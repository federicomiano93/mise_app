import { describe, expect, test, vi } from 'vitest';
import type { FirestoreKit } from '../session/firebaseBackend';
import { HISTORY_LIMIT, createFirestoreFoodcostSource, makeDocumentId } from './foodcostSource';
import type { StoredDoc } from './foodcostSource';

// The ONLY code in Mise 2 that writes Food cost to the real database, against a recording fake of
// the Firestore SDK. firestore.rules accept exactly these shapes; every other spec runs on an
// in-memory source, so a slip here — a merged product that keeps a removed line, a margin point
// written apart from its product, a whole recipe written from a stale copy, a missing venue stamp —
// would otherwise first show as a product that never reached the office.

type Ref = { kind: string; path: string; parts?: unknown[] };

function fakeKit() {
  const listeners: { target: Ref; options: unknown; next: (snap: unknown) => void; error: (err: unknown) => void; stopped: boolean }[] = [];
  const batches: { sets: [Ref, Record<string, unknown>][]; committed: boolean }[] = [];
  let autoIds = 0;
  const fs = {
    collection: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'collection', path: segments.join('/') }),
    doc: (first: unknown, ...segments: string[]): Ref => {
      // doc(collectionRef) mints an id, as the SDK does; doc(db, path, id) names one.
      if (first && typeof first === 'object' && (first as Ref).kind === 'collection' && !segments.length) {
        return { kind: 'doc', path: `${(first as Ref).path}/auto-${++autoIds}` };
      }
      return { kind: 'doc', path: segments.join('/') };
    },
    query: (ref: Ref, ...parts: unknown[]): Ref => ({ ...ref, kind: 'query', parts }),
    orderBy: (field: string, dir: string) => ({ orderBy: [field, dir] }),
    limit: (n: number) => ({ limit: n }),
    onSnapshot: vi.fn((target: Ref, ...rest: unknown[]) => {
      const options = typeof rest[0] === 'function' ? undefined : rest.shift();
      const [next, error] = rest as [(snap: unknown) => void, (err: unknown) => void];
      const entry = { target, options, next, error, stopped: false };
      listeners.push(entry);
      return () => { entry.stopped = true; };
    }),
    writeBatch: vi.fn(() => {
      const batch = { sets: [] as [Ref, Record<string, unknown>][], committed: false };
      batches.push(batch);
      return {
        set: (ref: Ref, data: Record<string, unknown>) => { batch.sets.push([ref, data]); },
        commit: async () => { batch.committed = true; },
      };
    }),
    setDoc: vi.fn(async (_ref: Ref, _data: Record<string, unknown>, _options?: unknown) => {}),
    updateDoc: vi.fn(async (_ref: Ref, _data: Record<string, unknown>) => {}),
    deleteDoc: vi.fn(async (_ref: Ref) => {}),
    getDocs: vi.fn(async (_q: Ref) => ({ docs: [{ id: 's1', data: () => ({ foodCostPct: 31 }) }] })),
  };
  const kit = { fs, db: {} } as unknown as FirestoreKit;
  const live = (path: string) => listeners.filter(l => l.target.path === path && !l.stopped);
  return { kit, fs, listeners, batches, live };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function collectionSnap(docs: StoredDoc[], fromCache = false) {
  const snaps = docs.map(({ id, ...data }) => ({ id, data: () => data }));
  return { docs: snaps, metadata: { fromCache }, forEach: (fn: (s: { id: string; data: () => Record<string, unknown> }) => void) => snaps.forEach(fn) };
}

describe('the Food cost source, as firestore.rules expect it', () => {
  test('⚠️ a product is written WHOLE, stamped for the venue, with its margin point in the SAME batch', async () => {
    const { kit, fs, batches } = fakeKit();
    const source = createFirestoreFoodcostSource(() => Promise.resolve(kit), 'panificio-miano');
    await source.saveProduct('p1', { name: 'Loaf', model: 2 }, { recordedAt: '2026-10-12', foodCostPct: 30 });
    expect(fs.writeBatch).toHaveBeenCalledTimes(1);
    expect(fs.setDoc).not.toHaveBeenCalled();
    const [batch] = batches;
    expect(batch!.committed).toBe(true);
    expect(batch!.sets).toHaveLength(2);
    const [productRef, productData] = batch!.sets[0]!;
    expect(productRef.path).toBe('locations/panificio-miano/products/p1');
    expect(productData).toEqual({ name: 'Loaf', model: 2, bakery: 'panificio-miano' });
    const [pointRef, pointData] = batch!.sets[1]!;
    expect(pointRef.path).toMatch(/^locations\/panificio-miano\/products\/p1\/snapshots\/auto-\d+$/);
    expect(pointData).toEqual({ recordedAt: '2026-10-12', foodCostPct: 30, bakery: 'panificio-miano' });
  });

  test('no margin point, no second write', async () => {
    const { kit, batches } = fakeKit();
    const source = createFirestoreFoodcostSource(() => Promise.resolve(kit), 'bakery');
    await source.saveProduct('p1', { name: 'Loaf' }, null);
    expect(batches[0]!.sets).toHaveLength(1);
  });

  test('⚠️ a weighing writes THREE fields of a recipe with updateDoc, stamped — never the whole recipe', async () => {
    const { kit, fs } = fakeKit();
    const source = createFirestoreFoodcostSource(() => Promise.resolve(kit), 'bakery');
    await source.saveRecipeLoss('r1', { lossPct: 12, rawGrams: 1000, cookedGrams: 880, name: 'sneaked' } as never);
    expect(fs.setDoc).not.toHaveBeenCalled();
    const [ref, data] = fs.updateDoc.mock.calls[0]!;
    expect(ref.path).toBe('locations/bakery/recipes/r1');
    expect(data).toEqual({ lossPct: 12, rawGrams: 1000, cookedGrams: 880, bakery: 'bakery' });
  });

  test('a product is deleted by its own path', async () => {
    const { kit, fs } = fakeKit();
    const source = createFirestoreFoodcostSource(() => Promise.resolve(kit), 'bakery');
    await source.removeProduct('p1');
    expect(fs.deleteDoc.mock.calls[0]![0].path).toBe('locations/bakery/products/p1');
  });

  test('⚠️ an id that could name another path never reaches Firestore', async () => {
    const { kit, fs } = fakeKit();
    const source = createFirestoreFoodcostSource(() => Promise.resolve(kit), 'bakery');
    await expect(source.saveProduct('a/b', { name: 'x' }, null)).rejects.toThrow();
    await expect(source.removeProduct('')).rejects.toThrow();
    await expect(source.saveRecipeLoss('..', { lossPct: 1, rawGrams: 1, cookedGrams: 1 })).rejects.toThrow();
    expect(fs.writeBatch).not.toHaveBeenCalled();
    expect(fs.deleteDoc).not.toHaveBeenCalled();
    expect(fs.updateDoc).not.toHaveBeenCalled();
  });

  test('the venue id is checked before anything is built from it', () => {
    const { kit } = fakeKit();
    expect(() => createFirestoreFoodcostSource(() => Promise.resolve(kit), '../other')).toThrow();
  });

  test('⚠️ the margin history is ordered by the recordedAt FIELD, newest first, at most 30', async () => {
    const { kit, fs } = fakeKit();
    const source = createFirestoreFoodcostSource(() => Promise.resolve(kit), 'bakery');
    expect(await source.getProductHistory('p1')).toEqual([{ id: 's1', foodCostPct: 31 }]);
    const q = fs.getDocs.mock.calls[0]![0];
    expect(q.path).toBe('locations/bakery/products/p1/snapshots');
    expect(q.parts).toEqual([{ orderBy: ['recordedAt', 'desc'] }, { limit: HISTORY_LIMIT }]);
    expect(HISTORY_LIMIT).toBe(30);
  });

  test('the labour rate is a MERGE with its stamp; null clears it', async () => {
    const { kit, fs } = fakeKit();
    const source = createFirestoreFoodcostSource(() => Promise.resolve(kit), 'bakery');
    await source.saveLabourCostPerHour(null, '2026-10-12T09:00:00.000Z');
    const [ref, data, options] = fs.setDoc.mock.calls[0]!;
    expect(ref.path).toBe('locations/bakery/foodcost-settings/main');
    expect(options).toEqual({ merge: true });
    expect(data).toEqual({ labourCostPerHour: null, updatedAt: '2026-10-12T09:00:00.000Z', bakery: 'bakery' });
  });

  test('⚠️ the products are watched WITH metadata changes, and say whether the server answered', async () => {
    const { kit, live } = fakeKit();
    const source = createFirestoreFoodcostSource(() => Promise.resolve(kit), 'bakery');
    const seen: [StoredDoc[], boolean][] = [];
    source.watchProducts((list, meta) => seen.push([list, meta.fromServer]), () => {});
    await settle();
    const [listener] = live('locations/bakery/products');
    expect(listener!.options).toEqual({ includeMetadataChanges: true });
    listener!.next(collectionSnap([{ id: 'p1', name: 'Loaf' }], true));
    listener!.next(collectionSnap([{ id: 'p1', name: 'Loaf' }], false));
    expect(seen).toEqual([[[{ id: 'p1', name: 'Loaf' }], false], [[{ id: 'p1', name: 'Loaf' }], true]]);
  });

  test('⚠️ the ingredients are emitted only once they have arrived, with their prices laid on', async () => {
    const { kit, live } = fakeKit();
    const source = createFirestoreFoodcostSource(() => Promise.resolve(kit), 'bakery');
    const seen: StoredDoc[][] = [];
    source.watchIngredients(list => seen.push(list), () => {});
    await settle();
    const prices = live('locations/bakery/ingredient-prices')[0]!;
    prices.next(collectionSnap([{ id: 'i1', priceUnit: 'kg', pricePerUnit: 2 }]));
    expect(seen).toEqual([]);
    live('locations/bakery/ingredients')[0]!.next(collectionSnap([{ id: 'i1', name: 'Flour', pricePerUnit: 99 }]));
    expect(seen).toHaveLength(1);
    expect(seen[0]![0]).toMatchObject({ id: 'i1', name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 });
  });

  test('a refused price read leaves the ingredients unpriced, quietly', async () => {
    const { kit, live } = fakeKit();
    const source = createFirestoreFoodcostSource(() => Promise.resolve(kit), 'bakery');
    const seen: StoredDoc[][] = [];
    const onError = vi.fn();
    source.watchIngredients(list => seen.push(list), onError);
    await settle();
    live('locations/bakery/ingredients')[0]!.next(collectionSnap([{ id: 'i1', name: 'Flour' }]));
    live('locations/bakery/ingredient-prices')[0]!.error(new Error('permission-denied'));
    expect(onError).not.toHaveBeenCalled();
    expect(seen.at(-1)![0]!.pricePerUnit ?? null).toBeNull();
  });

  test('the settings: their fields, null when missing, and null when refused', async () => {
    const { kit, live } = fakeKit();
    const source = createFirestoreFoodcostSource(() => Promise.resolve(kit), 'bakery');
    const seen: unknown[] = [];
    source.watchSettings(data => seen.push(data));
    await settle();
    const [listener] = live('locations/bakery/foodcost-settings/main');
    listener!.next({ exists: () => true, data: () => ({ labourCostPerHour: 14 }) });
    listener!.next({ exists: () => false, data: () => undefined });
    listener!.error(new Error('permission-denied'));
    expect(seen).toEqual([{ labourCostPerHour: 14 }, null, null]);
  });

  test('a stop before Firestore has loaded means nothing is ever subscribed', async () => {
    const { kit, fs } = fakeKit();
    let release!: (k: FirestoreKit) => void;
    const loading = new Promise<FirestoreKit>(resolve => { release = resolve; });
    const source = createFirestoreFoodcostSource(() => loading, 'bakery');
    const stop = source.watchRecipes(() => {}, () => {});
    stop();
    release(kit);
    await settle();
    expect(fs.onSnapshot).not.toHaveBeenCalled();
  });

  test('a new id is 20 characters of Firestore’s own alphabet, and two are never the same', () => {
    const a = makeDocumentId();
    const b = makeDocumentId();
    expect(a).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(a).not.toBe(b);
    // Bytes of 248 and above are thrown away, so every character is equally likely.
    let calls = 0;
    const id = makeDocumentId(bytes => { calls += 1; bytes.fill(calls === 1 ? 250 : 61); });
    expect(id).toBe('9'.repeat(20));
  });
});
