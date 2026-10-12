import { describe, expect, test, vi } from 'vitest';
import type { CountMap } from '@mise/shared/inventory-model';
import type { KeyValueStorage } from '../session/backend';
import type { Clearing, SnapshotMeta, StocktakeSource, StoredDoc } from './stocktakeSource';
import {
  SAVE_DELAY_MS, SETTLE_MS, createStocktakeStore, monthCacheKey, unsavedCacheKey,
} from './stocktakeStore';
import type { StocktakeDeps, StocktakeMessage } from './stocktakeStore';

// The store against a fake source and a fake browser: every decision of the current app's
// js/inventory/inventory-store.js (and the waits of inventory-main.js), one test each, plus the two
// Mise 2 differences (a count waits for the month's first answer; changing month needs no reload).

type Doc = Record<string, unknown>;
type Watch = {
  onChange: (doc: StoredDoc | null, meta: SnapshotMeta) => void;
  onError: (err: unknown) => void;
  stopped: boolean;
};
type IngredientWatch = { onChange: (list: StoredDoc[]) => void; onError: (err: unknown) => void; stopped: boolean };
type Save = {
  monthId: string;
  patch: Record<string, unknown>;
  clear: Clearing;
  // Answered by the server (landed or refused).
  answered: boolean;
  // The server's document, as the spec last said it, already has this write in it.
  applied: boolean;
  resolve: () => void;
  reject: (err: unknown) => void;
};

// A write merged into a document, the way Firestore's setDoc(…, { merge: true }) does it: maps key by
// key, a `true` in `clear` like deleteField().
function merged(doc: Doc | null, save: Pick<Save, 'patch' | 'clear'>): Doc {
  const next: Doc = { ...(doc ?? {}) };
  for (const [key, value] of Object.entries(save.patch)) {
    next[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? { ...((next[key] as Doc | undefined) ?? {}), ...(value as Doc) }
      : value;
  }
  for (const [map, ids] of Object.entries(save.clear)) {
    const kept = { ...((next[map] as Doc | undefined) ?? {}) };
    for (const id of Object.keys(ids)) delete kept[id];
    next[map] = kept;
  }
  return next;
}

// A source that behaves like the SDK where it matters to the store:
//   • a write is shown back in a snapshot BEFORE its promise settles, but not at once: the SDK shows
//     it only after its own database (IndexedDB) has it, so the echo comes a moment after the call
//     has returned (and, offline, from the cache: `fromServer` false). `setEcho(false)` holds it back
//     until `show()` — the moment the SDK has not put it in its database yet;
//   • a refused write is taken back out of the next snapshot;
//   • `answer()` is the raw document the server sends, laid over nothing — so a spec can send a
//     snapshot that does not have this phone's number in it;
//   • `fail()` ends a month's stream the way the SDK does when the rules refuse it: the error is
//     delivered once and nothing is ever heard from that listener again.
function fakeSource() {
  const months = new Map<string, Watch[]>();
  const ingredients: IngredientWatch[] = [];
  const saves: Save[] = [];
  const server = new Map<string, Doc | null>();
  // How a save answers: 'resolve' at once, 'never' (offline: a write's promise does not settle),
  // or 'manual' (the spec answers it through `saves`).
  let mode: 'resolve' | 'never' | 'manual' = 'resolve';
  let echoOn = true;
  const liveMonth = (monthId: string) => (months.get(monthId) ?? []).filter(w => !w.stopped);
  // What a snapshot shows: the server's document with the writes it has not answered laid over it.
  function view(monthId: string): Doc | null {
    let doc = server.get(monthId) ?? null;
    for (const save of saves) {
      if (save.monthId === monthId && !save.answered && !save.applied) doc = merged(doc, save);
    }
    return doc;
  }
  function tell(monthId: string, doc: Doc | null, fromServer: boolean): void {
    for (const w of liveMonth(monthId)) w.onChange(doc === null ? null : { id: monthId, ...doc }, { fromServer });
  }
  const source = {
    watchMonth: vi.fn((monthId: string, onChange: Watch['onChange'], onError: Watch['onError']) => {
      const w: Watch = { onChange, onError, stopped: false };
      months.set(monthId, [...(months.get(monthId) ?? []), w]);
      return () => { w.stopped = true; };
    }),
    getMonthOnce: vi.fn<StocktakeSource['getMonthOnce']>(() => Promise.resolve(null)),
    saveMonthFields: vi.fn((monthId: string, patch: Readonly<Record<string, unknown>>, clear: Clearing = {}) =>
      new Promise<void>((resolve, reject) => {
        const save: Save = {
          monthId, patch: { ...patch }, clear, answered: false, applied: false,
          resolve: () => {
            save.answered = true;
            if (!save.applied) server.set(monthId, merged(server.get(monthId) ?? null, save));
            tell(monthId, view(monthId), true);
            resolve();
          },
          reject: err => {
            save.answered = true;
            tell(monthId, view(monthId), mode !== 'never');
            reject(err);
          },
        };
        saves.push(save);
        const echoes = echoOn;
        const fromServer = mode !== 'never';
        queueMicrotask(() => { if (echoes && !save.answered) tell(monthId, view(monthId), fromServer); });
        if (mode === 'resolve') queueMicrotask(() => save.resolve());
      })),
    getOrdersInMonth: vi.fn<StocktakeSource['getOrdersInMonth']>(() => Promise.resolve([])),
    watchIngredients: vi.fn((onChange: IngredientWatch['onChange'], onError: IngredientWatch['onError']) => {
      const w: IngredientWatch = { onChange, onError, stopped: false };
      ingredients.push(w);
      return () => { w.stopped = true; };
    }),
  } satisfies StocktakeSource;
  return {
    source, saves, ingredients,
    liveMonth,
    // The month's document as Firestore would send it (null: it does not exist), from the server
    // unless said otherwise (`fromServer` false: the browser's own copy). Writes still in the air
    // are taken to be in it already: the server heard them before whoever changed it since.
    answer(monthId: string, doc: Doc | null, fromServer = true) {
      server.set(monthId, doc);
      for (const save of saves) if (save.monthId === monthId && !save.answered) save.applied = true;
      tell(monthId, doc, fromServer);
    },
    // The SDK has now put what was handed over in its own database: the next snapshot shows it.
    show(monthId: string, fromServer = mode !== 'never') { tell(monthId, view(monthId), fromServer); },
    // The month's stream dies (the rules refuse it): the error is delivered, then nothing more.
    fail(monthId: string, err: unknown) {
      for (const w of liveMonth(monthId)) {
        w.stopped = true;
        w.onError(err);
      }
    },
    setEcho(on: boolean) { echoOn = on; },
    setMode(next: typeof mode) { mode = next; },
  };
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

// 14 Oct 2026, 20:00 local.
const NOW = new Date(2026, 9, 14, 20, 0, 0).getTime();
const LID = 'panificio-miano';

const microtasks = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

function setup({ storage = memoryStorage() }: { storage?: ReturnType<typeof memoryStorage> } = {}) {
  const fake = fakeSource();
  let clock = NOW;
  const timers: { callback: () => void; due: number; cleared: boolean }[] = [];
  const hide: (() => void)[] = [];
  const deps: StocktakeDeps = {
    storage,
    now: () => clock,
    setTimer: (callback, ms) => {
      const timer = { callback, due: clock + ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: handle => { (handle as { cleared: boolean }).cleared = true; },
    onHide: callback => {
      hide.push(callback);
      return () => { hide.splice(hide.indexOf(callback), 1); };
    },
    warn: () => {},
  };
  // Moves the clock, firing every timer that falls due on the way, in order, with the promises
  // they release settled in between.
  async function advance(ms: number): Promise<void> {
    const end = clock + ms;
    for (;;) {
      await microtasks();
      const next = timers.filter(t => !t.cleared && t.due <= end).sort((a, b) => a.due - b.due)[0];
      if (!next) break;
      clock = next.due;
      next.cleared = true;
      next.callback();
    }
    clock = end;
    await microtasks();
  }
  const store = createStocktakeStore(fake.source, LID, deps);
  const messages: StocktakeMessage[] = [];
  store.onMessage(message => messages.push(message));
  return { ...fake, store, storage, deps, messages, advance, hide };
}

// A store watching October, which has answered (empty unless said otherwise).
async function ready(doc: Record<string, unknown> | null = null, options: Parameters<typeof setup>[0] = {}) {
  const t = setup(options);
  t.store.start();
  t.store.openMonth('2026-10');
  t.answer('2026-10', doc);
  await microtasks();
  return t;
}

const SAVED_KEY = unsavedCacheKey(LID, '2026-10');
const CLOSED_AT = '2026-10-31T20:00:00.000Z';

// What a page torn down before the SDK had shown its numbers back leaves in storage: the counts were
// typed with no signal (every write handed over, none answered) and the page went away.
async function leftBehind(counts: readonly (readonly [CountMap, string, string])[]) {
  const storage = memoryStorage();
  const t = await ready(null, { storage });
  t.setMode('never');
  t.setEcho(false);
  for (const [map, id, value] of counts) t.store.setCount(map, id, value);
  await t.advance(SAVE_DELAY_MS);
  t.store.stop();
  await microtasks();
  return storage;
}

// A NEW store on that storage, opened on October and not yet answered.
function openedAgain(storage: ReturnType<typeof memoryStorage>) {
  const t = setup({ storage });
  t.store.start();
  t.store.openMonth('2026-10');
  return t;
}

describe('the local copy', () => {
  test('is painted before Firestore answers, from the current app’s key for this venue and month', () => {
    const storage = memoryStorage({
      [monthCacheKey(LID, '2026-10')]: JSON.stringify({ month: '2026-10', closing: { flour: 2 } }),
      [monthCacheKey('another-venue', '2026-10')]: JSON.stringify({ month: '2026-10', closing: { flour: 99 } }),
    });
    const { store } = setup({ storage });
    store.openMonth('2026-10');
    expect(monthCacheKey(LID, '2026-10')).toBe('inventory-panificio-miano-2026-10');
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 2 });
    expect(store.getSnapshot().monthLoaded).toBe(false);
  });

  test('a corrupt copy is no copy: an empty month of the right shape', () => {
    const storage = memoryStorage({ [monthCacheKey(LID, '2026-10')]: '{not json' });
    const { store } = setup({ storage });
    store.openMonth('2026-10');
    expect(store.getSnapshot().month).toMatchObject({ id: '2026-10', closing: {}, opening: {}, closedAt: '' });
  });

  test('Firestore’s answer replaces it, and is written back for next time', async () => {
    const storage = memoryStorage({ [monthCacheKey(LID, '2026-10')]: JSON.stringify({ month: '2026-10', closing: { flour: 2 } }) });
    const { store, answer } = setup({ storage });
    store.openMonth('2026-10');
    answer('2026-10', { month: '2026-10', closing: { flour: 5 } });
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 5 });
    expect(JSON.parse(storage.map.get(monthCacheKey(LID, '2026-10'))!).closing).toEqual({ flour: 5 });
    // The copy is the document's shape: no `id` field.
    expect(JSON.parse(storage.map.get(monthCacheKey(LID, '2026-10'))!)).not.toHaveProperty('id');
  });
});

describe('a count', () => {
  test('⚠️ is refused until the month has answered once (Mise 2: never into a month that turns out closed)', async () => {
    const { store, answer, saves, advance } = setup();
    store.openMonth('2026-10');
    expect(store.setCount('closing', 'flour', '3')).toBe(false);
    answer('2026-10', { month: '2026-10', closedAt: '2026-10-31T20:00:00.000Z' });
    expect(store.setCount('closing', 'flour', '3')).toBe(false);
    await advance(SAVE_DELAY_MS * 2);
    expect(saves).toEqual([]);
  });

  test('changes the screen at once, the local copy too, and is sent 700ms after the last change', async () => {
    const { store, saves, storage, advance } = await ready();
    expect(store.setCount('closing', 'flour', '3,5')).toBe(true);
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 3.5 });
    expect(JSON.parse(storage.map.get(monthCacheKey(LID, '2026-10'))!).closing).toEqual({ flour: 3.5 });
    await advance(SAVE_DELAY_MS - 1);
    store.setCount('closing', 'flour', '4');
    await advance(SAVE_DELAY_MS - 1);
    expect(saves).toEqual([]);
    await advance(1);
    expect(saves).toHaveLength(1);
    expect(saves[0]!.monthId).toBe('2026-10');
    expect(saves[0]!.patch).toEqual({
      month: '2026-10',
      updatedAt: new Date(NOW + 2 * (SAVE_DELAY_MS - 1) + 1).toISOString(),
      createdAt: new Date(NOW + 2 * (SAVE_DELAY_MS - 1) + 1).toISOString(),
      closing: { flour: 4 },
    });
  });

  test('createdAt is sent only while the month has none', async () => {
    const { store, saves, advance } = await ready({ month: '2026-10', createdAt: '2026-10-01T08:00:00.000Z' });
    store.setCount('closing', 'flour', '1');
    await advance(SAVE_DELAY_MS);
    expect(saves[0]!.patch).not.toHaveProperty('createdAt');
  });

  test('⚠️ an emptied box is a REMOVAL, never a zero; a typed zero is a real count', async () => {
    const { store, saves, advance } = await ready({ month: '2026-10', closing: { flour: 2, salt: 1 } });
    store.setCount('closing', 'flour', '');
    store.setCount('closing', 'salt', '0');
    expect(store.getSnapshot().month?.closing).toEqual({ salt: 0 });
    await advance(SAVE_DELAY_MS);
    expect(saves[0]!.patch.closing).toEqual({ salt: 0 });
    expect(saves[0]!.clear).toEqual({ closing: { flour: true } });
  });

  test('junk and negatives are refused by the reading, which clears the box rather than inventing a number', async () => {
    const { store } = await ready({ month: '2026-10', closing: { flour: 2 } });
    store.setCount('closing', 'flour', '-2');
    expect(store.getSnapshot().month?.closing).toEqual({});
  });

  test('only the four count maps can be written', async () => {
    const { store } = await ready();
    expect(store.setCount('names' as never, 'flour', 'x')).toBe(false);
    expect(store.setCount('closing', '', '3')).toBe(false);
  });

  test('⚠️ a refused write keeps the count, says so, and goes again with the next save', async () => {
    const { store, saves, setMode, messages, advance } = await ready();
    setMode('manual');
    store.setCount('closing', 'flour', '3');
    await advance(SAVE_DELAY_MS);
    saves[0]!.reject(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await microtasks();
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 3 });
    expect(messages).toEqual([{ kind: 'not-saved-yet' }]);
    store.setCount('closing', 'salt', '1');
    await advance(SAVE_DELAY_MS);
    expect(saves[1]!.patch.closing).toEqual({ flour: 3, salt: 1 });
  });

  test('⚠️ a second save never waits behind the first: it goes at once and carries only what is new', async () => {
    const { store, saves, setMode, advance } = await ready();
    setMode('manual');
    store.setCount('closing', 'flour', '3');
    await advance(SAVE_DELAY_MS);
    store.setCount('closing', 'salt', '1');
    await advance(SAVE_DELAY_MS);
    expect(saves).toHaveLength(2);
    expect(saves[0]!.patch.closing).toEqual({ flour: 3 });
    expect(saves[1]!.patch.closing).toEqual({ salt: 1 });
  });

  test('⚠️⚠️ a snapshot arriving mid-write does not take back the number being written', async () => {
    const { store, saves, setMode, answer, advance } = await ready({ month: '2026-10', closing: { flour: 1 } });
    setMode('manual');
    store.setCount('closing', 'flour', '3');
    store.setCount('closing', 'salt', '');
    await advance(SAVE_DELAY_MS);
    expect(saves).toHaveLength(1);
    // Another phone's write lands first: its document has neither of this phone's changes yet.
    answer('2026-10', { month: '2026-10', closing: { flour: 1, salt: 7, sugar: 2 } });
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 3, sugar: 2 });
  });

  test('a count typed in the other phone’s box arrives, and the untouched boxes follow it', async () => {
    const { store, answer } = await ready({ month: '2026-10', closing: { flour: 1 } });
    answer('2026-10', { month: '2026-10', closing: { flour: 1, sugar: 2 } });
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 1, sugar: 2 });
  });

  test('«unsent» holds from a count until Firestore confirms it, and comes back after a refusal', async () => {
    const { store, saves, setMode, advance } = await ready();
    setMode('manual');
    expect(store.getSnapshot().unsent).toBe(false);
    store.setCount('closing', 'flour', '3');
    expect(store.getSnapshot().unsent).toBe(true);
    await advance(SAVE_DELAY_MS);
    expect(store.getSnapshot().unsent).toBe(true);
    saves[0]!.reject(new Error('denied'));
    await microtasks();
    expect(store.getSnapshot().unsent).toBe(true);
    // Nothing retries by itself: the next count carries the refused one with it.
    store.setCount('closing', 'salt', '1');
    void store.flush();
    await microtasks();
    expect(saves.at(-1)!.patch.closing).toEqual({ flour: 3, salt: 1 });
    saves.at(-1)!.resolve();
    await microtasks();
    expect(store.getSnapshot().unsent).toBe(false);
  });

  test('a page being hidden sends what is waiting at once', async () => {
    const { store, saves, hide } = await ready();
    store.setCount('closing', 'flour', '3');
    hide.forEach(callback => callback());
    await microtasks();
    expect(saves).toHaveLength(1);
  });

  test('⚠️ flushBeforeLeaving answers within the bound even when the write never does (no signal)', async () => {
    const { store, setMode, advance } = await ready();
    setMode('never');
    store.setCount('closing', 'flour', '3');
    let done = false;
    void store.flushBeforeLeaving().then(() => { done = true; });
    await advance(SETTLE_MS - 1);
    expect(done).toBe(false);
    await advance(1);
    expect(done).toBe(true);
  });
});

// With no signal a write's promise never settles. The store used to keep ONE write in the air and hold
// every later count in memory behind it, so only the first reached the SDK's own queue (the one in the
// browser's database, which outlasts the page): reproduced on the emulator on 11 Oct 2026, three counts
// typed, one survived. Every save is now handed over at once, and these are the rules that make that safe.
describe('several writes in the air (a storeroom with no signal)', () => {
  const denied = () => Object.assign(new Error('denied'), { code: 'permission-denied' });

  test('⚠️⚠️ offline, every count is handed over at once: three typed, three saves, each carrying only its own', async () => {
    const { store, saves, setMode, advance } = await ready();
    setMode('never');
    store.setCount('closing', 'flour', '1');
    await advance(SAVE_DELAY_MS);
    store.setCount('closing', 'salt', '2');
    await advance(SAVE_DELAY_MS);
    store.setCount('closing', 'sugar', '3');
    await advance(SAVE_DELAY_MS);
    expect(saves.map(s => s.patch.closing)).toEqual([{ flour: 1 }, { salt: 2 }, { sugar: 3 }]);
    // None of them has answered, and all three are on screen — and still counted as unsent.
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 1, salt: 2, sugar: 3 });
    expect(store.getSnapshot().unsent).toBe(true);
  });

  test('⚠️⚠️ the second write answering does not settle the first one’s numbers', async () => {
    const { store, saves, setMode, advance } = await ready();
    setMode('manual');
    store.setCount('closing', 'flour', '1');
    await advance(SAVE_DELAY_MS);
    store.setCount('closing', 'salt', '2');
    await advance(SAVE_DELAY_MS);
    saves[1]!.resolve();
    await microtasks();
    expect(store.getSnapshot().unsent).toBe(true);
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 1, salt: 2 });
    saves[0]!.resolve();
    await microtasks();
    expect(store.getSnapshot().unsent).toBe(false);
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 1, salt: 2 });
  });

  test('⚠️⚠️ a failed first write is sent again even though the second landed — once the last has answered', async () => {
    const { store, saves, setMode, advance, messages } = await ready();
    setMode('manual');
    store.setCount('closing', 'flour', '1');
    await advance(SAVE_DELAY_MS);
    store.setCount('closing', 'salt', '2');
    await advance(SAVE_DELAY_MS);
    saves[0]!.reject(denied());
    await microtasks();
    // Said at once, but nothing is put back while another write is still out.
    expect(messages).toEqual([{ kind: 'not-saved-yet' }]);
    expect(saves).toHaveLength(2);
    expect(store.getSnapshot().unsent).toBe(true);
    saves[1]!.resolve();
    await microtasks();
    // The refusal is acted on now: both are waiting again, and the screen never lost either.
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 1, salt: 2 });
    expect(store.getSnapshot().unsent).toBe(true);
    void store.flush();
    await microtasks();
    expect(saves).toHaveLength(3);
    expect(saves[2]!.patch.closing).toEqual({ flour: 1, salt: 2 });
  });

  test('⚠️ a number typed while the writes were out wins over what comes back from a failure', async () => {
    const { store, saves, setMode, advance } = await ready();
    setMode('manual');
    store.setCount('closing', 'flour', '1');
    await advance(SAVE_DELAY_MS);
    store.setCount('closing', 'salt', '2');
    await advance(SAVE_DELAY_MS);
    store.setCount('closing', 'flour', '9');
    saves[0]!.reject(denied());
    saves[1]!.reject(denied());
    await microtasks();
    void store.flush();
    await microtasks();
    expect(saves.at(-1)!.patch.closing).toEqual({ flour: 9, salt: 2 });
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 9, salt: 2 });
  });

  test('⚠️ a correction another phone made while writes were out shows once they have ALL answered', async () => {
    const { store, saves, setMode, answer, advance } = await ready({ month: '2026-10', closing: { flour: 1 } });
    setMode('manual');
    store.setCount('closing', 'flour', '3');
    await advance(SAVE_DELAY_MS);
    store.setCount('closing', 'salt', '2');
    await advance(SAVE_DELAY_MS);
    // The server has both writes, and then the other phone corrects the flour. Until this phone's
    // writes have answered, its own numbers stay laid over what the server says.
    answer('2026-10', { month: '2026-10', closing: { flour: 9, salt: 2 } });
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 3, salt: 2 });
    saves[0]!.resolve();
    await microtasks();
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 3, salt: 2 });
    saves[1]!.resolve();
    await microtasks();
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 9, salt: 2 });
    expect(store.getSnapshot().unsent).toBe(false);
  });

  test('⚠️ changing month offline hands the old month’s counts over at once — two saves, nothing waited for', async () => {
    const { store, saves, setMode, advance } = await ready();
    setMode('never');
    store.setCount('closing', 'flour', '1');
    await advance(SAVE_DELAY_MS);
    store.setCount('closing', 'salt', '2');
    store.openMonth('2026-09');
    await microtasks();
    expect(saves.map(s => [s.monthId, s.patch.closing])).toEqual([
      ['2026-10', { flour: 1 }],
      ['2026-10', { salt: 2 }],
    ]);
  });

  // ⚠️ THE SDK SHOWS A WRITE BACK ONLY AFTER ITS OWN DATABASE HAS IT, a moment after the call. A month
  // left at once used to stop listening before that: the copy kept the batch as unseen, the month opened
  // again laid it back as held, and the server's word sent it a second time.
  test('⚠️ changing month offline keeps listening until the SDK shows the batch back: the copy ends clean, nothing is sent twice', async () => {
    const { store, saves, storage, liveMonth, setMode, setEcho, show, answer, advance } = await ready();
    setMode('never');
    setEcho(false);
    store.setCount('closing', 'flour', '3');
    store.openMonth('2026-09');
    expect(saves).toHaveLength(1);
    expect(liveMonth('2026-10'), 'still listening to the month just left').toHaveLength(1);
    expect(storage.map.has(SAVED_KEY)).toBe(true);
    // The SDK has put it in its database now.
    show('2026-10');
    expect(storage.map.has(SAVED_KEY)).toBe(false);
    expect(liveMonth('2026-10'), 'and it stops once there is nothing left to see back').toEqual([]);
    // Back to October: nothing is held, so the server's word sends nothing.
    store.openMonth('2026-10');
    show('2026-10');
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 3 });
    answer('2026-10', { month: '2026-10', closing: { flour: 3 } }, true);
    await advance(SAVE_DELAY_MS * 2);
    expect(saves).toHaveLength(1);
  });

  test('stop() then the same month opened again leaves the old session once: one SETTLE_MS timer, not two', async () => {
    const { store, deps, setMode, setEcho } = await ready();
    const settleTimers: number[] = [];
    const setTimer = deps.setTimer;
    deps.setTimer = (callback, ms) => {
      if (ms === SETTLE_MS) settleTimers.push(ms);
      return setTimer(callback, ms);
    };
    setMode('never');
    setEcho(false);
    store.setCount('closing', 'flour', '3');
    store.stop();
    store.openMonth('2026-10');
    expect(settleTimers).toHaveLength(1);
  });

  test('a month left stops being listened to after SETTLE_MS even if the SDK never shows the batch back', async () => {
    const { store, storage, liveMonth, setMode, setEcho, advance } = await ready();
    setMode('never');
    setEcho(false);
    store.setCount('closing', 'flour', '3');
    store.openMonth('2026-09');
    await advance(SETTLE_MS - 1);
    expect(liveMonth('2026-10')).toHaveLength(1);
    await advance(1);
    expect(liveMonth('2026-10')).toEqual([]);
    expect(storage.map.has(SAVED_KEY), 'what was never seen back stays in the copy').toBe(true);
  });

  test('⚠️ a month left, while it still listens, draws nothing and never sends what it holds', async () => {
    const storage = await leftBehind([['closing', 'flour', '3']]);
    const { store, saves, liveMonth, answer, advance } = openedAgain(storage);
    answer('2026-10', { month: '2026-10' }, false);
    store.openMonth('2026-09');
    expect(liveMonth('2026-10')).toHaveLength(1);
    // The server says October is open: not this session's word to act on any more.
    answer('2026-10', { month: '2026-10', closing: { salt: 9 } }, true);
    await advance(SAVE_DELAY_MS * 2);
    expect(saves).toEqual([]);
    expect(storage.map.has(SAVED_KEY)).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ monthId: '2026-09', month: { closing: {} } });
  });

  test('a month that was left does not rewrite its local copy from an older view when its write answers late', async () => {
    const { store, saves, storage, setMode } = await ready({ month: '2026-10', closing: { flour: 1 } });
    setMode('manual');
    store.setCount('closing', 'flour', '3');
    store.openMonth('2026-09');
    await microtasks();
    const copy = storage.map.get(monthCacheKey(LID, '2026-10'));
    expect(JSON.parse(copy!).closing).toEqual({ flour: 3 });
    saves[0]!.resolve();
    await microtasks();
    expect(storage.map.get(monthCacheKey(LID, '2026-10'))).toBe(copy);
  });
});

// A write handed to Firestore reaches the browser's own database a moment later, and a page torn down
// in that moment takes the number with it (emulator, 11 Oct 2026). So what exists only in memory is
// written to localStorage at once — under the current app's key, as either app may open the month next.
describe('what exists only in memory is written down at once', () => {
  test('the key is the current app’s, with the venue in it', () => {
    expect(SAVED_KEY).toBe('inventory-unsaved-panificio-miano-2026-10');
    expect(unsavedCacheKey('', '2026-10')).toBe('inventory-unsaved-none-2026-10');
  });

  test('⚠️⚠️ written on every change, kept until the SDK shows the number back, then removed', async () => {
    const { store, storage, setMode, setEcho, show, advance } = await ready();
    setMode('never');
    setEcho(false);
    store.setCount('closing', 'flour', '3');
    expect(JSON.parse(storage.map.get(SAVED_KEY)!)).toEqual({ pending: { closing: { flour: 3 } }, cleared: {} });
    store.setCount('closing', 'salt', '');
    const both = { pending: { closing: { flour: 3 } }, cleared: { closing: { salt: true } } };
    expect(JSON.parse(storage.map.get(SAVED_KEY)!)).toEqual(both);
    // Handed over, not yet in the SDK's database: still only in memory, so still written down.
    await advance(SAVE_DELAY_MS);
    expect(store.getSnapshot().unsent).toBe(true);
    expect(JSON.parse(storage.map.get(SAVED_KEY)!)).toEqual(both);
    // The SDK has it now: the snapshot shows the number, and the box that was emptied is gone.
    show('2026-10');
    expect(storage.map.has(SAVED_KEY)).toBe(false);
  });

  test('with signal it appears and goes without anybody noticing', async () => {
    const { store, storage, advance } = await ready();
    store.setCount('closing', 'flour', '3');
    expect(storage.map.has(SAVED_KEY)).toBe(true);
    await advance(SAVE_DELAY_MS);
    expect(storage.map.has(SAVED_KEY)).toBe(false);
  });

  test('every way of changing the outbox writes it down: purchases and carried openings too', async () => {
    const { store, source, storage, setMode, setEcho } = await ready();
    setMode('never');
    setEcho(false);
    expect(store.applyPurchases({ flour: 2 })).toBe(1);
    expect(JSON.parse(storage.map.get(SAVED_KEY)!).pending).toEqual({ purchased: { flour: 2 } });
    source.getMonthOnce.mockResolvedValue({ id: '2026-09', month: '2026-09', closing: { salt: 1 } });
    expect(await store.pullOpeningFromPrevious('2026-09')).toBe(1);
    expect(JSON.parse(storage.map.get(SAVED_KEY)!).pending).toEqual({ purchased: { flour: 2 }, opening: { salt: 1 } });
  });

  test('⚠️ a month left and opened again keeps its copy: the old session’s late answer does not erase what is typed since', async () => {
    // Mise 2 keeps a left month alive until its last write answers (the current app reloads instead),
    // so on the way back into the same month two sessions share one key.
    const { store, saves, storage, answer, setMode, setEcho, advance } = await ready();
    setMode('never');
    setEcho(false);
    store.setCount('closing', 'flour', '3');
    await advance(SAVE_DELAY_MS);
    store.stop();
    store.start();
    // The new session shows what the old one handed over, held; then more is typed.
    answer('2026-10', { month: '2026-10' }, false);
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 3 });
    store.setCount('closing', 'salt', '2');
    const typed = JSON.parse(storage.map.get(SAVED_KEY)!);
    expect(typed.pending).toEqual({ closing: { flour: 3, salt: 2 } });
    // Signal comes back and the OLD session's write finally answers.
    saves[0]!.resolve();
    await microtasks();
    expect(JSON.parse(storage.map.get(SAVED_KEY)!)).toEqual(typed);
  });

  test('⚠️⚠️ only the NEWEST session of a month writes its copy: an older one’s late answer cannot put back a count that was corrected', async () => {
    // October is left and opened again twice, offline, while the first visit's write is still out.
    const storage = memoryStorage({ [SAVED_KEY]: JSON.stringify({ pending: { closing: { flour: 3 } }, cleared: {} }) });
    const t = setup({ storage });
    t.setMode('never');
    t.setEcho(false);
    t.store.start();
    // A: October, with the flour 3 of an earlier visit held; salt is typed and handed over.
    t.store.openMonth('2026-10');
    t.answer('2026-10', { month: '2026-10' }, false);
    t.store.setCount('closing', 'salt', '2');
    t.store.openMonth('2026-11');
    // C: October again; the flour is corrected to 7, and handed over on leaving.
    t.store.openMonth('2026-10');
    t.answer('2026-10', { month: '2026-10' }, false);
    t.store.setCount('closing', 'flour', '7');
    t.store.openMonth('2026-11');
    expect(t.saves.map(s => s.patch.closing)).toEqual([{ salt: 2 }, { flour: 7 }]);
    // A brief signal: A's write is acknowledged.
    t.saves[0]!.resolve();
    await microtasks();
    const copy = storage.map.get(SAVED_KEY) ?? '';
    expect(copy, 'the copy still holds the salt that nothing has shown back').toContain('"salt":2');
    expect(copy, 'and never the flour 3 that was corrected').not.toContain('"flour":3');
    // October once more, before C's write is acknowledged: the 7 is on screen, and the 3 is never sent.
    t.store.openMonth('2026-10');
    t.show('2026-10', false);
    expect(t.store.getSnapshot().month?.closing).toEqual({ flour: 7, salt: 2 });
    t.answer('2026-10', { month: '2026-10' }, true);
    await t.advance(SAVE_DELAY_MS);
    expect(t.saves.map(s => (s.patch.closing as Record<string, number> | undefined)?.flour)).not.toContain(3);
  });

  test('⚠️ and across store instances: leaving the Stocktake builds a new store while the old one’s writes are still out', async () => {
    const storage = memoryStorage();
    const old = await ready(null, { storage });
    old.setMode('never');
    old.setEcho(false);
    old.store.setCount('closing', 'flour', '3');
    await old.advance(SAVE_DELAY_MS);
    old.store.stop();
    const fresh = openedAgain(storage);
    fresh.answer('2026-10', { month: '2026-10' }, false);
    expect(fresh.store.getSnapshot().month?.closing).toEqual({ flour: 3 });
    fresh.store.setCount('closing', 'flour', '7');
    // The OLD store's write is finally acknowledged: it knows nothing of the correction.
    old.saves[0]!.resolve();
    await microtasks();
    expect(JSON.parse(storage.map.get(SAVED_KEY)!).pending).toEqual({ closing: { flour: 7 } });
  });

  test('a storage that refuses the write does not break the count', async () => {
    const storage = memoryStorage();
    const refusing = { ...storage, setItem: () => { throw new Error('QuotaExceededError'); } };
    const { store, saves, advance } = await ready(null, { storage: refusing as unknown as ReturnType<typeof memoryStorage> });
    expect(store.setCount('closing', 'flour', '3')).toBe(true);
    await advance(SAVE_DELAY_MS);
    expect(saves).toHaveLength(1);
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 3 });
  });
});

// What a page torn down left behind is laid back in as HELD: on screen and kept, but NOT SENT until the
// SERVER says the month is still open. The phone's own copy of the month can be days old, and a month
// closed meanwhile on another device must not take a count afterwards — the next month has already
// copied its figures (driven on the emulator, 11 Oct 2026).
describe('what a torn-down page left behind', () => {
  test('⚠️⚠️ a NEW store shows it at once, keeps it, and sends nothing from the open', async () => {
    const storage = await leftBehind([['closing', 'flour', '3']]);
    const before = storage.map.get(SAVED_KEY);
    expect(JSON.parse(before!)).toEqual({ pending: { closing: { flour: 3 } }, cleared: {} });
    const { store, saves, advance } = openedAgain(storage);
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 3 });
    // Held is already in localStorage, so it is not «unsent» (the section's busy marker).
    expect(store.getSnapshot().unsent).toBe(false);
    await advance(SAVE_DELAY_MS * 3);
    expect(saves).toEqual([]);
    expect(storage.map.get(SAVED_KEY)).toBe(before);
  });

  test('⚠️⚠️ a snapshot from the browser’s own copy does NOT send it; the first from the server does', async () => {
    const storage = await leftBehind([['closing', 'flour', '3']]);
    const { store, saves, answer, advance } = openedAgain(storage);
    // The phone's own copy of the month (days old, perhaps), and the held count laid over it.
    answer('2026-10', { month: '2026-10', closing: { salt: 1 } }, false);
    expect(store.getSnapshot().month?.closing).toEqual({ salt: 1, flour: 3 });
    await advance(SAVE_DELAY_MS * 2);
    expect(saves).toEqual([]);
    // The server says the month is open (and, as often, the same as the phone's copy).
    answer('2026-10', { month: '2026-10', closing: { salt: 1 } }, true);
    expect(store.getSnapshot().unsent).toBe(true);
    await advance(SAVE_DELAY_MS);
    expect(saves).toHaveLength(1);
    // Only what was held: the other box is not this phone's to write.
    expect(saves[0]!.patch.closing).toEqual({ flour: 3 });
    // And once the SDK shows it back, the copy in storage goes.
    expect(storage.map.has(SAVED_KEY)).toBe(false);
    expect(store.getSnapshot().month?.closing).toEqual({ salt: 1, flour: 3 });
    expect(store.getSnapshot().unsent).toBe(false);
  });

  test('⚠️⚠️ never sent, and no longer shown, once the server says the month is closed — and kept for its reopening', async () => {
    const storage = await leftBehind([['closing', 'flour', '3']]);
    const { store, saves, answer, advance } = openedAgain(storage);
    answer('2026-10', { month: '2026-10', closing: { flour: 1 } }, false);
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 3 });
    // Closed from another device while this phone was away.
    answer('2026-10', { month: '2026-10', closedAt: CLOSED_AT, closing: { flour: 1 } }, true);
    expect(store.getSnapshot().month).toMatchObject({ closedAt: CLOSED_AT, closing: { flour: 1 } });
    await advance(SAVE_DELAY_MS * 3);
    await store.flush();
    expect(saves).toEqual([]);
    expect(storage.map.has(SAVED_KEY)).toBe(true);
  });

  test('⚠️ a month opened closed from the start never has the held count drawn over it', async () => {
    const storage = await leftBehind([['closing', 'flour', '3']]);
    // The phone's own copy already says closed.
    storage.setItem(monthCacheKey(LID, '2026-10'), JSON.stringify({ month: '2026-10', closedAt: CLOSED_AT, closing: { flour: 1 } }));
    const { store, saves, advance } = openedAgain(storage);
    expect(store.getSnapshot().month).toMatchObject({ closedAt: CLOSED_AT, closing: { flour: 1 } });
    await advance(SAVE_DELAY_MS * 3);
    expect(saves).toEqual([]);
    expect(storage.map.has(SAVED_KEY)).toBe(true);
  });

  test('reopening the month sends what it was holding', async () => {
    const storage = await leftBehind([['closing', 'flour', '3']]);
    const { store, saves, answer, advance } = openedAgain(storage);
    answer('2026-10', { month: '2026-10', closedAt: CLOSED_AT, closing: { flour: 1 } }, true);
    await store.reopenMonth();
    await advance(SAVE_DELAY_MS);
    expect(saves.map(s => s.patch.closedAt)).toEqual(['', undefined]);
    expect(saves[1]!.patch.closing).toEqual({ flour: 3 });
    expect(store.getSnapshot().month).toMatchObject({ closedAt: '', closing: { flour: 3 } });
  });

  test('⚠️ and reopening it with no signal does too: the phone has just said the month is open itself', async () => {
    const storage = await leftBehind([['closing', 'flour', '3']]);
    const { store, saves, answer, setMode, advance } = openedAgain(storage);
    answer('2026-10', { month: '2026-10', closedAt: CLOSED_AT, closing: { flour: 1 } }, true);
    setMode('never');
    const reopened = store.reopenMonth();
    await advance(SETTLE_MS);
    await reopened;
    // The reopening was only shown back from the phone's own database, not by the server.
    await advance(SAVE_DELAY_MS);
    expect(saves.map(s => s.patch.closedAt)).toEqual(['', undefined]);
    expect(saves[1]!.patch.closing).toEqual({ flour: 3 });
    expect(store.getSnapshot().month).toMatchObject({ closedAt: '', closing: { flour: 3 } });
  });

  test('a box typed again before the server’s word is newer: the held one goes, the others are still sent', async () => {
    const storage = await leftBehind([['closing', 'flour', '3'], ['closing', 'salt', '1']]);
    const { store, saves, answer, advance } = openedAgain(storage);
    answer('2026-10', { month: '2026-10' }, false);
    store.setCount('closing', 'flour', '5');
    answer('2026-10', { month: '2026-10' }, true);
    await advance(SAVE_DELAY_MS);
    expect(saves).toHaveLength(1);
    expect(saves[0]!.patch.closing).toEqual({ flour: 5, salt: 1 });
  });

  test('⚠️ closing the month sends what it holds first, and the next month’s opening agrees with it', async () => {
    const storage = await leftBehind([['closing', 'flour', '3']]);
    const { store, saves, answer } = openedAgain(storage);
    answer('2026-10', { month: '2026-10', opening: { flour: 4 } }, false);
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 3 });
    const result = await store.closeMonth({ names: {}, unitPrice: {}, packKg: {} });
    expect(result).toEqual({ refused: false, opened: '2026-11' });
    expect(saves.map(s => [s.monthId, s.patch.closing, s.patch.opening, s.patch.closedAt !== undefined])).toEqual([
      ['2026-10', { flour: 3 }, undefined, false],
      ['2026-11', undefined, { flour: 3 }, false],
      ['2026-10', undefined, undefined, true],
    ]);
    expect(store.getSnapshot().month).toMatchObject({ closing: { flour: 3 } });
  });

  test('⚠️ a copy that cannot be a count a person typed is ignored: junk never reaches a write', async () => {
    const storage = memoryStorage({
      [SAVED_KEY]: JSON.stringify({
        pending: { closing: { flour: -1, salt: 'x', oil: null, sugar: 2 }, names: { a: 1 }, notAMap: { b: 1 } },
        cleared: { closing: { yeast: 'yes', butter: true } },
      }),
    });
    const { store, saves, answer, advance } = openedAgain(storage);
    answer('2026-10', { month: '2026-10', closing: { butter: 4 } }, true);
    await advance(SAVE_DELAY_MS);
    expect(saves).toHaveLength(1);
    expect(saves[0]!.patch.closing).toEqual({ sugar: 2 });
    expect(saves[0]!.clear).toEqual({ closing: { butter: true } });
    expect(Object.keys(saves[0]!.patch).sort()).toEqual(['closing', 'createdAt', 'month', 'updatedAt']);
    expect(store.getSnapshot().month?.closing).toEqual({ sugar: 2 });
  });

  test('a copy that is not even JSON is no copy', async () => {
    const storage = memoryStorage({ [SAVED_KEY]: '{not json' });
    const { store, saves, answer, advance } = openedAgain(storage);
    answer('2026-10', { month: '2026-10', closing: { butter: 4 } }, true);
    await advance(SAVE_DELAY_MS * 2);
    expect(saves).toEqual([]);
    expect(store.getSnapshot().month?.closing).toEqual({ butter: 4 });
  });

  test('it belongs to its venue and its month', async () => {
    const storage = memoryStorage({
      [unsavedCacheKey('another-venue', '2026-10')]: JSON.stringify({ pending: { closing: { flour: 9 } }, cleared: {} }),
      [unsavedCacheKey(LID, '2026-09')]: JSON.stringify({ pending: { closing: { flour: 8 } }, cleared: {} }),
    });
    const { store } = openedAgain(storage);
    expect(store.getSnapshot().month?.closing).toEqual({});
  });
});

describe('a closed month', () => {
  const CLOSED = { month: '2026-10', closedAt: '2026-10-31T20:00:00.000Z', closing: { flour: 2 }, purchased: { flour: 1 } };

  test('⚠️⚠️ refuses every change in the store, whatever the screen drew', async () => {
    const { store, saves, source, advance } = await ready(CLOSED);
    source.getMonthOnce.mockResolvedValue({ id: '2026-09', month: '2026-09', closing: { flour: 9 } });
    expect(store.setCount('closing', 'flour', '5')).toBe(false);
    expect(store.applyPurchases({ flour: 4 })).toBe(0);
    expect(await store.pullOpeningFromPrevious('2026-09')).toBe(0);
    expect(await store.closeMonth({ names: {}, unitPrice: {}, packKg: {} })).toEqual({ refused: true });
    await advance(SETTLE_MS * 2);
    expect(store.getSnapshot().month).toMatchObject({ closing: { flour: 2 }, purchased: { flour: 1 }, opening: {} });
    expect(saves).toEqual([]);
  });

  test('is reopened by writing closedAt back to empty, and then takes counts again', async () => {
    const { store, saves } = await ready(CLOSED);
    await store.reopenMonth();
    expect(saves.map(s => s.patch)).toEqual([
      { month: '2026-10', closedAt: '', updatedAt: new Date(NOW).toISOString() },
    ]);
    expect(store.getSnapshot().month?.closedAt).toBe('');
    expect(store.setCount('closing', 'flour', '5')).toBe(true);
  });

  test('⚠️⚠️ what is waiting is not sent into a month that turns out to be closed — it waits for the reopening', async () => {
    const { store, saves, storage, answer, advance } = await ready({ month: '2026-10' });
    store.setCount('closing', 'flour', '3');
    // Closed from another device before this phone's save went out.
    answer('2026-10', { month: '2026-10', closedAt: CLOSED_AT, closing: { flour: 1 } });
    expect(store.getSnapshot().month).toMatchObject({ closedAt: CLOSED_AT, closing: { flour: 1 } });
    await advance(SAVE_DELAY_MS * 2);
    await store.flush();
    expect(saves).toEqual([]);
    expect(storage.map.has(SAVED_KEY)).toBe(true);
    await store.reopenMonth();
    await advance(SAVE_DELAY_MS);
    expect(saves.map(s => s.patch.closing)).toEqual([undefined, { flour: 3 }]);
    expect(store.getSnapshot().month).toMatchObject({ closedAt: '', closing: { flour: 3 } });
  });
});

describe('closing a month', () => {
  const FROZEN = { names: { flour: 'Flour 25kg' }, unitPrice: { flour: 22.5 }, packKg: { flour: 25 } };

  test('⚠️ sends what is waiting, writes the NEXT month first, then closes this one with what it froze', async () => {
    const { store, saves } = await ready({ month: '2026-10', opening: { flour: 4 }, packKg: { flour: 25, salt: 1 } });
    store.setCount('closing', 'flour', '2');
    store.setCount('closing', 'salt', '');
    const result = await store.closeMonth(FROZEN);
    expect(result).toEqual({ refused: false, opened: '2026-11' });
    const iso = new Date(NOW).toISOString();
    expect(saves.map(s => [s.monthId, s.patch])).toEqual([
      ['2026-10', { month: '2026-10', updatedAt: iso, createdAt: iso, closing: { flour: 2 } }],
      // Only COUNTED rows become an opening; the pack weights travel.
      ['2026-11', { month: '2026-11', opening: { flour: 2 }, packKg: { flour: 25, salt: 1 }, createdAt: iso, updatedAt: iso }],
      ['2026-10', { month: '2026-10', closedAt: iso, updatedAt: iso, ...FROZEN }],
    ]);
    expect(store.getSnapshot().month).toMatchObject({ closedAt: iso, ...FROZEN });
  });

  test('⚠️ answers within ONE bound for the whole sequence when nothing reaches a server', async () => {
    const { store, setMode, advance, saves } = await ready();
    setMode('never');
    store.setCount('closing', 'flour', '2');
    let result: Awaited<ReturnType<typeof store.closeMonth>> | undefined;
    void store.closeMonth(FROZEN).then(value => { result = value; });
    await advance(SETTLE_MS - 1);
    expect(result).toBeUndefined();
    await advance(1);
    expect(result).toEqual({ refused: false, opened: '2026-11' });
    // Every write was still handed over, in order.
    expect(saves.map(s => s.monthId)).toEqual(['2026-10', '2026-11', '2026-10']);
    expect(store.getSnapshot().month?.closedAt).not.toBe('');
  });

  test('a failed write says «not saved yet» and never throws loose', async () => {
    const { store, source, messages } = await ready();
    source.saveMonthFields.mockImplementation(() => Promise.reject(new Error('offline')));
    await expect(store.closeMonth(FROZEN)).resolves.toEqual({ refused: false, opened: '2026-11' });
    expect(messages).toContainEqual({ kind: 'not-saved-yet' });
  });

  // ⚠️ The screen says «Month closed.» and records `month-closed` only for a close that happened, so
  // the answer must tell a close from a refusal — a refusal used to be the same `null` as a close
  // with no next month.
  test('⚠️ reports «refused» for a month that is already closed, and writes nothing', async () => {
    // Another phone closed it while this phone's question was open.
    const { store, saves, advance } = await ready({ month: '2026-10', closedAt: '2026-10-14T19:00:00.000Z', closing: { flour: 2 } });
    expect(await store.closeMonth(FROZEN)).toEqual({ refused: true });
    await advance(SETTLE_MS * 2);
    expect(saves).toEqual([]);
    expect(store.getSnapshot().month).toMatchObject({ closedAt: '2026-10-14T19:00:00.000Z', closing: { flour: 2 } });
  });

  test('reports «refused» before the month has answered, and writes nothing', async () => {
    const { store, saves, advance } = setup();
    store.start();
    store.openMonth('2026-10');
    expect(await store.closeMonth(FROZEN)).toEqual({ refused: true });
    await advance(SETTLE_MS * 2);
    expect(saves).toEqual([]);
  });
});

describe('carry forward', () => {
  test('copies last month’s closings into this month’s openings — only counted rows', async () => {
    const { store, source, saves, advance } = await ready({ month: '2026-10', opening: { salt: 3 } });
    source.getMonthOnce.mockResolvedValue({ id: '2026-09', month: '2026-09', closing: { flour: 2, sugar: 0 } });
    expect(await store.pullOpeningFromPrevious('2026-09')).toBe(2);
    expect(source.getMonthOnce).toHaveBeenCalledWith('2026-09');
    expect(store.getSnapshot().month?.opening).toEqual({ salt: 3, flour: 2, sugar: 0 });
    await advance(SAVE_DELAY_MS);
    expect(saves[0]!.patch.opening).toEqual({ flour: 2, sugar: 0 });
  });

  test('⚠️ three answers: n, 0 for «nothing there», null for «could not read it»', async () => {
    const { store, source } = await ready();
    source.getMonthOnce.mockResolvedValueOnce(null);
    expect(await store.pullOpeningFromPrevious('2026-09')).toBe(0);
    source.getMonthOnce.mockResolvedValueOnce({ id: '2026-09', month: '2026-09' });
    expect(await store.pullOpeningFromPrevious('2026-09')).toBe(0);
    source.getMonthOnce.mockRejectedValueOnce(new Error('offline'));
    expect(await store.pullOpeningFromPrevious('2026-09')).toBeNull();
  });
});

describe('the purchases', () => {
  const ORDERS: StoredDoc[] = [
    { id: '2026-10-04_alba', date: '2026-10-04', quantities: { flour: 2, salt: 1 }, missing: { salt: true } },
    { id: '2026-10-20_bianchi', date: '2026-10-20', quantities: { flour: 1 } },
  ];

  test('are read from the month’s orders, and nothing is written until they are applied', async () => {
    const { store, source, saves } = await ready();
    source.getOrdersInMonth.mockResolvedValue(ORDERS);
    const found = await store.readProposedPurchases();
    expect(source.getOrdersInMonth).toHaveBeenCalledWith('2026-10-01', '2026-11-01');
    expect(found).toMatchObject({ totals: { flour: 3 }, orders: 2, products: 1, failed: false });
    expect(saves).toEqual([]);
  });

  test('a failed read is «type it yourself», never an error', async () => {
    const { store, source } = await ready();
    source.getOrdersInMonth.mockRejectedValue(new Error('permission-denied'));
    expect(await store.readProposedPurchases()).toMatchObject({ failed: true, orders: 0, products: 0 });
  });

  test('⚠️ applying REPLACES the whole map: what the orders no longer account for is cleared', async () => {
    const { store, saves, advance } = await ready({ month: '2026-10', purchased: { salt: 4, flour: 1 } });
    expect(store.applyPurchases({ flour: 3, sugar: 0, yeast: 'junk' })).toBe(1);
    expect(store.getSnapshot().month?.purchased).toEqual({ flour: 3 });
    await advance(SAVE_DELAY_MS);
    expect(saves[0]!.patch.purchased).toEqual({ flour: 3 });
    expect(saves[0]!.clear).toEqual({ purchased: { salt: true } });
  });
});

describe('changing month (Mise 2: no reload)', () => {
  test('hands the old month’s waiting counts to Firestore AT ONCE, stops watching it, and watches the new one', async () => {
    const { store, saves, liveMonth, answer } = await ready();
    store.setCount('closing', 'flour', '3');
    store.openMonth('2026-09');
    await microtasks();
    expect(saves.map(s => [s.monthId, s.patch.closing])).toEqual([['2026-10', { flour: 3 }]]);
    expect(liveMonth('2026-10')).toEqual([]);
    expect(liveMonth('2026-09')).toHaveLength(1);
    expect(store.getSnapshot()).toMatchObject({ monthId: '2026-09', monthLoaded: false });
    answer('2026-09', { month: '2026-09', closing: { flour: 8 } });
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 8 });
  });

  test('a late failure of the old month’s write never touches the new month on screen', async () => {
    const { store, saves, setMode, answer, messages } = await ready();
    setMode('manual');
    store.setCount('closing', 'flour', '3');
    store.openMonth('2026-09');
    answer('2026-09', { month: '2026-09', closing: { salt: 1 } });
    saves[0]!.reject(new Error('denied'));
    await microtasks();
    expect(store.getSnapshot().month?.closing).toEqual({ salt: 1 });
    expect(messages).toEqual([{ kind: 'not-saved-yet' }]);
  });

  test('opening the same month again changes nothing; a month id that is not one is ignored', async () => {
    const { store, source } = await ready();
    store.openMonth('2026-10');
    store.openMonth('2026-13');
    expect(source.watchMonth).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().monthId).toBe('2026-10');
  });
});

describe('the streams', () => {
  test('a month stream that dies opens the boxes on the local copy and says so', async () => {
    const { store, liveMonth, messages } = setup();
    store.openMonth('2026-10');
    liveMonth('2026-10')[0]!.onError(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    expect(store.getSnapshot()).toMatchObject({ monthLoaded: true, monthFailed: true });
    expect(messages).toEqual([{ kind: 'month-stream-broken' }]);
  });

  // ⚠️ A MONTH THAT A MANAGER CLOSES WHILE AN EMPLOYEE IS COUNTING: the rules cancel the employee's
  // listener («this month is unavailable»). What was last heard says OPEN, and will never be corrected —
  // so the last write answering must not redraw from it, undo the notice, or rewrite the local copy.
  test.each(['lands', 'is refused'])('⚠️⚠️ once the stream has died, the last write that %s redraws nothing and keeps «unavailable»', async outcome => {
    const { store, saves, storage, setMode, setEcho, fail, advance } = await ready({ month: '2026-10', closing: { flour: 1 } });
    setMode('manual');
    setEcho(false);
    store.setCount('closing', 'flour', '3');
    await advance(SAVE_DELAY_MS);
    const copy = storage.map.get(monthCacheKey(LID, '2026-10'));
    fail('2026-10', Object.assign(new Error('denied'), { code: 'permission-denied' }));
    expect(store.getSnapshot()).toMatchObject({ monthLoaded: true, monthFailed: true });
    if (outcome === 'lands') saves[0]!.resolve();
    else saves[0]!.reject(new Error('denied'));
    await microtasks();
    expect(store.getSnapshot()).toMatchObject({ monthLoaded: true, monthFailed: true });
    // Not drawn again from the flour 1 heard before the stream died.
    expect(store.getSnapshot().month?.closing).toEqual({ flour: 3 });
    expect(storage.map.get(monthCacheKey(LID, '2026-10'))).toBe(copy);
  });

  test('the ingredients are loaded once they answer — or fail, so the list never waits for ever', () => {
    const t1 = setup();
    t1.store.start();
    expect(t1.store.getSnapshot().ingredientsLoaded).toBe(false);
    t1.ingredients[0]!.onChange([{ id: 'flour', name: 'Flour' }]);
    expect(t1.store.getSnapshot()).toMatchObject({ ingredientsLoaded: true, ingredients: [{ id: 'flour', name: 'Flour' }] });
    const t2 = setup();
    t2.store.start();
    t2.ingredients[0]!.onError(new Error('x'));
    expect(t2.store.getSnapshot()).toMatchObject({ ingredientsLoaded: true, ingredients: [] });
  });

  test('stop hands what is unsent to Firestore and stops listening; start → stop → start watches again', async () => {
    const { store, saves, liveMonth, ingredients, source } = await ready();
    store.setCount('closing', 'flour', '3');
    store.stop();
    await microtasks();
    expect(saves).toHaveLength(1);
    expect(liveMonth('2026-10')).toEqual([]);
    expect(ingredients.every(w => w.stopped)).toBe(true);
    store.start();
    expect(liveMonth('2026-10')).toHaveLength(1);
    expect(source.watchIngredients).toHaveBeenCalledTimes(2);
  });
});
