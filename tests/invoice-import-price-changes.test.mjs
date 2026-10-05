// «Import from invoices» writes the price changes it finds — the PURE half (js/orders/invoice-import-plan.js):
// which points are combined, what is skipped, what is removed, how the writes are batched. Every id and price is INVENTED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DOCS_PER_BATCH } from '../js/orders/invoice-import-model.js';
import {
  pointsOfDocs, planPriceChanges, priceChangeBatches, planBatchWrites, summarizeRun, replanRow, ingredientDisplayName,
} from '../js/orders/invoice-import-plan.js';

const NOW = '2026-10-05T09:00:00.000Z';
const stored = (invoiceId, line, invoiceDate, pricePerUnit, priceUnit = 'kg') => ({ invoiceId, line, invoiceDate, pricePerUnit, priceUnit });
// A stored change as the data layer hands it back (storedPriceChangeIds).
const storedChange = (id, oldPrice, newPrice, oldDate, date, priceUnit = 'kg') => ({ id, oldPrice, newPrice, oldDate, date, priceUnit });
const none = { changeIds: async () => [] };
const base = { ingredientId: 'i1', supplierId: 's1', name: 'Farina', priceUnit: 'kg', isNew: false, read: none, nowIso: NOW };

test('stored points and the points about to be written are ONE history, a point in both counts once', async () => {
  const ops = await planPriceChanges({
    ...base,
    storedPoints: [stored('100', 1, '2026-01-10', 1), stored('200', 1, '2026-02-10', 1.1)],
    newPoints: [
      { id: 'inv-200-1', invoiceId: '200', line: 1, invoiceDate: '2026-02-10', pricePerUnit: 1.1, qty: 1 },
      { id: 'inv-300-1', invoiceId: '300', line: 1, invoiceDate: '2026-03-10', pricePerUnit: 1.1, qty: 1 },
    ],
  });
  assert.equal(ops.create.length, 1, '1.00 → 1.10 → 1.10: one change');
  assert.deepEqual(ops.remove, []);
  assert.deepEqual(ops.create[0], {
    type: 'add-price-change', ingredientId: 'i1', changeId: 'inv-200-1-i1',
    data: {
      ingredientId: 'i1', name: 'Farina', priceUnit: 'kg', oldPrice: 1, newPrice: 1.1, oldDate: '2026-01-10',
      date: '2026-02-10', invoiceId: '200', line: 1, pct: 10, supplierId: 's1', recordedAt: NOW,
    },
  });
});

test('a change whose id is already stored (and still right) is left out; the rest are written', async () => {
  const ops = await planPriceChanges({
    ...base,
    storedPoints: [stored('100', 1, '2026-01-10', 1), stored('200', 1, '2026-02-10', 2), stored('300', 1, '2026-03-10', 3)],
    newPoints: [],
    read: { changeIds: async () => [storedChange('inv-200-1-i1', 1, 2, '2026-01-10', '2026-02-10')] },
  });
  assert.deepEqual(ops.create.map(o => o.changeId), ['inv-300-1-i1']);
  assert.deepEqual(ops.remove, [], 'a stored change that is still right stays');
});

test('an unchanged row (nothing new to write) still produces the changes its stored history shows', async () => {
  const ops = await planPriceChanges({
    ...base, storedPoints: [stored('100', 1, '2026-01-10', 1), stored('200', 1, '2026-02-10', 2)], newPoints: [],
  });
  assert.equal(ops.create.length, 1);
  assert.equal(ops.create[0].data.pct, 100);
});

test('no change across units, and no read at all when there is nothing to write', async () => {
  let reads = 0;
  const read = { changeIds: async () => { reads += 1; return []; } };
  const ops = await planPriceChanges({
    ...base, read, storedPoints: [stored('100', 1, '2026-01-10', 1, 'kg'), stored('200', 1, '2026-02-10', 9, 'pcs')], newPoints: [],
  });
  assert.deepEqual(ops, { create: [], remove: [] });
  assert.equal(reads, 0);
});

test('a NEW ingredient has no stored changes, so it reads none', async () => {
  const read = { changeIds: async () => { throw new Error('must not be read'); } };
  const ops = await planPriceChanges({
    ...base, isNew: true, read, storedPoints: [],
    newPoints: [
      { id: 'a', invoiceId: '1', line: 1, invoiceDate: '2026-01-01', pricePerUnit: 1 },
      { id: 'b', invoiceId: '2', line: 1, invoiceDate: '2026-02-01', pricePerUnit: 2 },
    ],
  });
  assert.equal(ops.create.length, 1);
});

test('⚠️ nothing the rules would refuse is ever planned: a non-numeric invoice id, an unknown unit', async () => {
  const odd = await planPriceChanges({
    ...base, storedPoints: [stored('A1', 1, '2026-01-10', 1), stored('A2', 1, '2026-02-10', 2)], newPoints: [],
  });
  assert.deepEqual(odd.create, []);
  const unit = await planPriceChanges({
    ...base, priceUnit: 'box', storedPoints: [stored('1', 1, '2026-01-10', 1, 'box'), stored('2', 1, '2026-02-10', 2, 'box')], newPoints: [],
  });
  assert.deepEqual(unit.create, []);
  assert.deepEqual(await planPriceChanges({ ...base, ingredientId: null, storedPoints: [], newPoints: [] }), { create: [], remove: [] });
});

test('⚠️ nothing the rules would refuse: a supplier or ingredient id over 100 characters is refused, a long name is cut to 200', async () => {
  const points = [stored('100', 1, '2026-01-10', 1), stored('200', 1, '2026-02-10', 2)];
  const longSupplier = await planPriceChanges({ ...base, supplierId: 's'.repeat(101), storedPoints: points, newPoints: [] });
  assert.deepEqual(longSupplier.create, [], 'a supplier id over 100 characters would be refused');
  const longId = await planPriceChanges({ ...base, ingredientId: 'i'.repeat(101), storedPoints: points, newPoints: [] });
  assert.deepEqual(longId, { create: [], remove: [] });
  const named = await planPriceChanges({ ...base, name: `  ${'n'.repeat(250)}  `, storedPoints: points, newPoints: [] });
  assert.equal(named.create.length, 1, 'truncated, not dropped');
  assert.equal(named.create[0].data.name, 'n'.repeat(200));
  const noSupplier = await planPriceChanges({ ...base, supplierId: undefined, storedPoints: points, newPoints: [] });
  assert.equal(noSupplier.create.length, 1);
  assert.ok(!('supplierId' in noSupplier.create[0].data));
});

test('⚠️ an invoice that arrives OUT OF ORDER removes the change it made wrong and writes the two right ones', async () => {
  // Stored: Jan 1.00 and Mar 1.20, with the change recorded at March (+20%). A later zip brings February at 1.10.
  const read = { changeIds: async () => [storedChange('inv-300-1-i1', 1, 1.2, '2026-01-10', '2026-03-10')] };
  const ops = await planPriceChanges({
    ...base, read,
    storedPoints: [stored('100', 1, '2026-01-10', 1), stored('300', 1, '2026-03-10', 1.2)],
    newPoints: [{ id: 'inv-200-1', invoiceId: '200', line: 1, invoiceDate: '2026-02-10', pricePerUnit: 1.1, qty: 1 }],
  });
  assert.deepEqual(ops.remove, [{ type: 'remove-price-change', ingredientId: 'i1', changeId: 'inv-300-1-i1' }]);
  assert.deepEqual(ops.create.map(o => [o.changeId, o.data.oldPrice, o.data.newPrice, o.data.pct]), [
    ['inv-200-1-i1', 1, 1.1, 10],
    ['inv-300-1-i1', 1.1, 1.2, 9.09],
  ]);
  // removals run first, in their own batches, then the creations (the March change keeps its id)
  const batches = priceChangeBatches(ops);
  assert.deepEqual(batches.map(b => b.map(o => o.type)), [['remove-price-change'], ['add-price-change', 'add-price-change']]);
});

test('a stored change that is no longer expected is removed; one whose unit differs is replaced', async () => {
  const read = {
    changeIds: async () => [
      storedChange('inv-200-1-i1', 1, 2, '2026-01-10', '2026-02-10'),
      storedChange('inv-999-1-i1', 5, 6, '2025-01-01', '2025-02-01'),
    ],
  };
  const ops = await planPriceChanges({
    ...base, read, storedPoints: [stored('100', 1, '2026-01-10', 1), stored('200', 1, '2026-02-10', 2)], newPoints: [],
  });
  assert.deepEqual(ops.remove.map(o => o.changeId), ['inv-999-1-i1']);
  assert.deepEqual(ops.create, []);
  const unit = await planPriceChanges({
    ...base, read: { changeIds: async () => [storedChange('inv-200-1-i1', 1, 2, '2026-01-10', '2026-02-10', 'l')] },
    storedPoints: [stored('100', 1, '2026-01-10', 1), stored('200', 1, '2026-02-10', 2)], newPoints: [],
  });
  assert.deepEqual(unit.remove.map(o => o.changeId), ['inv-200-1-i1']);
  assert.deepEqual(unit.create.map(o => o.changeId), ['inv-200-1-i1']);
});

test('removals are batched at the cap too, and a remove op becomes a delete the data layer runs', () => {
  const remove = Array.from({ length: MAX_DOCS_PER_BATCH + 1 }, (_, i) => ({ type: 'remove-price-change', ingredientId: 'i1', changeId: `c${i}` }));
  const batches = priceChangeBatches({ create: [{ type: 'add-price-change', ingredientId: 'i1', changeId: 'n', data: {} }], remove });
  assert.ok(batches.every(b => b.length <= MAX_DOCS_PER_BATCH));
  assert.equal(batches.length, 3);
  assert.equal(batches[2][0].type, 'add-price-change', 'creations come last');
  const { batches: steps } = planBatchWrites([[remove[0]]], { mintId: () => 'x', bakery: 'b' });
  assert.deepEqual(steps[0][0], { path: ['price-changes', 'c0'], remove: true });
});

test('the summary counts the ingredients whose changes could not be recorded, apart from the failed rows', () => {
  const sum = summarizeRun([
    { key: 'a', name: 'A', outcome: 'created', pricesAdded: 1, changesAdded: 0, changesFailed: 1 },
    { key: 'b', name: 'B', outcome: 'unchanged', changesAdded: 0, changesFailed: 1 },
    { key: 'c', name: 'C', outcome: 'updated' },
  ]);
  assert.equal(sum.changesFailed, 2);
  assert.equal(sum.failed.length, 0, 'the rows themselves are not failures');
  assert.equal(sum.created, 1);
});

test('the changes go in batches of at most the cap, after which nothing is lost', () => {
  const ops = Array.from({ length: MAX_DOCS_PER_BATCH * 2 + 1 }, (_, i) => ({ type: 'add-price-change', changeId: `c${i}` }));
  const batches = priceChangeBatches(ops);
  assert.ok(batches.every(b => b.length <= MAX_DOCS_PER_BATCH));
  assert.equal(batches.flat().length, ops.length);
  assert.deepEqual(priceChangeBatches([]), []);
  assert.deepEqual(priceChangeBatches({ create: [], remove: [] }), []);
});

test('pointsOfDocs reads the line from the id and keeps only what a change needs', () => {
  assert.deepEqual(pointsOfDocs([
    { id: 'inv-18000000001-5', data: { invoiceId: '18000000001', invoiceDate: '2026-08-31', pricePerUnit: 0.57, priceUnit: 'kg', qty: 3 } },
    { id: 'manual-1', data: { pricePerUnit: 1 } },
  ]), [{ invoiceId: '18000000001', line: 5, invoiceDate: '2026-08-31', pricePerUnit: 0.57, priceUnit: 'kg' }]);
});

test('a change op becomes a create-only price-changes document stamped with the venue', () => {
  const { batches } = planBatchWrites([[{
    type: 'add-price-change', ingredientId: 'i1', changeId: 'inv-200-1-i1', data: { ingredientId: 'i1', pct: 10 },
  }]], { mintId: () => 'x', bakery: 'loc-test' });
  assert.deepEqual(batches[0][0], { path: ['price-changes', 'inv-200-1-i1'], data: { ingredientId: 'i1', pct: 10, bakery: 'loc-test' }, merge: false });
  assert.throws(() => planBatchWrites([[{ type: 'add-price-change', ingredientId: 'i1', data: {} }]], { mintId: () => 'x', bakery: 'b' }), /no id/);
});

test('the summary counts the changes recorded, for any outcome', () => {
  const sum = summarizeRun([
    { key: 'a', name: 'A', outcome: 'created', pricesAdded: 2, changesAdded: 1 },
    { key: 'b', name: 'B', outcome: 'unchanged', changesAdded: 2 },
  ]);
  assert.equal(sum.changesAdded, 3);
});

test('replanRow hands back the matched ingredient and its stored points from the SAME read', async () => {
  const points = [stored('100', 1, '2026-01-10', 1)];
  const ids = Object.assign(new Set(['inv-100-1']), { points });
  let pointReads = 0;
  const out = await replanRow({
    fileIngredient: {
      key: 'k', supplierKey: 'S', name: 'Farina', supplierCode: '', mergeWith: '', priceUnit: 'kg', weight: '', packUnit: '',
      packCount: null, prices: [{ invoiceId: '100', line: 1, invoiceDate: '2026-01-10', pricePerUnit: 1, qty: 1 }],
    },
    supplierIdByKey: { S: 's1' },
    read: {
      ingredients: async () => [{ id: 'i1', name: 'Farina', shortName: 'Fa', supplierId: 's1', kind: 'ingredient' }],
      pointIds: async () => { pointReads += 1; return ids; },
      price: async () => null,
    },
  });
  assert.equal(out.row.status, 'unchanged');
  assert.equal(out.row.ingredientId, 'i1');
  assert.equal(out.ingredient.id, 'i1');
  assert.deepEqual(out.storedPoints, points);
  assert.equal(pointReads, 1);
  assert.equal(ingredientDisplayName(out.ingredient), 'Fa');
});

test('the pack of a stored point and of the new points is carried into oldPack / newPack', async () => {
  const [point] = pointsOfDocs([
    { id: 'inv-100-1', data: { invoiceId: '100', invoiceDate: '2026-01-10', pricePerUnit: 4, priceUnit: 'kg', packLabel: 'Lievito Pegaso 5 kg' } },
  ]);
  assert.equal(point.pack, 'Lievito Pegaso 5 kg');
  assert.equal(pointsOfDocs([{ id: 'inv-100-2', data: { invoiceId: '100', invoiceDate: '2026-01-10', pricePerUnit: 4, priceUnit: 'kg' } }])[0].pack, undefined);
  const ops = await planPriceChanges({
    ...base,
    storedPoints: [point],
    newPoints: [{ id: 'inv-200-1', invoiceId: '200', line: 1, invoiceDate: '2026-02-10', pricePerUnit: 6, qty: 1 }],
    packLabel: 'Lievito Zeus 1 kg',
  });
  assert.equal(ops.create[0].data.oldPack, 'Lievito Pegaso 5 kg');
  assert.equal(ops.create[0].data.newPack, 'Lievito Zeus 1 kg');
});
