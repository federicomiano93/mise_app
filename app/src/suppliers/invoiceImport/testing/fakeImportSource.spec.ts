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
});
