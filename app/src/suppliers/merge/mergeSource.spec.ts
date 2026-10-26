import { afterEach, describe, expect, test, vi } from 'vitest';
import type { FirestoreKit } from '../../session/firebaseBackend';
import { MERGE_TIMEOUT_MS, MergeError, createFirestoreMergeSource } from './mergeSource';

// The ONLY code in Mise 2 that merges two ingredients in the real database, against a recording fake of the Firestore SDK
// (the shape of importSource.spec.ts). @mise/shared/ingredient-merge's spec pins WHAT is planned; this file pins WHERE it
// goes and in what order, that every read comes from the SERVER, that nothing starts offline, that nothing waits for ever,
// that the usage is checked again right before the first write, and the honest `committed` flag (parity I124–I127).
// Every name, id and price is INVENTED.

type Ref = { kind: string; path: string; constraints?: unknown[] };
type Op = { op: 'set' | 'delete'; ref: Ref; data?: Record<string, unknown>; options?: unknown };
type Snap = { id: string; data: () => Record<string, unknown> };

const VENUE = 'panificio-miano';
const at = (path: string) => `locations/${VENUE}/${path}`;
// 15 Oct 2026, noon: this month is 2026-10, last month 2026-09.
const NOW = new Date(2026, 9, 15, 12).getTime();

function fakeKit() {
  const batches: { ops: Op[]; committed: boolean }[] = [];
  const served: Record<string, Snap[]> = {};
  const docs: Record<string, Record<string, unknown> | null> = {};
  const order: string[] = [];
  let failCommit: ((index: number) => unknown) | null = null;
  const fs = {
    collection: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'collection', path: segments.join('/') }),
    doc: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'doc', path: segments.join('/') }),
    where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
    query: (target: Ref, ...constraints: unknown[]) => ({ ...target, constraints }),
    getDocsFromServer: vi.fn(async (target: Ref) => {
      order.push(`read ${target.path}`);
      return { docs: served[target.path] ?? [] };
    }),
    getDocFromServer: vi.fn(async (ref: Ref) => {
      order.push(`read ${ref.path}`);
      const data = docs[ref.path] ?? null;
      return { id: ref.path.split('/').pop(), exists: () => data !== null, data: () => data ?? undefined };
    }),
    waitForPendingWrites: vi.fn(async (_db: unknown) => { order.push('wait'); }),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    updateDoc: vi.fn(async (..._args: unknown[]) => { order.push('draft'); }),
    deleteField: () => ({ deleteField: true }),
    FieldPath: class { segments: string[]; constructor(...segments: string[]) { this.segments = segments; } },
    writeBatch: vi.fn(() => {
      const batch = { ops: [] as Op[], committed: false };
      const index = batches.push(batch) - 1;
      return {
        set: (ref: Ref, data: Record<string, unknown>, options?: unknown) => { batch.ops.push({ op: 'set', ref, data, options }); },
        delete: (ref: Ref) => { batch.ops.push({ op: 'delete', ref }); },
        commit: async () => {
          const failure = failCommit?.(index);
          if (failure) throw failure;
          batch.committed = true;
          order.push(`commit ${index}`);
        },
      };
    }),
  };
  const kit = { fs, db: {} } as unknown as FirestoreKit;
  return { kit, fs, batches, served, docs, order, failOn: (f: (index: number) => unknown) => { failCommit = f; } };
}

function make() {
  const parts = fakeKit();
  let offline = false;
  const source = createFirestoreMergeSource(() => Promise.resolve(parts.kit), VENUE, { isOffline: () => offline, now: () => NOW });
  return { ...parts, source, goOffline: () => { offline = true; } };
}

const snap = (id: string, data: Record<string, unknown>): Snap => ({ id, data: () => data });

// A (the sack, stays) and B (the bag, goes), with one invoice point on B, a newer price on B and one price change of B.
function seed(parts: ReturnType<typeof make>) {
  parts.docs[at('ingredients/a')] = { name: 'Lievito sacco', supplierId: 's1', kind: 'ingredient', supplierCode: 'SACCO', weight: '5 kg' };
  parts.docs[at('ingredients/b')] = { name: 'Lievito pacco', supplierId: 's1', kind: 'ingredient', supplierCode: 'PACCO', weight: '1 kg' };
  parts.served[at('ingredients/b/prices')] = [snap('inv-18000000050-1', {
    recordedAt: '2026-09-01T12:00:00.000Z', priceUnit: 'kg', pricePerUnit: 6, supplierId: 's1', source: 'invoice',
    invoiceId: '18000000050', invoiceDate: '2026-09-01', bakery: VENUE,
  })];
  parts.docs[at('ingredient-prices/a')] = { priceUnit: 'kg', pricePerUnit: 4, priceUpdatedAt: '2026-08-01T12:00:00.000Z' };
  parts.docs[at('ingredient-prices/b')] = { priceUnit: 'kg', pricePerUnit: 6, priceUpdatedAt: '2026-09-01T12:00:00.000Z' };
  parts.served[at('price-changes')] = [snap('inv-18000000050-1-b', { ingredientId: 'b' })];
}

afterEach(() => { vi.useRealTimers(); });

describe('where B is still used', () => {
  test('every source is read from the SERVER: products, recipes, the draft, the order lists, this month and last month', async () => {
    const parts = make();
    parts.docs[at('inventory/2026-09')] = { closedAt: '', opening: { b: 2 } };
    parts.served[at('recipes')] = [snap('r1', { name: 'Impasto', ingredients: [{ refId: 'b', kind: 'ingredient' }] })];
    const used = await parts.source.checkUsage('b');
    expect(used).toEqual([{ kind: 'recipe', name: 'Impasto' }, { kind: 'inventory', month: '2026-09' }]);
    expect(parts.order.sort()).toEqual([
      `read ${at('drafts/current')}`, `read ${at('inventory/2026-09')}`, `read ${at('inventory/2026-10')}`,
      `read ${at('order-requests')}`, `read ${at('products')}`, `read ${at('recipes')}`,
    ]);
    expect(parts.fs.getDocs, 'a cached «B is free» would let a used ingredient be deleted').not.toHaveBeenCalled();
  });

  test('«could not check» never reads as «not used»: a failed read REJECTS with its Firestore code', async () => {
    const parts = make();
    parts.fs.getDocsFromServer.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await expect(parts.source.checkUsage('b')).rejects.toMatchObject({ code: 'permission-denied', committed: false });
  });

  test('offline it refuses before reading anything', async () => {
    const parts = make();
    parts.goOffline();
    await expect(parts.source.checkUsage('b')).rejects.toMatchObject({ code: 'offline' });
    expect(parts.order).toEqual([]);
  });
});

describe('the preview', () => {
  test('plans from the server without writing: the counts, the takeover, B\'s changes', async () => {
    const parts = make();
    seed(parts);
    const preview = await parts.source.previewMerge('a', 'b');
    expect(preview).toMatchObject({ counts: { prices: 1, codes: 1, droppedCodes: 0 }, takeover: true, bLostPrice: null, hasChanges: true });
    expect(parts.batches).toEqual([]);
    expect(parts.order[0], 'this phone\'s queue drains before the fresh reads (not in the original)').toBe('wait');
  });

  test('either ingredient gone → code «gone», nothing written', async () => {
    const parts = make();
    seed(parts);
    parts.docs[at('ingredients/b')] = null;
    await expect(parts.source.previewMerge('a', 'b')).rejects.toMatchObject({ code: 'gone', committed: false });
  });
});

describe('the merge', () => {
  test('⚠️ the order is the safety: points, then A\'s codes and price, then B\'s changes, then B with its price LAST, then the draft', async () => {
    const parts = make();
    seed(parts);
    const counts = await parts.source.mergeIngredients('a', 'b');
    expect(counts).toEqual({ prices: 1, codes: 1, droppedCodes: 0 });
    const written = parts.batches.map(b => b.ops.map(o => `${o.op} ${o.ref.path}`));
    expect(written).toEqual([
      [`set ${at('ingredients/a/prices/inv-18000000050-1')}`, `set ${at('ingredients/a')}`, `set ${at('ingredient-prices/a')}`],
      [`delete ${at('price-changes/inv-18000000050-1-b')}`],
      [`delete ${at('ingredients/b')}`, `delete ${at('ingredient-prices/b')}`],
    ]);
    const [point, codes, price] = parts.batches[0]!.ops;
    expect(point!.data!.bakery, 'stamped for this venue').toBe(VENUE);
    expect(point!.options, 'a history point is create-only').toBeUndefined();
    expect(codes!.options).toEqual({ merge: true });
    expect(codes!.data).toEqual({ supplierCodes: ['PACCO'], bakery: VENUE });
    expect(price!.options).toEqual({ merge: true });
    expect(parts.order.indexOf('draft')).toBeGreaterThan(parts.order.indexOf('commit 2'));
    const [ref, field] = parts.fs.updateDoc.mock.calls[0]!;
    expect((ref as Ref).path).toBe(at('drafts/current'));
    expect((field as { segments: string[] }).segments, 'a FieldPath, never a dotted string').toEqual(['entries', 'b']);
  });

  test('⚠️ fresh data: the queue drains, A and B are read again, and the usage is checked ONCE MORE before the first write', async () => {
    const parts = make();
    seed(parts);
    await parts.source.mergeIngredients('a', 'b');
    const first = parts.order.indexOf('commit 0');
    expect(parts.order[0]).toBe('wait');
    expect(parts.order.slice(0, first)).toEqual(expect.arrayContaining([
      `read ${at('ingredients/a')}`, `read ${at('ingredients/b')}`, `read ${at('products')}`, `read ${at('inventory/2026-09')}`,
    ]));
  });

  test('B still used at the last check → code «used» with the list, and NOTHING written', async () => {
    const parts = make();
    seed(parts);
    parts.docs[at('drafts/current')] = { entries: { b: { qty: 3 } } };
    await expect(parts.source.mergeIngredients('a', 'b')).rejects.toMatchObject({ code: 'used', committed: false, used: [{ kind: 'draft' }] });
    expect(parts.batches).toEqual([]);
  });

  test('⚠️ honest «committed»: a refusal of the FIRST batch committed nothing; a refusal after one landed says so', async () => {
    const parts = make();
    seed(parts);
    parts.failOn(index => (index === 0 ? Object.assign(new Error('denied'), { code: 'permission-denied' }) : null));
    await expect(parts.source.mergeIngredients('a', 'b')).rejects.toMatchObject({ code: 'permission-denied', committed: false });

    const later = make();
    seed(later);
    later.failOn(index => (index === 2 ? Object.assign(new Error('denied'), { code: 'permission-denied' }) : null));
    const error = await later.source.mergeIngredients('a', 'b').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(MergeError);
    expect(error).toMatchObject({ code: 'permission-denied', committed: true });
    expect(later.fs.updateDoc, 'B was not deleted: its draft line stays').not.toHaveBeenCalled();
  });

  test('a commit that never answers is a stop («timeout»), not a hang', async () => {
    vi.useFakeTimers();
    const parts = make();
    seed(parts);
    parts.fs.writeBatch.mockImplementationOnce(() => ({ set: () => undefined, delete: () => undefined, commit: () => new Promise(() => undefined) }));
    const pending = parts.source.mergeIngredients('a', 'b').catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(MERGE_TIMEOUT_MS);
    expect(await pending).toMatchObject({ code: 'timeout', committed: false });
  });

  test('offline it refuses before reading or writing anything', async () => {
    const parts = make();
    seed(parts);
    parts.goOffline();
    await expect(parts.source.mergeIngredients('a', 'b')).rejects.toMatchObject({ code: 'offline', committed: false });
    expect(parts.order).toEqual([]);
  });

  test('a failed draft clean-up is only logged: the merge has succeeded', async () => {
    const parts = make();
    seed(parts);
    parts.fs.updateDoc.mockRejectedValueOnce(Object.assign(new Error('no draft'), { code: 'not-found' }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(parts.source.mergeIngredients('a', 'b')).resolves.toEqual({ prices: 1, codes: 1, droppedCodes: 0 });
    await Promise.resolve();
    expect(error).toHaveBeenCalledWith('The draft still holds a deleted ingredient:', 'not-found');
    error.mockRestore();
  });

  test('an id that could name another path never reaches Firestore', async () => {
    const parts = make();
    await expect(parts.source.mergeIngredients('a', '../b')).rejects.toBeInstanceOf(MergeError);
    expect(parts.order).toEqual([]);
  });
});
