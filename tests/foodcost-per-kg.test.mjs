// foodcost-per-kg.test.mjs — «Costo per 1 kg»: one kilo of a product, line by line.
//
// Federico, 4 Nov 2026: every ingredient's weight scaled to one kilo of the product, with
// its price per kilo and what the line costs; recipes opened into their own ingredients;
// an unpriced row shown as not counted; the total = the card's own cost. These tests pin
// the arithmetic, the one-row-per-ingredient merge, the inherited unlinked-row quirk, and
// that the total is the card's figure rather than a second sum. Fake data only.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { costPerKg } from '../js/foodcost/per-kg-model.js';
import { productionCost } from '../js/foodcost/foodcost-model.js';

const near = (actual, expected, eps = 1e-3) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} is not ${expected}`);
const sumOf = (rows, field) => rows.reduce((s, r) => s + (r[field] || 0), 0);
const counted = result => result.rows.filter(r => !r.reason);
const named = (result, name) => result.rows.find(r => r.name === name);

const INGREDIENTS = {
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
const DOUGH = {
  id: 'DOUGH', name: 'Dough', lossPct: 0,
  ingredients: [
    { label: 'Flour', grams: 800, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Butter', grams: 200, unit: 'g', kind: 'ingredient', refId: 'BUTTER' },
  ],
};
const LOSSY = { ...DOUGH, id: 'LOSSY', name: 'Lossy dough', lossPct: 20 };
// Water not linked to anything: the inherited quirk.
const WET = {
  id: 'WET', name: 'Wet dough', lossPct: 0,
  ingredients: [
    { label: 'Flour', grams: 600, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Water', grams: 400, unit: 'g' },
  ],
};
// A cream, used INSIDE the filled dough below: flour again, milk, and a pinch of nothing.
const CREAM = {
  id: 'CREAM', name: 'Cream', lossPct: 0,
  ingredients: [
    { label: 'Milk', grams: 800, unit: 'g', kind: 'ingredient', refId: 'MILK' },
    { label: 'Flour', grams: 200, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Salt', grams: 1, unit: 'pinch' },
    { label: '', grams: 0, unit: 'g' },
  ],
};
const FILLED = {
  id: 'FILLED', name: 'Filled dough', lossPct: 0,
  ingredients: [
    { label: 'Flour', grams: 500, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Cream', grams: 500, unit: 'g', kind: 'recipe', refId: 'CREAM' },
  ],
};
const UNPRICED = { id: 'UNPRICED', name: 'Mystery', lossPct: 0, ingredients: [{ label: 'Something', grams: 500, unit: 'g' }] };
const LOOP = {
  id: 'LOOP', name: 'Loop', lossPct: 0,
  ingredients: [
    { label: 'Flour', grams: 500, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Itself', grams: 500, unit: 'g', kind: 'recipe', refId: 'LOOP' },
  ],
};
const TABLES = {
  ingredients: INGREDIENTS,
  recipes: { DOUGH, LOSSY, WET, CREAM, FILLED, UNPRICED, LOOP },
};

const product = (over = {}) => ({
  id: 'P1', name: 'Test product',
  components: [{ recipeId: 'DOUGH', qtyKg: 10 }],
  packaging: [],
  sellingMode: 'piece', piecesPerBatch: 100,
  sellingPrice: 1.2, vatRate: 20, foodCostTarget: 30,
  ...over,
});

// The total is the card's figure: its batch cost over its batch kilos.
function cardPerKg(p) {
  const cost = productionCost(p, TABLES);
  return cost.batchCost / cost.batch.kg;
}

test('one recipe: each ingredient scaled to one kilo, its price per kilo and its cost', () => {
  const result = costPerKg(product(), TABLES);
  assert.equal(result.kg, 10);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(named(result, 'Flour'), {
    key: 'ing:FLOUR', kind: 'ingredient', name: 'Flour',
    kg: 0.8, pcs: null, pricePerKg: 2, priceEach: null, cost: 1.6, reason: null,
  });
  assert.equal(named(result, 'Butter').kg, 0.2);
  assert.equal(named(result, 'Butter').cost, 1.6);
  assert.equal(result.total, 3.2);
  assert.equal(result.partial, false);
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
    const result = costPerKg(p, TABLES);
    near(result.total, cardPerKg(p));
    near(sumOf(counted(result), 'cost'), result.total);
  }
});

test('sold by the kilo, the total is exactly the cost per kilo the card shows', () => {
  const p = product({ sellingMode: 'weight', packaging: [{ ingredientId: 'BAG', qtyPcs: 2 }] });
  const card = productionCost(p, TABLES);
  assert.equal(card.unit, 'kg');
  assert.equal(costPerKg(p, TABLES).total, card.unitCost);
});

test('an oven loss: more than a kilo of ingredients for a kilo of product', () => {
  const result = costPerKg(product({ components: [{ recipeId: 'LOSSY', qtyKg: 10 }] }), TABLES);
  // 1 kg out of a recipe that loses 20% takes 1.25 kg in.
  near(sumOf(result.rows, 'kg'), 1.25, 1e-6);
  near(named(result, 'Flour').kg, 1.0, 1e-6);
  near(result.total, 4.0);
  assert.equal(result.lossy, true);
  assert.equal(costPerKg(product(), TABLES).lossy, false);
});

test('a finished product (no weight loss) lays the loss aside, as the card does', () => {
  const p = product({ components: [{ recipeId: 'LOSSY', qtyKg: 10 }], noWeightLoss: true });
  const result = costPerKg(p, TABLES);
  near(sumOf(result.rows, 'kg'), 1, 1e-6);
  assert.equal(result.total, 3.2);
  assert.equal(result.lossy, false);
  near(result.total, cardPerKg(p));
});

test('a recipe inside a recipe is opened into its own ingredients, one row per ingredient', () => {
  const result = costPerKg(product({ components: [{ recipeId: 'FILLED', qtyKg: 4 }] }), TABLES);
  // Flour: 500 g of the dough plus 200 g of the cream's 1000 g in the other 500 g.
  near(named(result, 'Flour').kg, 0.6, 1e-6);
  near(named(result, 'Milk').kg, 0.4, 1e-6);
  assert.equal(result.rows.filter(r => r.name === 'Flour').length, 1);
  assert.equal(named(result, 'Cream'), undefined, 'the recipe is opened, never a line of its own');
  // The pinch of salt cannot be weighed: shown, not counted, no weight; the blank line not at all.
  const salt = named(result, 'Salt');
  assert.equal(salt.reason, 'not-weighed');
  assert.equal(salt.kg, null);
  assert.equal(salt.cost, null);
  assert.equal(result.rows.some(r => r.name === ''), false);
});

test('an unlinked row (water) is shown with its weight and NOT counted — the inherited quirk', () => {
  const result = costPerKg(product({ components: [{ recipeId: 'WET', qtyKg: 10 }] }), TABLES);
  const water = named(result, 'Water');
  assert.equal(water.reason, 'no-price');
  assert.equal(water.cost, null);
  assert.equal(water.pricePerKg, null);
  // ⚠️ The cost model gives the water no weight, so the recipe's price per kilo is that of
  // its flour alone (2.00 instead of 1.20) and every row is scaled as if the flour were the
  // whole kilo. Pinned so the day it is corrected, it is corrected on purpose.
  near(named(result, 'Flour').kg, 1, 1e-6);
  near(water.kg, 400 / 600, 1e-6);
  assert.equal(result.total, 2);
  assert.equal(result.partial, true);
});

test('an ingredient with no price on it is shown and not counted', () => {
  const result = costPerKg(product({ components: [
    { recipeId: 'DOUGH', qtyKg: 10 },
    { kind: 'ingredient', ingredientId: 'NOPRICE', qty: 50, unit: 'g' },
  ] }), TABLES);
  const vanilla = named(result, 'Vanilla');
  assert.equal(vanilla.reason, 'no-price');
  near(vanilla.kg, 0.005, 1e-9);
  assert.equal(result.partial, true);
  assert.equal(result.total, 3.2);
});

test('an ingredient straight on the product: its own name, by weight or by the piece', () => {
  const result = costPerKg(product({ components: [
    { recipeId: 'DOUGH', qtyKg: 9.8 },
    { kind: 'ingredient', ingredientId: 'SUGAR', qty: 200, unit: 'g' },
    { kind: 'ingredient', ingredientId: 'CHERRY', qty: 100, unit: 'pcs' },
    { kind: 'ingredient', ingredientId: 'EGG', qty: 10, unit: 'pcs' },
  ] }), TABLES);
  // Batch: 9.8 kg dough + 0.2 kg sugar + 0.6 kg of eggs (the cherries weigh nothing known).
  assert.equal(result.kg, 10.6);
  const sugar = named(result, 'Icing sugar');
  near(sugar.kg, 0.2 / 10.6, 1e-6);
  assert.equal(sugar.pricePerKg, 3);
  const cherry = named(result, 'Cherry');
  assert.equal(cherry.kind, 'piece');
  near(cherry.pcs, 100 / 10.6, 1e-3);
  assert.equal(cherry.priceEach, 0.05);
  assert.equal(cherry.kg, null);
  const egg = named(result, 'Egg');
  assert.equal(egg.kind, 'piece');
  near(egg.kg, 0.6 / 10.6, 1e-6);
  near(sumOf(counted(result), 'cost'), result.total);
});

test('a recipe with no price on the product is one line, not counted', () => {
  const result = costPerKg(product({ components: [{ recipeId: 'DOUGH', qtyKg: 8 }, { recipeId: 'UNPRICED', qtyKg: 2 }] }), TABLES);
  const mystery = named(result, 'Mystery');
  assert.equal(mystery.reason, 'no-recipe');
  // The cost model gives an unpriced recipe no weight: the kilo is the dough's alone.
  assert.equal(result.kg, 8);
  near(mystery.kg, 0.25, 1e-6);
  assert.equal(result.partial, true);
});

test('a recipe that contains itself is not counted, and nothing hangs', () => {
  const p = product({ components: [{ recipeId: 'DOUGH', qtyKg: 10 }, { recipeId: 'LOOP', qtyKg: 1 }] });
  const result = costPerKg(p, TABLES);
  // The loop's flour is costed; the row pointing back at itself is shown, not counted.
  near(result.total, cardPerKg(p));
  assert.equal(named(result, 'Itself').reason, 'no-recipe');
  assert.equal(result.partial, true);
});

test('packaging: so many pieces per kilo, once the way of selling says how many units', () => {
  const byPiece = costPerKg(product({ packaging: [{ ingredientId: 'BAG', qtyPcs: 1 }] }), TABLES);
  const bag = named(byPiece, 'Paper bag');
  assert.equal(bag.kind, 'packaging');
  // 100 pieces from 10 kg: 10 bags in a kilo, 0.10 each.
  assert.equal(bag.pcs, 10);
  assert.equal(bag.cost, 1);
  assert.equal(bag.kg, null);
  assert.equal(byPiece.total, 4.2);

  const notSold = costPerKg(product({ sellingMode: null, packaging: [{ ingredientId: 'BAG', qtyPcs: 1 }] }), TABLES);
  assert.equal(notSold.packagingLeftOut, true);
  assert.equal(notSold.partial, true);
  assert.equal(named(notSold, 'Paper bag'), undefined);
  assert.equal(notSold.total, 3.2);

  const byWeight = costPerKg(product({ packaging: [{ ingredientId: 'FILM', qtyPcs: 1 }] }), TABLES);
  assert.equal(named(byWeight, 'Film').reason, 'no-piece-price');
});

test('nothing costed, or nothing weighed: no total — never a kilo that reads as free', () => {
  assert.equal(costPerKg(product({ components: [] }), TABLES).total, null);
  assert.equal(costPerKg(product({ components: [{ recipeId: 'UNPRICED', qtyKg: 5 }] }), TABLES).total, null);
  assert.equal(costPerKg(product({ components: [{ recipeId: 'DOUGH', qtyKg: 0 }] }), TABLES).total, null);
  // Only pieces of unknown weight: a cost, but no kilo to divide it by.
  assert.equal(costPerKg(product({ components: [{ kind: 'ingredient', ingredientId: 'CHERRY', qty: 10, unit: 'pcs' }] }), TABLES).total, null);
  assert.equal(costPerKg(null, TABLES).total, null);
  assert.deepEqual(costPerKg(undefined).rows, []);
});

test('the weighings typed on the card count: the tables it is given are the tables used', () => {
  const live = { ...TABLES, recipes: { ...TABLES.recipes, DOUGH: { ...DOUGH, lossPct: 20 } } };
  const result = costPerKg(product(), live);
  near(sumOf(result.rows, 'kg'), 1.25, 1e-6);
  near(result.total, 4);
});

test('an ingredient that HAS a price is never called «no price»: the piece weight or price is named', () => {
  const ing = {
    ...INGREDIENTS,
    TOPPING: { id: 'TOPPING', name: 'Topping', priceUnit: 'pcs', pricePerUnit: 0.2 },
    NUT: { id: 'NUT', name: 'Nut', priceUnit: 'kg', pricePerUnit: 12 },
  };
  const result = costPerKg(product({ components: [
    { recipeId: 'DOUGH', qtyKg: 10 },
    { kind: 'ingredient', ingredientId: 'TOPPING', qty: 50, unit: 'g' },
    { kind: 'ingredient', ingredientId: 'NUT', qty: 5, unit: 'pcs' },
  ], packaging: [{ ingredientId: 'FILM', qtyPcs: 1 }] }), { ...TABLES, ingredients: ing });
  assert.equal(named(result, 'Topping').reason, 'no-piece-weight');
  assert.equal(named(result, 'Nut').reason, 'no-piece-price');
  assert.equal(named(result, 'Film').reason, 'no-piece-price');
});

test('a line with no amount yet is not a row', () => {
  const result = costPerKg(product({ components: [
    { recipeId: 'DOUGH', qtyKg: 10 },
    { kind: 'ingredient', ingredientId: 'SUGAR', qty: 0, unit: 'g' },
  ], packaging: [{ ingredientId: 'BAG', qtyPcs: 0 }] }), TABLES);
  assert.equal(named(result, 'Icing sugar'), undefined);
  assert.equal(named(result, 'Paper bag'), undefined);
});

test('a chain past the depth limit ends in a row not counted, and the total is still the card\'s', () => {
  const chain = {};
  for (let i = 1; i <= 5; i++) {
    chain[`C${i}`] = { id: `C${i}`, name: `Level ${i}`, lossPct: 10, ingredients: [
      { label: 'Flour', grams: 500, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
      ...(i < 5 ? [{ label: `Level ${i + 1}`, grams: 500, unit: 'g', kind: 'recipe', refId: `C${i + 1}` }] : []),
    ] };
  }
  const tables = { ...TABLES, recipes: { ...TABLES.recipes, ...chain } };
  const p = product({ components: [{ recipeId: 'C1', qtyKg: 3 }] });
  const result = costPerKg(p, tables);
  assert.equal(named(result, 'Level 5').reason, 'no-recipe');
  const card = productionCost(p, tables);
  near(result.total, card.batchCost / card.batch.kg);
  near(sumOf(counted(result), 'cost'), result.total);
});

test('Map tables work as well as plain objects', () => {
  const tables = { ingredients: new Map(Object.entries(INGREDIENTS)), recipes: new Map(Object.entries(TABLES.recipes)) };
  const result = costPerKg(product({ components: [{ recipeId: 'FILLED', qtyKg: 4 }] }), tables);
  near(named(result, 'Flour').kg, 0.6, 1e-6);
  near(sumOf(counted(result), 'cost'), result.total);
});
