import { describe, expect, test, vi } from 'vitest';
import type { KeyValueStorage } from '../session/backend';
import type { Clearing, StocktakeSource, StoredDoc } from './stocktakeSource';
import { SAVE_DELAY_MS, SETTLE_MS, createStocktakeStore, monthCacheKey } from './stocktakeStore';
import type { StocktakeDeps, StocktakeMessage } from './stocktakeStore';

// The store against a fake source and a fake browser: every decision of the current app's
// js/inventory/inventory-store.js (and the waits of inventory-main.js), one test each, plus the two
// Mise 2 differences (a count waits for the month's first answer; changing month needs no reload).

type Watch = { onChange: (doc: StoredDoc | null) => void; onError: (err: unknown) => void; stopped: boolean };
type IngredientWatch = { onChange: (list: StoredDoc[]) => void; onError: (err: unknown) => void; stopped: boolean };
type Save = {
  monthId: string;
  patch: Record<string, unknown>;
  clear: Clearing;
  resolve: () => void;
  reject: (err: unknown) => void;
};

function fakeSource() {
  const months = new Map<string, Watch[]>();
  const ingredients: IngredientWatch[] = [];
  const saves: Save[] = [];
  // How a save answers: 'resolve' at once, 'never' (offline: a write's promise does not settle),
  // or 'manual' (the spec answers it through `saves`).
  let mode: 'resolve' | 'never' | 'manual' = 'resolve';
  const source = {
    watchMonth: vi.fn((monthId: string, onChange: Watch['onChange'], onError: Watch['onError']) => {
      const w: Watch = { onChange, onError, stopped: false };
      months.set(monthId, [...(months.get(monthId) ?? []), w]);
      return () => { w.stopped = true; };
    }),
    getMonthOnce: vi.fn<StocktakeSource['getMonthOnce']>(() => Promise.resolve(null)),
    saveMonthFields: vi.fn((monthId: string, patch: Readonly<Record<string, unknown>>, clear: Clearing = {}) =>
      new Promise<void>((resolve, reject) => {
        saves.push({ monthId, patch: { ...patch }, clear, resolve, reject });
        if (mode === 'resolve') resolve();
      })),
    getOrdersInMonth: vi.fn<StocktakeSource['getOrdersInMonth']>(() => Promise.resolve([])),
    watchIngredients: vi.fn((onChange: IngredientWatch['onChange'], onError: IngredientWatch['onError']) => {
      const w: IngredientWatch = { onChange, onError, stopped: false };
      ingredients.push(w);
      return () => { w.stopped = true; };
    }),
  } satisfies StocktakeSource;
  const liveMonth = (monthId: string) => (months.get(monthId) ?? []).filter(w => !w.stopped);
  return {
    source, saves, ingredients,
    liveMonth,
    // The month's document as Firestore would send it (null: it does not exist).
    answer(monthId: string, doc: Record<string, unknown> | null) {
      for (const w of liveMonth(monthId)) w.onChange(doc === null ? null : { id: monthId, ...doc });
    },
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

  test('⚠️ exactly one write in the air: a second save waits for the first, then carries only what is new', async () => {
    const { store, saves, setMode, advance } = await ready();
    setMode('manual');
    store.setCount('closing', 'flour', '3');
    await advance(SAVE_DELAY_MS);
    store.setCount('closing', 'salt', '1');
    await advance(SAVE_DELAY_MS);
    expect(saves).toHaveLength(1);
    saves[0]!.resolve();
    await microtasks();
    expect(saves).toHaveLength(2);
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
