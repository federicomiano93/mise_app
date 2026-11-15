// Unit tests for «Cost per 1 kg»: one kilo of a product, line by line (P15 — the owner cannot read code, so these tests are the
// safety net), run against BOTH implementations: the TypeScript port in shared/ and js/foodcost/per-kg-model.js, which the live app
// uses today. Ported from tests/foodcost-per-kg.test.mjs (all 19). Each side is run with its OWN foodcost-model, as the app is. The
// module is a FULL port, so parity.spec.ts also compares its exports name by name; the last block here compares the two on every
// case of this file, row by row.
//
// Federico, 4 Nov 2026: every ingredient's weight scaled to one kilo of the product, with its price per kilo and what the line
// costs; recipes opened into their own ingredients; an unpriced row shown as not counted; the total = the card's own cost. These
// tests pin the arithmetic, the one-row-per-ingredient merge, the inherited unlinked-row quirk, and that the total is the card's
// figure rather than a second sum. Fake data only.

import { describe, expect, test } from 'vitest';
import * as ported from './per-kg-model';
import * as portedCard from './foodcost-model';
import * as legacyJs from '../../js/foodcost/per-kg-model.js';
import * as legacyCardJs from '../../js/foodcost/foodcost-model.js';

const legacy = legacyJs as unknown as typeof ported;
const legacyCard = legacyCardJs as unknown as typeof portedCard;

type Doc = Record<string, unknown>;

const near = (actual: number | null, expected: number, eps = 1e-3): void => {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual as number) - expected), `${actual} is not ${expected}`).toBeLessThan(eps);
};
const sumOf = (rows: ported.PerKgRow[], field: 'kg' | 'pcs' | 'cost'): number => rows.reduce((s, r) => s + (r[field] || 0), 0);
const counted = (result: ported.PerKgResult): ported.PerKgRow[] => result.rows.filter(r => !r.reason);
const named = (result: ported.PerKgResult, name: string): ported.PerKgRow | undefined => result.rows.find(r => r.name === name);
const row = (result: ported.PerKgResult, name: string): ported.PerKgRow => {
  const found = named(result, name);
  expect(found, `a row named ${name}`).toBeDefined();
  return found as ported.PerKgRow;
};

const INGREDIENTS: Record<string, Doc> = {
  FLOUR: { id: 'FLOUR', name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 },
  BUTTER: { id: 'BUTTER', name: 'Butter', priceUnit: 'kg', pricePerUnit: 8 },
  SUGAR: { id: 'SUGAR', name: 'Sugar', shortName: 'Icing sugar', priceUnit: 'kg', pricePerUnit: 3 },
  MILK: { id: 'MILK', name: 'Milk', priceUnit: 'l', pricePerUnit: 1.5 },
  EGG: { id: 'EGG', name: 'Egg', priceUnit: 'pcs', pricePerUnit: 0.3, unitWeightKg: 0.06 },
  CHERRY: { id: 'CHERRY', name: 'Cherry', priceUnit: 'pcs', pricePerUnit: 0.05 },
  BAG: { id: 'BAG', name: 'Paper bag', priceUnit: 'pcs', pricePerUnit: 0.1 },
  FILM: { id: 'FILM', name: 'Film', priceUnit: 'kg', pricePerUnit: 4 },
  NOPRICE: { id: 'NOPRICE', name: 'Vanilla' },
};
// 3.20 per kilo with no loss.
const DOUGH: Doc = {
  id: 'DOUGH', name: 'Dough', lossPct: 0,
  ingredients: [
    { label: 'Flour', grams: 800, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Butter', grams: 200, unit: 'g', kind: 'ingredient', refId: 'BUTTER' },
  ],
};
const LOSSY: Doc = { ...DOUGH, id: 'LOSSY', name: 'Lossy dough', lossPct: 20 };
// Water not linked to anything: the inherited quirk.
const WET: Doc = {
  id: 'WET', name: 'Wet dough', lossPct: 0,
  ingredients: [
    { label: 'Flour', grams: 600, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Water', grams: 400, unit: 'g' },
  ],
};
// A cream, used INSIDE the filled dough below: flour again, milk, and a pinch of nothing.
const CREAM: Doc = {
  id: 'CREAM', name: 'Cream', lossPct: 0,
  ingredients: [
    { label: 'Milk', grams: 800, unit: 'g', kind: 'ingredient', refId: 'MILK' },
    { label: 'Flour', grams: 200, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Salt', grams: 1, unit: 'pinch' },
    { label: '', grams: 0, unit: 'g' },
  ],
};
const FILLED: Doc = {
  id: 'FILLED', name: 'Filled dough', lossPct: 0,
  ingredients: [
    { label: 'Flour', grams: 500, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Cream', grams: 500, unit: 'g', kind: 'recipe', refId: 'CREAM' },
  ],
};
const UNPRICED: Doc = { id: 'UNPRICED', name: 'Mystery', lossPct: 0, ingredients: [{ label: 'Something', grams: 500, unit: 'g' }] };
const LOOP: Doc = {
  id: 'LOOP', name: 'Loop', lossPct: 0,
  ingredients: [
    { label: 'Flour', grams: 500, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Itself', grams: 500, unit: 'g', kind: 'recipe', refId: 'LOOP' },
  ],
};
const TABLES = {
  ingredients: INGREDIENTS,
  recipes: { DOUGH, LOSSY, WET, CREAM, FILLED, UNPRICED, LOOP } as Record<string, Doc>,
};

const product = (over: Doc = {}): Doc => ({
  id: 'P1', name: 'Test product',
  components: [{ recipeId: 'DOUGH', qtyKg: 10 }],
  packaging: [],
  sellingMode: 'piece', piecesPerBatch: 100,
  sellingPrice: 1.2, vatRate: 20, foodCostTarget: 30,
  ...over,
});

const depthChain = (): Record<string, Doc> => {
  const chain: Record<string, Doc> = {};
  for (let i = 1; i <= 5; i++) {
    chain[`C${i}`] = { id: `C${i}`, name: `Level ${i}`, lossPct: 10, ingredients: [
      { label: 'Flour', grams: 500, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
      ...(i < 5 ? [{ label: `Level ${i + 1}`, grams: 500, unit: 'g', kind: 'recipe', refId: `C${i + 1}` }] : []),
    ] };
  }
  return chain;
};

describe.each([
  ['shared/ (TypeScript)', ported, portedCard],
  ['js/ (current app)', legacy, legacyCard],
] as const)('%s', (_name, m, card) => {
  // The total is the card's figure: its batch cost over its batch kilos.
  function cardPerKg(p: Doc, tables = TABLES): number {
    const cost = card.productionCost(p, tables);
    return (cost.batchCost as number) / cost.batch.kg;
  }

  test('one recipe: each ingredient scaled to one kilo, its price per kilo and its cost', () => {
    const result = m.costPerKg(product(), TABLES);
    expect(result.kg).toBe(10);
    expect(result.rows.length).toBe(2);
    expect(row(result, 'Flour')).toStrictEqual({
      key: 'ing:FLOUR', kind: 'ingredient', name: 'Flour',
      kg: 0.8, pcs: null, pricePerKg: 2, priceEach: null, cost: 1.6, reason: null,
    });
    expect(row(result, 'Butter').kg).toBe(0.2);
    expect(row(result, 'Butter').cost).toBe(1.6);
    expect(result.total).toBe(3.2);
    expect(result.partial).toBe(false);
  });

  test('the total is the card\'s own cost per kilo, and the lines add up to it', () => {
    const cases = [
      product(),
      product({ components: [{ recipeId: 'LOSSY', qtyKg: 3.7 }] }),
      product({ components: [{ recipeId: 'FILLED', qtyKg: 2.3 }, { recipeId: 'DOUGH', qtyKg: 1.1 }] }),
      product({ components: [{ recipeId: 'WET', qtyKg: 5 }, { kind: 'ingredient', ingredientId: 'SUGAR', qty: 150, unit: 'g' }] }),
      product({ sellingMode: 'weight', packaging: [{ ingredientId: 'BAG', qtyPcs: 2 }] }),
      product({ packaging: [{ ingredientId: 'BAG', qtyPcs: 1 }] }),
    ];
    for (const p of cases) {
      const result = m.costPerKg(p, TABLES);
      near(result.total, cardPerKg(p));
      near(sumOf(counted(result), 'cost'), result.total as number);
    }
  });

  test('sold by the kilo, the total is exactly the cost per kilo the card shows', () => {
    const p = product({ sellingMode: 'weight', packaging: [{ ingredientId: 'BAG', qtyPcs: 2 }] });
    const cost = card.productionCost(p, TABLES);
    expect(cost.unit).toBe('kg');
    expect(m.costPerKg(p, TABLES).total).toBe(cost.unitCost);
  });

  test('an oven loss: more than a kilo of ingredients for a kilo of product', () => {
    const result = m.costPerKg(product({ components: [{ recipeId: 'LOSSY', qtyKg: 10 }] }), TABLES);
    // 1 kg out of a recipe that loses 20% takes 1.25 kg in.
    near(sumOf(result.rows, 'kg'), 1.25, 1e-6);
    near(row(result, 'Flour').kg, 1.0, 1e-6);
    near(result.total, 4.0);
    expect(result.lossy).toBe(true);
    expect(m.costPerKg(product(), TABLES).lossy).toBe(false);
  });

  test('a finished product (no weight loss) lays the loss aside, as the card does', () => {
    const p = product({ components: [{ recipeId: 'LOSSY', qtyKg: 10 }], noWeightLoss: true });
    const result = m.costPerKg(p, TABLES);
    near(sumOf(result.rows, 'kg'), 1, 1e-6);
    expect(result.total).toBe(3.2);
    expect(result.lossy).toBe(false);
    near(result.total, cardPerKg(p));
  });

  test('a recipe inside a recipe is opened into its own ingredients, one row per ingredient', () => {
    const result = m.costPerKg(product({ components: [{ recipeId: 'FILLED', qtyKg: 4 }] }), TABLES);
    // Flour: 500 g of the dough plus 200 g of the cream's 1000 g in the other 500 g.
    near(row(result, 'Flour').kg, 0.6, 1e-6);
    near(row(result, 'Milk').kg, 0.4, 1e-6);
    expect(result.rows.filter(r => r.name === 'Flour').length).toBe(1);
    expect(named(result, 'Cream'), 'the recipe is opened, never a line of its own').toBeUndefined();
    // The pinch of salt cannot be weighed: shown, not counted, no weight; the blank line not at all.
    const salt = row(result, 'Salt');
    expect(salt.reason).toBe('not-weighed');
    expect(salt.kg).toBeNull();
    expect(salt.cost).toBeNull();
    expect(result.rows.some(r => r.name === '')).toBe(false);
  });

  test('an unlinked row (water) is shown with its weight and NOT counted — the inherited quirk', () => {
    const result = m.costPerKg(product({ components: [{ recipeId: 'WET', qtyKg: 10 }] }), TABLES);
    const water = row(result, 'Water');
    expect(water.reason).toBe('no-price');
    expect(water.cost).toBeNull();
    expect(water.pricePerKg).toBeNull();
    // ⚠️ The cost model gives the water no weight, so the recipe's price per kilo is that of its flour alone (2.00 instead of 1.20)
    // and every row is scaled as if the flour were the whole kilo. Pinned so the day it is corrected, it is corrected on purpose.
    near(row(result, 'Flour').kg, 1, 1e-6);
    near(water.kg, 400 / 600, 1e-6);
    expect(result.total).toBe(2);
    expect(result.partial).toBe(true);
  });

  test('an ingredient with no price on it is shown and not counted', () => {
    const result = m.costPerKg(product({ components: [
      { recipeId: 'DOUGH', qtyKg: 10 },
      { kind: 'ingredient', ingredientId: 'NOPRICE', qty: 50, unit: 'g' },
    ] }), TABLES);
    const vanilla = row(result, 'Vanilla');
    expect(vanilla.reason).toBe('no-price');
    // POST-SWITCH (10 Nov 2026, «il calo è del prodotto»): change C moves it. The vanilla has no price but a known weight,
    // so the batch weighs 10 + 0.05 = 10.05 kg (js/: 10) and everything divided by it moves: the same 32 of dough over
    // 10.05 kg is 3.1841 a kilo (js/: 3.2), and the vanilla is 0.05 / 10.05 = 0.004975 kg of it (js/: 0.005).
    near(vanilla.kg, m === ported ? 0.05 / 10.05 : 0.005, m === ported ? 1e-6 : 1e-9);
    expect(result.partial).toBe(true);
    expect(result.total).toBe(m === ported ? 3.1841 : 3.2);
  });

  test('an ingredient straight on the product: its own name, by weight or by the piece', () => {
    const result = m.costPerKg(product({ components: [
      { recipeId: 'DOUGH', qtyKg: 9.8 },
      { kind: 'ingredient', ingredientId: 'SUGAR', qty: 200, unit: 'g' },
      { kind: 'ingredient', ingredientId: 'CHERRY', qty: 100, unit: 'pcs' },
      { kind: 'ingredient', ingredientId: 'EGG', qty: 10, unit: 'pcs' },
    ] }), TABLES);
    // Batch: 9.8 kg dough + 0.2 kg sugar + 0.6 kg of eggs (the cherries weigh nothing known).
    expect(result.kg).toBe(10.6);
    const sugar = row(result, 'Icing sugar');
    near(sugar.kg, 0.2 / 10.6, 1e-6);
    expect(sugar.pricePerKg).toBe(3);
    const cherry = row(result, 'Cherry');
    expect(cherry.kind).toBe('piece');
    near(cherry.pcs, 100 / 10.6, 1e-3);
    expect(cherry.priceEach).toBe(0.05);
    expect(cherry.kg).toBeNull();
    const egg = row(result, 'Egg');
    expect(egg.kind).toBe('piece');
    near(egg.kg, 0.6 / 10.6, 1e-6);
    near(sumOf(counted(result), 'cost'), result.total as number);
  });

  test('a recipe with no price on the product is one line, not counted', () => {
    const result = m.costPerKg(product({ components: [{ recipeId: 'DOUGH', qtyKg: 8 }, { recipeId: 'UNPRICED', qtyKg: 2 }] }), TABLES);
    const mystery = row(result, 'Mystery');
    expect(mystery.reason).toBe('no-recipe');
    // POST-SWITCH (10 Nov 2026, «il calo è del prodotto»): change C moves it. The unpriced recipe still weighs what it
    // weighs, so the batch is 8 + 2 = 10 kg (js/: the dough's 8 alone) and the Mystery is 2 / 10 = 0.2 kg of a kilo (js/:
    // 2 / 8 = 0.25).
    expect(result.kg).toBe(m === ported ? 10 : 8);
    near(mystery.kg, m === ported ? 0.2 : 0.25, 1e-6);
    expect(result.partial).toBe(true);
  });

  test('a recipe that contains itself is not counted, and nothing hangs', () => {
    const p = product({ components: [{ recipeId: 'DOUGH', qtyKg: 10 }, { recipeId: 'LOOP', qtyKg: 1 }] });
    const result = m.costPerKg(p, TABLES);
    // The loop's flour is costed; the row pointing back at itself is shown, not counted.
    near(result.total, cardPerKg(p));
    expect(row(result, 'Itself').reason).toBe('no-recipe');
    expect(result.partial).toBe(true);
  });

  test('packaging: so many pieces per kilo, once the way of selling says how many units', () => {
    const byPiece = m.costPerKg(product({ packaging: [{ ingredientId: 'BAG', qtyPcs: 1 }] }), TABLES);
    const bag = row(byPiece, 'Paper bag');
    expect(bag.kind).toBe('packaging');
    // 100 pieces from 10 kg: 10 bags in a kilo, 0.10 each.
    expect(bag.pcs).toBe(10);
    expect(bag.cost).toBe(1);
    expect(bag.kg).toBeNull();
    expect(byPiece.total).toBe(4.2);

    const notSold = m.costPerKg(product({ sellingMode: null, packaging: [{ ingredientId: 'BAG', qtyPcs: 1 }] }), TABLES);
    expect(notSold.packagingLeftOut).toBe(true);
    expect(notSold.partial).toBe(true);
    expect(named(notSold, 'Paper bag')).toBeUndefined();
    expect(notSold.total).toBe(3.2);

    const byWeight = m.costPerKg(product({ packaging: [{ ingredientId: 'FILM', qtyPcs: 1 }] }), TABLES);
    expect(row(byWeight, 'Film').reason).toBe('no-piece-price');
  });

  test('nothing costed, or nothing weighed: no total — never a kilo that reads as free', () => {
    expect(m.costPerKg(product({ components: [] }), TABLES).total).toBeNull();
    expect(m.costPerKg(product({ components: [{ recipeId: 'UNPRICED', qtyKg: 5 }] }), TABLES).total).toBeNull();
    expect(m.costPerKg(product({ components: [{ recipeId: 'DOUGH', qtyKg: 0 }] }), TABLES).total).toBeNull();
    // Only pieces of unknown weight: a cost, but no kilo to divide it by.
    expect(m.costPerKg(product({ components: [{ kind: 'ingredient', ingredientId: 'CHERRY', qty: 10, unit: 'pcs' }] }), TABLES).total).toBeNull();
    expect(m.costPerKg(null, TABLES).total).toBeNull();
    expect(m.costPerKg(undefined).rows).toStrictEqual([]);
  });

  test('the weighings typed on the card count: the tables it is given are the tables used', () => {
    const live = { ...TABLES, recipes: { ...TABLES.recipes, DOUGH: { ...DOUGH, lossPct: 20 } } };
    const result = m.costPerKg(product(), live);
    near(sumOf(result.rows, 'kg'), 1.25, 1e-6);
    near(result.total, 4);
  });

  test('an ingredient that HAS a price is never called «no price»: the piece weight or price is named', () => {
    const ing = {
      ...INGREDIENTS,
      TOPPING: { id: 'TOPPING', name: 'Topping', priceUnit: 'pcs', pricePerUnit: 0.2 },
      NUT: { id: 'NUT', name: 'Nut', priceUnit: 'kg', pricePerUnit: 12 },
    };
    const result = m.costPerKg(product({ components: [
      { recipeId: 'DOUGH', qtyKg: 10 },
      { kind: 'ingredient', ingredientId: 'TOPPING', qty: 50, unit: 'g' },
      { kind: 'ingredient', ingredientId: 'NUT', qty: 5, unit: 'pcs' },
    ], packaging: [{ ingredientId: 'FILM', qtyPcs: 1 }] }), { ...TABLES, ingredients: ing });
    expect(row(result, 'Topping').reason).toBe('no-piece-weight');
    expect(row(result, 'Nut').reason).toBe('no-piece-price');
    expect(row(result, 'Film').reason).toBe('no-piece-price');
  });

  test('a line with no amount yet is not a row', () => {
    const result = m.costPerKg(product({ components: [
      { recipeId: 'DOUGH', qtyKg: 10 },
      { kind: 'ingredient', ingredientId: 'SUGAR', qty: 0, unit: 'g' },
    ], packaging: [{ ingredientId: 'BAG', qtyPcs: 0 }] }), TABLES);
    expect(named(result, 'Icing sugar')).toBeUndefined();
    expect(named(result, 'Paper bag')).toBeUndefined();
  });

  test('a chain past the depth limit ends in a row not counted, and the total is still the card\'s', () => {
    const tables = { ...TABLES, recipes: { ...TABLES.recipes, ...depthChain() } };
    const p = product({ components: [{ recipeId: 'C1', qtyKg: 3 }] });
    const result = m.costPerKg(p, tables);
    expect(row(result, 'Level 5').reason).toBe('no-recipe');
    near(result.total, cardPerKg(p, tables));
    near(sumOf(counted(result), 'cost'), result.total as number);
  });

  test('Map tables work as well as plain objects', () => {
    const tables = { ingredients: new Map(Object.entries(INGREDIENTS)), recipes: new Map(Object.entries(TABLES.recipes)) };
    const result = m.costPerKg(product({ components: [{ recipeId: 'FILLED', qtyKg: 4 }] }), tables);
    near(row(result, 'Flour').kg, 0.6, 1e-6);
    near(sumOf(counted(result), 'cost'), result.total as number);
  });

  test('the reasons the block can give are frozen and exactly these five', () => {
    expect([...m.PER_KG_REASONS]).toStrictEqual(['no-price', 'not-weighed', 'no-recipe', 'no-piece-weight', 'no-piece-price']);
    expect(Object.isFrozen(m.PER_KG_REASONS)).toBe(true);
  });
});

// POST-SWITCH (11 Nov 2026, «solo l'impasto»): Federico decided the cost of 1 kg is the DOUGH only — the lines of «Made of», no
// packaging. Mise 2's screens call costPerKg with `{ packaging: false }`; js/ has no such option (it ignores a third argument),
// so these run against the port alone. Without the option the answer is still the original's (the block above, both files).
describe('POST-SWITCH: the dough only ({ packaging: false }), the port alone', () => {
  const doughOnly = { packaging: false } as const;
  const BOXED_TABLES = { ...TABLES, ingredients: { ...INGREDIENTS, BOX: { id: 'BOX', name: 'Box', priceUnit: 'pcs', pricePerUnit: 0.3 } } };
  // Federico's example: a kilo of flour (2.00), a box at 0.30 on each of the 10 pieces, 900 g out of the oven (model 3).
  const bun = (over: Doc = {}): Doc => product({
    components: [{ kind: 'ingredient', ingredientId: 'FLOUR', qty: 1000, unit: 'g' }],
    packaging: [{ ingredientId: 'BOX', qtyPcs: 1 }],
    piecesPerBatch: 10, cookedGrams: 900, model: 3,
    ...over,
  });

  test('Federico\'s example: 2.00 of flour over 900 g cooked is 2.2222 a kilo, not (2.00 + 3.00) ÷ 0.9 = 5.5556', () => {
    expect(ported.costPerKg(bun(), BOXED_TABLES).total, 'with the packaging, as the current app counts it').toBe(5.5556);
    const result = ported.costPerKg(bun(), BOXED_TABLES, doughOnly);
    expect(result).toStrictEqual({
      kg: 0.9, total: 2.2222, partial: false, packagingLeftOut: false, lossy: true,
      rows: [{ key: 'ing:FLOUR', kind: 'ingredient', name: 'Flour', kg: 1.111111, pcs: null, pricePerKg: 2, priceEach: null, cost: 2.2222, reason: null }],
    });
  });

  test('the packaging is ignored: no packaging row, the total is the lines\' batch cost ÷ kg, and the rows add up to it', () => {
    const cases = [
      bun(),
      bun({ sellingMode: 'weight', piecesPerBatch: null }),
      bun({ sellingMode: null, piecesPerBatch: null }),
      product({ packaging: [{ ingredientId: 'BAG', qtyPcs: 1 }, { ingredientId: 'FILM', qtyPcs: 1 }, { ingredientId: 'NOPRICE', qtyPcs: 1 }] }),
      product({ components: [{ recipeId: 'FILLED', qtyKg: 2.3 }, { recipeId: 'DOUGH', qtyKg: 1.1 }], packaging: [{ ingredientId: 'BAG', qtyPcs: 2 }] }),
    ];
    for (const p of cases) {
      const result = ported.costPerKg(p, BOXED_TABLES, doughOnly);
      const batch = portedCard.batchTotals(p, BOXED_TABLES);
      near(result.total, batch.cost / batch.kg);
      near(sumOf(counted(result), 'cost'), result.total as number);
      expect(result.rows.some(r => r.kind === 'packaging'), JSON.stringify(p)).toBe(false);
      expect(result.packagingLeftOut).toBe(false);
    }
    // The default is unchanged: the packaging is in, and so is its row.
    expect(ported.costPerKg(product({ packaging: [{ ingredientId: 'BAG', qtyPcs: 1 }] }), TABLES).total).toBe(4.2);
    expect(ported.costPerKg(product({ packaging: [{ ingredientId: 'BAG', qtyPcs: 1 }] }), TABLES, doughOnly).total).toBe(3.2);
    expect(ported.costPerKg(product({ packaging: [{ ingredientId: 'BAG', qtyPcs: 1 }] }), TABLES, { packaging: true }).total).toBe(4.2);
  });

  test('partial: a line of «Made of» with no cost makes it partial; a packaging item with none, or no way of selling, does not', () => {
    const vanilla = ported.costPerKg(bun({ components: [
      { kind: 'ingredient', ingredientId: 'FLOUR', qty: 1000, unit: 'g' },
      { kind: 'ingredient', ingredientId: 'NOPRICE', qty: 50, unit: 'g' },
    ] }), BOXED_TABLES, doughOnly);
    expect(vanilla.partial).toBe(true);
    expect(row(vanilla, 'Vanilla').reason).toBe('no-price');
    // 2.00 over the 900 g cooked: the vanilla's 50 g weigh in the raw dough, not in what came out.
    expect(vanilla.total).toBe(2.2222);

    const film = bun({ packaging: [{ ingredientId: 'FILM', qtyPcs: 1 }] });
    expect(ported.costPerKg(film, BOXED_TABLES).partial, 'with the packaging').toBe(true);
    expect(ported.costPerKg(film, BOXED_TABLES, doughOnly).partial).toBe(false);
    const notSold = bun({ sellingMode: null, piecesPerBatch: null });
    expect(ported.costPerKg(notSold, BOXED_TABLES).packagingLeftOut, 'with the packaging').toBe(true);
    expect(ported.costPerKg(notSold, BOXED_TABLES, doughOnly)).toMatchObject({ partial: false, packagingLeftOut: false, total: 2.2222 });
  });

  test('no oven loss: the dough\'s cost over the raw dough', () => {
    const result = ported.costPerKg(bun({ cookedGrams: null }), BOXED_TABLES, doughOnly);
    expect([result.kg, result.total, result.lossy]).toStrictEqual([1, 2, false]);
  });

  test('a cooked weight heavier than the raw one: no kilo at all, with or without the packaging', () => {
    const heavier = bun({ cookedGrams: 1200 });
    expect(ported.costPerKg(heavier, BOXED_TABLES, doughOnly)).toMatchObject({ kg: null, total: null, rows: [] });
    expect(ported.costPerKg(heavier, BOXED_TABLES).total).toBeNull();
  });

  test('nothing costed: no total; junk options read as the default and never throw', () => {
    expect(ported.costPerKg(bun({ components: [] }), BOXED_TABLES, doughOnly).total).toBeNull();
    expect(ported.costPerKg(null, BOXED_TABLES, doughOnly).total).toBeNull();
    for (const junk of [null, undefined, {}, 0, 'no']) {
      expect(ported.costPerKg(bun(), BOXED_TABLES, junk as never).total, String(junk)).toBe(5.5556);
    }
  });
});

describe('the port and the original answer the same, row by row', () => {
  const tables = { ...TABLES, recipes: { ...TABLES.recipes, ...depthChain() } };
  const cases: [string, unknown][] = [
    ['one recipe', product()],
    ['lossy', product({ components: [{ recipeId: 'LOSSY', qtyKg: 3.7 }] })],
    ['finished product', product({ components: [{ recipeId: 'LOSSY', qtyKg: 10 }], noWeightLoss: true })],
    ['nested', product({ components: [{ recipeId: 'FILLED', qtyKg: 2.3 }, { recipeId: 'DOUGH', qtyKg: 1.1 }] })],
    ['unlinked water', product({ components: [{ recipeId: 'WET', qtyKg: 5 }, { kind: 'ingredient', ingredientId: 'SUGAR', qty: 150, unit: 'g' }] })],
    ['pieces', product({ components: [
      { recipeId: 'DOUGH', qtyKg: 9.8 },
      { kind: 'ingredient', ingredientId: 'CHERRY', qty: 100, unit: 'pcs' },
      { kind: 'ingredient', ingredientId: 'EGG', qty: 10, unit: 'pcs' },
      { kind: 'ingredient', ingredientId: 'NOPRICE', qty: 50, unit: 'g' },
      { kind: 'ingredient', ingredientId: 'GONE', qty: 50, unit: 'g' },
    ] })],
    ['packaging', product({ packaging: [{ ingredientId: 'BAG', qtyPcs: 1 }, { ingredientId: 'FILM', qtyPcs: 1 }, { ingredientId: 'NOPRICE', qtyPcs: 1 }] })],
    ['packaging not sold', product({ sellingMode: null, packaging: [{ ingredientId: 'BAG', qtyPcs: 1 }] })],
    ['loop and unpriced', product({ components: [{ recipeId: 'LOOP', qtyKg: 1 }, { recipeId: 'UNPRICED', qtyKg: 2 }, { recipeId: 'GONE', qtyKg: 2 }] })],
    ['too deep', product({ components: [{ recipeId: 'C1', qtyKg: 3 }] })],
    ['empty', product({ components: [] })],
    ['junk', 42],
    ['null', null],
    ['undefined', undefined],
  ];

  // POST-SWITCH (10 Nov 2026, «il calo è del prodotto»): four of these cases part from the original on purpose; each is
  // pinned below to the port's own answer. foodcost-product-loss.spec.ts proves what must not move (the cost of every product).
  const POST_SWITCH = ['pieces', 'loop and unpriced', 'too deep'];

  test.each(cases.filter(([label]) => !POST_SWITCH.includes(label)))('%s', (_label, input) => {
    expect(ported.costPerKg(input, tables as never)).toStrictEqual(legacy.costPerKg(input, tables as never));
  });

  // Change C: the batch weighs every line whose weight is known. Unlisted rows are still the original's.
  test('POST-SWITCH pieces: the unpriced and gone ingredients weigh 0.05 kg each, so the batch is 10.5 kg and not 10.4', () => {
    const input = cases.find(([label]) => label === 'pieces')?.[1];
    // 9.8 kg dough (31.36) + 100 cherries (5) + 10 eggs (3) = 39.36 over 10.5 kg = 3.7486 (js/: over 10.4 = 3.7846).
    const row = (key: string, kind: ported.PerKgKind, name: string, kg: number | null, pcs: number | null, pricePerKg: number | null,
      priceEach: number | null, cost: number | null, reason: ported.PerKgReason | null): ported.PerKgRow =>
      ({ key, kind, name, kg, pcs, pricePerKg, priceEach, cost, reason });
    expect(ported.costPerKg(input, tables as never)).toStrictEqual({
      kg: 10.5, total: 3.7486, partial: true, packagingLeftOut: false, lossy: false,
      rows: [
        row('ing:FLOUR', 'ingredient', 'Flour', 0.746667, null, 2, null, 1.4933, null),
        row('ing:BUTTER', 'ingredient', 'Butter', 0.186667, null, 8, null, 1.4933, null),
        row('ing:CHERRY:pcs', 'piece', 'Cherry', null, 9.5238, null, 0.05, 0.4762, null),
        row('ing:EGG:pcs', 'piece', 'Egg', 0.057143, 0.9524, null, 0.3, 0.2857, null),
        row('ing:NOPRICE:no-price', 'ingredient', 'Vanilla', 0.004762, null, null, null, null, 'no-price'),
      ],
    });
  });

  test('POST-SWITCH loop and unpriced: a recipe that is gone or unpriced still weighs, so the batch is 5 kg and not 1', () => {
    const input = cases.find(([label]) => label === 'loop and unpriced')?.[1];
    // Loop 1 kg + Mystery 2 kg + the gone recipe 2 kg = 5 kg (js/: only the Loop's 1 kg). Its flour costs 2 for 5 kg: 0.4 a kilo.
    const row = (key: string, name: string, kg: number, cost: number | null, pricePerKg: number | null, reason: ported.PerKgReason | null): ported.PerKgRow =>
      ({ key, kind: 'ingredient', name, kg, pcs: null, pricePerKg, priceEach: null, cost, reason });
    expect(ported.costPerKg(input, tables as never)).toStrictEqual({
      kg: 5, total: 0.4, partial: true, packagingLeftOut: false, lossy: false,
      rows: [
        row('ing:FLOUR', 'Flour', 0.2, 0.4, 2, null),
        row('label:itself:no-recipe', 'Itself', 0.2, null, null, 'no-recipe'),
        row('recipe:UNPRICED:no-recipe', 'Mystery', 0.4, null, null, 'no-recipe'),
      ],
    });
  });

  test('POST-SWITCH too deep: the same cost and the same rows, the weights a hair apart from the conversion of the old kilos', () => {
    const input = cases.find(([label]) => label === 'too deep')?.[1];
    const old = legacy.costPerKg(input, tables as never);
    // Change B: 3 kg finished of a recipe that loses 10% become the roundest raw kilos whose cost rounds to the line's old
    // cost (near q × finished price ÷ raw price), not q ÷ 0.9. The prices are rounded to four decimals, so those kilos differ
    // from q ÷ 0.9 by ~2 in 100 000, and so does every row cut from them (the total, the batch cost over 3 kg, is the
    // original's to the last decimal).
    const moved: Record<string, Partial<ported.PerKgRow>> = {
      'ing:FLOUR': { kg: 1.226162, cost: 2.4523 },
      'label:level 5:no-recipe': { kg: 0.190516 },
    };
    expect(ported.costPerKg(input, tables as never)).toStrictEqual({
      ...old, rows: old.rows.map(r => ({ ...r, ...moved[r.key] })),
    });
    expect(Object.keys(moved).every(key => old.rows.some(r => r.key === key))).toBe(true);
  });

  test('without tables', () => {
    // POST-SWITCH (10 Nov 2026, «il calo è del prodotto»): change C. Nothing is known about the recipe, but the line still
    // says 10 kg, which is what the batch weighs: kg 10 (js/: null, nothing priced so nothing weighed). Still no total.
    expect(ported.costPerKg(product())).toStrictEqual({ ...legacy.costPerKg(product()), kg: 10 });
  });
});
