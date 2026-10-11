import { describe, expect, test, vi } from 'vitest';
import type { BuiltLog } from '@mise/shared/pastries-log-model';
import type { PastryItem, Weekday } from '@mise/shared/pastries-model';
import type { KeyValueStorage } from '../session/backend';
import type { PastriesSource, StoredDoc } from './pastriesSource';
import { DAYS_CACHE_KEY, createPastriesStore } from './pastriesStore';
import type { PastriesDeps, PastriesMessage } from './pastriesStore';

// The store against a fake source and a fake browser: every decision of the current app's
// pastries-store.js, pastries-logs-store.js and the lock half of pastries-main.js, one test each.

type Watch = {
  onChange: (docs: StoredDoc[], fromCache?: boolean) => void;
  onError: (err: unknown) => void;
  stopped: boolean;
  date?: string;
};

function fakeSource() {
  const days: Watch[] = [];
  const logs: Watch[] = [];
  const forDate: Watch[] = [];
  const watcher = (list: Watch[], date?: string) =>
    (onChange: Watch['onChange'], onError: Watch['onError']) => {
      const w: Watch = { onChange, onError, stopped: false, date };
      list.push(w);
      return () => { w.stopped = true; };
    };
  const source = {
    watchDays: vi.fn((onChange: Watch['onChange'], onError: Watch['onError']) => watcher(days)(onChange, onError)),
    watchLogs: vi.fn((onChange: Watch['onChange'], onError: Watch['onError']) => watcher(logs)(onChange, onError)),
    watchLogsForDate: vi.fn((date: string, onChange: Watch['onChange'], onError: Watch['onError']) =>
      watcher(forDate, date)(onChange, onError)),
    saveDay: vi.fn<PastriesSource['saveDay']>(() => Promise.resolve()),
    getLog: vi.fn<PastriesSource['getLog']>(() => Promise.resolve(null)),
    confirmLog: vi.fn<PastriesSource['confirmLog']>((_id, build) => { build(null); return Promise.resolve(); }),
    deleteLog: vi.fn<PastriesSource['deleteLog']>(() => Promise.resolve()),
  } satisfies PastriesSource;
  const live = (list: Watch[]) => list.filter(w => !w.stopped);
  return { source, days, logs, forDate, live };
}

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: key => { map.delete(key); },
  };
}

// Wednesday 14 Oct 2026, 21:00 local: the work date is 2026-10-14.
const EVENING = new Date(2026, 9, 14, 21, 0, 0).getTime();

function setup({ storage = memoryStorage(), now = EVENING }: { storage?: ReturnType<typeof memoryStorage>; now?: number } = {}) {
  const fake = fakeSource();
  let clock = now;
  const timers: { callback: () => void; ms: number; cleared: boolean }[] = [];
  // A timer that has fired is spent, like a cleared one.
  const foreground: (() => void)[] = [];
  const deps: PastriesDeps = {
    storage,
    now: () => clock,
    setTimer: (callback, ms) => {
      const timer = { callback: () => { timer.cleared = true; callback(); }, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: handle => { (handle as { cleared: boolean }).cleared = true; },
    onForeground: callback => {
      foreground.push(callback);
      return () => { foreground.splice(foreground.indexOf(callback), 1); };
    },
    warn: () => {},
  };
  const store = createPastriesStore(fake.source, deps);
  const messages: PastriesMessage[] = [];
  store.onMessage(message => messages.push(message));
  return {
    ...fake, store, storage, timers, foreground, messages,
    setClock: (ms: number) => { clock = ms; },
    liveTimers: () => timers.filter(t => !t.cleared),
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const items = (...pairs: [string, number][]): PastryItem[] => pairs.map(([name, qty]) => ({ name, qty }));

describe('the first paint', () => {
  test('comes from the local copy, before the network answers', () => {
    const storage = memoryStorage({
      [DAYS_CACHE_KEY]: JSON.stringify({ Tuesday: { items: [{ name: 'Cornetti', qty: 24 }], note: 'butter' } }),
    });
    const { store } = setup({ storage });
    expect(store.getSnapshot().days.Tuesday).toEqual({ items: [{ name: 'Cornetti', qty: 24 }], note: 'butter' });
    expect(Object.keys(store.getSnapshot().days)).toHaveLength(7);
  });

  test('a copy written before the standing note existed still paints its lists', () => {
    const storage = memoryStorage({ [DAYS_CACHE_KEY]: JSON.stringify({ Monday: [{ name: 'Krapfen', qty: 6 }] }) });
    const { store } = setup({ storage });
    expect(store.getSnapshot().days.Monday).toEqual({ items: [{ name: 'Krapfen', qty: 6 }], note: '' });
  });

  test('a corrupt or missing copy is an empty week, never a crash', () => {
    expect(setup({ storage: memoryStorage({ [DAYS_CACHE_KEY]: '{not json' }) }).store.getSnapshot().days.Friday)
      .toEqual({ items: [], note: '' });
    expect(setup().store.getSnapshot().days.Sunday).toEqual({ items: [], note: '' });
  });
});

describe('the live days', () => {
  test('a snapshot is cleaned, shown and written to the local copy', () => {
    const { store, days, storage } = setup();
    store.start();
    days[0]!.onChange([{ id: 'Thursday', items: [{ name: '  Sfogliatelle ', qty: '12' }, { name: '' }], note: 'x' }]);
    expect(store.getSnapshot().days.Thursday).toEqual({ items: [{ name: 'Sfogliatelle', qty: 12 }], note: 'x' });
    expect(JSON.parse(storage.map.get(DAYS_CACHE_KEY)!).Thursday.items).toEqual([{ name: 'Sfogliatelle', qty: 12 }]);
  });

  test('a stream that dies says so', () => {
    const { store, days, messages } = setup();
    store.start();
    days[0]!.onError(new Error('permission-denied'));
    expect(messages).toEqual([{ kind: 'days-stream-broken' }]);
  });

  // ⚠️ The editor copies a day once and never repaints, so it must not copy the local copy while the
  // real answer is still on its way: the first paint is not «loaded».
  test('are loaded once the first answer arrives, not before', () => {
    const storage = memoryStorage({ [DAYS_CACHE_KEY]: JSON.stringify({ Tuesday: { items: [{ name: 'Cornetti', qty: 24 }], note: '' } }) });
    const { store, days } = setup({ storage });
    expect(store.getSnapshot().daysLoaded).toBe(false);
    store.start();
    expect(store.getSnapshot().daysLoaded).toBe(false);
    days[0]!.onChange([]);
    expect(store.getSnapshot().daysLoaded).toBe(true);
  });

  test('count as loaded when the stream dies before it answered, so nothing waits for ever', () => {
    const { store, days } = setup();
    store.start();
    days[0]!.onError(new Error('unavailable'));
    expect(store.getSnapshot().daysLoaded).toBe(true);
  });

  // ⚠️ Firestore answers «nothing» from its own offline copy about a list it has never fetched on
  // this phone, once it decides it is offline: a new phone on bad Wi-Fi. Believed, the editor would
  // open on an empty day and a Save would replace the real list when the signal came back.
  test('an EMPTY answer from the device cache is not believed on a phone with no local copy', () => {
    const { store, days, storage } = setup();
    store.start();
    days[0]!.onChange([], true);
    expect(store.getSnapshot().daysLoaded).toBe(false);
    // Not even drawn or remembered: the copy on screen stays what it was.
    expect(storage.map.has(DAYS_CACHE_KEY)).toBe(false);
    // The server's answer, even the same nothing, is believed.
    days[0]!.onChange([], false);
    expect(store.getSnapshot().daysLoaded).toBe(true);
  });

  test('an EMPTY answer from the device cache does not wipe a local copy that holds pastries', () => {
    const storage = memoryStorage({ [DAYS_CACHE_KEY]: JSON.stringify({ Tuesday: { items: [{ name: 'Cornetti', qty: 24 }], note: '' } }) });
    const { store, days } = setup({ storage });
    store.start();
    days[0]!.onChange([], true);
    expect(store.getSnapshot().daysLoaded).toBe(false);
    expect(store.getSnapshot().days.Tuesday.items).toEqual([{ name: 'Cornetti', qty: 24 }]);
    expect(JSON.parse(storage.map.get(DAYS_CACHE_KEY)!).Tuesday.items).toEqual([{ name: 'Cornetti', qty: 24 }]);
  });

  test('an EMPTY answer from the device cache is believed when the local copy said the venue never had a pastry', () => {
    const storage = memoryStorage({ [DAYS_CACHE_KEY]: JSON.stringify({}) });
    const { store, days } = setup({ storage });
    store.start();
    days[0]!.onChange([], true);
    expect(store.getSnapshot().daysLoaded).toBe(true);
  });

  // Working offline from Firestore's own copy is the app's local-first choice, unchanged.
  test('an answer from the device cache WITH documents is believed', () => {
    const { store, days } = setup();
    store.start();
    days[0]!.onChange([{ id: 'Friday', items: [{ name: 'Krapfen', qty: 6 }], note: '' }], true);
    expect(store.getSnapshot().daysLoaded).toBe(true);
    expect(store.getSnapshot().days.Friday.items).toEqual([{ name: 'Krapfen', qty: 6 }]);
  });

  test('a local copy written after the store was made does not change what the cache is believed about', () => {
    const storage = memoryStorage();
    const { store, days } = setup({ storage });
    store.start();
    store.saveDay('Monday', [], '');
    // The save wrote an (empty) local copy; the store still remembers the phone had none when it opened.
    expect(storage.map.has(DAYS_CACHE_KEY)).toBe(true);
    days[0]!.onChange([], true);
    expect(store.getSnapshot().daysLoaded).toBe(false);
  });

  test('stay loaded across a stop and a start', () => {
    const { store, days } = setup();
    store.start();
    days[0]!.onChange([]);
    store.stop();
    store.start();
    expect(store.getSnapshot().daysLoaded).toBe(true);
  });
});

describe('saving a day', () => {
  test('is local-first: the screen and the copy change before the server answers', () => {
    const { store, source, storage } = setup();
    source.saveDay.mockReturnValue(new Promise(() => {}));
    const seen = vi.fn();
    store.subscribe(seen);
    store.saveDay('Friday', items(['Cornetti', 24], ['', 0]), 'note');
    expect(store.getSnapshot().days.Friday).toEqual({ items: [{ name: 'Cornetti', qty: 24 }], note: 'note' });
    expect(seen).toHaveBeenCalled();
    expect(JSON.parse(storage.map.get(DAYS_CACHE_KEY)!).Friday.note).toBe('note');
    expect(source.saveDay).toHaveBeenCalledWith('Friday', [{ name: 'Cornetti', qty: 24 }], 'note');
  });

  test('⚠️ an omitted note KEEPS the note there; an empty one clears it', () => {
    const { store, source } = setup();
    store.saveDay('Monday', items(['A', 1]), 'keep me');
    store.saveDay('Monday', items(['B', 2]));
    expect(source.saveDay).toHaveBeenLastCalledWith('Monday', [{ name: 'B', qty: 2 }], 'keep me');
    store.saveDay('Monday', items(['B', 2]), '');
    expect(source.saveDay).toHaveBeenLastCalledWith('Monday', [{ name: 'B', qty: 2 }], '');
  });

  test('a refused write puts the day back and says so', async () => {
    const { store, source, messages } = setup();
    store.saveDay('Tuesday', items(['Old', 3]), '');
    source.saveDay.mockRejectedValueOnce(new Error('permission-denied'));
    store.saveDay('Tuesday', items(['New', 9]), '');
    expect(store.getSnapshot().days.Tuesday.items).toEqual([{ name: 'New', qty: 9 }]);
    await flush();
    expect(store.getSnapshot().days.Tuesday.items).toEqual([{ name: 'Old', qty: 3 }]);
    expect(messages).toEqual([{ kind: 'save-failed', day: 'Tuesday' }]);
  });
});

describe('correcting one quantity from the list', () => {
  test('lands on the row it was typed on, and keeps the note', () => {
    const { store, source } = setup();
    store.saveDay('Saturday', items(['Cornetti', 24], ['Bomboloni', 10]), 'n');
    expect(store.setItemQuantity('Saturday', 1, 'Bomboloni', 14)).toBe(true);
    expect(source.saveDay).toHaveBeenLastCalledWith('Saturday', [{ name: 'Cornetti', qty: 24 }, { name: 'Bomboloni', qty: 14 }], 'n');
  });

  test('⚠️ a row that moved under the finger is REFUSED, not written onto another pastry', () => {
    const { store, source, days } = setup();
    store.start();
    days[0]!.onChange([{ id: 'Saturday', items: [{ name: 'Bomboloni', qty: 10 }, { name: 'Cornetti', qty: 24 }] }]);
    source.saveDay.mockClear();
    // The screen drew Cornetti at index 0; another phone has since reordered the list.
    expect(store.setItemQuantity('Saturday', 0, 'Cornetti', 30)).toBe(false);
    expect(source.saveDay).not.toHaveBeenCalled();
  });
});

describe('tonight\'s confirmations and the lock', () => {
  test('watches the work date under way, and a confirmed list is locked', () => {
    const { store, forDate } = setup();
    store.start();
    expect(forDate[0]!.date).toBe('2026-10-14');
    forDate[0]!.onChange([{ id: '2026-10-14_Thursday', date: '2026-10-14', day: 'Thursday' }]);
    expect(store.isLocked('Thursday')).toBe(true);
    expect(store.isLocked('Friday')).toBe(false);
  });

  test('⚠️ a confirmations failure locks NOTHING', () => {
    const { store, forDate } = setup();
    store.start();
    forDate[0]!.onChange([{ id: '2026-10-14_Thursday' }]);
    forDate[0]!.onError(new Error('unavailable'));
    expect(store.isLocked('Thursday')).toBe(false);
  });

  test('Edit grants tonight\'s permission, stored for this phone', () => {
    const { store, forDate, storage } = setup();
    store.start();
    forDate[0]!.onChange([{ id: '2026-10-14_Thursday' }]);
    store.grantEdit('Thursday');
    expect(store.isLocked('Thursday')).toBe(false);
    expect(storage.map.get('pastries-edit-Thursday')).toBe('2026-10-14');
  });

  test('last night\'s permission is spent', () => {
    const storage = memoryStorage({ 'pastries-edit-Thursday': '2026-10-13' });
    const { store, forDate } = setup({ storage });
    store.start();
    forDate[0]!.onChange([{ id: '2026-10-14_Thursday' }]);
    expect(store.isLocked('Thursday')).toBe(true);
  });

  test('the roll at 4am asks about the NEW date and drops the old question', () => {
    const { store, forDate, liveTimers, setClock, live } = setup();
    store.start();
    const [timer] = liveTimers();
    // 21:00 → 04:00 is seven hours; one second more so the clock has certainly crossed it.
    expect(timer!.ms).toBe(7 * 3600 * 1000 + 1000);
    forDate[0]!.onChange([{ id: '2026-10-14_Thursday' }]);
    setClock(new Date(2026, 9, 15, 4, 0, 1).getTime());
    timer!.callback();
    expect(live(forDate).map(w => w.date)).toEqual(['2026-10-15']);
    expect(store.isLocked('Thursday')).toBe(false);
    expect(liveTimers()).toHaveLength(1);
  });

  test('⚠️ coming back to the foreground after 4am asks again; before it, nothing happens', () => {
    const { store, forDate, foreground, setClock } = setup();
    store.start();
    foreground[0]!();
    expect(forDate).toHaveLength(1);
    setClock(new Date(2026, 9, 15, 9, 0, 0).getTime());
    foreground[0]!();
    expect(forDate.map(w => w.date)).toEqual(['2026-10-14', '2026-10-15']);
    expect(forDate[0]!.stopped).toBe(true);
  });

  // ⚠️ Until tonight's confirmations have answered, «nothing is confirmed» is only «nobody has said».
  // The editor opened by its address asks the lock question once it knows.
  describe('confirmedLoaded', () => {
    test('is false until the first answer, then true', () => {
      const { store, forDate } = setup();
      expect(store.getSnapshot().confirmedLoaded).toBe(false);
      store.start();
      expect(store.getSnapshot().confirmedLoaded).toBe(false);
      forDate[0]!.onChange([]);
      expect(store.getSnapshot().confirmedLoaded).toBe(true);
    });

    test('is true after an answer that confirms something, and still true when it changes', () => {
      const { store, forDate } = setup();
      store.start();
      forDate[0]!.onChange([{ id: '2026-10-14_Thursday', date: '2026-10-14', day: 'Thursday' }]);
      forDate[0]!.onChange([]);
      expect(store.getSnapshot().confirmedLoaded).toBe(true);
    });

    test('counts a failed watch as an answer, with nothing confirmed, so nothing waits for ever', () => {
      const { store, forDate } = setup();
      store.start();
      forDate[0]!.onError(new Error('unavailable'));
      expect(store.getSnapshot().confirmedLoaded).toBe(true);
      expect(store.getSnapshot().confirmed.size).toBe(0);
      expect(store.isLocked('Thursday')).toBe(false);
    });

    test('goes back to false when the roll at 4am starts a new watch, and true again at its answer', () => {
      const { store, forDate, liveTimers, setClock } = setup();
      store.start();
      forDate[0]!.onChange([]);
      expect(store.getSnapshot().confirmedLoaded).toBe(true);

      const [timer] = liveTimers();
      setClock(new Date(2026, 9, 15, 4, 0, 1).getTime());
      timer!.callback();
      expect(store.getSnapshot().confirmedLoaded).toBe(false);
      forDate[1]!.onChange([]);
      expect(store.getSnapshot().confirmedLoaded).toBe(true);
    });

    test('goes back to false when the app comes back after 4am, and an old date\'s answer cannot set it', () => {
      const { store, forDate, foreground, setClock } = setup();
      store.start();
      forDate[0]!.onChange([]);
      setClock(new Date(2026, 9, 15, 9, 0, 0).getTime());
      foreground[0]!();
      expect(store.getSnapshot().confirmedLoaded).toBe(false);

      forDate[0]!.onChange([]);
      expect(store.getSnapshot().confirmedLoaded).toBe(false);
      forDate[1]!.onChange([]);
      expect(store.getSnapshot().confirmedLoaded).toBe(true);
    });

    test('is false again after a stop and a start, until the new watch answers', () => {
      const { store, forDate } = setup();
      store.start();
      forDate[0]!.onChange([]);
      store.stop();
      store.start();
      expect(store.getSnapshot().confirmedLoaded).toBe(false);
      forDate[1]!.onChange([]);
      expect(store.getSnapshot().confirmedLoaded).toBe(true);
    });
  });

  test('an answer about an old date never overwrites the new one', () => {
    const { store, forDate, setClock, foreground } = setup();
    store.start();
    setClock(new Date(2026, 9, 15, 9, 0, 0).getTime());
    foreground[0]!();
    forDate[0]!.onChange([{ id: '2026-10-14_Thursday' }]);
    expect(store.isLocked('Thursday')).toBe(false);
  });
});

describe('confirming a list', () => {
  test('writes the record for the work date, ticks the day off at once and spends the permission', async () => {
    const { store, source, storage } = setup({ storage: memoryStorage({ 'pastries-edit-Friday': '2026-10-14' }) });
    store.start();
    const saved = await store.confirmDay('Friday', items(['Cornetti', 24]), 'note');
    expect(source.confirmLog.mock.calls[0]![0]).toBe('2026-10-14_Friday');
    expect(saved).toMatchObject({ id: '2026-10-14_Friday', date: '2026-10-14', day: 'Friday', items: [{ name: 'Cornetti', qty: 24 }], note: 'note' });
    expect(store.getSnapshot().confirmed.has('Friday')).toBe(true);
    expect(storage.map.has('pastries-edit-Friday')).toBe(false);
    expect(store.isLocked('Friday')).toBe(true);
  });

  test('confirming twice in one night keeps the first createdAt', async () => {
    const { store, source } = setup();
    source.confirmLog.mockImplementationOnce((_id, build) => {
      build({ createdAt: '2026-10-14T19:00:00.000Z' });
      return Promise.resolve();
    });
    const saved = await store.confirmDay('Friday', items(['Cornetti', 24]), '');
    expect(saved!.createdAt).toBe('2026-10-14T19:00:00.000Z');
  });

  test('⚠️ NOT optimistic: a refused record is not shown as done, and the failure is said', async () => {
    const { store, source, messages } = setup();
    source.confirmLog.mockRejectedValueOnce(new Error('unavailable'));
    expect(await store.confirmDay('Friday', [], '')).toBeNull();
    expect(store.getSnapshot().confirmed.has('Friday')).toBe(false);
    expect(messages).toEqual([{ kind: 'record-failed', day: 'Friday' }]);
  });

  test('tonight\'s record is asked for by its id; a failed read promises nothing', async () => {
    const { store, source } = setup();
    source.getLog.mockResolvedValueOnce({ id: '2026-10-14_Friday' });
    expect(await store.tonightsRecord('Friday')).toEqual({ id: '2026-10-14_Friday' });
    expect(source.getLog).toHaveBeenCalledWith('2026-10-14_Friday');
    source.getLog.mockRejectedValueOnce(new Error('offline'));
    expect(await store.tonightsRecord('Friday')).toBeNull();
  });
});

describe('records', () => {
  test('are read only while Records is open', () => {
    const { store, logs, live } = setup();
    store.start();
    expect(logs).toHaveLength(0);
    store.startLogs();
    logs[0]!.onChange([
      { id: '2026-10-13_Wednesday', date: '2026-10-13', day: 'Wednesday', items: [], createdAt: 'x' },
      { id: 'nonsense' },
    ]);
    expect(store.getSnapshot().logs.map(l => l.id)).toEqual(['2026-10-13_Wednesday']);
    store.stopLogs();
    expect(live(logs)).toHaveLength(0);
  });

  test('a second start replaces the first, and a late answer from the first is ignored', () => {
    const { store, logs, live } = setup();
    store.startLogs();
    store.startLogs();
    expect(live(logs)).toHaveLength(1);
    logs[0]!.onChange([{ id: '2026-10-13_Wednesday', date: '2026-10-13', day: 'Wednesday' }]);
    expect(store.getSnapshot().logs).toEqual([]);
  });

  test('a records stream that dies says so', () => {
    const { store, logs, messages } = setup();
    store.startLogs();
    logs[0]!.onError(new Error('x'));
    expect(messages).toEqual([{ kind: 'logs-stream-broken' }]);
  });

  test('removing a record: true when done, false and said when refused', async () => {
    const { store, source, messages } = setup();
    expect(await store.removeLog('2026-10-13_Wednesday')).toBe(true);
    expect(source.deleteLog).toHaveBeenCalledWith('2026-10-13_Wednesday');
    source.deleteLog.mockRejectedValueOnce(new Error('x'));
    expect(await store.removeLog('2026-10-13_Wednesday')).toBe(false);
    expect(messages).toEqual([{ kind: 'remove-failed' }]);
  });
});

describe('start and stop', () => {
  test('stop ends every listener and the 4am timer', () => {
    const { store, days, forDate, logs, live, liveTimers, foreground } = setup();
    store.start();
    store.startLogs();
    store.stop();
    expect(live(days)).toHaveLength(0);
    expect(live(forDate)).toHaveLength(0);
    expect(live(logs)).toHaveLength(0);
    expect(liveTimers()).toHaveLength(0);
    expect(foreground).toHaveLength(0);
  });

  test('start → stop → start leaves exactly one of each (React\'s development mode)', () => {
    const { store, days, forDate, live, liveTimers, foreground } = setup();
    store.start();
    store.stop();
    store.start();
    expect(live(days)).toHaveLength(1);
    expect(live(forDate)).toHaveLength(1);
    expect(liveTimers()).toHaveLength(1);
    expect(foreground).toHaveLength(1);
  });

  test('two starts in a row never leave a listener behind', () => {
    const { store, days, forDate, live } = setup();
    store.start();
    store.start();
    expect(live(days)).toHaveLength(1);
    expect(live(forDate)).toHaveLength(1);
  });
});

// The BuiltLog type is what Confirm hands back; this only pins that the store returns it whole.
test('the record returned is the one built inside the transaction', async () => {
  const { store, source } = setup();
  let built: BuiltLog | null = null;
  source.confirmLog.mockImplementationOnce((_id, build) => { built = build(null); return Promise.resolve(); });
  const saved = await store.confirmDay('Monday' as Weekday, [], '');
  expect(saved).toBe(built);
});
