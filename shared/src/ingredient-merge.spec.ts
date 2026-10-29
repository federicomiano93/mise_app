// Unit tests for «Unisci un'altra confezione…» (P15) — where an ingredient is still used, the chooser and the plan of the
// merge — run against BOTH implementations: the TypeScript port in shared/ and js/orders/ingredient-merge.js, which the
// live app uses today. Ported from tests/ingredient-merge.test.mjs. Every name, id and price below is INVENTED.
//
// ingredient-merge.ts is a FULL port since step 3e-7, so parity.spec.ts pairs it.
//
// PORTED: every test of the planning — mergeCandidates, findUsage, the month keys, mergedCodes, pointIdOnA, planMerge,
// deletionBatches and «a merge never writes priceBasis».
//
// NOT PORTED: every test that reads the source text of the current app's data layer, screen or stylesheets ('the data
// layer reads from the SERVER…', 'the write works on FRESH data…', 'the failure words are honest…', 'the confirmation
// lists the price takeover…', 'while it writes…', 'the price rows wrap only when…', 'the screen uses the app's own
// dialogs…', 'no file of the merge imports another feature's folder', 'the button is drawn only for somebody who may
// merge…'): Mise 2 pins the same behaviour in its own data layer and screen specs (app/src/suppliers/merge*.spec.ts*).

import { describe, expect, test } from 'vitest';
import * as ported from './ingredient-merge';
import * as legacyJs from '../../js/orders/ingredient-merge.js';
import { MAX_DOCS_PER_BATCH, MAX_SUPPLIER_CODES } from './invoice-import-model';
import rulesSource from '../../firestore.rules?raw';

const legacy = legacyJs as unknown as typeof ported;
const RULES = rulesSource.replace(/\r\n/g, '\n');

const ing = (over: Record<string, unknown> = {}) => ({
  id: 'a', name: 'Lievito baking sacco', shortName: '', supplierId: 's1', kind: 'ingredient', active: true, supplierCode: 'SACCO', weight: '5 kg', ...over,
});
const A = ing({ id: 'a', supplierCode: 'SACCO', supplierCodes: [] });
const B = ing({ id: 'b', name: 'Lievito baking pacco', supplierCode: 'PACCO', weight: '1 kg' });
const point = (id: string, over: Record<string, unknown> = {}) => ({ id, data: {
  recordedAt: '2026-09-01T12:00:00.000Z', priceUnit: 'kg', pricePerUnit: 6, supplierId: 's1', source: 'invoice',
  invoiceId: '18000000050', invoiceDate: '2026-09-01', bakery: 'loc', ...over,
} as Record<string, unknown> });
const flat = (plan: ported.MergePlan): ported.MergeOp[] => plan.batches.flat();
const at = (ops: readonly ported.MergeOp[], i: number): ported.MergeOp => ops[i] ?? { path: [], data: {}, merge: false };

const free = { products: [], recipes: [], inventory: null, month: '2026-10', draft: null };

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('a free ingredient is used nowhere', () => {
    expect(m.findUsage('b', free)).toStrictEqual([]);
    expect(m.findUsage('b', undefined)).toStrictEqual([]);
    expect(m.findUsage('', free)).toStrictEqual([]);
  });

  test("a product that holds it in its components OR its packaging blocks, by the product's name", () => {
    const products = [
      { name: 'Pane', components: [{ kind: 'ingredient', ingredientId: 'b', qty: 1, unit: 'kg' }], packaging: [] },
      { name: 'Torta', components: [{ recipeId: 'r1', qtyKg: 2 }], packaging: [{ ingredientId: 'b', qtyPcs: 1 }] },
      { name: 'Altro', components: [{ kind: 'ingredient', ingredientId: 'z' }], packaging: [] },
    ];
    expect(m.findUsage('b', { ...free, products })).toStrictEqual([{ kind: 'product', name: 'Pane' }, { kind: 'product', name: 'Torta' }]);
  });

  test('a recipe row linked to it blocks; a row linked to a RECIPE with the same id does not', () => {
    const recipes = [
      { name: 'Impasto', ingredients: [{ label: 'Lievito', refId: 'b', kind: 'ingredient' }] },
      { name: 'Base', ingredients: [{ label: 'Altro', refId: 'b', kind: 'recipe' }] },
      { name: 'Libera', ingredients: [{ label: 'Sale' }] },
    ];
    expect(m.findUsage('b', { ...free, recipes })).toStrictEqual([{ kind: 'recipe', name: 'Impasto' }]);
  });

  test('the current stocktake blocks on any count (opening, purchased, closing) unless the month is closed', () => {
    const open = (extra: object) => ({ ...free, inventory: { closedAt: '', opening: {}, purchased: {}, closing: {}, ...extra } });
    expect(m.findUsage('b', open({ opening: { b: 3 } }))).toStrictEqual([{ kind: 'inventory', month: '2026-10' }]);
    expect(m.findUsage('b', open({ purchased: { b: 0 } })).length, 'a zero is a count').toBe(1);
    expect(m.findUsage('b', open({ closing: { b: 2 } })).length).toBe(1);
    expect(m.findUsage('b', open({ opening: { x: 3 } })), 'a missing key is «not counted»').toStrictEqual([]);
    expect(m.findUsage('b', { ...free, inventory: { closedAt: '2026-10-31T10:00:00Z', opening: { b: 3 } } }), 'a closed month is history').toStrictEqual([]);
    expect(m.findUsage('b', { ...free, inventory: null })).toStrictEqual([]);
  });

  test('the order in progress blocks only on a quantity above zero', () => {
    expect(m.findUsage('b', { ...free, draft: { entries: { b: { qty: 2, stock: 0 } } } })).toStrictEqual([{ kind: 'draft' }]);
    expect(m.findUsage('b', { ...free, draft: { entries: { b: { qty: 0, stock: 5 } } } })).toStrictEqual([]);
    expect(m.findUsage('b', { ...free, draft: { entries: {} } })).toStrictEqual([]);
    expect(m.findUsage('b', { ...free, draft: null })).toStrictEqual([]);
  });

  test('several places are all listed, in a stable order: products, recipes, stocktake, order', () => {
    const where = m.findUsage('b', {
      products: [{ name: 'P', components: [{ ingredientId: 'b' }] }],
      recipes: [{ name: 'R', ingredients: [{ refId: 'b', kind: 'ingredient' }] }],
      inventory: { closedAt: '', opening: { b: 1 } }, month: '2026-10',
      draft: { entries: { b: { qty: 1 } } },
    });
    expect(where.map(w => w.kind)).toStrictEqual(['product', 'recipe', 'inventory', 'draft']);
  });

  test("the month key is the LOCAL month, like the stocktake's", () => {
    expect(m.monthKeyOf(new Date(2026, 9, 5, 12).getTime())).toBe('2026-10');
    expect(m.monthKeyOf(NaN)).toBeNull();
    expect(m.previousMonthKeyOf(new Date(2026, 9, 5, 12).getTime())).toBe('2026-09');
    expect(m.previousMonthKeyOf(new Date(2026, 0, 31, 12).getTime()), 'January looks back to December').toBe('2025-12');
    expect(m.previousMonthKeyOf(NaN)).toBeNull();
  });

  test('with no moment given, the month key is the current month', () => {
    const expected = new Date();
    const key = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}`;
    expect([key, m.monthKeyOf()]).toStrictEqual([key, key]);
  });

  test('⚠️ an OPEN stocktake of LAST month that counts it blocks too; a closed or empty one does not', () => {
    const inv = (month: string, data: unknown) => ({ month, data });
    const open = { closedAt: '', opening: { b: 3 } };
    const missing = { opening: { b: 3 } };
    expect(m.findUsage('b', { ...free, inventories: [inv('2026-10', null), inv('2026-09', open)] })).toStrictEqual([{ kind: 'inventory', month: '2026-09' }]);
    expect(m.findUsage('b', { ...free, inventories: [inv('2026-10', null), inv('2026-09', missing)] }).length, 'no closedAt at all is open').toBe(1);
    expect(m.findUsage('b', { ...free, inventories: [inv('2026-10', null), inv('2026-09', { ...open, closedAt: '2026-09-30T20:00:00Z' })] })).toStrictEqual([]);
    expect(m.findUsage('b', { ...free, inventories: [inv('2026-10', null), inv('2026-09', { closedAt: '', opening: { x: 1 } })] })).toStrictEqual([]);
    expect(m.findUsage('b', { ...free, inventories: [inv('2026-10', open), inv('2026-09', open)] }).length, 'both months are named').toBe(2);
  });

  test('⚠️ an order list not yet done blocks while a line naming it is unticked; a done one does not', () => {
    const requests = (list: unknown[]) => ({ ...free, requests: list });
    expect(m.findUsage('b', requests([{ quantities: { b: 2, c: 1 }, done: {} }]))).toStrictEqual([{ kind: 'request' }]);
    expect(m.findUsage('b', requests([{ quantities: { b: 2, c: 1 }, done: { b: true } }])), 'its own line is ticked').toStrictEqual([]);
    expect(m.findUsage('b', requests([{ quantities: { b: 2 }, done: { b: true } }])), 'the whole list is done').toStrictEqual([]);
    expect(m.findUsage('b', requests([{ quantities: { c: 1 }, done: {} }])), 'it does not name B').toStrictEqual([]);
    expect(m.findUsage('b', requests([null, {}, { quantities: null }])), 'a broken document never throws').toStrictEqual([]);
  });

  // ── Who can be merged ─────────────────────────────────────────────────────────

  test("only the same supplier's other FOOD ingredients are offered, active or not, most alike first", () => {
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
    expect(m.mergeCandidates(a, list).map(c => c.ingredient.id)).toStrictEqual(['b', 'c', 'f']);
  });

  test('the search narrows by every typed word, accents and case ignored, on either name', () => {
    const a = ing();
    const list = [ing({ id: 'b', name: 'Lièvito baking pacco' }), ing({ id: 'c', name: 'Farina', shortName: 'Farina pacco' })];
    expect(m.mergeCandidates(a, list, 'LIEVITO pacco').map(c => c.ingredient.id)).toStrictEqual(['b']);
    expect(m.mergeCandidates(a, list, 'pacco').map(c => c.ingredient.id).sort()).toStrictEqual(['b', 'c']);
    expect(m.mergeCandidates(a, list, 'nothing')).toStrictEqual([]);
    expect(m.mergeCandidates(null, list)).toStrictEqual([]);
  });

  // ── Codes ─────────────────────────────────────────────────────────────────────

  test("A's codes after the merge: its own, then B's main and extras — no repeat, never A's main code", () => {
    const a = ing({ supplierCode: 'SACCO', supplierCodes: ['X'] });
    const b = ing({ id: 'b', supplierCode: 'pacco', supplierCodes: ['x', 'SACCO', 'Y'] });
    expect(m.mergedCodes(a, b)).toStrictEqual({ codes: ['X', 'pacco', 'Y'], added: 2, dropped: 0 });
  });

  test('at the cap nothing more is added and the rest is counted as dropped', () => {
    const own = Array.from({ length: MAX_SUPPLIER_CODES - 1 }, (_, i) => `C${i}`);
    const result = m.mergedCodes(ing({ supplierCodes: own }), ing({ id: 'b', supplierCode: 'N1', supplierCodes: ['N2', 'N3'] }));
    expect(result.codes.length).toBe(MAX_SUPPLIER_CODES);
    expect([result.added, result.dropped]).toStrictEqual([1, 2]);
    const full = m.mergedCodes(ing({ supplierCodes: [...own, 'LAST'] }), ing({ id: 'b', supplierCode: 'N1' }));
    expect([full.codes.length, full.added, full.dropped]).toStrictEqual([MAX_SUPPLIER_CODES, 0, 1]);
  });

  // ── The plan ──────────────────────────────────────────────────────────────────

  test("an invoice point keeps its id; any other point gets an id made from B's and its own", () => {
    expect(m.pointIdOnA('b', 'inv-18000000050-1', { source: 'invoice' })).toBe('inv-18000000050-1');
    expect(m.pointIdOnA('b', 'AutoId123', { source: 'manual' })).toBe('mrg-b-AutoId123');
    expect(m.pointIdOnA('b', 'inv-1-1', { source: 'manual' }), 'a manual point never claims an invoice id').toBe('mrg-b-inv-1-1');
  });

  test("the points go first (oldest first), then A's codes, then A's price — and no document is B's own key", () => {
    const plan = m.planMerge({
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
    expect(ops.map(o => o.path.join('/'))).toStrictEqual([
      'ingredients/a/prices/mrg-b-manualA',
      'ingredients/a/prices/inv-18000000050-1',
      'ingredients/a/prices/inv-18000000051-1',
      'ingredients/a',
      'ingredient-prices/a',
    ]);
    expect(at(ops, 3).data).toStrictEqual({ supplierCodes: ['PACCO'] });
    expect(at(ops, 3).merge).toBe(true);
    expect(at(ops, 0).merge, 'a history point is create-only').toBe(false);
    expect(at(ops, 4).data.pricePerUnit).toBe(6.5);
    expect(at(ops, 4).data.priceUpdatedAt).toBe('2026-10-01T12:00:00.000Z');
    expect(at(ops, 4).data.vatRate).toBe(4);
    expect(at(ops, 4).data.casePrice, 'the retired and case keys drain, as on every save').toBe(null);
    expect(plan.counts).toStrictEqual({ prices: 3, codes: 1, droppedCodes: 0 });
  });

  test('a copied point keeps only the keys the rules know, and says which pack it paid for', () => {
    const plan = m.planMerge({
      a: A, b: B,
      bPoints: [point('inv-18000000050-1', { packLabel: undefined }), point('inv-18000000052-1', { packLabel: 'Lievito pacco 1 kg (sconto)', invoiceId: '18000000052' })],
      aPointIds: new Set(), aPrice: null, bPrice: null,
    });
    const first = at(flat(plan), 0);
    const second = at(flat(plan), 1);
    expect(first.data.packLabel, "B's name + weight when the point has none").toBe('Lievito baking pacco 1 kg');
    expect(second.data.packLabel, 'kept when it has one').toBe('Lievito pacco 1 kg (sconto)');
    const keyList = RULES.slice(RULES.indexOf('match /prices/{priceId} {')).match(/hasOnly\(\[([\s\S]*?)\]\)/)?.[1] ?? '';
    const allowed = [...keyList.matchAll(/'([^']+)'/g)]
      .map(found => found[1]);
    expect(allowed.length).toBeGreaterThan(5);
    flat(plan).filter(op => op.path[2] === 'prices')
      .forEach(op => Object.keys(op.data).forEach(k => expect(allowed.includes(k), `${k} is not a key the rules accept`).toBe(true)));
    expect('bakery' in first.data, "the writer stamps the venue, the copy never carries B's").toBe(false);
  });

  test('a second try finishes the job: points A already has are skipped, and nothing new is planned for the codes or the price', () => {
    const afterFirstTry = {
      a: { ...A, supplierCodes: ['PACCO'] }, b: B,
      bPoints: [point('inv-18000000050-1'), point('manualA', { source: 'manual', invoiceId: undefined, invoiceDate: undefined })],
      aPointIds: new Set(['inv-18000000050-1', 'mrg-b-manualA']),
      aPrice: { priceUnit: 'kg', pricePerUnit: 6.5, priceUpdatedAt: '2026-10-01T12:00:00.000Z' },
      bPrice: { priceUnit: 'kg', pricePerUnit: 6.5, priceUpdatedAt: '2026-10-01T12:00:00.000Z' },
    };
    expect(m.planMerge(afterFirstTry).batches).toStrictEqual([]);
    const half = m.planMerge({ ...afterFirstTry, aPointIds: new Set(['inv-18000000050-1']) });
    expect(flat(half).map(o => o.path.join('/'))).toStrictEqual(['ingredients/a/prices/mrg-b-manualA']);
  });

  test("B's price takes over only when it is NEWER and in the SAME unit", () => {
    const run = (aPrice: unknown, bPrice: unknown) => flat(m.planMerge({ a: A, b: B, bPoints: [], aPointIds: new Set(), aPrice, bPrice }))
      .filter(o => o.path[0] === 'ingredient-prices');
    const stamp = (d: string) => `${d}T12:00:00.000Z`;
    expect(run({ priceUnit: 'kg', pricePerUnit: 4, priceUpdatedAt: stamp('2026-09-01') }, { priceUnit: 'kg', pricePerUnit: 6, priceUpdatedAt: stamp('2026-10-01') }).length).toBe(1);
    expect(run({ priceUnit: 'kg', pricePerUnit: 4, priceUpdatedAt: stamp('2026-10-01') }, { priceUnit: 'kg', pricePerUnit: 6, priceUpdatedAt: stamp('2026-09-01') }).length, 'older').toBe(0);
    expect(run({ priceUnit: 'kg', pricePerUnit: 4, priceUpdatedAt: stamp('2026-10-01') }, { priceUnit: 'kg', pricePerUnit: 6, priceUpdatedAt: stamp('2026-10-01') }).length, 'same moment').toBe(0);
    expect(run({ priceUnit: 'pcs', pricePerUnit: 4, priceUpdatedAt: stamp('2026-09-01') }, { priceUnit: 'kg', pricePerUnit: 6, priceUpdatedAt: stamp('2026-10-01') }).length, 'another unit').toBe(0);
    expect(run(null, { priceUnit: 'kg', pricePerUnit: 6, priceUpdatedAt: stamp('2026-10-01') }).length, 'A has no price yet').toBe(1);
    expect(run({ priceUnit: 'kg', pricePerUnit: 4, priceUpdatedAt: stamp('2026-09-01') }, null).length, 'B has none').toBe(0);
    expect(run({ priceUnit: 'kg', pricePerUnit: 4 }, { priceUnit: 'kg', pricePerUnit: 6 }).length, 'an undated price is never «newer»').toBe(0);
  });

  test("B's VAT rate does not wipe A's when B states none", () => {
    const [op] = flat(m.planMerge({
      a: A, b: B, bPoints: [], aPointIds: new Set(),
      aPrice: { priceUnit: 'kg', pricePerUnit: 4, priceUpdatedAt: '2026-09-01T12:00:00.000Z', vatRate: 10 },
      bPrice: { priceUnit: 'kg', pricePerUnit: 6, priceUpdatedAt: '2026-10-01T12:00:00.000Z' },
    })).filter(o => o.path[0] === 'ingredient-prices');
    expect(op?.data.vatRate).toBe(10);
  });

  test('⚠️ a per-piece price of B takes over only when the piece weighs the same (0.1%)', () => {
    const run = (aKg: number | undefined, bKg: number) => flat(m.planMerge({
      a: A, b: B, bPoints: [], aPointIds: new Set(),
      aPrice: { priceUnit: 'pcs', pricePerUnit: 5, unitWeightKg: aKg, priceUpdatedAt: '2026-09-01T12:00:00.000Z' },
      bPrice: { priceUnit: 'pcs', pricePerUnit: 1.2, unitWeightKg: bKg, priceUpdatedAt: '2026-10-01T12:00:00.000Z' },
    })).filter(o => o.path[0] === 'ingredient-prices');
    expect(run(5, 1).length, 'a 5 kg sack piece is not a 1 kg bag piece').toBe(0);
    expect(run(1, 1.0005).length).toBe(1);
    expect(run(undefined, 1).length, 'a missing weight is not «equal»').toBe(0);
  });

  test("a copied point carries the article code of its pack: its own, else B's main code, else none", () => {
    const plan = m.planMerge({
      a: A, b: B, bPoints: [point('inv-18000000050-1'), point('inv-18000000052-1', { packCode: 'OWN-1', invoiceId: '18000000052' })],
      aPointIds: new Set(), aPrice: null, bPrice: null,
    });
    const first = at(flat(plan), 0);
    const second = at(flat(plan), 1);
    expect(first.data.packCode).toBe('PACCO');
    expect(second.data.packCode).toBe('OWN-1');
    const noCode = m.planMerge({ a: A, b: { ...B, supplierCode: '' }, bPoints: [point('inv-18000000050-1')], aPointIds: new Set(), aPrice: null, bPrice: null });
    expect('packCode' in at(flat(noCode), 0).data).toBe(false);
  });

  test('the confirmation counts only the prices that will be COPIED, not those A already has', () => {
    const plan = m.planMerge({
      a: A, b: B, bPoints: [point('inv-18000000050-1'), point('inv-18000000051-1', { invoiceId: '18000000051' })],
      aPointIds: new Set(['inv-18000000050-1']), aPrice: null, bPrice: null,
    });
    expect(plan.counts.prices).toBe(1);
  });

  test("the plan says what happens to B's current price and to its price changes", () => {
    const stamp = (d: string) => `${d}T12:00:00.000Z`;
    const bPrice = { priceUnit: 'kg', pricePerUnit: 6, priceUpdatedAt: stamp('2026-09-01') };
    const aNewer = { priceUnit: 'kg', pricePerUnit: 4, priceUpdatedAt: stamp('2026-10-01') };
    const run = (extra: object) => m.planMerge({ a: A, b: B, aPointIds: new Set(), aPrice: aNewer, bPrice, ...extra });
    const taken = m.planMerge({ a: A, b: B, bPoints: [], aPointIds: new Set(), aPrice: { ...aNewer, priceUpdatedAt: stamp('2026-08-01') }, bPrice });
    expect(taken.takeover).toBe(true);
    expect(taken.bLostPrice).toBe(null);
    const kept = run({ bPoints: [point('inv-18000000050-1', { pricePerUnit: 6 })] });
    expect([kept.takeover, kept.bLostPrice]).toStrictEqual([false, 'history']);
    const lost = run({ bPoints: [point('inv-18000000050-1', { pricePerUnit: 5 })] });
    expect([lost.takeover, lost.bLostPrice], 'no point holds that price: it goes with B').toStrictEqual([false, 'lost']);
    expect(run({ bPoints: [], bPrice: null }).bLostPrice, 'no current price, nothing lost').toBe(null);
    expect(run({ bPoints: [], changeIds: ['inv-1-1-b'] }).hasChanges).toBe(true);
    expect(run({ bPoints: [], changeIds: [] }).hasChanges).toBe(false);
  });

  test('batches never hold more than five documents and keep the order', () => {
    const bPoints = Array.from({ length: 13 }, (_, i) => point(`inv-1800000${String(i).padStart(4, '0')}-1`, {
      invoiceId: `1800000${String(i).padStart(4, '0')}`, recordedAt: `2026-09-${String(10 + i).padStart(2, '0')}T12:00:00.000Z`,
    }));
    const plan = m.planMerge({ a: A, b: B, bPoints, aPointIds: new Set(), aPrice: null, bPrice: { priceUnit: 'kg', pricePerUnit: 6, priceUpdatedAt: '2026-10-01T12:00:00.000Z' } });
    expect(plan.batches.length).toBeGreaterThan(1);
    plan.batches.forEach(b => expect(b.length >= 1 && b.length <= MAX_DOCS_PER_BATCH).toBe(true));
    const ops = flat(plan);
    expect(ops.length, '13 points, the codes, the price').toBe(15);
    expect(ops.slice(-2).map(o => o.path[0])).toStrictEqual(['ingredients', 'ingredient-prices']);
    expect(at(ops, 13).path.length, "A's codes come after every point").toBe(2);
  });

  test("B's price changes are deleted in batches of at most five", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `inv-${i}-1-b`);
    const batches = m.deletionBatches(ids);
    expect(batches.map(b => b.length)).toStrictEqual([5, 5, 2]);
    expect(batches.flat()).toStrictEqual(ids);
    expect(m.deletionBatches([])).toStrictEqual([]);
    expect(m.deletionBatches([null, '', 'x'])).toStrictEqual([['x']]);
  });

  test('⚠️ a merge never writes priceBasis: the surviving ingredient keeps the basis it chose', () => {
    const [op] = flat(m.planMerge({
      a: A, b: B, bPoints: [], aPointIds: new Set(),
      aPrice: { priceUnit: 'pcs', pricePerUnit: 9.6, unitWeightKg: 10, priceUpdatedAt: '2026-09-01T12:00:00.000Z', priceBasis: 'rate' },
      bPrice: { priceUnit: 'pcs', pricePerUnit: 9.9, unitWeightKg: 10, priceUpdatedAt: '2026-10-01T12:00:00.000Z', priceBasis: 'case' },
    })).filter(o => o.path[0] === 'ingredient-prices');
    expect(op, "B's newer price takes over").toBeTruthy();
    expect('priceBasis' in (op?.data ?? {}), 'neither copied from B nor reset to null').toBe(false);
  });
});
