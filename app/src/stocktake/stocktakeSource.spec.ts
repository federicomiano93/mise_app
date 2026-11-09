import { describe, expect, test, vi } from 'vitest';
import type { FirestoreKit } from '../session/firebaseBackend';
import { createFirestoreStocktakeSource } from './stocktakeSource';
import type { StoredDoc } from './stocktakeSource';

// The ONLY code in Mise 2 that writes the Stocktake to the real database, against a recording fake
// of the Firestore SDK. firestore.rules (the `inventory` block) accept exactly these shapes; every
// other spec runs on an in-memory source, so a slip here — a whole-document write that undoes the
// other phone's counts, a key the whitelist refuses, a missing venue stamp, a cleared box sent as a
// zero or as a dotted path — would otherwise first show as a count that never reached the office.

type Ref = { kind: string; path: string; parts?: unknown[] };
type Snap = { id: string; data: () => Record<string, unknown> };
const DELETE = { sentinel: 'deleteField' };

function fakeKit() {
  const listeners: {
    target: Ref; options: unknown; next: (snap: unknown) => void; error: (err: unknown) => void; stopped: boolean;
  }[] = [];
  let stored: Record<string, Record<string, unknown> | null> = {};
  let orderDocs: Snap[] = [];
  let ordersFromCache = false;
  const fs = {
    collection: (_db: unknown, path: string): Ref => ({ kind: 'collection', path }),
    doc: (_db: unknown, path: string, id: string): Ref => ({ kind: 'doc', path: `${path}/${id}` }),
    where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
    query: (ref: Ref, ...parts: unknown[]): Ref => ({ ...ref, kind: 'query', parts }),
    deleteField: vi.fn(() => DELETE),
    // Like the SDK's: the options, when there are any, come second.
    onSnapshot: vi.fn((target: Ref, ...rest: unknown[]) => {
      const options = typeof rest[0] === 'function' ? undefined : rest.shift();
      const [next, error] = rest as [(snap: unknown) => void, (err: unknown) => void];
      const entry = { target, options, next, error, stopped: false };
      listeners.push(entry);
      return () => { entry.stopped = true; };
    }),
    setDoc: vi.fn(async (_ref: Ref, _payload: Record<string, unknown>, _options?: unknown) => {}),
    getDoc: vi.fn(async (ref: Ref) => {
      const data = stored[ref.path] ?? null;
      return { id: ref.path.split('/').pop(), exists: () => data !== null, data: () => data };
    }),
    getDocs: vi.fn(async (_query: Ref) => ({ docs: orderDocs, metadata: { fromCache: ordersFromCache } })),
  };
  const kit = { fs, db: {} } as unknown as FirestoreKit;
  const live = (path: string) => listeners.filter(l => l.target.path === path && !l.stopped);
  return {
    kit, fs, listeners, live,
    setStored: (value: typeof stored) => { stored = value; },
    setOrdersFromCache: (value: boolean) => { ordersFromCache = value; },
    setOrders: (docs: StoredDoc[]) => {
      orderDocs = docs.map(({ id, ...data }) => ({ id, data: () => data }));
    },
  };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// A collection snapshot as onSnapshot hands it over.
function collectionSnap(docs: StoredDoc[], { fromCache = false, changes = docs.length } = {}) {
  const snaps = docs.map(({ id, ...data }) => ({ id, data: () => data }));
  return {
    docs: snaps,
    empty: snaps.length === 0,
    metadata: { fromCache },
    docChanges: () => Array.from({ length: changes }, () => ({})),
    forEach: (fn: (snap: Snap) => void) => snaps.forEach(fn),
  };
}

describe('the Stocktake source, as firestore.rules expect it', () => {
  test('a count is a MERGE into the month document, stamped for the venue', async () => {
    const { kit, fs } = fakeKit();
    const source = createFirestoreStocktakeSource(() => Promise.resolve(kit), 'panificio-miano');
    await source.saveMonthFields('2026-10', { month: '2026-10', updatedAt: 'now', closing: { flour: 3 } });
    expect(fs.setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload, options] = fs.setDoc.mock.calls[0] as [Ref, Record<string, unknown>, unknown];
    expect(ref.path).toBe('locations/panificio-miano/inventory/2026-10');
    // ⚠️ A merge: a whole-document write from a phone with a stale copy would undo the other
    // phone's counts.
    expect(options).toEqual({ merge: true });
    expect(payload).toEqual({ month: '2026-10', updatedAt: 'now', closing: { flour: 3 }, bakery: 'panificio-miano' });
  });

  test('every key a save can carry is one the rules whitelist', async () => {
    const { kit, fs } = fakeKit();
    const source = createFirestoreStocktakeSource(() => Promise.resolve(kit), 'bakery');
    await source.saveMonthFields('2026-10', {
      month: '2026-10', opening: {}, purchased: {}, closing: {}, packKg: {}, names: {}, unitPrice: {},
      closedAt: '', createdAt: 'a', updatedAt: 'b',
    });
    const payload = fs.setDoc.mock.calls[0]![1];
    const allowed = ['bakery', 'month', 'opening', 'purchased', 'closing', 'packKg', 'names', 'unitPrice',
      'closedAt', 'createdAt', 'updatedAt'];
    expect(Object.keys(payload).filter(key => !allowed.includes(key))).toEqual([]);
  });

  test('⚠️ an emptied box travels as deleteField() inside its map, in the SAME write as the counts', async () => {
    const { kit, fs } = fakeKit();
    const source = createFirestoreStocktakeSource(() => Promise.resolve(kit), 'bakery');
    await source.saveMonthFields(
      '2026-10',
      { month: '2026-10', closing: { sugar: 2 } },
      { closing: { flour: true }, opening: { 'farina.00': true } },
    );
    expect(fs.setDoc).toHaveBeenCalledTimes(1);
    const payload = fs.setDoc.mock.calls[0]![1];
    expect(payload.closing).toEqual({ sugar: 2, flour: DELETE });
    // ⚠️ A nested map keyed by the id as it is — never a dotted 'opening.farina.00' path, which
    // would delete the wrong key, or nothing.
    expect(payload.opening).toEqual({ 'farina.00': DELETE });
    expect(Object.keys(payload).some(key => key.includes('.'))).toBe(false);
  });

  test('a refused write rejects, so the store can say «not saved yet» and keep the count', async () => {
    const { kit, fs } = fakeKit();
    fs.setDoc.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    const source = createFirestoreStocktakeSource(() => Promise.resolve(kit), 'bakery');
    await expect(source.saveMonthFields('2026-10', { month: '2026-10' })).rejects.toThrow('denied');
  });

  test('a month id that is not one never reaches Firestore', async () => {
    const { kit, fs } = fakeKit();
    const source = createFirestoreStocktakeSource(() => Promise.resolve(kit), 'bakery');
    await expect(source.saveMonthFields('2026-13', { month: '2026-13' })).rejects.toThrow(/month id/);
    await expect(source.saveMonthFields('../users/x', {})).rejects.toThrow(/month id/);
    await expect(source.getMonthOnce('2026-1')).rejects.toThrow(/month id/);
    expect(fs.setDoc).not.toHaveBeenCalled();
    expect(fs.getDoc).not.toHaveBeenCalled();
  });

  test('a venue id that could point anywhere else is refused before anything is built', () => {
    const { kit } = fakeKit();
    expect(() => createFirestoreStocktakeSource(() => Promise.resolve(kit), '../admins')).toThrow();
  });

  test('the month is watched live, and a missing month is null', async () => {
    const { kit, live } = fakeKit();
    const source = createFirestoreStocktakeSource(() => Promise.resolve(kit), 'bakery');
    const seen: (StoredDoc | null)[] = [];
    const stop = source.watchMonth('2026-10', doc => seen.push(doc), () => {});
    await settle();
    const [listener] = live('locations/bakery/inventory/2026-10');
    listener!.next({ id: '2026-10', exists: () => false, data: () => undefined, metadata: { fromCache: false } });
    listener!.next({
      id: '2026-10', exists: () => true, data: () => ({ month: '2026-10', closing: { a: 1 } }), metadata: { fromCache: false },
    });
    expect(seen).toEqual([null, { id: '2026-10', month: '2026-10', closing: { a: 1 } }]);
    stop();
    expect(live('locations/bakery/inventory/2026-10')).toEqual([]);
  });

  test('⚠️ every snapshot says whether the SERVER sent it, and metadata changes are asked for', async () => {
    // A count held from an earlier visit is sent only on the server's word that the month is open.
    // Without includeMetadataChanges an answer identical to the phone's own copy is never reported,
    // so the held counts would wait for ever.
    const { kit, live } = fakeKit();
    const source = createFirestoreStocktakeSource(() => Promise.resolve(kit), 'bakery');
    const seen: [StoredDoc | null, { fromServer: boolean }][] = [];
    source.watchMonth('2026-10', (doc, meta) => seen.push([doc, meta]), () => {});
    await settle();
    const [listener] = live('locations/bakery/inventory/2026-10');
    expect(listener!.options).toEqual({ includeMetadataChanges: true });
    const month = { id: '2026-10', exists: () => true, data: () => ({ month: '2026-10' }) };
    listener!.next({ ...month, metadata: { fromCache: true } });
    listener!.next({ ...month, metadata: { fromCache: false } });
    listener!.next({ id: '2026-10', exists: () => false, data: () => undefined, metadata: { fromCache: false } });
    expect(seen.map(([, meta]) => meta)).toEqual([{ fromServer: false }, { fromServer: true }, { fromServer: true }]);
  });

  test('a watch stopped before Firestore has loaded never subscribes', async () => {
    const { kit, fs } = fakeKit();
    let release: (k: FirestoreKit) => void = () => {};
    const source = createFirestoreStocktakeSource(() => new Promise(resolve => { release = resolve; }), 'bakery');
    const stop = source.watchMonth('2026-10', () => {}, () => {});
    stop();
    release(kit);
    await settle();
    expect(fs.onSnapshot).not.toHaveBeenCalled();
  });

  test('a stream that dies says so (the screen tells an employee the month is not theirs)', async () => {
    const { kit, live } = fakeKit();
    const onError = vi.fn();
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const source = createFirestoreStocktakeSource(() => Promise.resolve(kit), 'bakery');
    source.watchMonth('2026-10', () => {}, onError);
    await settle();
    live('locations/bakery/inventory/2026-10')[0]!.error(Object.assign(new Error('x'), { code: 'permission-denied' }));
    expect(onError).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test('the month before is read ONCE, never watched', async () => {
    const { kit, fs, setStored } = fakeKit();
    setStored({ 'locations/bakery/inventory/2026-09': { month: '2026-09', closing: { flour: 2 } } });
    const source = createFirestoreStocktakeSource(() => Promise.resolve(kit), 'bakery');
    expect(await source.getMonthOnce('2026-09')).toEqual({ id: '2026-09', month: '2026-09', closing: { flour: 2 } });
    expect(await source.getMonthOnce('2026-08')).toBeNull();
    expect(fs.onSnapshot).not.toHaveBeenCalled();
  });

  test('the orders are read once, bounded by a range on `date` (never by the document id)', async () => {
    const { kit, fs, setOrders } = fakeKit();
    setOrders([{ id: '2026-10-04_alba', date: '2026-10-04', quantities: { flour: 2 } }]);
    const source = createFirestoreStocktakeSource(() => Promise.resolve(kit), 'bakery');
    const records = await source.getOrdersInMonth('2026-10-01', '2026-11-01');
    expect(records).toEqual([{ id: '2026-10-04_alba', date: '2026-10-04', quantities: { flour: 2 } }]);
    const [query] = fs.getDocs.mock.calls[0] as [Ref];
    expect(query.path).toBe('locations/bakery/orders-history');
    expect(query.parts).toEqual([{ where: ['date', '>=', '2026-10-01'] }, { where: ['date', '<', '2026-11-01'] }]);
    expect(fs.setDoc).not.toHaveBeenCalled();
  });

  test('ingredients wait for themselves, carry their prices, and ignore a price on the ingredient', async () => {
    const { kit, live } = fakeKit();
    const source = createFirestoreStocktakeSource(() => Promise.resolve(kit), 'bakery');
    const seen: StoredDoc[][] = [];
    source.watchIngredients(list => seen.push(list), () => {});
    await settle();
    const prices = live('locations/bakery/ingredient-prices')[0]!;
    const ingredients = live('locations/bakery/ingredients')[0]!;
    // ⚠️ The prices land first: nothing is painted until the ingredients themselves arrive.
    prices.next(collectionSnap([{ id: 'flour', priceUnit: 'kg', pricePerUnit: 0.9 }]));
    expect(seen).toEqual([]);
    // A price written on the ingredient itself is never used (withPrices: security audit 23 Sep 2026).
    ingredients.next(collectionSnap([{ id: 'flour', name: 'Flour', pricePerUnit: 99 }, { id: 'salt', name: 'Salt' }]));
    expect(seen).toHaveLength(1);
    const [flour, salt] = seen[0]!;
    expect(flour).toMatchObject({ id: 'flour', name: 'Flour', priceUnit: 'kg', pricePerUnit: 0.9 });
    expect(salt).toMatchObject({ id: 'salt', name: 'Salt' });
    expect(salt!.pricePerUnit ?? null).toBeNull();
  });

  test('a refused price read (an employee) still gives the list, unpriced', async () => {
    const { kit, live } = fakeKit();
    const source = createFirestoreStocktakeSource(() => Promise.resolve(kit), 'bakery');
    const seen: StoredDoc[][] = [];
    const onError = vi.fn();
    source.watchIngredients(list => seen.push(list), onError);
    await settle();
    live('locations/bakery/ingredients')[0]!.next(collectionSnap([{ id: 'flour', name: 'Flour' }]));
    live('locations/bakery/ingredient-prices')[0]!.error(Object.assign(new Error('no'), { code: 'permission-denied' }));
    expect(onError).not.toHaveBeenCalled();
    expect(seen.at(-1)).toEqual([expect.objectContaining({ id: 'flour', name: 'Flour' })]);
  });

  test('stopping the ingredients stops both listeners', async () => {
    const { kit, live } = fakeKit();
    const source = createFirestoreStocktakeSource(() => Promise.resolve(kit), 'bakery');
    const stop = source.watchIngredients(() => {}, () => {});
    await settle();
    expect(live('locations/bakery/ingredients')).toHaveLength(1);
    expect(live('locations/bakery/ingredient-prices')).toHaveLength(1);
    stop();
    expect(live('locations/bakery/ingredients')).toHaveLength(0);
    expect(live('locations/bakery/ingredient-prices')).toHaveLength(0);
  });
});

describe('⚠️ what the source says it knows, and what it never sends', () => {
  const FLOUR = { id: 'flour', name: 'Flour' };
  const denied = (code: string) => Object.assign(new Error(code), { code });

  async function listening() {
    const fake = fakeKit();
    const source = createFirestoreStocktakeSource(() => Promise.resolve(fake.kit), 'bakery');
    const told: { names: unknown[]; fromCache: boolean; pricesAnswered: boolean }[] = [];
    const lists: (readonly Record<string, unknown>[])[] = [];
    const onError = vi.fn();
    source.watchIngredients((list, answer) => {
      told.push({ names: list.map(i => i.name), ...answer });
      lists.push(list);
    }, onError);
    await settle();
    return {
      told, lists, onError,
      ingredients: fake.live('locations/bakery/ingredients')[0]!,
      prices: fake.live('locations/bakery/ingredient-prices')[0]!,
    };
  }

  test('⚠️⚠️ no empty map goes out, and it is still a merge: in a merge an empty map wipes the stored one', async () => {
    // The very write an ordinary close makes with nothing counted: it emptied the next month's figures on the emulator.
    const { kit, fs } = fakeKit();
    const source = createFirestoreStocktakeSource(() => Promise.resolve(kit), 'bakery');
    await source.saveMonthFields('2026-11', { month: '2026-11', opening: {}, packKg: {}, createdAt: 'a', updatedAt: 'b' });
    const [, payload, options] = fs.setDoc.mock.calls[0] as [Ref, Record<string, unknown>, unknown];
    expect(payload).toEqual({ month: '2026-11', createdAt: 'a', updatedAt: 'b', bakery: 'bakery' });
    expect(options).toEqual({ merge: true });
  });

  test('a close stamped with nothing to freeze leaves the stored names and prices alone', async () => {
    const { kit, fs } = fakeKit();
    const source = createFirestoreStocktakeSource(() => Promise.resolve(kit), 'bakery');
    await source.saveMonthFields('2026-10', { month: '2026-10', closedAt: 'x', names: {}, unitPrice: {}, packKg: { flour: 25 } });
    const payload = fs.setDoc.mock.calls[0]![1];
    expect(payload).not.toHaveProperty('names');
    expect(payload).not.toHaveProperty('unitPrice');
    expect(payload.packKg).toEqual({ flour: 25 });
  });

  test('a box is still emptied by name, and a month still reopened by an empty string', async () => {
    const { kit, fs } = fakeKit();
    const source = createFirestoreStocktakeSource(() => Promise.resolve(kit), 'bakery');
    await source.saveMonthFields('2026-10', { month: '2026-10', closing: {} }, { closing: { flour: true } });
    expect(fs.setDoc.mock.calls[0]![1].closing).toEqual({ flour: DELETE });
    await source.saveMonthFields('2026-10', { month: '2026-10', closedAt: '' });
    expect(fs.setDoc.mock.calls[1]![1].closedAt).toBe('');
  });

  test('⚠️ orders that are only on this device are a failed read, never «no orders», nor a part standing for the month', async () => {
    const { kit, setOrders, setOrdersFromCache } = fakeKit();
    const source = createFirestoreStocktakeSource(() => Promise.resolve(kit), 'bakery');
    setOrdersFromCache(true);
    await expect(source.getOrdersInMonth('2026-10-01', '2026-11-01')).rejects.toThrow(/only on this device/);
    setOrders([{ id: 'o1', date: '2026-10-05' }]);
    await expect(source.getOrdersInMonth('2026-10-01', '2026-11-01')).rejects.toThrow(/only on this device/);
    setOrdersFromCache(false);
    await expect(source.getOrdersInMonth('2026-10-01', '2026-11-01')).resolves.toEqual([{ id: 'o1', date: '2026-10-05' }]);
  });

  test('the month says whether the snapshot carries this phone’s own writes', async () => {
    const { kit, live } = fakeKit();
    const source = createFirestoreStocktakeSource(() => Promise.resolve(kit), 'bakery');
    const seen: unknown[] = [];
    source.watchMonth('2026-10', (_doc, meta) => seen.push(meta), () => {});
    await settle();
    live('locations/bakery/inventory/2026-10')[0]!.next({
      id: '2026-10', exists: () => true, data: () => ({}), metadata: { fromCache: true, hasPendingWrites: true },
    });
    expect(seen).toEqual([{ fromServer: false, hasPendingWrites: true }]);
  });

  test('⚠️ both collections ask for metadata changes: the server confirming an empty copy changes no document', async () => {
    const { ingredients, prices } = await listening();
    expect(ingredients.options).toEqual({ includeMetadataChanges: true });
    expect(prices.options).toEqual({ includeMetadataChanges: true });
  });

  test('⚠️ an empty copy of the ingredients says it is a copy; the server’s «none» arrives and says so', async () => {
    const { told, ingredients } = await listening();
    ingredients.next(collectionSnap([], { fromCache: true }));
    expect(told.at(-1)).toMatchObject({ names: [], fromCache: true });
    // Nothing new to tell.
    ingredients.next(collectionSnap([], { fromCache: true }));
    expect(told).toHaveLength(1);
    ingredients.next(collectionSnap([]));
    expect(told).toHaveLength(2);
    expect(told.at(-1)).toMatchObject({ names: [], fromCache: false });
  });

  test('the server confirming a full list changes nothing and is not told again', async () => {
    const { told, ingredients } = await listening();
    ingredients.next(collectionSnap([FLOUR], { fromCache: true }));
    ingredients.next(collectionSnap([FLOUR], { changes: 0 }));
    expect(told).toHaveLength(1);
  });

  test('⚠️ an empty copy of the prices is not an answer; the server’s «none» is, and it arrives', async () => {
    const { told, ingredients, prices } = await listening();
    ingredients.next(collectionSnap([FLOUR]));
    expect(told.map(a => a.pricesAnswered)).toEqual([false]);
    prices.next(collectionSnap([], { fromCache: true }));
    expect(told.map(a => a.pricesAnswered)).toEqual([false]);
    prices.next(collectionSnap([]));
    expect(told.map(a => a.pricesAnswered)).toEqual([false, true]);
  });

  test('prices from the phone’s copy are an answer, and the server confirming them is not told twice', async () => {
    const { told, ingredients, prices } = await listening();
    ingredients.next(collectionSnap([FLOUR]));
    prices.next(collectionSnap([{ id: 'flour', pricePerUnit: 2 }], { fromCache: true }));
    prices.next(collectionSnap([{ id: 'flour', pricePerUnit: 2 }], { changes: 0 }));
    expect(told.map(a => a.pricesAnswered)).toEqual([false, true]);
  });

  test('a refused price read counts as answered: that account will never get more', async () => {
    const { told, ingredients, prices, onError } = await listening();
    ingredients.next(collectionSnap([FLOUR]));
    prices.error(denied('permission-denied'));
    expect(told.map(a => a.pricesAnswered)).toEqual([false, true]);
    expect(onError).not.toHaveBeenCalled();
  });

  test('⚠️ any other price failure does not: a month closed on it would freeze no money, with no warning', async () => {
    const { told, ingredients, prices } = await listening();
    ingredients.next(collectionSnap([FLOUR]));
    prices.error(denied('resource-exhausted'));
    expect(told.map(a => a.pricesAnswered)).toEqual([false, false]);
  });

  // The current app's 5df661d3 (tests/inventory-close-month.test.mjs). Mise 2 used to take the answer back here.
  test('⚠️ a price failure after an answer keeps the prices: the month stays ready, so a close would freeze no money', async () => {
    const { told, lists, ingredients, prices } = await listening();
    ingredients.next(collectionSnap([FLOUR]));
    prices.next(collectionSnap([{ id: 'flour', priceUnit: 'kg', pricePerUnit: 2 }]));
    const before = lists.at(-1);
    expect(before?.[0]).toMatchObject({ id: 'flour', pricePerUnit: 2 });
    prices.error(denied('resource-exhausted'));
    expect(told.at(-1)!.pricesAnswered).toBe(true);
    expect(lists.at(-1)).toStrictEqual(before);
  });

  test('a refused read after an answer still empties the prices, and stays answered: that account will get no more', async () => {
    const { told, lists, ingredients, prices } = await listening();
    ingredients.next(collectionSnap([FLOUR]));
    prices.next(collectionSnap([{ id: 'flour', priceUnit: 'kg', pricePerUnit: 2 }]));
    prices.error(denied('permission-denied'));
    expect(told.at(-1)!.pricesAnswered).toBe(true);
    expect(lists.at(-1)?.[0]?.pricePerUnit ?? null).toBeNull();
  });
});
