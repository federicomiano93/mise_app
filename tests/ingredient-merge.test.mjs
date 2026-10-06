// «Unisci un'altra confezione…» — the planning (js/orders/ingredient-merge.js) and the pins on the pieces around
// it. The planning is pure; the screen and the data layer load the Firebase SDK from a CDN, which node cannot,
// so what they must do is pinned in their source. Every name, id and price below is INVENTED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mergeCandidates, findUsage, monthKeyOf, previousMonthKeyOf, pointIdOnA, mergedCodes, planMerge, deletionBatches,
} from '../js/orders/ingredient-merge.js';
import { MAX_DOCS_PER_BATCH, MAX_SUPPLIER_CODES } from '../js/orders/invoice-import-model.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const RULES = read('firestore.rules');

const ing = (over = {}) => ({ id: 'a', name: 'Lievito baking sacco', shortName: '', supplierId: 's1', kind: 'ingredient', active: true, supplierCode: 'SACCO', weight: '5 kg', ...over });

// ── Who can be merged ───────────────────────────────────────────────────────────

test('only the same supplier\'s other FOOD ingredients are offered, active or not, most alike first', () => {
  const a = ing();
  const list = [
    a,
    ing({ id: 'b', name: 'Lievito baking pacco' }),
    ing({ id: 'c', name: 'Farina 00', active: false }),
    ing({ id: 'd', name: 'Lievito baking pacco', supplierId: 's2' }),
    ing({ id: 'e', name: 'Scatola lievito', kind: 'packaging' }),
    ing({ id: 'f', name: 'Lievito fresco' }),
  ];
  // The one that shares words comes first; the rest follow by name.
  assert.deepEqual(mergeCandidates(a, list).map(c => c.ingredient.id), ['b', 'c', 'f']);
});

test('the search narrows by every typed word, accents and case ignored, on either name', () => {
  const a = ing();
  const list = [ing({ id: 'b', name: 'Lièvito baking pacco' }), ing({ id: 'c', name: 'Farina', shortName: 'Farina pacco' })];
  assert.deepEqual(mergeCandidates(a, list, 'LIEVITO pacco').map(c => c.ingredient.id), ['b']);
  assert.deepEqual(mergeCandidates(a, list, 'pacco').map(c => c.ingredient.id).sort(), ['b', 'c']);
  assert.deepEqual(mergeCandidates(a, list, 'nothing'), []);
  assert.deepEqual(mergeCandidates(null, list), []);
});

// ── Where B is used (every case) ────────────────────────────────────────────────

const free = { products: [], recipes: [], inventory: null, month: '2026-10', draft: null };

test('a free ingredient is used nowhere', () => {
  assert.deepEqual(findUsage('b', free), []);
  assert.deepEqual(findUsage('b', undefined), []);
  assert.deepEqual(findUsage('', free), []);
});

test('a product that holds it in its components OR its packaging blocks, by the product\'s name', () => {
  const products = [
    { name: 'Pane', components: [{ kind: 'ingredient', ingredientId: 'b', qty: 1, unit: 'kg' }], packaging: [] },
    { name: 'Torta', components: [{ recipeId: 'r1', qtyKg: 2 }], packaging: [{ ingredientId: 'b', qtyPcs: 1 }] },
    { name: 'Altro', components: [{ kind: 'ingredient', ingredientId: 'z' }], packaging: [] },
  ];
  assert.deepEqual(findUsage('b', { ...free, products }), [{ kind: 'product', name: 'Pane' }, { kind: 'product', name: 'Torta' }]);
});

test('a recipe row linked to it blocks; a row linked to a RECIPE with the same id does not', () => {
  const recipes = [
    { name: 'Impasto', ingredients: [{ label: 'Lievito', refId: 'b', kind: 'ingredient' }] },
    { name: 'Base', ingredients: [{ label: 'Altro', refId: 'b', kind: 'recipe' }] },
    { name: 'Libera', ingredients: [{ label: 'Sale' }] },
  ];
  assert.deepEqual(findUsage('b', { ...free, recipes }), [{ kind: 'recipe', name: 'Impasto' }]);
});

test('the current stocktake blocks on any count (opening, purchased, closing) unless the month is closed', () => {
  const open = (extra) => ({ ...free, inventory: { closedAt: '', opening: {}, purchased: {}, closing: {}, ...extra } });
  assert.deepEqual(findUsage('b', open({ opening: { b: 3 } })), [{ kind: 'inventory', month: '2026-10' }]);
  assert.equal(findUsage('b', open({ purchased: { b: 0 } })).length, 1, 'a zero is a count');
  assert.equal(findUsage('b', open({ closing: { b: 2 } })).length, 1);
  assert.deepEqual(findUsage('b', open({ opening: { x: 3 } })), [], 'a missing key is «not counted»');
  assert.deepEqual(findUsage('b', { ...free, inventory: { closedAt: '2026-10-31T10:00:00Z', opening: { b: 3 } } }), [], 'a closed month is history');
  assert.deepEqual(findUsage('b', { ...free, inventory: null }), []);
});

test('the order in progress blocks only on a quantity above zero', () => {
  assert.deepEqual(findUsage('b', { ...free, draft: { entries: { b: { qty: 2, stock: 0 } } } }), [{ kind: 'draft' }]);
  assert.deepEqual(findUsage('b', { ...free, draft: { entries: { b: { qty: 0, stock: 5 } } } }), []);
  assert.deepEqual(findUsage('b', { ...free, draft: { entries: {} } }), []);
  assert.deepEqual(findUsage('b', { ...free, draft: null }), []);
});

test('several places are all listed, in a stable order: products, recipes, stocktake, order', () => {
  const where = findUsage('b', {
    products: [{ name: 'P', components: [{ ingredientId: 'b' }] }],
    recipes: [{ name: 'R', ingredients: [{ refId: 'b', kind: 'ingredient' }] }],
    inventory: { closedAt: '', opening: { b: 1 } }, month: '2026-10',
    draft: { entries: { b: { qty: 1 } } },
  });
  assert.deepEqual(where.map(w => w.kind), ['product', 'recipe', 'inventory', 'draft']);
});

test('the month key is the LOCAL month, like the stocktake\'s', () => {
  assert.equal(monthKeyOf(new Date(2026, 9, 5, 12).getTime()), '2026-10');
  assert.equal(monthKeyOf(NaN), null);
  assert.equal(previousMonthKeyOf(new Date(2026, 9, 5, 12).getTime()), '2026-09');
  assert.equal(previousMonthKeyOf(new Date(2026, 0, 31, 12).getTime()), '2025-12', 'January looks back to December');
  assert.equal(previousMonthKeyOf(NaN), null);
});

test('⚠️ an OPEN stocktake of LAST month that counts it blocks too; a closed or empty one does not', () => {
  const inv = (month, data) => ({ month, data });
  const open = { closedAt: '', opening: { b: 3 } };
  const missing = { opening: { b: 3 } };
  assert.deepEqual(findUsage('b', { ...free, inventories: [inv('2026-10', null), inv('2026-09', open)] }), [{ kind: 'inventory', month: '2026-09' }]);
  assert.equal(findUsage('b', { ...free, inventories: [inv('2026-10', null), inv('2026-09', missing)] }).length, 1, 'no closedAt at all is open');
  assert.deepEqual(findUsage('b', { ...free, inventories: [inv('2026-10', null), inv('2026-09', { ...open, closedAt: '2026-09-30T20:00:00Z' })] }), []);
  assert.deepEqual(findUsage('b', { ...free, inventories: [inv('2026-10', null), inv('2026-09', { closedAt: '', opening: { x: 1 } })] }), []);
  assert.equal(findUsage('b', { ...free, inventories: [inv('2026-10', open), inv('2026-09', open)] }).length, 2, 'both months are named');
});

test('⚠️ an order list not yet done blocks while a line naming it is unticked; a done one does not', () => {
  const requests = (list) => ({ ...free, requests: list });
  assert.deepEqual(findUsage('b', requests([{ quantities: { b: 2, c: 1 }, done: {} }])), [{ kind: 'request' }]);
  assert.deepEqual(findUsage('b', requests([{ quantities: { b: 2, c: 1 }, done: { b: true } }])), [], 'its own line is ticked');
  assert.deepEqual(findUsage('b', requests([{ quantities: { b: 2 }, done: { b: true } }])), [], 'the whole list is done');
  assert.deepEqual(findUsage('b', requests([{ quantities: { c: 1 }, done: {} }])), [], 'it does not name B');
  assert.deepEqual(findUsage('b', requests([null, {}, { quantities: null }])), [], 'a broken document never throws');
});

// ── Codes ───────────────────────────────────────────────────────────────────────

test('A\'s codes after the merge: its own, then B\'s main and extras — no repeat, never A\'s main code', () => {
  const a = ing({ supplierCode: 'SACCO', supplierCodes: ['X'] });
  const b = ing({ id: 'b', supplierCode: 'pacco', supplierCodes: ['x', 'SACCO', 'Y'] });
  assert.deepEqual(mergedCodes(a, b), { codes: ['X', 'pacco', 'Y'], added: 2, dropped: 0 });
});

test('at the cap nothing more is added and the rest is counted as dropped', () => {
  const own = Array.from({ length: MAX_SUPPLIER_CODES - 1 }, (_, i) => `C${i}`);
  const result = mergedCodes(ing({ supplierCodes: own }), ing({ id: 'b', supplierCode: 'N1', supplierCodes: ['N2', 'N3'] }));
  assert.equal(result.codes.length, MAX_SUPPLIER_CODES);
  assert.deepEqual([result.added, result.dropped], [1, 2]);
  const full = mergedCodes(ing({ supplierCodes: [...own, 'LAST'] }), ing({ id: 'b', supplierCode: 'N1' }));
  assert.deepEqual([full.codes.length, full.added, full.dropped], [MAX_SUPPLIER_CODES, 0, 1]);
});

// ── The plan ────────────────────────────────────────────────────────────────────

const A = ing({ id: 'a', supplierCode: 'SACCO', supplierCodes: [] });
const B = ing({ id: 'b', name: 'Lievito baking pacco', supplierCode: 'PACCO', weight: '1 kg' });
const point = (id, over = {}) => ({ id, data: {
  recordedAt: '2026-09-01T12:00:00.000Z', priceUnit: 'kg', pricePerUnit: 6, supplierId: 's1', source: 'invoice',
  invoiceId: '18000000050', invoiceDate: '2026-09-01', bakery: 'loc', ...over,
} });
const flat = (plan) => plan.batches.flat();

test('an invoice point keeps its id; any other point gets an id made from B\'s and its own', () => {
  assert.equal(pointIdOnA('b', 'inv-18000000050-1', { source: 'invoice' }), 'inv-18000000050-1');
  assert.equal(pointIdOnA('b', 'AutoId123', { source: 'manual' }), 'mrg-b-AutoId123');
  assert.equal(pointIdOnA('b', 'inv-1-1', { source: 'manual' }), 'mrg-b-inv-1-1', 'a manual point never claims an invoice id');
});

test('the points go first (oldest first), then A\'s codes, then A\'s price — and no document is B\'s own key', () => {
  const plan = planMerge({
    a: A, b: B,
    bPoints: [
      point('inv-18000000051-1', { recordedAt: '2026-10-01T12:00:00.000Z', invoiceId: '18000000051' }),
      point('manualA', { source: 'manual', recordedAt: '2026-08-01T12:00:00.000Z', invoiceId: undefined, invoiceDate: undefined }),
      point('inv-18000000050-1'),
    ],
    aPointIds: new Set(),
    aPrice: { priceUnit: 'kg', pricePerUnit: 4, priceUpdatedAt: '2026-08-01T12:00:00.000Z' },
    bPrice: { priceUnit: 'kg', pricePerUnit: 6.5, priceUpdatedAt: '2026-10-01T12:00:00.000Z', vatRate: 4 },
  });
  const ops = flat(plan);
  assert.deepEqual(ops.map(o => o.path.join('/')), [
    'ingredients/a/prices/mrg-b-manualA',
    'ingredients/a/prices/inv-18000000050-1',
    'ingredients/a/prices/inv-18000000051-1',
    'ingredients/a',
    'ingredient-prices/a',
  ]);
  assert.deepEqual(ops[3].data, { supplierCodes: ['PACCO'] });
  assert.equal(ops[3].merge, true);
  assert.equal(ops[0].merge, false, 'a history point is create-only');
  assert.equal(ops[4].data.pricePerUnit, 6.5);
  assert.equal(ops[4].data.priceUpdatedAt, '2026-10-01T12:00:00.000Z');
  assert.equal(ops[4].data.vatRate, 4);
  assert.equal(ops[4].data.casePrice, null, 'the retired and case keys drain, as on every save');
  assert.deepEqual(plan.counts, { prices: 3, codes: 1, droppedCodes: 0 });
});

test('a copied point keeps only the keys the rules know, and says which pack it paid for', () => {
  const plan = planMerge({
    a: A, b: B, bPoints: [point('inv-18000000050-1', { packLabel: undefined }), point('inv-18000000052-1', { packLabel: 'Lievito pacco 1 kg (sconto)', invoiceId: '18000000052' })],
    aPointIds: new Set(), aPrice: null, bPrice: null,
  });
  const [first, second] = flat(plan);
  assert.equal(first.data.packLabel, 'Lievito baking pacco 1 kg', 'B\'s name + weight when the point has none');
  assert.equal(second.data.packLabel, 'Lievito pacco 1 kg (sconto)', 'kept when it has one');
  const allowed = [...RULES.slice(RULES.indexOf('match /prices/{priceId} {')).match(/hasOnly\(\[([\s\S]*?)\]\)/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  flat(plan).filter(op => op.path[2] === 'prices').forEach(op => Object.keys(op.data).forEach(k => assert.ok(allowed.includes(k), `${k} is not a key the rules accept`)));
  assert.equal('bakery' in first.data, false, 'the writer stamps the venue, the copy never carries B\'s');
});

test('a second try finishes the job: points A already has are skipped, and nothing new is planned for the codes or the price', () => {
  const afterFirstTry = {
    a: { ...A, supplierCodes: ['PACCO'] }, b: B,
    bPoints: [point('inv-18000000050-1'), point('manualA', { source: 'manual', invoiceId: undefined, invoiceDate: undefined })],
    aPointIds: new Set(['inv-18000000050-1', 'mrg-b-manualA']),
    aPrice: { priceUnit: 'kg', pricePerUnit: 6.5, priceUpdatedAt: '2026-10-01T12:00:00.000Z' },
    bPrice: { priceUnit: 'kg', pricePerUnit: 6.5, priceUpdatedAt: '2026-10-01T12:00:00.000Z' },
  };
  assert.deepEqual(planMerge(afterFirstTry).batches, []);
  const half = planMerge({ ...afterFirstTry, aPointIds: new Set(['inv-18000000050-1']) });
  assert.deepEqual(flat(half).map(o => o.path.join('/')), ['ingredients/a/prices/mrg-b-manualA']);
});

test('B\'s price takes over only when it is NEWER and in the SAME unit', () => {
  const run = (aPrice, bPrice) => flat(planMerge({ a: A, b: B, bPoints: [], aPointIds: new Set(), aPrice, bPrice }))
    .filter(o => o.path[0] === 'ingredient-prices');
  const stamp = (d) => `${d}T12:00:00.000Z`;
  assert.equal(run({ priceUnit: 'kg', pricePerUnit: 4, priceUpdatedAt: stamp('2026-09-01') }, { priceUnit: 'kg', pricePerUnit: 6, priceUpdatedAt: stamp('2026-10-01') }).length, 1);
  assert.equal(run({ priceUnit: 'kg', pricePerUnit: 4, priceUpdatedAt: stamp('2026-10-01') }, { priceUnit: 'kg', pricePerUnit: 6, priceUpdatedAt: stamp('2026-09-01') }).length, 0, 'older');
  assert.equal(run({ priceUnit: 'kg', pricePerUnit: 4, priceUpdatedAt: stamp('2026-10-01') }, { priceUnit: 'kg', pricePerUnit: 6, priceUpdatedAt: stamp('2026-10-01') }).length, 0, 'same moment');
  assert.equal(run({ priceUnit: 'pcs', pricePerUnit: 4, priceUpdatedAt: stamp('2026-09-01') }, { priceUnit: 'kg', pricePerUnit: 6, priceUpdatedAt: stamp('2026-10-01') }).length, 0, 'another unit');
  assert.equal(run(null, { priceUnit: 'kg', pricePerUnit: 6, priceUpdatedAt: stamp('2026-10-01') }).length, 1, 'A has no price yet');
  assert.equal(run({ priceUnit: 'kg', pricePerUnit: 4, priceUpdatedAt: stamp('2026-09-01') }, null).length, 0, 'B has none');
  assert.equal(run({ priceUnit: 'kg', pricePerUnit: 4 }, { priceUnit: 'kg', pricePerUnit: 6 }).length, 0, 'an undated price is never «newer»');
});

test('B\'s VAT rate does not wipe A\'s when B states none', () => {
  const [op] = flat(planMerge({
    a: A, b: B, bPoints: [], aPointIds: new Set(),
    aPrice: { priceUnit: 'kg', pricePerUnit: 4, priceUpdatedAt: '2026-09-01T12:00:00.000Z', vatRate: 10 },
    bPrice: { priceUnit: 'kg', pricePerUnit: 6, priceUpdatedAt: '2026-10-01T12:00:00.000Z' },
  })).filter(o => o.path[0] === 'ingredient-prices');
  assert.equal(op.data.vatRate, 10);
});

test('⚠️ a per-piece price of B takes over only when the piece weighs the same (0.1%)', () => {
  const run = (aKg, bKg) => flat(planMerge({
    a: A, b: B, bPoints: [], aPointIds: new Set(),
    aPrice: { priceUnit: 'pcs', pricePerUnit: 5, unitWeightKg: aKg, priceUpdatedAt: '2026-09-01T12:00:00.000Z' },
    bPrice: { priceUnit: 'pcs', pricePerUnit: 1.2, unitWeightKg: bKg, priceUpdatedAt: '2026-10-01T12:00:00.000Z' },
  })).filter(o => o.path[0] === 'ingredient-prices');
  assert.equal(run(5, 1).length, 0, 'a 5 kg sack piece is not a 1 kg bag piece');
  assert.equal(run(1, 1.0005).length, 1);
  assert.equal(run(undefined, 1).length, 0, 'a missing weight is not «equal»');
});

test('a copied point carries the article code of its pack: its own, else B\'s main code, else none', () => {
  const plan = planMerge({
    a: A, b: B, bPoints: [point('inv-18000000050-1'), point('inv-18000000052-1', { packCode: 'OWN-1', invoiceId: '18000000052' })],
    aPointIds: new Set(), aPrice: null, bPrice: null,
  });
  const [first, second] = flat(plan);
  assert.equal(first.data.packCode, 'PACCO');
  assert.equal(second.data.packCode, 'OWN-1');
  const noCode = planMerge({ a: A, b: { ...B, supplierCode: '' }, bPoints: [point('inv-18000000050-1')], aPointIds: new Set(), aPrice: null, bPrice: null });
  assert.equal('packCode' in flat(noCode)[0].data, false);
});

test('the confirmation counts only the prices that will be COPIED, not those A already has', () => {
  const plan = planMerge({
    a: A, b: B, bPoints: [point('inv-18000000050-1'), point('inv-18000000051-1', { invoiceId: '18000000051' })],
    aPointIds: new Set(['inv-18000000050-1']), aPrice: null, bPrice: null,
  });
  assert.equal(plan.counts.prices, 1);
});

test('the plan says what happens to B\'s current price and to its price changes', () => {
  const stamp = (d) => `${d}T12:00:00.000Z`;
  const bPrice = { priceUnit: 'kg', pricePerUnit: 6, priceUpdatedAt: stamp('2026-09-01') };
  const aNewer = { priceUnit: 'kg', pricePerUnit: 4, priceUpdatedAt: stamp('2026-10-01') };
  const run = (extra) => planMerge({ a: A, b: B, aPointIds: new Set(), aPrice: aNewer, bPrice, ...extra });
  const taken = planMerge({ a: A, b: B, bPoints: [], aPointIds: new Set(), aPrice: { ...aNewer, priceUpdatedAt: stamp('2026-08-01') }, bPrice });
  assert.equal(taken.takeover, true);
  assert.equal(taken.bLostPrice, null);
  const kept = run({ bPoints: [point('inv-18000000050-1', { pricePerUnit: 6 })] });
  assert.deepEqual([kept.takeover, kept.bLostPrice], [false, 'history']);
  const lost = run({ bPoints: [point('inv-18000000050-1', { pricePerUnit: 5 })] });
  assert.deepEqual([lost.takeover, lost.bLostPrice], [false, 'lost'], 'no point holds that price: it goes with B');
  assert.equal(run({ bPoints: [], bPrice: null }).bLostPrice, null, 'no current price, nothing lost');
  assert.equal(run({ bPoints: [], changeIds: ['inv-1-1-b'] }).hasChanges, true);
  assert.equal(run({ bPoints: [], changeIds: [] }).hasChanges, false);
});

test('batches never hold more than five documents and keep the order', () => {
  const bPoints = Array.from({ length: 13 }, (_, i) => point(`inv-1800000${String(i).padStart(4, '0')}-1`, {
    invoiceId: `1800000${String(i).padStart(4, '0')}`, recordedAt: `2026-09-${String(10 + i).padStart(2, '0')}T12:00:00.000Z`,
  }));
  const plan = planMerge({ a: A, b: B, bPoints, aPointIds: new Set(), aPrice: null, bPrice: { priceUnit: 'kg', pricePerUnit: 6, priceUpdatedAt: '2026-10-01T12:00:00.000Z' } });
  assert.ok(plan.batches.length > 1);
  plan.batches.forEach(b => assert.ok(b.length >= 1 && b.length <= MAX_DOCS_PER_BATCH));
  const ops = flat(plan);
  assert.equal(ops.length, 15, '13 points, the codes, the price');
  assert.deepEqual(ops.slice(-2).map(o => o.path[0]), ['ingredients', 'ingredient-prices']);
  assert.equal(ops[13].path.length, 2, 'A\'s codes come after every point');
});

test('B\'s price changes are deleted in batches of at most five', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `inv-${i}-1-b`);
  const batches = deletionBatches(ids);
  assert.deepEqual(batches.map(b => b.length), [5, 5, 2]);
  assert.deepEqual(batches.flat(), ids);
  assert.deepEqual(deletionBatches([]), []);
  assert.deepEqual(deletionBatches([null, '', 'x']), [['x']]);
});

// ── The pieces around it (pinned in source: they need the Firebase SDK) ─────────

test('the data layer reads from the SERVER, refuses offline, and deletes B last', () => {
  const src = read('js/orders/ingredient-merge-data.js');
  assert.doesNotMatch(src, /\bgetDocs\(|\bgetDoc\(/, 'only server reads');
  assert.match(src, /getDocsFromServer/);
  assert.match(src, /getDocFromServer/);
  assert.match(src, /refuseOffline\(\)/);
  const writePoints = src.indexOf('for (const step of plan.batches)');
  const deleteChanges = src.indexOf('deletionBatches(input.changeIds)');
  const deleteB = src.indexOf('deleteIngredientWithPrice(freshB.id, true)');
  const dropDraft = src.indexOf('dropDeletedIngredientFromDraft(freshB.id)');
  assert.ok(writePoints > 0 && writePoints < deleteChanges && deleteChanges < deleteB && deleteB < dropDraft, 'points, then changes, then B, then the draft');
  ['products', 'recipes', 'inventory', 'drafts', 'order-requests'].forEach(name => assert.match(src, new RegExp(`'${name}'`)));
  assert.match(src, /previousMonthKeyOf/, 'last month\'s stocktake is read too');
  assert.match(src, /throw|REJECTS|Promise\.all/, 'a failed read rejects, it never answers «not used»');
});

test('⚠️ the write works on FRESH data and checks the usage again right before the first batch', () => {
  const src = read('js/orders/ingredient-merge-data.js');
  const body = src.slice(src.indexOf('export async function mergeIngredients'), src.indexOf('export async function previewMerge'));
  const fresh = body.indexOf('freshIngredient(a.id)');
  const gone = body.indexOf("stopped('gone')");
  const plan = body.indexOf('planMerge({ a: freshA, b: freshB');
  const again = body.indexOf('await checkUsage(freshB.id)');
  const firstWrite = body.indexOf('for (const step of plan.batches)');
  assert.ok(fresh > 0 && fresh < gone && gone < plan && plan < again && again < firstWrite, 'read fresh, stop if gone, plan from the fresh A, check usage, then write');
  assert.match(body, /stopped\('used'/);
  assert.doesNotMatch(body, /planMerge\(\{ a, b/, 'never planned from the screen\'s copies');
  assert.match(body, /committed = true/);
  assert.match(body, /err\.mergeCommitted = committed/, 'the failure says whether anything landed');
});

test('⚠️ the failure words are honest: «nothing changed» only before the first commit, «half way» after', () => {
  const src = read('js/orders/ingredient-merge-screen.js');
  assert.match(src, /err\.mergeCommitted === true\) return t\('orders\.merge\.interrupted'\)/);
  assert.ok(src.indexOf('orders.merge.interrupted') < src.indexOf('orders.merge.offline'), 'the half-way message wins over the offline one');
  assert.match(src, /err\.mergeStop === 'gone'/);
  const dict = read('js/i18n.js');
  assert.match(dict, /'orders\.merge\.interrupted': 'The merge stopped half way: the prices already copied are safe\./);
  assert.match(dict, /'orders\.merge\.interrupted': 'L’unione si è interrotta a metà: i prezzi già copiati sono al sicuro\. Riprova «Unisci»/);
  assert.match(dict, /'orders\.merge\.usedRequest': 'lista d’ordine aperta'/);
});

test('the confirmation lists the price takeover, the price that is not kept (and whether it is lost) and the price changes', () => {
  const src = read('js/orders/ingredient-merge-screen.js');
  ['lineTakeover', 'lineKept', 'lineLost', 'lineChanges'].forEach(key => {
    assert.match(src, new RegExp(`orders\\.merge\\.${key}`));
    assert.match(read('js/i18n.js'), new RegExp(`'orders\\.merge\\.${key}'`));
  });
  assert.ok(src.indexOf('detailLines(preview') < src.indexOf('confirmDialog('), 'the lines are in the question');
});

test('⚠️ while it writes: a polite status, the list and Back disabled; «Merged» is inserted empty and filled on the next frame', () => {
  const screen = read('js/orders/ingredient-merge-screen.js');
  assert.match(screen, /'aria-live': 'polite'/);
  assert.match(screen, /orders\.merge\.working/);
  assert.match(screen, /body\.setBusy = /);
  assert.ok(screen.indexOf("onBusy(t('orders.merge.working'))") < screen.indexOf('await mergeIngredients(a, b)'));
  assert.match(screen, /finally \{\s*onBusy\(null\);/);
  const registry = read('js/orders/registry.js');
  assert.match(registry, /back\.disabled = Boolean\(message\)/);
  assert.match(registry, /requestAnimationFrame\(\(\) => \{ done\.textContent = t\('orders\.merge\.done'\); \}\)/);
  assert.match(registry, /const done = el\('p', \{ class: 'orders-status ok', role: 'status', 'aria-live': 'polite' \}\)/, 'born empty');
});

test('the price rows wrap only when they carry a pack label (a modifier class), in orders.css and the generated records.css', () => {
  assert.match(read('js/ingredient-record-form.js'), /mgmt-price-row--pack/);
  assert.match(read('orders.css'), /\.mgmt-price-row--pack \{ flex-wrap: wrap; \}/);
  assert.doesNotMatch(read('orders.css'), /^\.mgmt-price-row \{ flex-wrap: wrap; \}/m);
  assert.match(read('records.css'), /\.rec-host \.mgmt-price-row--pack \{\s*flex-wrap: wrap;/);
});

test('the screen uses the app\'s own dialogs, asks danger before deleting, and reads the language when it draws', () => {
  const src = read('js/orders/ingredient-merge-screen.js');
  assert.doesNotMatch(src, /\bwindow\.(confirm|alert)\b|(^|[^.\w])(confirm|alert)\(/m);
  assert.match(src, /from '\.\/confirm-dialog\.js'/);
  assert.match(src, /danger: true/);
  assert.doesNotMatch(src, /^(const|let) \w+ = t\(/m, 'no phrase frozen at load');
  assert.ok(src.indexOf('checkUsage(b.id)') < src.indexOf('confirmDialog('), 'the usage check comes before the question');
  assert.ok(src.indexOf('confirmDialog(') < src.indexOf('mergeIngredients(a, b)'), 'nothing is written before the answer');
  assert.match(src, /orders\.merge\.checkFailed/);
});

test('no file of the merge imports another feature\'s folder', () => {
  ['ingredient-merge.js', 'ingredient-merge-data.js', 'ingredient-merge-screen.js'].forEach(file => {
    const src = read(`js/orders/${file}`);
    assert.doesNotMatch(src, /from '\.\.\/(catalogue|foodcost|inventory)\//, file);
  });
});

test('the button is drawn only for somebody who may merge: a getter on the role AND Food cost, an existing non-packaging card', () => {
  const main = read('js/orders/registry-main.js');
  assert.match(main, /get mergePacks\(\) \{\s*return canManageHere\(\) && mayWritePrices\(\) \? true : undefined;/);
  const registry = read('js/orders/registry.js');
  assert.match(registry, /item && !isPackaging\(item\) && actions\.mergePacks \? \{ openMerge:/);
  const card = read('js/ingredient-record-form.js');
  assert.match(card, /typeof actions\?\.openMerge === 'function'/);
  assert.doesNotMatch(card, /from '\.\/orders\//, 'the card imports no feature');
  assert.match(registry, /entryDirty\(cardEntry\)/, 'typing in the card is never lost');
  assert.match(card, /entry\.packLabel/, 'the history shows which pack each price was paid for');
});

test('⚠️ a merge never writes priceBasis: the surviving ingredient keeps the basis it chose', () => {
  const [op] = flat(planMerge({
    a: A, b: B, bPoints: [], aPointIds: new Set(),
    aPrice: { priceUnit: 'pcs', pricePerUnit: 9.6, unitWeightKg: 10, priceUpdatedAt: '2026-09-01T12:00:00.000Z', priceBasis: 'rate' },
    bPrice: { priceUnit: 'pcs', pricePerUnit: 9.9, unitWeightKg: 10, priceUpdatedAt: '2026-10-01T12:00:00.000Z', priceBasis: 'case' },
  })).filter(o => o.path[0] === 'ingredient-prices');
  assert.ok(op, 'B\'s newer price takes over');
  assert.equal('priceBasis' in op.data, false, 'neither copied from B nor reset to null');
});
