import { afterEach, describe, expect, test, vi } from 'vitest';
import type { FirestoreKit } from '../../session/firebaseBackend';
import { IMPORT_COMMIT_TIMEOUT_MS, ImportError, createFirestoreImportSource } from './importSource';
import type { ImportEnvironment } from './importSource';

// The ONLY code in Mise 2 that writes an invoice import to the real database, against a recording fake of the Firestore SDK
// (the shape of suppliersSource.spec.ts). firestore.rules accept exactly the documents the plan builds; what this file adds is
// WHERE they go, that every read comes from the SERVER, that nothing starts offline, that nothing waits for ever, and that a
// row's batches go one after the other.

type Ref = { kind: string; path: string };
type Op = { op: 'set' | 'delete'; ref: Ref; data?: Record<string, unknown>; options?: unknown };
type Snap = { id: string; data: () => Record<string, unknown> };

const VENUE = 'panificio-miano';

function fakeKit() {
  const batches: { ops: Op[]; committed: boolean }[] = [];
  let commitGate: Promise<void> | null = null;
  const served: Record<string, Snap[]> = {};
  const docs: Record<string, Record<string, unknown> | null> = {};
  const fs = {
    collection: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'collection', path: segments.join('/') }),
    doc: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'doc', path: segments.join('/') }),
    where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
    query: (target: Ref, ...constraints: unknown[]) => ({ ...target, constraints }),
    getDocsFromServer: vi.fn(async (target: Ref & { constraints?: unknown[] }) => ({ docs: served[target.path] ?? [] })),
    getDocFromServer: vi.fn(async (ref: Ref) => {
      const data = docs[ref.path] ?? null;
      return { exists: () => data !== null, data: () => data };
    }),
    waitForPendingWrites: vi.fn(async (_db: unknown) => {}),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    setDoc: vi.fn(async (_ref: Ref, _data: Record<string, unknown>, _options?: unknown) => {}),
    writeBatch: vi.fn(() => {
      const batch = { ops: [] as Op[], committed: false };
      batches.push(batch);
      return {
        set: (ref: Ref, data: Record<string, unknown>, options?: unknown) => { batch.ops.push({ op: 'set', ref, data, options }); },
        delete: (ref: Ref) => { batch.ops.push({ op: 'delete', ref }); },
        commit: async () => {
          if (commitGate) await commitGate;
          batch.committed = true;
        },
      };
    }),
  };
  const kit = { fs, db: {} } as unknown as FirestoreKit;
  return {
    kit, fs, batches, served, docs,
    holdCommits: (gate: Promise<void>) => { commitGate = gate; },
  };
}

function make(env: Partial<ImportEnvironment> = {}) {
  const parts = fakeKit();
  let offline = false;
  const source = createFirestoreImportSource(() => Promise.resolve(parts.kit), VENUE, {
    isOffline: () => offline,
    now: () => new Date('2026-10-24T09:00:00.000Z'),
    ...env,
  });
  return { ...parts, source, goOffline: () => { offline = true; } };
}

const at = (path: string) => `locations/${VENUE}/${path}`;

afterEach(() => { vi.useRealTimers(); });

describe('suppliers', () => {
  test('a new supplier is MERGED at an id minted here, stamped for the venue, and never carries an id field', async () => {
    const { fs, source } = make();
    const id = await source.createSupplier({ id: 'x', name: 'Molino', vatNumber: 'IT01234567890', bakery: 'elsewhere' });
    expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
    const [ref, data, options] = fs.setDoc.mock.calls[0]!;
    expect(ref.path).toBe(at(`suppliers/${id}`));
    expect(data).toEqual({ name: 'Molino', vatNumber: 'IT01234567890', bakery: VENUE });
    expect(options).toEqual({ merge: true });
  });

  test('⚠️ linking writes the VAT number and nothing else onto the existing supplier (parity I13)', async () => {
    const { fs, source } = make();
    await source.linkSupplierVat('s1', 'IT01234567890');
    expect(fs.setDoc.mock.calls).toEqual([[{ kind: 'doc', path: at('suppliers/s1') }, { vatNumber: 'IT01234567890', bakery: VENUE }, { merge: true }]]);
  });

  test('the suppliers are read from the SERVER', async () => {
    const { fs, source, served } = make();
    served[at('suppliers')] = [{ id: 's1', data: () => ({ name: 'Molino' }) }];
    expect(await source.freshSuppliers()).toEqual([{ id: 's1', name: 'Molino' }]);
    expect(fs.getDocsFromServer).toHaveBeenCalledTimes(1);
    expect(fs.getDocs).not.toHaveBeenCalled();
  });

  test('⚠️ the fresh suppliers wait for this phone’s queued writes before they ask the server (a timed-out write is still queued)', async () => {
    const { fs, source } = make();
    const order: string[] = [];
    fs.waitForPendingWrites.mockImplementationOnce(async () => { order.push('drained'); });
    fs.getDocsFromServer.mockImplementationOnce(async () => { order.push('read'); return { docs: [] }; });
    await source.freshSuppliers();
    expect(order).toEqual(['drained', 'read']);
  });

  test('a queue that never drains is a stop after the timeout, never a read of a server that lacks the queued write', async () => {
    vi.useFakeTimers();
    const { fs, source } = make();
    fs.waitForPendingWrites.mockImplementationOnce(() => new Promise<void>(() => {}));
    const read = source.freshIngredientsForSupplier('s1');
    const caught = read.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(IMPORT_COMMIT_TIMEOUT_MS);
    expect(await caught).toMatchObject({ code: 'timeout' });
    expect(fs.getDocsFromServer).not.toHaveBeenCalled();
  });

  test('an id that could name another path never reaches Firestore', async () => {
    const { fs, source } = make();
    await expect(source.linkSupplierVat('../x', 'IT1')).rejects.toThrow(/Not a document id/);
    expect(fs.setDoc).not.toHaveBeenCalled();
  });
});

describe('the fresh reads before a row is written (parity I93), all from the server', () => {
  test('the ingredients of ONE supplier, by a single equality', async () => {
    const { fs, source, served } = make();
    served[at('ingredients')] = [{ id: 'i1', data: () => ({ name: 'Farina', supplierId: 's1' }) }];
    expect(await source.freshIngredientsForSupplier('s1')).toEqual([{ id: 'i1', name: 'Farina', supplierId: 's1' }]);
    expect(fs.getDocsFromServer.mock.calls[0]![0]).toMatchObject({ path: at('ingredients'), constraints: [{ where: ['supplierId', '==', 's1'] }] });
  });

  test('the invoice points of an ingredient: their ids, and the same documents read as points', async () => {
    const { fs, source, served } = make();
    served[at('ingredients/i1/prices')] = [
      { id: 'inv-123-1', data: () => ({ source: 'invoice', invoiceId: '123', invoiceDate: '2026-09-01', pricePerUnit: 1.2, priceUnit: 'kg' }) },
      { id: 'inv-124-2', data: () => ({ source: 'invoice', invoiceId: '124', invoiceDate: '2026-09-15', pricePerUnit: 1.3, priceUnit: 'kg' }) },
    ];
    const stored = await source.invoicePoints('i1');
    expect([...stored.ids]).toEqual(['inv-123-1', 'inv-124-2']);
    expect(stored.points.map(p => [p.invoiceId, p.line, p.pricePerUnit])).toEqual([['123', 1, 1.2], ['124', 2, 1.3]]);
    expect(fs.getDocsFromServer.mock.calls[0]![0]).toMatchObject({ constraints: [{ where: ['source', '==', 'invoice'] }] });
  });

  test('the stored price changes of an ingredient, with their fields', async () => {
    const { source, served } = make();
    served[at('price-changes')] = [{ id: 'c1', data: () => ({ ingredientId: 'i1', oldPrice: 1, newPrice: 1.1, oldDate: 'a', date: 'b', priceUnit: 'kg', bakery: VENUE }) }];
    expect(await source.storedPriceChanges('i1')).toEqual([{ id: 'c1', oldPrice: 1, newPrice: 1.1, oldDate: 'a', date: 'b', priceUnit: 'kg' }]);
  });

  test('the price document: its data, or null when there is none', async () => {
    const { fs, source, docs } = make();
    docs[at('ingredient-prices/i1')] = { priceUnit: 'kg', pricePerUnit: 2 };
    expect(await source.freshPrice('i1')).toEqual({ priceUnit: 'kg', pricePerUnit: 2 });
    expect(await source.freshPrice('i2')).toBeNull();
    expect(fs.getDoc).not.toHaveBeenCalled();
  });
});

describe('writing one row', () => {
  const newRow = [
    [
      { type: 'create-ingredient', data: { name: 'Farina', supplierId: 's1' } },
      { type: 'set-current-price', data: { priceUnit: 'kg', pricePerUnit: 0.85 } },
      { type: 'add-price-point', pointId: 'inv-123-1', data: { pricePerUnit: 0.85 } },
    ],
    [{ type: 'add-price-point', pointId: 'inv-124-1', data: { pricePerUnit: 0.9 } }],
  ];

  test('a NEW ingredient: its id minted once, filled into every later op; merges, and a create-only point; every document stamped', async () => {
    const { source, batches } = make();
    const id = await source.runImportBatches(newRow);
    expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(batches.map(b => b.ops.map(o => [o.op, o.ref.path, o.options ?? null, o.data?.bakery]))).toEqual([
      [
        ['set', at(`ingredients/${id}`), { merge: true }, VENUE],
        ['set', at(`ingredient-prices/${id}`), { merge: true }, VENUE],
        ['set', at(`ingredients/${id}/prices/inv-123-1`), null, VENUE],
      ],
      [['set', at(`ingredients/${id}/prices/inv-124-1`), null, VENUE]],
    ]);
    expect(batches.every(b => b.committed)).toBe(true);
  });

  test('a price change is created at its id, a stale one deleted', async () => {
    const { source, batches } = make();
    await source.runImportBatches([[
      { type: 'remove-price-change', ingredientId: 'i1', changeId: 'inv-1-1-i1' },
      { type: 'add-price-change', ingredientId: 'i1', changeId: 'inv-2-1-i1', data: { newPrice: 1 } },
    ]]);
    expect(batches[0]!.ops.map(o => [o.op, o.ref.path])).toEqual([
      ['delete', at('price-changes/inv-1-1-i1')],
      ['set', at('price-changes/inv-2-1-i1')],
    ]);
  });

  test('⚠️ the batches go one after the other: the second is not even built before the first has answered', async () => {
    const { source, batches, holdCommits } = make();
    let release!: () => void;
    holdCommits(new Promise<void>(resolve => { release = resolve; }));
    const run = source.runImportBatches(newRow);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(batches).toHaveLength(1);
    release();
    await run;
    expect(batches).toHaveLength(2);
  });

  test('a refused batch stops the row there: the later batches are never sent, and the code reaches the caller untouched', async () => {
    const { source, batches, fs } = make();
    fs.writeBatch.mockImplementationOnce(() => {
      const batch = { ops: [] as Op[], committed: false };
      batches.push(batch);
      return {
        set: (ref: Ref) => { batch.ops.push({ op: 'set', ref }); },
        delete: (ref: Ref) => { batch.ops.push({ op: 'delete', ref }); },
        commit: async () => { throw Object.assign(new Error('refused'), { code: 'permission-denied' }); },
      };
    });
    await expect(source.runImportBatches(newRow)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(batches).toHaveLength(1);
  });

  test('⚠️ a write to a folder the import does not own is refused before anything is sent', async () => {
    const { source, batches } = make();
    // A plan op never names this, but the guard must hold whatever reaches it.
    await expect(source.runImportBatches([[{ type: 'patch-ingredient', ingredientId: '../../users/u1', data: {} }]])).rejects.toThrow();
    expect(batches.every(b => !b.committed)).toBe(true);
  });
});

describe('remembered decisions', () => {
  test('read from the server, written in batches of the selection\'s plan, stamped and dated', async () => {
    const { source, served, batches } = make();
    served[at('invoice-decisions')] = [{ id: 'a'.repeat(64), data: () => ({ decision: 'skip', label: 'X' }) }];
    expect(await source.loadDecisions()).toEqual([{ id: 'a'.repeat(64), decision: 'skip', label: 'X' }]);
    const written = await source.writeDecisions({
      set: [{ id: 'b'.repeat(64), key: 'k', decision: 'ingredient', label: 'Farina' }],
      remove: ['a'.repeat(64)],
    });
    expect(written).toBe(2);
    expect(batches[0]!.ops.map(o => [o.op, o.ref.path, o.data ?? null])).toEqual([
      ['set', at(`invoice-decisions/${'b'.repeat(64)}`), { bakery: VENUE, decision: 'ingredient', label: 'Farina', updatedAt: '2026-10-24T09:00:00.000Z' }],
      ['delete', at(`invoice-decisions/${'a'.repeat(64)}`), null],
    ]);
  });
});

describe('the import log (Mise 2 only)', () => {
  const record = {
    fileName: 'fatture-settembre.zip', importedAt: '2026-10-25T10:00:00.000Z', firstDate: '2026-09-01', lastDate: '2026-09-30',
    months: ['2026-09'], invoiceIds: ['18000000001', '18000000002'],
  };

  test('read from the SERVER, the whole folder', async () => {
    const { source, served, fs } = make();
    served[at('invoice-imports')] = [{ id: 'r1', data: () => ({ ...record }) }];
    expect(await source.loadImportLog()).toEqual([{ ...record, id: 'r1' }]);
    expect(fs.getDocsFromServer).toHaveBeenCalledTimes(1);
    expect(fs.getDocs).not.toHaveBeenCalled();
  });

  test('⚠️ a record is written WHOLE (create-only), under a new id, with exactly the keys the rules list — no «who»', async () => {
    const { source, fs } = make();
    const id = await source.saveImportLog({ ...record, importedBy: 'someone', id: 'forged' } as typeof record);
    expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
    const [ref, data, options] = fs.setDoc.mock.calls[0]!;
    expect(ref.path).toBe(at(`invoice-imports/${id}`));
    expect(data).toEqual({ bakery: VENUE, ...record });
    expect(Object.keys(data).sort()).toEqual(['bakery', 'fileName', 'firstDate', 'importedAt', 'invoiceIds', 'lastDate', 'months']);
    expect(options).toBeUndefined();
  });

  test('two records never share an id', async () => {
    const { source } = make();
    const a = await source.saveImportLog(record);
    const b = await source.saveImportLog(record);
    expect(a).not.toBe(b);
  });
});

describe('⚠️ the import needs the network (parity I8, I9)', () => {
  test('offline, every call is refused with code «offline» before Firestore is touched', async () => {
    const { source, goOffline, fs } = make();
    goOffline();
    const calls: Promise<unknown>[] = [
      source.createSupplier({ name: 'x' }), source.linkSupplierVat('s1', 'IT1'), source.freshSuppliers(),
      source.freshIngredientsForSupplier('s1'), source.invoicePoints('i1'), source.storedPriceChanges('i1'), source.freshPrice('i1'),
      source.runImportBatches([[{ type: 'patch-ingredient', ingredientId: 'i1', data: {} }]]), source.loadDecisions(),
      source.writeDecisions({ set: [], remove: ['a'.repeat(64)] }), source.loadImportLog(),
      source.saveImportLog({ fileName: 'x.zip', importedAt: '2026-10-25T10:00:00.000Z', firstDate: '2026-09-01', lastDate: '2026-09-01', months: ['2026-09'], invoiceIds: ['1'] }),
    ];
    for (const call of calls) await expect(call).rejects.toMatchObject({ code: 'offline' });
    expect(fs.setDoc).not.toHaveBeenCalled();
    expect(fs.getDocsFromServer).not.toHaveBeenCalled();
    expect(fs.writeBatch).not.toHaveBeenCalled();
  });

  test('a commit that never answers is a stop: «timeout» after 30 s', async () => {
    vi.useFakeTimers();
    const { source, holdCommits } = make();
    holdCommits(new Promise<void>(() => {}));
    const run = source.runImportBatches([[{ type: 'patch-ingredient', ingredientId: 'i1', data: {} }]]);
    const settled = expect(run).rejects.toBeInstanceOf(ImportError);
    await vi.advanceTimersByTimeAsync(IMPORT_COMMIT_TIMEOUT_MS);
    await settled;
    await expect(run).rejects.toMatchObject({ code: 'timeout' });
  });

  test('⚠️ a read that never answers is a stop too (the difference from the current app)', async () => {
    vi.useFakeTimers();
    const { source, fs } = make();
    fs.getDocFromServer.mockImplementationOnce(() => new Promise(() => {}));
    const read = source.freshPrice('i1');
    const settled = expect(read).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(IMPORT_COMMIT_TIMEOUT_MS);
    await settled;
  });

  test('the limit is 30 seconds', () => {
    expect(IMPORT_COMMIT_TIMEOUT_MS).toBe(30_000);
  });
});
