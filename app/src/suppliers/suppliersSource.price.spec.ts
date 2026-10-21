import { describe, expect, test, vi } from 'vitest';
import type { FirestoreKit } from '../session/firebaseBackend';
import { createFirestoreSuppliersSource } from './suppliersSource';

// The ingredient card's MONEY writes and reads (step 3e-3) against a recording fake of the Firestore SDK: the shapes
// firestore.rules accept (`ingredient-prices`, the append-only `ingredients/{id}/prices`), the one batch, and the two reads.

type Ref = { kind: string; path: string };
type BatchOp = { op: 'set'; ref: Ref; data: Record<string, unknown>; options?: unknown };

const VENUE = 'panificio-miano';

function make(answers: { price?: Record<string, unknown> | null | Error; history?: Array<Record<string, unknown>> | Error } = {}) {
  const batches: { ops: BatchOp[]; committed: boolean }[] = [];
  const fs = {
    collection: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'collection', path: segments.join('/') }),
    doc: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'doc', path: segments.join('/') }),
    query: (ref: Ref, ...constraints: unknown[]) => ({ ref, constraints }),
    orderBy: (field: string, dir: string) => ({ orderBy: field, dir }),
    limit: (n: number) => ({ limit: n }),
    writeBatch: vi.fn(() => {
      const batch = { ops: [] as BatchOp[], committed: false };
      batches.push(batch);
      return {
        set: (ref: Ref, data: Record<string, unknown>, options?: unknown) => { batch.ops.push({ op: 'set', ref, data, options }); },
        commit: async () => { batch.committed = true; },
      };
    }),
    setDoc: vi.fn(async (_ref: Ref, _data: Record<string, unknown>, _options?: unknown) => {}),
    getDoc: vi.fn(async (_ref: Ref) => {
      if (answers.price instanceof Error) throw answers.price;
      return { exists: () => answers.price != null, data: () => answers.price };
    }),
    getDocsFromServer: vi.fn(async (_q: unknown) => {
      if (answers.history instanceof Error) throw answers.history;
      return { docs: (answers.history ?? []).map(({ id, ...data }) => ({ id: id as string, data: () => data })) };
    }),
  };
  const kit = { fs, db: {} } as unknown as FirestoreKit;
  const source = createFirestoreSuppliersSource(() => Promise.resolve(kit), vi.fn(), VENUE);
  return { fs, batches, source };
}

describe('the money writes, as firestore.rules expect them', () => {
  test('⚠️ ingredient + price + history in ONE batch: the item and the price MERGED, the entry a new document, all stamped', async () => {
    const { fs, batches, source } = make();
    await source.saveIngredient('i1', { name: 'Flour' }, {
      doc: { priceUnit: 'kg', pricePerUnit: 2, id: 'x', bakery: 'elsewhere' },
      history: { recordedAt: 'now', priceUnit: 'kg', pricePerUnit: 2, unitWeightKg: null, supplierId: '', source: 'manual' },
    });
    expect(fs.setDoc).not.toHaveBeenCalled();
    expect(batches).toHaveLength(1);
    const [item, price, entry] = batches[0]!.ops;
    expect(batches[0]!.committed).toBe(true);
    expect([item!.ref.path, item!.data, item!.options]).toEqual([`locations/${VENUE}/ingredients/i1`, { name: 'Flour', bakery: VENUE }, { merge: true }]);
    expect([price!.ref.path, price!.data, price!.options])
      .toEqual([`locations/${VENUE}/ingredient-prices/i1`, { priceUnit: 'kg', pricePerUnit: 2, bakery: VENUE }, { merge: true }]);
    expect(entry!.ref.path).toMatch(new RegExp(`^locations/${VENUE}/ingredients/i1/prices/[A-Za-z0-9]{20}$`));
    expect(entry!.data).toMatchObject({ recordedAt: 'now', source: 'manual', bakery: VENUE });
    expect(entry!.options).toBeUndefined();
  });

  test('a price with no history entry: two writes in the batch, no entry', async () => {
    const { batches, source } = make();
    await source.saveIngredient('i1', { name: 'Flour' }, { doc: { vatRate: 10 }, history: null });
    expect(batches[0]!.ops.map(o => o.ref.path)).toEqual([`locations/${VENUE}/ingredients/i1`, `locations/${VENUE}/ingredient-prices/i1`]);
  });

  test('no money: the ingredient alone, merged, no batch (step 3e-2 as it was)', async () => {
    const { fs, batches, source } = make();
    await source.saveIngredient('i1', { name: 'Flour' });
    expect(batches).toHaveLength(0);
    expect(fs.setDoc.mock.calls[0]![0].path).toBe(`locations/${VENUE}/ingredients/i1`);
  });

  test('an id that could name another path never reaches Firestore', async () => {
    const { batches, source } = make();
    await expect(source.saveIngredient('a/b', { name: 'x' }, { doc: {}, history: null })).rejects.toThrow();
    expect(batches.every(b => !b.committed)).toBe(true);
  });
});

describe('the money reads', () => {
  test('readPrice answers the price document, null when there is none, and rejects when it cannot be read', async () => {
    const one = make({ price: { pricePerUnit: 2 } });
    expect(await one.source.readPrice('i1')).toEqual({ pricePerUnit: 2 });
    expect(one.fs.getDoc.mock.calls[0]![0].path).toBe(`locations/${VENUE}/ingredient-prices/i1`);
    expect(await make({ price: null }).source.readPrice('i1')).toBeNull();
    await expect(make({ price: new Error('unavailable') }).source.readPrice('i1')).rejects.toThrow('unavailable');
  });

  test('⚠️ the history is read FROM THE SERVER, ordered by the recordedAt FIELD descending, limited', async () => {
    const { fs, source } = make({ history: [{ id: 'h1', recordedAt: 'b', pricePerUnit: 2 }] });
    expect(await source.readPriceHistory('i1', 20)).toEqual([{ id: 'h1', recordedAt: 'b', pricePerUnit: 2 }]);
    const q = fs.getDocsFromServer.mock.calls[0]![0] as { ref: Ref; constraints: unknown[] };
    expect(q.ref.path).toBe(`locations/${VENUE}/ingredients/i1/prices`);
    expect(q.constraints).toEqual([{ orderBy: 'recordedAt', dir: 'desc' }, { limit: 20 }]);
  });

  test('a history the server cannot give rejects (never an empty «no price recorded yet»)', async () => {
    await expect(make({ history: new Error('unavailable') }).source.readPriceHistory('i1', 20)).rejects.toThrow();
  });
});
