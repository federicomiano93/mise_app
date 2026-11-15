import { describe, expect, it } from 'vitest';
import { fakeImportSource } from './fakeImportSource';

// The fake the screen's specs stand on: if it lied, every screen spec would.

describe('the fake import source', () => {
  it('records every call, in order, and every write', async () => {
    const source = fakeImportSource();
    const id = await source.createSupplier({ name: 'A' });
    await source.linkSupplierVat('s1', 'IT1');
    await source.freshSuppliers();
    expect(source.calls.map(call => call[0])).toEqual(['createSupplier', 'linkSupplierVat', 'freshSuppliers']);
    expect(source.writes).toEqual([
      { kind: 'createSupplier', id, data: { name: 'A' } },
      { kind: 'linkSupplierVat', supplierId: 's1', vatNumber: 'IT1' },
    ]);
    expect(source.countOf('createSupplier')).toBe(1);
  });

  it('behaves like a database: a created supplier is in the next fresh read, a written decision in the next load', async () => {
    const source = fakeImportSource({ suppliers: [{ id: 's1', name: 'Old' }] });
    await source.createSupplier({ name: 'New' });
    expect((await source.freshSuppliers()).map(supplier => supplier.name)).toEqual(['Old', 'New']);
    expect(await source.writeDecisions({ set: [{ id: 'd1', key: 'k', decision: 'skip', label: 'L' }], remove: [] })).toBe(1);
    expect(await source.loadDecisions()).toEqual([{ id: 'd1', decision: 'skip', label: 'L' }]);
    expect(await source.writeDecisions({ set: [], remove: ['d1'] })).toBe(1);
    expect(await source.loadDecisions()).toEqual([]);
  });

  it('fails a method with a code until told to stop; the failed call is recorded too', async () => {
    const source = fakeImportSource();
    source.failWith('freshSuppliers', 'offline');
    await expect(source.freshSuppliers()).rejects.toMatchObject({ code: 'offline' });
    await expect(source.freshSuppliers()).rejects.toMatchObject({ code: 'offline' });
    expect(source.countOf('freshSuppliers')).toBe(2);
    source.failWith('freshSuppliers', null);
    await expect(source.freshSuppliers()).resolves.toEqual([]);
  });

  it('can let the first calls through and fail the ones beyond (a write that goes wrong half-way)', async () => {
    const source = fakeImportSource();
    source.failWith('createSupplier', 'unavailable', 1);
    await expect(source.createSupplier({ name: 'A' })).resolves.toBe('sup-1');
    await expect(source.createSupplier({ name: 'B' })).rejects.toMatchObject({ code: 'unavailable' });
    expect(source.suppliers.map(supplier => supplier.name)).toEqual(['A']);
  });

  it('holds the next call pending until released — the call is recorded when it starts, its effect only when it finishes', async () => {
    const source = fakeImportSource();
    const release = source.hold('createSupplier');
    let done = false;
    const pending = source.createSupplier({ name: 'A' }).then(() => { done = true; });
    await Promise.resolve();
    expect(source.countOf('createSupplier')).toBe(1);
    expect(done).toBe(false);
    expect(source.writes).toEqual([]);
    release();
    await pending;
    expect(done).toBe(true);
    expect(source.writes).toHaveLength(1);
    // Only the NEXT call was held.
    await source.createSupplier({ name: 'B' });
    expect(source.writes).toHaveLength(2);
  });

  it('lets a spec play another phone: a hook runs just before a fresh read answers', async () => {
    const source = fakeImportSource();
    source.beforeFreshSuppliers = () => { source.suppliers.push({ id: 'other', name: 'Other' }); };
    expect(await source.freshSuppliers()).toEqual([{ id: 'other', name: 'Other' }]);
  });

  it('applies a row\'s batches like the database: the ingredient gets a minted id, its price, its history point and its price change', async () => {
    const source = fakeImportSource();
    const id = await source.runImportBatches([
      [
        { type: 'create-ingredient', data: { name: 'Farina', supplierId: 'sup-1' } },
        { type: 'set-current-price', data: { pricePerUnit: 0.5, priceUnit: 'kg' } },
        { type: 'add-price-point', pointId: 'inv-18000000001-1', data: { invoiceId: '18000000001', pricePerUnit: 0.5, priceUnit: 'kg' } },
      ],
    ] as never);
    expect(id).toBe('ing-1');
    expect(source.ingredients).toEqual([{ name: 'Farina', supplierId: 'sup-1', bakery: 'test', id: 'ing-1' }]);
    expect(await source.freshIngredientsForSupplier('sup-1')).toHaveLength(1);
    expect(await source.freshIngredientsForSupplier('other')).toEqual([]);
    expect(await source.freshPrice('ing-1')).toMatchObject({ pricePerUnit: 0.5, priceUnit: 'kg' });
    expect(await source.freshPrice('nobody')).toBeNull();
    const stored = await source.invoicePoints('ing-1');
    expect([...stored.ids]).toEqual(['inv-18000000001-1']);
    expect(stored.points).toHaveLength(1);

    await source.runImportBatches([[
      {
        type: 'add-price-change', ingredientId: 'ing-1', changeId: 'c1',
        data: { ingredientId: 'ing-1', oldPrice: 1, newPrice: 1.1, oldDate: '2026-09-01', date: '2026-09-10', priceUnit: 'kg' },
      },
    ]] as never);
    expect(await source.storedPriceChanges('ing-1'))
      .toEqual([{ id: 'c1', oldPrice: 1, newPrice: 1.1, oldDate: '2026-09-01', date: '2026-09-10', priceUnit: 'kg' }]);
    await source.runImportBatches([[{ type: 'remove-price-change', ingredientId: 'ing-1', changeId: 'c1' }]] as never);
    expect(await source.storedPriceChanges('ing-1')).toEqual([]);
    expect(source.writes.map(write => write.kind)).toEqual(['batches', 'batches', 'batches']);
  });

  it('merges a patch into an ingredient that exists, and fails a batch on request like any other call', async () => {
    const source = fakeImportSource({ ingredients: [{ id: 'ing-9', name: 'Old', supplierId: 's' }] });
    await source.runImportBatches([[{ type: 'patch-ingredient', ingredientId: 'ing-9', data: { invoiceName: 'NEW' } }]] as never);
    expect(source.ingredients).toEqual([{ id: 'ing-9', name: 'Old', supplierId: 's', invoiceName: 'NEW', bakery: 'test' }]);
    source.failWith('runImportBatches', 'permission-denied', 1);
    await expect(source.runImportBatches([[{ type: 'patch-ingredient', ingredientId: 'ing-9', data: { invoiceName: 'X' } }]] as never))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(source.ingredients[0]?.invoiceName).toBe('NEW');
  });

  it('adds the points a spec seeded to the ones a run wrote', async () => {
    const source = fakeImportSource();
    source.points.set('ing-1', { ids: new Set(['inv-1-1']), points: [] });
    await source.runImportBatches([[
      { type: 'add-price-point', ingredientId: 'ing-1', pointId: 'inv-2-1', data: { invoiceId: '2', pricePerUnit: 1, priceUnit: 'kg' } },
    ]] as never);
    expect([...(await source.invoicePoints('ing-1')).ids].sort()).toEqual(['inv-1-1', 'inv-2-1']);
  });
});
