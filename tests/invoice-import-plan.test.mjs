// «Import from invoices» — the pure half between the model and the database
// (js/orders/invoice-import-plan.js): the documents a row writes, the screen's view of a plan, the re-check
// before each row and the summary. Every name, VAT number and invoice id below is INVENTED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPORT_FORMAT, IMPORT_VERSION, parseImportFile, planIngredients, ingredientWrites,
} from '../js/orders/invoice-import-model.js';
import {
  FORBIDDEN_KEYS, planBatchWrites, stopKind, applyDecisions, bucketOf, filterCounts, entriesFor,
  waitingCount, writesRow, importTotals, idsToCheck, invoiceCount, replanRow, summarizeRun, FILTERS,
  changedSupplierKeys, visibleFilters, isRetryableReason, rememberHints,
} from '../js/orders/invoice-import-plan.js';

const SUPPLIER_ID = 'sup-1';
const price = (over = {}) => ({ invoiceId: '18000000001', line: 5, invoiceDate: '2026-08-31', pricePerUnit: 0.57, qty: 25, ...over });
const rawIngredient = (over = {}) => ({
  key: 'IT00000000001|code:F00-25', supplierKey: 'IT00000000001', mergeWith: '', name: 'Farina tipo 00',
  brand: '', category: '', supplierCode: 'F00-25', weight: '25 kg', packUnit: 'sacco', packCount: null,
  priceUnit: 'kg', unitWeightKg: null, vatRate: 4, prices: [price()], ...over,
});
const fileOf = (ingredients) => {
  const r = parseImportFile(JSON.stringify({
    format: IMPORT_FORMAT, version: IMPORT_VERSION, generatedAt: '2026-10-03T10:00:00Z',
    suppliers: [{ key: 'IT00000000001', vatNumber: 'IT00000000001', name: 'FORNITORE ESEMPIO SRL' }],
    ingredients,
  }));
  assert.equal(r.ok, true);
  return r.file;
};
const supplierIdByKey = { IT00000000001: SUPPLIER_ID };
const existing = (over = {}) => ({
  id: 'ing-1', name: 'Farina tipo 00', shortName: '', supplierId: SUPPLIER_ID, supplierCode: 'F00-25', kind: 'ingredient', ...over,
});
const ctxOf = (over = {}) => ({ supplierIdByKey, ingredients: [], pricesById: {}, invoicePointIds: {}, ...over });

// ── planBatchWrites ─────────────────────────────────────────────────────────────

test('a NEW ingredient: the minted id reaches the price and every point, and nothing else is invented', () => {
  const file = fileOf([rawIngredient({ prices: [price(), price({ line: 6, invoiceDate: '2026-09-15', pricePerUnit: 0.6 })] })]);
  const row = planIngredients(file.ingredients, ctxOf())[0];
  assert.equal(row.status, 'new');
  const batches = ingredientWrites(row, file.ingredients[0], '2026-10-03T00:00:00.000Z', { language: 'it' });
  let minted = 0;
  const plan = planBatchWrites(batches, { mintId: () => { minted += 1; return 'minted-1'; }, bakery: 'loc-test' });
  assert.equal(minted, 1, 'one id per new ingredient');
  assert.equal(plan.ingredientId, 'minted-1');
  const writes = plan.batches.flat();
  assert.deepEqual(writes[0].path, ['ingredients', 'minted-1']);
  assert.equal(writes[0].merge, true);
  assert.deepEqual(writes[1].path, ['ingredient-prices', 'minted-1']);
  assert.equal(writes[1].merge, true);
  const points = writes.filter(w => w.path[2] === 'prices');
  assert.deepEqual(points.map(w => w.path), [
    ['ingredients', 'minted-1', 'prices', 'inv-18000000001-5'],
    ['ingredients', 'minted-1', 'prices', 'inv-18000000001-6'],
  ]);
  points.forEach(w => {
    assert.equal(w.merge, false, 'a history point is create-only: the rules refuse the second create');
    assert.equal(w.data.source, 'invoice');
    assert.equal(w.data.supplierId, SUPPLIER_ID);
  });
  writes.forEach(w => assert.equal(w.data.bakery, 'loc-test', 'every document carries the venue id'));
  const shape = (name) => { assert.ok(writes.every(w => !(name in w.data)), `${name} was written`); };
  FORBIDDEN_KEYS.forEach(shape);
});

test('an EXISTING ingredient is never given a new id, and a patch only carries what the model sent', () => {
  const file = fileOf([rawIngredient({ supplierCode: 'F00-25' })]);
  const row = planIngredients(file.ingredients, ctxOf({ ingredients: [existing({ supplierCode: '' })] }))[0];
  assert.equal(row.status, 'update-price');
  const batches = ingredientWrites(row, file.ingredients[0], '2026-10-03T00:00:00.000Z', { language: 'it' });
  const plan = planBatchWrites(batches, { mintId: () => { throw new Error('no id may be minted'); }, bakery: 'loc-test' });
  assert.equal(plan.ingredientId, 'ing-1');
  const writes = plan.batches.flat();
  assert.deepEqual(writes[0].path, ['ingredients', 'ing-1']);
  assert.deepEqual(writes[0].data, { supplierCode: 'F00-25', bakery: 'loc-test' });
  assert.ok(writes.some(w => w.path[0] === 'ingredient-prices' && w.merge === true));
});

test('a history-only row writes points and no current price', () => {
  const file = fileOf([rawIngredient()]);
  const row = planIngredients(file.ingredients, ctxOf({
    ingredients: [existing()], pricesById: { 'ing-1': { priceUpdatedAt: '2026-09-30T12:00:00.000Z' } },
  }))[0];
  assert.equal(row.status, 'history-only');
  const plan = planBatchWrites(ingredientWrites(row, file.ingredients[0], '', {}), { mintId: () => 'x', bakery: 'b' });
  assert.deepEqual(plan.batches.flat().map(w => w.path[0]), ['ingredients']);
  assert.equal(plan.batches.flat()[0].path[2], 'prices');
});

test('⚠️ an allergen, nutrition or pack-list key can never pass, whoever builds the op', () => {
  for (const key of FORBIDDEN_KEYS) {
    assert.throws(
      () => planBatchWrites([[{ type: 'create-ingredient', data: { name: 'x', [key]: [] } }]], { mintId: () => 'a', bakery: 'b' }),
      new RegExp(key),
    );
  }
  assert.throws(() => planBatchWrites([[{ type: 'patch-ingredient', ingredientId: 'i', data: { allergens: ['milk'] } }]], { mintId: () => 'a', bakery: 'b' }), /allergens/);
});

test('an op with nowhere to go, an unknown op and a point with no id are refused, not guessed', () => {
  const opts = { mintId: () => 'a', bakery: 'b' };
  assert.throws(() => planBatchWrites([[{ type: 'set-current-price', ingredientId: null, data: {} }]], opts), /no ingredient/);
  assert.throws(() => planBatchWrites([[{ type: 'drop-everything' }]], { ...opts }), /Unknown|no ingredient/);
  assert.throws(() => planBatchWrites([[{ type: 'add-price-point', ingredientId: 'i', data: {} }]], opts), /no id/);
  assert.deepEqual(planBatchWrites([], opts), { batches: [], ingredientId: null });
});

test('the batches keep the model\'s order and size', () => {
  const ingredients = rawIngredient({
    prices: Array.from({ length: 12 }, (_, i) => price({ line: i + 1, invoiceDate: `2026-08-${String(i + 10).padStart(2, '0')}` })),
  });
  const file = fileOf([ingredients]);
  const row = planIngredients(file.ingredients, ctxOf())[0];
  const batches = ingredientWrites(row, file.ingredients[0], '', { language: 'it' });
  const plan = planBatchWrites(batches, { mintId: () => 'm', bakery: 'b' });
  assert.deepEqual(plan.batches.map(b => b.length), batches.map(b => b.length));
  assert.ok(plan.batches.every(b => b.length <= 5));
  assert.equal(plan.batches.flat().length, 14, 'the ingredient, the price, twelve points');
});

// ── stopKind ────────────────────────────────────────────────────────────────────

test('only a refusal and a lost connection stop the whole run', () => {
  assert.equal(stopKind({ code: 'permission-denied' }), 'permission');
  assert.equal(stopKind({ code: 'firestore/permission-denied' }), 'permission');
  assert.equal(stopKind({ code: 'offline' }), 'offline');
  assert.equal(stopKind({ code: 'unavailable' }), 'offline');
  assert.equal(stopKind({ code: 'timeout' }), 'offline');
  assert.equal(stopKind({ code: 'invalid-argument' }), null);
  assert.equal(stopKind(new Error('boom')), null);
  assert.equal(stopKind(null), null);
});

// ── The screen's view of a plan ─────────────────────────────────────────────────

function mixedRows() {
  const file = fileOf([
    rawIngredient({ key: 'k-new', name: 'Zucchero velo', supplierCode: '' }),
    rawIngredient({ key: 'k-same', name: 'Farina tipo 00' }),
    // Its own invoice: a point already recorded on another ingredient would be a remembered answer.
    rawIngredient({ key: 'k-maybe', name: 'Farina 00 Premium', supplierCode: '', prices: [price({ invoiceId: '18000000009' })] }),
    rawIngredient({ key: 'k-bad', name: '', supplierCode: '' }),
    rawIngredient({ key: 'k-nosup', supplierKey: 'IT99999999999', name: 'Orphan', supplierCode: '' }),
  ]);
  const ctx = ctxOf({
    ingredients: [existing({ id: 'ing-same' }), existing({ id: 'ing-near', name: 'Farina 00 Esempio', supplierCode: '' })],
    invoicePointIds: { 'ing-same': new Set(['inv-18000000001-5']) },
  });
  return { file, ctx, rows: planIngredients(file.ingredients, ctx) };
}

test('the chips count every row once, and Errors and Unchanged are told apart', () => {
  const { ctx, rows } = mixedRows();
  assert.deepEqual(rows.map(r => r.status), ['new', 'unchanged', 'maybe-duplicate', 'error', 'error']);
  const entries = applyDecisions(rows, {}, ctx);
  const counts = filterCounts(entries);
  assert.deepEqual(counts, { all: 5, new: 1, 'update-price': 0, 'history-only': 0, unchanged: 1, check: 0, decide: 1, error: 2 });
  assert.deepEqual(FILTERS, ['all', 'new', 'update-price', 'history-only', 'unchanged', 'check', 'decide', 'error']);
  assert.deepEqual(entriesFor(entries, 'error').map(e => e.planned.key), ['k-bad', 'k-nosup']);
  assert.equal(entriesFor(entries, 'all').length, 5);
  assert.equal(waitingCount(entries), 1);
  assert.equal(bucketOf(entries[2]), 'decide');
});

test('answering a question keeps the row under «To decide» but changes what would be written', () => {
  const { ctx, rows } = mixedRows();
  const same = applyDecisions(rows, { 'k-maybe': { sameAs: 'ing-near' } }, ctx);
  assert.equal(same[2].waiting, false);
  assert.equal(bucketOf(same[2]), 'decide', 'the row does not jump away from the finger that answered it');
  assert.equal(same[2].row.status, 'update-price');
  assert.equal(same[2].row.ingredientId, 'ing-near');
  assert.equal(waitingCount(same), 0);

  const created = applyDecisions(rows, { 'k-maybe': { createNew: true } }, ctx);
  assert.equal(created[2].row.status, 'new');
  const skipped = applyDecisions(rows, { 'k-maybe': { skip: true } }, ctx);
  assert.equal(skipped[2].row.status, 'skipped');
  assert.equal(writesRow(skipped[2]), false);
});

test('the confirmation quotes the rows that write, the ingredients created and the prices added', () => {
  const { ctx, rows } = mixedRows();
  const entries = applyDecisions(rows, { 'k-maybe': { createNew: true } }, ctx);
  assert.deepEqual(importTotals(entries), { rows: 2, newIngredients: 2, pricesAdded: 2 });
  const sameAs = applyDecisions(rows, { 'k-maybe': { sameAs: 'ing-near' } }, ctx);
  assert.deepEqual(importTotals(sameAs), { rows: 2, newIngredients: 1, pricesAdded: 2 });
  assert.deepEqual(importTotals(applyDecisions(rows, {}, ctx)), { rows: 1, newIngredients: 1, pricesAdded: 1 });
});

test('the invoice-point reads are made only for ingredients a row could be matched with', () => {
  const { rows } = mixedRows();
  assert.deepEqual(idsToCheck(rows).sort(), ['ing-near', 'ing-same']);
  assert.deepEqual(idsToCheck([]), []);
});

test('the invoice count is by invoice, not by line', () => {
  const file = fileOf([rawIngredient({ prices: [price(), price({ line: 6 }), price({ invoiceId: '18000000002', line: 1, invoiceDate: '2026-09-02' })] })]);
  const row = planIngredients(file.ingredients, ctxOf())[0];
  assert.equal(invoiceCount(row), 2);
});

// ── The re-check before each row ────────────────────────────────────────────────

function reader(state) {
  const calls = [];
  return {
    calls,
    read: {
      ingredients: async (id) => { calls.push(['ingredients', id]); return state.ingredients; },
      pointIds: async (id) => { calls.push(['pointIds', id]); return state.points?.[id] || new Set(); },
      price: async (id) => { calls.push(['price', id]); return state.prices?.[id] || null; },
    },
  };
}

test('⚠️ a row that was NEW when planned becomes an update when the ingredient now exists', async () => {
  const file = fileOf([rawIngredient({ supplierCode: '' })]);
  const { read, calls } = reader({ ingredients: [existing({ id: 'just-created', supplierCode: '' })] });
  const out = await replanRow({ fileIngredient: file.ingredients[0], decision: undefined, supplierIdByKey, read });
  assert.equal(out.waiting, false);
  assert.equal(out.row.status, 'update-price');
  assert.equal(out.row.ingredientId, 'just-created');
  assert.deepEqual(calls.map(c => c[0]), ['ingredients', 'pointIds', 'price']);
});

test('a row whose points are all recorded is unchanged on the re-check, and nothing is written', async () => {
  const file = fileOf([rawIngredient()]);
  const { read } = reader({
    ingredients: [existing({ id: 'i1' })],
    points: { i1: new Set(['inv-18000000001-5']) },
    prices: { i1: { priceUpdatedAt: '2026-08-31T12:00:00.000Z' } },
  });
  const out = await replanRow({ fileIngredient: file.ingredients[0], supplierIdByKey, read });
  assert.equal(out.row.status, 'unchanged');
  assert.deepEqual(ingredientWrites(out.row, file.ingredients[0], '', {}), []);
});

test('a row with nothing similar stays new and reads nothing about prices', async () => {
  const file = fileOf([rawIngredient({ supplierCode: '' })]);
  const { read, calls } = reader({ ingredients: [] });
  const out = await replanRow({ fileIngredient: file.ingredients[0], supplierIdByKey, read });
  assert.equal(out.row.status, 'new');
  assert.deepEqual(calls, [['ingredients', SUPPLIER_ID]]);
});

test('a similar ingredient that appeared meanwhile leaves an undecided row WAITING, never a duplicate', async () => {
  const file = fileOf([rawIngredient({ name: 'Farina 00 Premium', supplierCode: '' })]);
  const { read } = reader({ ingredients: [existing({ id: 'near', name: 'Farina 00 Esempio', supplierCode: '' })] });
  const out = await replanRow({ fileIngredient: file.ingredients[0], supplierIdByKey, read });
  assert.equal(out.waiting, true);
  assert.equal(out.row.status, 'maybe-duplicate');
});

test('the person\'s answer is applied again on the fresh data', async () => {
  const file = fileOf([rawIngredient({ name: 'Farina 00 Premium', supplierCode: '' })]);
  const state = { ingredients: [existing({ id: 'near', name: 'Farina 00 Esempio', supplierCode: '' })] };
  const same = await replanRow({ fileIngredient: file.ingredients[0], decision: { sameAs: 'near' }, supplierIdByKey, read: reader(state).read });
  assert.equal(same.row.status, 'update-price');
  assert.equal(same.row.ingredientId, 'near');
  const fresh = await replanRow({ fileIngredient: file.ingredients[0], decision: { createNew: true }, supplierIdByKey, read: reader(state).read });
  assert.equal(fresh.row.status, 'new');
  const gone = await replanRow({ fileIngredient: file.ingredients[0], decision: { sameAs: 'deleted' }, supplierIdByKey, read: reader(state).read });
  assert.equal(gone.row.status, 'error');
});

test('a supplier nobody mapped reads nothing and is an error row', async () => {
  const file = fileOf([rawIngredient({ supplierKey: 'IT99999999999' })]);
  const { read, calls } = reader({ ingredients: [] });
  const out = await replanRow({ fileIngredient: file.ingredients[0], supplierIdByKey, read });
  assert.equal(out.row.status, 'error');
  assert.equal(out.row.reason, 'supplier-missing');
  assert.deepEqual(calls, []);
});

test('a failed read is not swallowed: the caller decides what it means', async () => {
  const file = fileOf([rawIngredient()]);
  const err = Object.assign(new Error('offline'), { code: 'unavailable' });
  await assert.rejects(
    replanRow({ fileIngredient: file.ingredients[0], supplierIdByKey, read: { ingredients: async () => { throw err; } } }),
    e => e.code === 'unavailable',
  );
});

// ── A second run writes nothing ─────────────────────────────────────────────────

test('importing the same file twice: the second pass plans no write at all', async () => {
  const file = fileOf([rawIngredient(), rawIngredient({ key: 'k2', name: 'Zucchero', supplierCode: '', prices: [price({ line: 9 })] })]);
  const store = [];
  const points = {};
  const read = {
    ingredients: async () => store,
    pointIds: async (id) => new Set(points[id] || []),
    price: async () => null,
  };
  let next = 0;
  const run = async () => {
    let writes = 0;
    for (const fileIngredient of file.ingredients) {
      const { row } = await replanRow({ fileIngredient, supplierIdByKey, read });
      const batches = ingredientWrites(row, fileIngredient, '', { language: 'it' });
      if (batches.length === 0) continue;
      const plan = planBatchWrites(batches, { mintId: () => `id-${++next}`, bakery: 'b' });
      plan.batches.flat().forEach(w => {
        writes += 1;
        if (w.path[0] === 'ingredients' && w.path.length === 2 && !store.some(i => i.id === w.path[1])) {
          store.push({ id: w.path[1], supplierId: SUPPLIER_ID, kind: 'ingredient', ...w.data });
        }
        if (w.path[2] === 'prices') (points[w.path[1]] ||= []).push(w.path[3]);
      });
    }
    return writes;
  };
  assert.ok(await run() > 0);
  assert.equal(await run(), 0, 're-running the same file must write nothing');
  assert.equal(store.length, 2, 'and must not have created a copy');
});

// ── The summary ─────────────────────────────────────────────────────────────────

test('the summary counts every outcome and keeps each failure with its reason', () => {
  const sum = summarizeRun([
    { key: 'a', name: 'A', outcome: 'created', pricesAdded: 2 },
    { key: 'b', name: 'B', outcome: 'updated', pricesAdded: 1 },
    { key: 'c', name: 'C', outcome: 'unchanged' },
    { key: 'd', name: 'D', outcome: 'skipped' },
    { key: 'e', name: 'E', outcome: 'failed', reason: 'nope' },
  ], { stopped: 'offline', notRun: 3 });
  assert.deepEqual(sum, {
    created: 1, updated: 1, pricesAdded: 3, changesAdded: 0, changesFailed: 0, unchanged: 1, skipped: 1, codesFull: 0,
    failed: [{ key: 'e', name: 'E', reason: 'nope', retry: false }], stopped: 'offline', notRun: 3,
    retryable: 0, notFixableByRetry: 1,
  });
  assert.deepEqual(summarizeRun([]).failed, []);
});

// ── Review fixes ────────────────────────────────────────────────────────────────

test('⚠️ the re-check remembers an answer too: the candidate that holds the row\'s points is the match', async () => {
  const file = fileOf([rawIngredient({ name: 'Farina di grano tenero', supplierCode: '' })]);
  const { read, calls } = reader({
    ingredients: [existing({ id: 'far', name: 'Farina', supplierCode: '' }), existing({ id: 'zz', name: 'Zucchero', supplierCode: '' })],
    points: { far: new Set(['inv-18000000001-5']) },
    prices: { far: { priceUnit: 'kg', priceUpdatedAt: '2026-08-31T12:00:00.000Z' } },
  });
  const out = await replanRow({ fileIngredient: file.ingredients[0], decision: undefined, supplierIdByKey, read });
  assert.equal(out.waiting, false, 'it is not a question any more');
  assert.equal(out.row.status, 'unchanged');
  assert.equal(out.row.ingredientId, 'far');
  assert.deepEqual(calls.map(c => c[0]), ['ingredients', 'pointIds', 'price']);
  assert.deepEqual(calls.filter(c => c[0] === 'pointIds').map(c => c[1]), ['far']);
});

test('the same file twice after a «Same as» answer: the second run asks nothing and plans no write', () => {
  const file = fileOf([rawIngredient({ name: 'Farina di grano tenero', supplierCode: '' })]);
  const ingredients = [existing({ id: 'far', name: 'Farina', supplierCode: '' })];
  const first = planIngredients(file.ingredients, ctxOf({ ingredients }));
  assert.equal(first[0].status, 'maybe-duplicate');
  const answered = applyDecisions(first, { [first[0].key]: { sameAs: 'far' } }, ctxOf({ ingredients }));
  assert.equal(answered[0].row.status, 'update-price');
  // What the first import left behind: the point under «Farina».
  const second = planIngredients(file.ingredients, ctxOf({ ingredients, invoicePointIds: { far: new Set(['inv-18000000001-5']) } }));
  assert.deepEqual(second.map(r => r.status), ['unchanged']);
  const entries = applyDecisions(second, {}, ctxOf({ ingredients }));
  assert.equal(waitingCount(entries), 0);
  assert.equal(importTotals(entries).rows, 0);
});

test('the supplier plan the owner confirmed is compared with the fresh one, key by key', () => {
  const before = [
    { key: 'a', status: 'new' },
    { key: 'b', status: 'present', supplierId: 's1' },
    { key: 'c', status: 'maybe', candidates: [{ id: 'x', label: 'X' }] },
    { key: 'd', status: 'error', reason: 'name-missing' },
  ];
  assert.deepEqual(changedSupplierKeys(before, before.map(e => ({ ...e }))), []);
  const after = [
    { key: 'a', status: 'present', supplierId: 's9' },                         // appeared meanwhile
    { key: 'b', status: 'present', supplierId: 's2' },                         // now another supplier
    { key: 'c', status: 'maybe', candidates: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] },   // one more candidate
    { key: 'd', status: 'error', reason: 'name-missing' },
  ];
  assert.deepEqual(changedSupplierKeys(before, after), ['a', 'b', 'c']);
  assert.deepEqual(changedSupplierKeys(before, []), ['a', 'b', 'c', 'd'], 'a missing entry is a change');
  // What this very import wrote exists now by its own doing: not a change.
  assert.deepEqual(changedSupplierKeys(before, after, ['a', 'b']), ['c']);
});

test('the chips offered: All, the one that is on, and every one with something under it', () => {
  const counts = { all: 5, new: 3, 'update-price': 0, 'history-only': 0, unchanged: 2, decide: 0, error: 0 };
  assert.deepEqual(visibleFilters(counts, 'all'), ['all', 'new', 'unchanged']);
  assert.deepEqual(visibleFilters(counts, 'decide'), ['all', 'new', 'unchanged', 'decide']);
  assert.deepEqual(visibleFilters({ ...counts, new: 0, unchanged: 0 }, 'all'), ['all']);
});

test('only a failure a second load can fix is marked retryable; the summary counts both kinds', () => {
  const sum = summarizeRun([
    { key: 'a', name: 'A', outcome: 'failed', reason: 'invalid price', retry: false },
    { key: 'b', name: 'B', outcome: 'failed', reason: 'could not be saved', retry: true },
    { key: 'c', name: 'C', outcome: 'failed', reason: 'unmarked' },
  ]);
  assert.equal(sum.retryable, 1);
  assert.equal(sum.notFixableByRetry, 2, 'a failure nobody marked is not promised a fix');
  assert.deepEqual(sum.failed.map(f => f.retry), [false, true, false]);
  assert.equal(isRetryableReason('target-not-found'), true);
  assert.equal(isRetryableReason('price-invalid'), false);
  assert.equal(isRetryableReason('supplier-missing'), false);
  assert.equal(summarizeRun([]).retryable, 0);
});

test('every row answered by hand with no article code gets a «unisci con» line; a row with a code does not', () => {
  const file = fileOf([
    rawIngredient({ key: 'k-hand', name: 'Farina 00 Premium', supplierCode: '' }),
    rawIngredient({ key: 'k-code', name: 'Zucchero velo premium', supplierCode: 'Z1', prices: [price({ line: 2 })] }),
    rawIngredient({ key: 'k-skip', name: 'Sale marino premium', supplierCode: '', prices: [price({ line: 3 })] }),
    rawIngredient({ key: 'k-auto', name: 'Olio extra', supplierCode: '', prices: [price({ line: 4 })] }),
  ]);
  const ingredients = [
    existing({ id: 'i1', name: 'Farina 00 Esempio', supplierCode: '' }),
    existing({ id: 'i2', name: 'Zucchero velo esempio', supplierCode: '' }),
    existing({ id: 'i3', name: 'Sale marino esempio', supplierCode: '' }),
  ];
  const ctx = ctxOf({ ingredients });
  const rows = planIngredients(file.ingredients, ctx);
  const decisions = { 'k-hand': { sameAs: 'i1' }, 'k-code': { sameAs: 'i2' }, 'k-skip': { skip: true } };
  const entries = applyDecisions(rows, decisions, ctx);
  const labelOf = (id) => ingredients.find(i => i.id === id)?.name || '';
  assert.deepEqual(rememberHints(entries, decisions, labelOf), [{ name: 'Farina 00 Premium', target: 'Farina 00 Esempio' }]);
  assert.deepEqual(rememberHints(entries, {}, labelOf), []);
  assert.deepEqual(rememberHints(entries, decisions, () => ''), [], 'a target with no label is not promised');
});

// ── The price change shown on a row, the «price to check» group and «do not import (remember)» ────
import { priceChange, applyDecisions as applyAll, bucketOf as bucket, filterCounts as countOf } from '../js/orders/invoice-import-plan.js';

test('priceChange: a signed whole percent, «equal» within half a percent, nothing across units or with a missing side', () => {
  assert.deepEqual(priceChange({ pricePerUnit: 2.1, priceUnit: 'kg' }, 2.31, 'kg'), { percent: 10 });
  assert.deepEqual(priceChange({ pricePerUnit: 2.1, priceUnit: 'kg' }, 1.89, 'kg'), { percent: -10 });
  assert.deepEqual(priceChange({ pricePerUnit: 2.1, priceUnit: 'kg' }, 2.105, 'kg'), { percent: 0 });
  assert.deepEqual(priceChange({ pricePerUnit: 2, priceUnit: 'kg' }, 2.009, 'kg'), { percent: 0 });
  assert.deepEqual(priceChange({ pricePerUnit: 2, priceUnit: 'kg' }, 2.02, 'kg'), { percent: 1 });
  assert.equal(priceChange({ pricePerUnit: 2.1, priceUnit: 'kg' }, 2.31, 'l'), null);
  assert.equal(priceChange({ pricePerUnit: 2.1, priceUnit: 'kg' }, 2.31, 'pcs'), null);
  assert.equal(priceChange(null, 2.31, 'kg'), null);
  assert.equal(priceChange({ priceUnit: 'kg' }, 2.31, 'kg'), null);
  assert.equal(priceChange({ pricePerUnit: 0, priceUnit: 'kg' }, 2.31, 'kg'), null);
  assert.equal(priceChange({ pricePerUnit: 2, priceUnit: 'kg' }, 0, 'kg'), null);
});

test('a row with a priceCheck code is counted under «Price to check», new or matched', () => {
  const planned = [
    { key: 'a', status: 'new', priceCheck: 'price-out-of-scale', newPoints: [], allPoints: [] },
    { key: 'b', status: 'unchanged', priceCheck: 'mixed-units', newPoints: [], allPoints: [] },
    { key: 'c', status: 'new', priceCheck: '', newPoints: [{}], allPoints: [{}] },
  ];
  const entries = applyAll(planned, {}, {});
  assert.deepEqual(entries.map(bucket), ['check', 'check', 'new']);
  const counts = countOf(entries);
  assert.deepEqual([counts.check, counts.new, counts.unchanged], [2, 1, 0]);
});

test('«Do not import (remember)» turns a NEW row into a skipped one that stays under its chip', () => {
  const planned = [
    { key: 'a', status: 'new', priceCheck: '', newPoints: [{}], allPoints: [{}], updateCurrent: true },
    { key: 'b', status: 'update-price', priceCheck: '', newPoints: [{}], allPoints: [{}], updateCurrent: true },
  ];
  const entries = applyAll(planned, {}, {}, new Set(['a', 'b']));
  assert.equal(entries[0].row.status, 'skipped');
  assert.deepEqual(entries[0].row.newPoints, []);
  assert.equal(bucket(entries[0]), 'new');
  assert.equal(entries[1].row.status, 'update-price', 'only a NEW row can be left out this way');
  assert.equal(countOf(entries).new, 1);
});
