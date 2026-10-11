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
  const listeners: { target: Ref; next: (snap: unknown) => void; error: (err: unknown) => void; stopped: boolean }[] = [];
  let stored: Record<string, Record<string, unknown> | null> = {};
  let orderDocs: Snap[] = [];
  const fs = {
    collection: (_db: unknown, path: string): Ref => ({ kind: 'collection', path }),
    doc: (_db: unknown, path: string, id: string): Ref => ({ kind: 'doc', path: `${path}/${id}` }),
    where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
    query: (ref: Ref, ...parts: unknown[]): Ref => ({ ...ref, kind: 'query', parts }),
    deleteField: vi.fn(() => DELETE),
    onSnapshot: vi.fn((target: Ref, next: (snap: unknown) => void, error: (err: unknown) => void) => {
      const entry = { target, next, error, stopped: false };
      listeners.push(entry);
      return () => { entry.stopped = true; };
    }),
    setDoc: vi.fn(async (_ref: Ref, _payload: Record<string, unknown>, _options?: unknown) => {}),
    getDoc: vi.fn(async (ref: Ref) => {
      const data = stored[ref.path] ?? null;
      return { id: ref.path.split('/').pop(), exists: () => data !== null, data: () => data };
    }),
    getDocs: vi.fn(async (_query: Ref) => ({ docs: orderDocs })),
  };
  const kit = { fs, db: {} } as unknown as FirestoreKit;
  const live = (path: string) => listeners.filter(l => l.target.path === path && !l.stopped);
  return {
    kit, fs, listeners, live,
    setStored: (value: typeof stored) => { stored = value; },
    setOrders: (docs: StoredDoc[]) => {
      orderDocs = docs.map(({ id, ...data }) => ({ id, data: () => data }));
    },
  };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// A collection snapshot as onSnapshot hands it over.
function collectionSnap(docs: StoredDoc[]) {
  const snaps = docs.map(({ id, ...data }) => ({ id, data: () => data }));
  return { docs: snaps, forEach: (fn: (snap: Snap) => void) => snaps.forEach(fn) };
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
    listener!.next({ id: '2026-10', exists: () => false, data: () => undefined });
    listener!.next({ id: '2026-10', exists: () => true, data: () => ({ month: '2026-10', closing: { a: 1 } }) });
    expect(seen).toEqual([null, { id: '2026-10', month: '2026-10', closing: { a: 1 } }]);
    stop();
    expect(live('locations/bakery/inventory/2026-10')).toEqual([]);
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
