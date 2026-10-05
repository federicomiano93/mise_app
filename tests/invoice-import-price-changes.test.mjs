// «Import from invoices» writes the price changes it finds — the PURE half (js/orders/invoice-import-plan.js):
// which points are combined, what is skipped, how the writes are batched. Every id and price is INVENTED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DOCS_PER_BATCH } from '../js/orders/invoice-import-model.js';
import {
  pointsOfDocs, planPriceChanges, priceChangeBatches, planBatchWrites, summarizeRun, replanRow, ingredientDisplayName,
} from '../js/orders/invoice-import-plan.js';

const NOW = '2026-10-05T09:00:00.000Z';
const stored = (invoiceId, line, invoiceDate, pricePerUnit, priceUnit = 'kg') => ({ invoiceId, line, invoiceDate, pricePerUnit, priceUnit });
const none = { changeIds: async () => new Set() };
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
  assert.equal(ops.length, 1, '1.00 → 1.10 → 1.10: one change');
  assert.deepEqual(ops[0], {
    type: 'add-price-change', ingredientId: 'i1', changeId: 'inv-200-1-i1',
    data: {
      ingredientId: 'i1', name: 'Farina', priceUnit: 'kg', oldPrice: 1, newPrice: 1.1, oldDate: '2026-01-10',
      date: '2026-02-10', invoiceId: '200', line: 1, pct: 10, supplierId: 's1', recordedAt: NOW,
    },
  });
});

test('a change whose id is already stored is left out; the rest are written', async () => {
  const ops = await planPriceChanges({
    ...base,
    storedPoints: [stored('100', 1, '2026-01-10', 1), stored('200', 1, '2026-02-10', 2), stored('300', 1, '2026-03-10', 3)],
    newPoints: [],
    read: { changeIds: async () => new Set(['inv-200-1-i1']) },
  });
  assert.deepEqual(ops.map(o => o.changeId), ['inv-300-1-i1']);
});

test('an unchanged row (nothing new to write) still produces the changes its stored history shows', async () => {
  const ops = await planPriceChanges({
    ...base, storedPoints: [stored('100', 1, '2026-01-10', 1), stored('200', 1, '2026-02-10', 2)], newPoints: [],
  });
  assert.equal(ops.length, 1);
  assert.equal(ops[0].data.pct, 100);
});

test('no change across units, and no read at all when there is nothing to write', async () => {
  let reads = 0;
  const read = { changeIds: async () => { reads += 1; return new Set(); } };
  const ops = await planPriceChanges({
    ...base, read, storedPoints: [stored('100', 1, '2026-01-10', 1, 'kg'), stored('200', 1, '2026-02-10', 9, 'pcs')], newPoints: [],
  });
  assert.deepEqual(ops, []);
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
  assert.equal(ops.length, 1);
});

test('⚠️ nothing the rules would refuse is ever planned: a non-numeric invoice id, an unknown unit', async () => {
  const odd = await planPriceChanges({
    ...base, storedPoints: [stored('A1', 1, '2026-01-10', 1), stored('A2', 1, '2026-02-10', 2)], newPoints: [],
  });
  assert.deepEqual(odd, []);
  const unit = await planPriceChanges({
    ...base, priceUnit: 'box', storedPoints: [stored('1', 1, '2026-01-10', 1, 'box'), stored('2', 1, '2026-02-10', 2, 'box')], newPoints: [],
  });
  assert.deepEqual(unit, []);
  assert.deepEqual(await planPriceChanges({ ...base, ingredientId: null, storedPoints: [], newPoints: [] }), []);
});

test('the changes go in batches of at most the cap, after which nothing is lost', () => {
  const ops = Array.from({ length: MAX_DOCS_PER_BATCH * 2 + 1 }, (_, i) => ({ type: 'add-price-change', changeId: `c${i}` }));
  const batches = priceChangeBatches(ops);
  assert.ok(batches.every(b => b.length <= MAX_DOCS_PER_BATCH));
  assert.equal(batches.flat().length, ops.length);
  assert.deepEqual(priceChangeBatches([]), []);
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
