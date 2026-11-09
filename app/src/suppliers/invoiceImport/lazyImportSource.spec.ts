import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvoiceImportSource } from './importSource';

// The wrapper that keeps the import's database half (importSource.ts) out of the first screen's code. importSource.ts has its own
// spec; here the real module is replaced, to see WHAT the wrapper asks of it and WHEN.

const created = vi.hoisted(() => ({ calls: 0, failNext: false, source: null as null | Record<string, ReturnType<typeof vi.fn>> }));

vi.mock('./importSource', () => ({
  createFirestoreImportSource: vi.fn((_firestore: unknown, locationId: string) => {
    created.calls += 1;
    if (created.failNext) {
      created.failNext = false;
      throw new Error('chunk failed');
    }
    const answer = (name: string) => vi.fn((..._args: unknown[]) => Promise.resolve(`${name}@${locationId}`));
    created.source = {
      createSupplier: answer('createSupplier'), linkSupplierVat: answer('linkSupplierVat'), freshSuppliers: answer('freshSuppliers'),
      freshIngredientsForSupplier: answer('freshIngredientsForSupplier'), invoicePoints: answer('invoicePoints'),
      storedPriceChanges: answer('storedPriceChanges'), freshPrice: answer('freshPrice'), runImportBatches: answer('runImportBatches'),
      loadDecisions: answer('loadDecisions'), writeDecisions: answer('writeDecisions'),
      loadImportLog: answer('loadImportLog'), saveImportLog: answer('saveImportLog'),
    };
    return created.source;
  }),
}));

beforeEach(() => { created.calls = 0; created.failNext = false; created.source = null; vi.resetModules(); });

async function wrapper(locationId = 'bakery') {
  const { createLazyImportSource } = await import('./lazyImportSource');
  return createLazyImportSource(() => Promise.reject(new Error('the wrapper never reads Firestore itself')), locationId);
}

describe('the lazy import source', () => {
  it('fetches the real one as soon as it is made, once, for the venue it was made for', async () => {
    const source = await wrapper('panificio');
    await source.loadDecisions();
    await source.freshSuppliers();
    expect(created.calls).toBe(1);
    expect(created.source?.loadDecisions).toHaveBeenCalledTimes(1);
  });

  it('hands every call to the real source with its arguments, and returns its answer', async () => {
    const source = await wrapper();
    const expected: Array<[keyof InvoiceImportSource, unknown[]]> = [
      ['createSupplier', [{ name: 'A' }]], ['linkSupplierVat', ['s1', 'IT1']], ['freshSuppliers', []],
      ['freshIngredientsForSupplier', ['s1']], ['invoicePoints', ['i1']], ['storedPriceChanges', ['i1']], ['freshPrice', ['i1']],
      ['runImportBatches', [[]]], ['loadDecisions', []], ['writeDecisions', [{ set: [], remove: [] }]],
      ['loadImportLog', []], ['saveImportLog', [{ fileName: 'f.zip' }]],
    ];
    expect(expected.map(([name]) => name).sort()).toEqual(Object.keys(source).sort());
    for (const [name, args] of expected) {
      const answer = await (source[name] as (...a: unknown[]) => Promise<unknown>)(...args);
      expect(answer).toBe(`${name}@bakery`);
      expect(created.source?.[name]).toHaveBeenCalledWith(...args);
    }
  });

  it('a load that failed is forgotten: the next call tries again, and the failure is that call\'s', async () => {
    created.failNext = true;
    const source = await wrapper();
    await expect(source.loadDecisions()).rejects.toThrow('chunk failed');
    await expect(source.loadDecisions()).resolves.toBe('loadDecisions@bakery');
    expect(created.calls).toBe(2);
  });
});
