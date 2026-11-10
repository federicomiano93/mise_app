// The money under every «Made of» and packaging line, and the «Which?» list of what has no price (item 26 of
// docs/mise2-port-owed.md), run against BOTH implementations: the TypeScript port in shared/ and
// js/foodcost/foodcost-model.js, which the live app uses today. Ported from tests/foodcost-line-costs.test.mjs
// (current-app PR #485); the two must stay equal until the switch to Mise 2.
//
// Federico, 7 Nov 2026: «il costo dell'ingrediente al kg e il costo della quantità selezionata». The failures
// these tests stop: a line costed one way on the card and another in the batch total, an unknown price shown
// as 0, and a list that names nothing under a warning that stands.
//
// THE WORDS. unpricedParts / productPreview name a line that no longer exists and unpricedReasonText turns a
// reason into words. The original reads js/i18n.js; the port is handed that same `t` last (as
// price-write.spec.ts does), so both are run after setLanguage(...) and must say the same.
//
// PORTED: every test of tests/foodcost-line-costs.test.mjs that runs the model (componentLineCost,
// packagingLineCost, batchTotals, packagingPerUnit, unpricedParts, productPreview, unpricedReasonText).
// NOT PORTED: the ones that read lineCostView (app/src/foodcost/lineCost.spec.ts) or the source text of the
// current screens (the Mise 2 screens have their own specs), and 'every new word exists in both languages'
// (app/src/i18n has a build check).

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import * as ported from './foodcost-model';
import * as legacyJs from '../../js/foodcost/foodcost-model.js';
import { setLanguage, t } from '../../js/i18n.js';

const legacy = legacyJs as unknown as typeof ported;

type Doc = Record<string, unknown>;

beforeEach(() => { setLanguage('en'); });
afterEach(() => { setLanguage('en'); });

const ING: Record<string, Doc> = {
  FLOUR: { id: 'FLOUR', name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 },
  SALT: { id: 'SALT', name: 'Salt', priceUnit: 'kg', pricePerUnit: 1.5 },
  EGG: { id: 'EGG', name: 'Egg', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 },
  NIB: { id: 'NIB', name: 'Nib', priceUnit: 'kg', pricePerUnit: 10, unitWeightKg: 0.05 },
  SPRINKLE: { id: 'SPRINKLE', name: 'Sprinkle', priceUnit: 'pcs', pricePerUnit: 0.02 },
  ICING: { id: 'ICING', name: 'Icing', priceUnit: 'kg', pricePerUnit: 4 },
  RIBBON: { id: 'RIBBON', name: 'Ribbon' },
  BOX: { id: 'BOX', name: 'Box', priceUnit: 'pcs', pricePerUnit: 0.12 },
  FILM: { id: 'FILM', name: 'Film', priceUnit: 'kg', pricePerUnit: 3 },
};
const flourRow = (grams: number): Doc => ({ label: 'Flour', grams, unit: 'g', kind: 'ingredient', refId: 'FLOUR' });
// 1000 g of flour at 2/kg, 20% lost in the oven → 2.50 a kilo out.
const DOUGH: Doc = { id: 'DOUGH', name: 'Dough', lossPct: 20, ingredients: [flourRow(1000)] };
// One linked row and one labelled, unlinked row: priced, but only in part.
const CREAM: Doc = { id: 'CREAM', name: 'Cream', lossPct: 0, ingredients: [flourRow(500), { label: 'Water', grams: 100, unit: 'g' }] };
const MYSTERY: Doc = { id: 'MYSTERY', name: 'Mystery', lossPct: 0, ingredients: [{ label: 'Something', grams: 500, unit: 'g' }] };
const EMPTY: Doc = { id: 'EMPTY', name: 'Empty', lossPct: 0, ingredients: [] };
const FILLING: Doc = { id: 'FILLING', name: 'Filling', lossPct: 0, ingredients: [
  flourRow(200), { label: 'Cream', grams: 300, unit: 'g', kind: 'recipe', refId: 'CREAM' },
] };
const CAKE: Doc = { id: 'CAKE', name: 'Cake', lossPct: 0, ingredients: [
  flourRow(200), { label: 'Filling', grams: 300, unit: 'g', kind: 'recipe', refId: 'FILLING' },
] };
const LOOP_A: Doc = { id: 'LA', name: 'Loop A', lossPct: 0, ingredients: [{ label: 'B', grams: 100, unit: 'g', kind: 'recipe', refId: 'LB' }] };
const LOOP_B: Doc = { id: 'LB', name: 'Loop B', lossPct: 0, ingredients: [{ label: 'A', grams: 100, unit: 'g', kind: 'recipe', refId: 'LA' }] };
const TABLES: ported.CostTables = {
  ingredients: ING,
  recipes: { DOUGH, CREAM, MYSTERY, EMPTY, FILLING, CAKE, LA: LOOP_A, LB: LOOP_B },
};

const ingLine = (ingredientId: string, qty: number, unit: string): Doc => ({ kind: 'ingredient', ingredientId, qty, unit });
const recLine = (recipeId: string, qtyKg: number): Doc => ({ recipeId, qtyKg });
const product = (components: Doc[], over: Doc = {}): Doc => ({
  id: 'P', name: 'P', components, packaging: [], sellingMode: 'piece', piecesPerBatch: 10,
  sellingPrice: 2, vatRate: 0, foodCostTarget: 30, ...over,
});

// The dictionary functions behind the original's signatures: the port is handed the same `t` last.
const unpricedOf = (m: typeof ported, raw: unknown, tables: ported.CostTables): ported.UnpricedPart[] => (m === ported
  ? ported.unpricedParts(raw, tables, t)
  : (legacyJs.unpricedParts as unknown as (raw: unknown, tables: ported.CostTables) => ported.UnpricedPart[])(raw, tables));
const previewOf = (m: typeof ported, raw: unknown, tables: ported.CostTables): ported.ProductPreview => (m === ported
  ? ported.productPreview(raw, tables, t)
  : (legacyJs.productPreview as unknown as (raw: unknown, tables: ported.CostTables) => ported.ProductPreview)(raw, tables));
const reasonText = (m: typeof ported, reason: unknown): string => (m === ported
  ? ported.unpricedReasonText(reason, t)
  : (legacyJs.unpricedReasonText as unknown as (reason: unknown) => string)(reason));

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const parts = (components: Doc[], over: Doc = {}, tables: ported.CostTables = TABLES): ported.UnpricedPart[] => unpricedOf(m, product(components, over), tables);

  // ── componentLineCost ────────────────────────────────────────────────────────

  test('a recipe line: its price per kilo of what comes out, and the amount on the line', () => {
    const line = m.componentLineCost(recLine('DOUGH', 2), TABLES);
    expect([line.rate, line.rateUnit, line.cost, line.partial, line.reason]).toStrictEqual([2.5, 'kg', 5, false, null]);
  });

  test('«no weight loss» lays the oven loss aside, as the batch total does', () => {
    const line = m.componentLineCost(recLine('DOUGH', 2), TABLES, { noWeightLoss: true });
    expect([line.rate, line.cost]).toStrictEqual([2, 4]);
  });

  test('a partly priced recipe has a rate and says it is partial; an unpriced one has NO rate (null, never 0)', () => {
    const partly = m.componentLineCost(recLine('CREAM', 1), TABLES);
    expect([partly.rate, partly.partial]).toStrictEqual([2, true]);
    const none = m.componentLineCost(recLine('MYSTERY', 1), TABLES);
    expect([none.rate, none.cost, none.reason]).toStrictEqual([null, null, 'no-recipe-cost']);
    expect(m.componentLineCost(recLine('GONE', 1), TABLES).reason).toBe('missing-recipe');
  });

  test('an ingredient by weight: a price per kilo, in grams or kilos', () => {
    const grams = m.componentLineCost(ingLine('SALT', 2, 'g'), TABLES);
    expect([grams.rate, grams.rateUnit, grams.cost]).toStrictEqual([1.5, 'kg', 0.003]);
    const kilos = m.componentLineCost(ingLine('FLOUR', 3, 'kg'), TABLES);
    expect([kilos.rate, kilos.rateUnit, kilos.cost]).toStrictEqual([2, 'kg', 6]);
  });

  test('pieces: priced each → each; priced by the kilo with a piece weight → per kilo', () => {
    const each = m.componentLineCost(ingLine('SPRINKLE', 10, 'pcs'), TABLES);
    expect([each.rate, each.rateUnit, each.cost]).toStrictEqual([0.02, 'pcs', 0.2]);
    const eggs = m.componentLineCost(ingLine('EGG', 4, 'pcs'), TABLES);
    expect([eggs.rate, eggs.rateUnit, eggs.cost]).toStrictEqual([0.25, 'pcs', 1]);
    const nibs = m.componentLineCost(ingLine('NIB', 4, 'pcs'), TABLES);
    expect([nibs.rate, nibs.rateUnit, nibs.cost]).toStrictEqual([10, 'kg', 2]);
    // The same egg counted in grams is a price per kilo (0.25 / 0.06 kg).
    const eggGrams = m.componentLineCost(ingLine('EGG', 120, 'g'), TABLES);
    expect(eggGrams.rateUnit).toBe('kg');
    expect(eggGrams.cost as number).toBeGreaterThan(0);
  });

  test('a price that exists but cannot be used keeps the rate it has, and no cost', () => {
    const noWeight = m.componentLineCost(ingLine('SPRINKLE', 5, 'g'), TABLES);
    expect([noWeight.reason, noWeight.rate, noWeight.rateUnit, noWeight.cost]).toStrictEqual(['no-piece-weight', 0.02, 'pcs', null]);
    const noPiece = m.componentLineCost(ingLine('ICING', 5, 'pcs'), TABLES);
    expect([noPiece.reason, noPiece.rate, noPiece.rateUnit, noPiece.cost]).toStrictEqual(['no-piece-price', 4, 'kg', null]);
    const nothing = m.componentLineCost(ingLine('RIBBON', 5, 'g'), TABLES);
    expect([nothing.reason, nothing.rate, nothing.cost]).toStrictEqual(['no-ingredient-price', null, null]);
    expect(m.componentLineCost(ingLine('GONE', 5, 'g'), TABLES).reason).toBe('missing-ingredient');
  });

  test('ONE place costs a line: batchTotals rows carry exactly componentLineCost\'s numbers', () => {
    const components = [recLine('DOUGH', 2), recLine('CREAM', 1), recLine('MYSTERY', 1), recLine('GONE', 1),
      ingLine('SALT', 2, 'g'), ingLine('EGG', 4, 'pcs'), ingLine('SPRINKLE', 5, 'g'), ingLine('GONE', 1, 'kg')];
    const batch = m.batchTotals(product(components), TABLES);
    components.forEach((component, i) => {
      const line = m.componentLineCost(component, TABLES);
      expect(batch.rows[i]?.cost, `row ${i} cost`).toBe(line.cost);
      expect(batch.rows[i]?.reason, `row ${i} reason`).toBe(line.reason);
    });
    // 5 + 2 (Cream: 1 kg × 2) + 0.003 + 1 — the lines that could be costed, and only those.
    expect([batch.cost, batch.kg, batch.partial]).toStrictEqual([8.003, 3.242, true]);
    expect(batch.rows[3]).toStrictEqual({ kind: 'recipe', id: 'GONE', name: '', qty: 1, cost: null, reason: 'missing-recipe' });
    expect(batch.rows[0]).toStrictEqual({ kind: 'recipe', id: 'DOUGH', name: 'Dough', qty: 2, cost: 5, reason: null });
    expect(batch.rows[4]).toStrictEqual({ kind: 'ingredient', id: 'SALT', name: 'Salt', qty: 2, unit: 'g', cost: 0.003, reason: null });
  });

  test('a null table no longer throws: every line is then «gone»', () => {
    const batch = m.batchTotals(product([recLine('DOUGH', 1), ingLine('FLOUR', 1, 'kg')]), { ingredients: null, recipes: null });
    expect([batch.cost, batch.partial]).toStrictEqual([0, true]);
  });

  // ── packagingLineCost ────────────────────────────────────────────────────────

  test('packaging priced each: the rate each and pieces × each', () => {
    const line = m.packagingLineCost({ qtyPcs: 3 }, ING.BOX);
    expect([line.rate, line.rateUnit, line.cost, line.reason]).toStrictEqual([0.12, 'pcs', 0.36, null]);
  });

  test('packaging with NO price is null and a reason, never 0; priced by weight keeps its per-kilo rate', () => {
    const none = m.packagingLineCost({ qtyPcs: 3 }, ING.RIBBON);
    expect([none.rate, none.rateUnit, none.cost, none.reason]).toStrictEqual([null, null, null, 'no-price']);
    const byWeight = m.packagingLineCost({ qtyPcs: 3 }, ING.FILM);
    expect([byWeight.rate, byWeight.rateUnit, byWeight.cost, byWeight.reason]).toStrictEqual([3, 'kg', null, 'no-piece-price']);
  });

  test('packagingPerUnit still reports both as «no-piece-price» and counts the priced ones', () => {
    const out = m.packagingPerUnit(product([], { packaging: [
      { ingredientId: 'BOX', qtyPcs: 2 }, { ingredientId: 'RIBBON', qtyPcs: 1 }, { ingredientId: 'FILM', qtyPcs: 1 },
    ] }), TABLES);
    expect([out.cost, out.partial]).toStrictEqual([0.24, true]);
    expect(out.rows.map(r => r.reason)).toStrictEqual([null, 'no-piece-price', 'no-piece-price']);
  });

  // ── unpricedParts ────────────────────────────────────────────────────────────

  test('product lines that cannot be costed are listed with the reason; a gone item under the card’s own words', () => {
    expect(parts([ingLine('RIBBON', 1, 'g'), ingLine('SPRINKLE', 5, 'g'), ingLine('ICING', 5, 'pcs'), ingLine('GONE', 1, 'g')])).toStrictEqual([
      { name: 'Ribbon', inRecipe: '', reason: 'no-ingredient-price' },
      { name: 'Sprinkle', inRecipe: '', reason: 'no-piece-weight' },
      { name: 'Icing', inRecipe: '', reason: 'no-piece-price' },
      { name: 'This item no longer exists', inRecipe: '', reason: 'gone' },
    ]);
    expect(parts([ingLine('SALT', 1, 'g'), recLine('DOUGH', 1)]), 'nothing missing, nothing listed').toStrictEqual([]);
  });

  test('packaging with no usable price is listed; so is packaging with no way of selling chosen — once', () => {
    const list = parts([recLine('DOUGH', 1)], { packaging: [
      { ingredientId: 'RIBBON', qtyPcs: 1 }, { ingredientId: 'FILM', qtyPcs: 1 }, { ingredientId: 'BOX', qtyPcs: 1 },
    ] });
    expect(list).toStrictEqual([
      { name: 'Ribbon', inRecipe: '', reason: 'packaging-no-price' },
      { name: 'Film', inRecipe: '', reason: 'no-piece-price' },
    ]);
    const noMode = parts([recLine('DOUGH', 1)], { sellingMode: null, packaging: [
      { ingredientId: 'BOX', qtyPcs: 1 }, { ingredientId: 'BOX', qtyPcs: 2 },
    ] });
    expect(noMode).toHaveLength(1);
    expect(noMode[0]?.reason).toBe('packaging-no-mode');
    expect(noMode[0]?.name.length).toBeGreaterThan(0);
  });

  test('the rows inside a partly priced recipe are listed with the recipe they are in', () => {
    expect(parts([recLine('CREAM', 1)])).toStrictEqual([{ name: 'Water', inRecipe: 'Cream', reason: 'not-linked' }]);
  });

  test('a sub-recipe is OPENED, priced or not, recursively', () => {
    // Cake → Filling (priced, partly: it holds Cream) → Cream's Water.
    expect(parts([recLine('CAKE', 1)])).toStrictEqual([{ name: 'Water', inRecipe: 'Cream', reason: 'not-linked' }]);
  });

  test('a recipe with no price and nothing labelled to list is listed itself', () => {
    expect(parts([recLine('EMPTY', 1)])).toStrictEqual([{ name: 'Empty', inRecipe: '', reason: 'recipe-no-price' }]);
    // …while one with a labelled unpriced row lists the row instead.
    expect(parts([recLine('MYSTERY', 1)])).toStrictEqual([{ name: 'Something', inRecipe: 'Mystery', reason: 'not-linked' }]);
  });

  test('a loop of recipes ends: the row is listed as itself, with the model\'s own reason', () => {
    const list = parts([recLine('LA', 1)]);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every(item => item.name && item.reason)).toBe(true);
  });

  test('the same unpriced thing is listed once, and the order is the card\'s', () => {
    const list = parts([recLine('CREAM', 1), ingLine('RIBBON', 1, 'g'), recLine('CREAM', 2)]);
    expect(list.map(item => item.name)).toStrictEqual(['Water', 'Ribbon']);
  });

  test('a labelled row in pieces or spoons is listed: it is what makes the warning stand', () => {
    const ODD: Doc = { id: 'ODD', name: 'Odd', lossPct: 0, ingredients: [flourRow(100), { label: 'Salt', grams: 2, unit: 'tsp', kind: 'ingredient', refId: 'SALT' }] };
    const tables = { ...TABLES, recipes: { ...(TABLES.recipes as Doc), ODD } };
    const batch = m.batchTotals(product([recLine('ODD', 1)]), tables);
    // The recipe model calls a labelled spoon row «partial», so the card shows its warning — and a «Which?»
    // with nothing under it, or no button at all, would leave the warning unexplained.
    expect(batch.partial).toBe(true);
    expect(unpricedOf(m, product([recLine('ODD', 1)]), tables)).toStrictEqual([{ name: 'Salt', inRecipe: 'Odd', reason: 'not-weighable' }]);
  });

  test('productPreview carries the list; it is empty for no product', () => {
    const preview = previewOf(m, product([recLine('CREAM', 1)]), TABLES);
    expect(preview.partial).toBe(true);
    expect(preview.unpriced).toStrictEqual([{ name: 'Water', inRecipe: 'Cream', reason: 'not-linked' }]);
    expect(previewOf(m, null, TABLES).unpriced).toStrictEqual([]);
  });

  test('every unpriced reason becomes words, in both languages', () => {
    for (const lang of ['en', 'it']) {
      setLanguage(lang);
      for (const reason of ['no-ingredient-price', 'packaging-no-price', 'no-piece-weight', 'no-piece-price',
        'packaging-no-mode', 'recipe-no-price', 'not-weighable', 'not-linked', 'sub-not-costable', 'missing-recipe', 'cycle', 'too-deep']) {
        expect(reasonText(m, reason), `${reason} in ${lang}`).toBeTruthy();
      }
    }
  });

  test('a line or packaging whose item no longer exists is listed (it makes the cost partial too)', () => {
    setLanguage('it');
    const list = parts([recLine('DOUGH', 1), ingLine('GONE', 5, 'g'), recLine('NOPE', 1)], { packaging: [{ ingredientId: 'GONE2', qtyPcs: 1 }] });
    const preview = previewOf(m, product([recLine('DOUGH', 1), ingLine('GONE', 5, 'g')]), TABLES);
    setLanguage('en');
    expect(list.every(item => item.name && item.reason === 'gone')).toBe(true);
    expect(list.map(i => i.name)).toStrictEqual(['Questa voce non esiste più', 'Questa ricetta non esiste più']);
    expect(preview.partial).toBe(true);
    expect(preview.unpriced, 'the warning always has something under «Which?»').toHaveLength(1);
  });

  test('packaging with a way of selling chosen but not complete gets «finish it», not «choose one»', () => {
    const list = parts([recLine('DOUGH', 1)], { piecesPerBatch: null, packaging: [{ ingredientId: 'BOX', qtyPcs: 1 }] });
    expect(list.map(i => i.reason)).toStrictEqual(['packaging-no-units']);
    expect(reasonText(m, 'packaging-no-units')).toBeTruthy();
    expect(reasonText(m, 'gone')).toBeTruthy();
  });

  test('an UNLABELLED row pointing at an unpriced sub-recipe lists nothing: it is not partial', () => {
    const SUB: Doc = { id: 'SUB', name: 'Sub', lossPct: 0, ingredients: [{ label: 'Water', grams: 100, unit: 'g' }] };
    const TOP: Doc = { id: 'TOP', name: 'Top', lossPct: 0, ingredients: [flourRow(500), { label: '', grams: 100, unit: 'g', kind: 'recipe', refId: 'SUB' }] };
    const tables = { ...TABLES, recipes: { ...(TABLES.recipes as Doc), SUB, TOP } };
    const preview = previewOf(m, product([recLine('TOP', 1)]), tables);
    expect(preview.partial).toBe(false);
    expect(preview.unpriced).toStrictEqual([]);
  });

  test('ingredientLineCost is untouched by the new helper', () => {
    expect(m.ingredientLineCost({ qty: 4, unit: 'pcs' }, ING.EGG)).toStrictEqual({ cost: 1, kg: 0.24, reason: null });
  });
});

describe('the port against the original, for the words', () => {
  test('a reason the dictionary does not know gives nothing, as the original does', () => {
    for (const reason of [undefined, null, 5, '', 'nope', 'toString', '__proto__']) {
      expect(ported.unpricedReasonText(reason, t), String(reason)).toBe((legacyJs.unpricedReasonText as unknown as (r: unknown) => string)(reason));
    }
  });
});
