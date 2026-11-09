import { describe, expect, test, vi } from 'vitest';
import type { FirestoreKit } from '../session/firebaseBackend';
import { PANEL_TIMEOUT_MS, WRITES_PER_BATCH, createFirestoreSuppliersSource, makeSupplierId } from './suppliersSource';
import type { StoredDoc } from './suppliersSource';

// The ONLY code in Mise 2 that writes «Ingredients & suppliers» to the real database, against a recording fake of the
// Firestore SDK. firestore.rules accept exactly these shapes; every other spec runs on an in-memory source, so a slip
// here — a supplier written whole, a category batch too big for production, a star written as a whole list, a missing
// venue stamp — would otherwise first show as a supplier that never reached the office.

type Ref = { kind: string; path: string };
type Op = { op: 'set' | 'update'; ref: Ref; data: Record<string, unknown>; options?: unknown };

function fakeKit() {
  const listeners: { target: Ref; options: unknown; next: (snap: unknown) => void; error: (err: unknown) => void; stopped: boolean }[] = [];
  const batches: { ops: Op[]; committed: boolean }[] = [];
  const fs = {
    collection: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'collection', path: segments.join('/') }),
    doc: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'doc', path: segments.join('/') }),
    onSnapshot: vi.fn((target: Ref, ...rest: unknown[]) => {
      const options = typeof rest[0] === 'function' ? undefined : rest.shift();
      const [next, error] = rest as [(snap: unknown) => void, (err: unknown) => void];
      const entry = { target, options, next, error, stopped: false };
      listeners.push(entry);
      return () => { entry.stopped = true; };
    }),
    writeBatch: vi.fn(() => {
      const batch = { ops: [] as Op[], committed: false };
      batches.push(batch);
      return {
        set: (ref: Ref, data: Record<string, unknown>, options?: unknown) => { batch.ops.push({ op: 'set', ref, data, options }); },
        update: (ref: Ref, data: Record<string, unknown>) => { batch.ops.push({ op: 'update', ref, data }); },
        commit: async () => { batch.committed = true; },
      };
    }),
    setDoc: vi.fn(async (_ref: Ref, _data: Record<string, unknown>, _options?: unknown) => {}),
    updateDoc: vi.fn(async (_ref: Ref, _data: Record<string, unknown>) => {}),
    deleteDoc: vi.fn(async (_ref: Ref) => {}),
    arrayUnion: (...values: unknown[]) => ({ arrayUnion: values }),
    arrayRemove: (...values: unknown[]) => ({ arrayRemove: values }),
  };
  const kit = { fs, db: {} } as unknown as FirestoreKit;
  const live = (path: string) => listeners.filter(l => l.target.path === path && !l.stopped);
  return { kit, fs, listeners, batches, live };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const VENUE = 'panificio-miano';

function collectionSnap(docs: StoredDoc[], fromCache = false) {
  const snaps = docs.map(({ id, ...data }) => ({ id, data: () => data }));
  return {
    docs: snaps, empty: snaps.length === 0, metadata: { fromCache },
    forEach: (fn: (s: { id: string; data: () => Record<string, unknown> }) => void) => snaps.forEach(fn),
  };
}

function make() {
  const parts = fakeKit();
  const call = vi.fn(async (_name: string, _data: unknown, _timeout: number) => ({ ok: true }));
  const source = createFirestoreSuppliersSource(() => Promise.resolve(parts.kit), call, VENUE);
  return { ...parts, call, source };
}

describe('the suppliers source, as firestore.rules expect it', () => {
  test('a supplier is MERGED at its own id, stamped for the venue, and never carries its id as a field', async () => {
    const { fs, source } = make();
    await source.saveSupplier('s1', { id: 's1', name: 'Alba', shortName: '' });
    expect(fs.setDoc).toHaveBeenCalledTimes(1);
    const [ref, data, options] = fs.setDoc.mock.calls[0]!;
    expect(ref.path).toBe(`locations/${VENUE}/suppliers/s1`);
    expect(data).toEqual({ name: 'Alba', shortName: '', bakery: VENUE });
    expect(options).toEqual({ merge: true });
  });

  test('⚠️ a caller cannot name another venue: the stamp goes on last', async () => {
    const { fs, source } = make();
    await source.saveSupplier('s1', { name: 'Alba', bakery: 'elsewhere' });
    expect(fs.setDoc.mock.calls[0]![1]).toEqual({ name: 'Alba', bakery: VENUE });
  });

  test('⚠️ switching a supplier off is an UPDATE (a supplier deleted meanwhile must not come back)', async () => {
    const { fs, source } = make();
    await source.setSupplierActive('s1', false);
    expect(fs.setDoc).not.toHaveBeenCalled();
    const [ref, data] = fs.updateDoc.mock.calls[0]!;
    expect(ref.path).toBe(`locations/${VENUE}/suppliers/s1`);
    expect(data).toEqual({ active: false, bakery: VENUE });
  });

  test('a supplier delete deletes that document and nothing else', async () => {
    const { fs, source } = make();
    await source.deleteSupplier('s1');
    expect(fs.deleteDoc).toHaveBeenCalledTimes(1);
    expect(fs.deleteDoc.mock.calls[0]![0].path).toBe(`locations/${VENUE}/suppliers/s1`);
    expect(fs.writeBatch).not.toHaveBeenCalled();
  });

  test('⚠️ a star is arrayUnion / arrayRemove on config/orders, merged — never the whole list', async () => {
    const { fs, source } = make();
    await source.setFavourite('s1', true);
    await source.setFavourite('s2', false);
    expect(fs.setDoc.mock.calls[0]).toEqual([
      { kind: 'doc', path: `locations/${VENUE}/config/orders` },
      { favouriteSuppliers: { arrayUnion: ['s1'] }, bakery: VENUE },
      { merge: true },
    ]);
    expect(fs.setDoc.mock.calls[1]![1]).toEqual({ favouriteSuppliers: { arrayRemove: ['s2'] }, bakery: VENUE });
  });

  test('an id that could name another path never reaches Firestore', async () => {
    const { fs, source } = make();
    await expect(source.saveSupplier('a/b', { name: 'x' })).rejects.toThrow('Not a document id');
    await expect(source.setFavourite('..', true)).rejects.toThrow('Not a document id');
    expect(fs.setDoc).not.toHaveBeenCalled();
  });

  test('⚠️ a category delete: the list rides in the FIRST batch, at most five documents a batch, ingredients UPDATED', async () => {
    const { batches, source } = make();
    const ids = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6', 'i7', 'i8', 'i9', 'i10'];
    await source.deleteCategory(['Pastry'], ids);
    expect(WRITES_PER_BATCH).toBe(5);
    expect(batches.map(b => b.ops.length)).toEqual([5, 5, 1]);
    expect(batches.every(b => b.committed)).toBe(true);
    const [first] = batches;
    expect(first!.ops[0]).toEqual({
      op: 'set', ref: { kind: 'doc', path: `locations/${VENUE}/config/orders` },
      data: { ingredientCategories: ['Pastry'], bakery: VENUE }, options: { merge: true },
    });
    const ingredientOps = batches.flatMap(b => b.ops).filter(o => o.ref.path.includes('/ingredients/'));
    expect(ingredientOps.map(o => o.ref.path.split('/').pop())).toEqual(ids);
    expect(ingredientOps.every(o => o.op === 'update')).toBe(true);
    // The category plus every old price key as null (the merged document must pass the whitelist), and the stamp.
    expect(ingredientOps[0]!.data).toMatchObject({ category: 'Other', priceUnit: null, pricePerUnit: null, bakery: VENUE });
  });

  test('a category nobody uses still writes the shortened list', async () => {
    const { batches, source } = make();
    await source.deleteCategory([], []);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.ops).toHaveLength(1);
  });

  test('the panel switch is ONE key to setIngredientPanels, for this venue, with the 70 s wait', async () => {
    const { call, source } = make();
    await source.setIngredientPanel('showNutrition', false);
    expect(call).toHaveBeenCalledWith('setIngredientPanels', { locationId: VENUE, showNutrition: false }, PANEL_TIMEOUT_MS);
    expect(PANEL_TIMEOUT_MS).toBe(70_000);
  });

  test('every watch asks for metadata changes, so an answer identical to the copy still says it is the server’s', async () => {
    const { listeners, source } = make();
    source.watchSuppliers(() => undefined, () => undefined);
    source.watchIngredients(() => undefined, () => undefined);
    source.watchPrices(() => undefined);
    source.watchOrdersConfig(() => undefined, () => undefined);
    await settle();
    expect(listeners.map(l => l.target.path)).toEqual([
      `locations/${VENUE}/suppliers`, `locations/${VENUE}/ingredients`,
      `locations/${VENUE}/ingredient-prices`, `locations/${VENUE}/config/orders`,
    ]);
    expect(listeners.every(l => (l.options as { includeMetadataChanges?: boolean }).includeMetadataChanges === true)).toBe(true);
  });

  test('⚠️ prices: an EMPTY cached answer is not readable, a server one is, a refusal is ({}, false)', async () => {
    const { live, source } = make();
    const seen: Array<[Record<string, unknown>, boolean]> = [];
    source.watchPrices((map, readable) => { seen.push([map, readable]); });
    await settle();
    const [entry] = live(`locations/${VENUE}/ingredient-prices`);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    entry!.next(collectionSnap([], true));
    entry!.next(collectionSnap([{ id: 'i1', pricePerUnit: 2 }], true));
    entry!.next(collectionSnap([], false));
    entry!.error(new Error('permission-denied'));
    expect(seen).toEqual([[{}, false], [{ i1: { pricePerUnit: 2 } }, true], [{}, true], [{}, false]]);
  });

  test('config/orders: a missing document is null, with where it came from', async () => {
    const { live, source } = make();
    const seen: unknown[] = [];
    source.watchOrdersConfig((data, meta) => { seen.push([data, meta.fromServer]); }, () => undefined);
    await settle();
    const [entry] = live(`locations/${VENUE}/config/orders`);
    entry!.next({ exists: () => false, data: () => undefined, metadata: { fromCache: true } });
    entry!.next({ exists: () => true, data: () => ({ ingredientCategories: [] }), metadata: { fromCache: false } });
    expect(seen).toEqual([[null, false], [{ ingredientCategories: [] }, true]]);
  });

  test('stop works before Firestore has loaded', async () => {
    let resolve: (kit: FirestoreKit) => void = () => undefined;
    const pending = new Promise<FirestoreKit>(r => { resolve = r; });
    const { kit, listeners } = fakeKit();
    const source = createFirestoreSuppliersSource(() => pending, vi.fn(), VENUE);
    const stop = source.watchSuppliers(() => undefined, () => undefined);
    stop();
    resolve(kit);
    await settle();
    expect(listeners).toHaveLength(0);
  });

  test('a minted supplier id has Firestore’s shape', () => {
    expect(makeSupplierId()).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(makeSupplierId()).not.toBe(makeSupplierId());
  });
});
