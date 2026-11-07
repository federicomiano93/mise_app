// foodcost-no-weight-loss.test.mjs — «finished product, no weight loss» (Nov 2026).
//
// Federico: a finished product has no raw/cooked dough, so a product can be marked as losing
// no weight. The loss belongs to the RECIPE (13 Sep 2026), so the switch lives on the PRODUCT
// and only lays the recipe's loss aside for THAT product's cost — it never edits the recipe,
// and every other product built on the same recipe is untouched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchTotals, costProduct, normalizeProduct } from '../js/foodcost/foodcost-model.js';

const INGREDIENTS = { FLOUR: { id: 'FLOUR', priceUnit: 'kg', pricePerUnit: 2 } };
const lossy = lossPct => ({ id: 'DOUGH', name: 'Dough', lossPct, ingredients: [
  { label: 'Flour', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
] });
const tables = lossPct => ({ ingredients: INGREDIENTS, recipes: { DOUGH: lossy(lossPct) } });
const product = (over = {}) => ({
  id: 'P1', name: 'Rame', components: [{ recipeId: 'DOUGH', qtyKg: 1 }], packaging: [],
  sellingMode: 'weight', sellingPrice: 10, vatRate: 0, foodCostTarget: 30, ...over,
});

test('a recipe that loses 20% costs more per kilo of what comes out', () => {
  // 1 kg of flour = £2, but only 800 g comes out: £2.50 per cooked kilo.
  assert.equal(batchTotals(product(), tables(20)).cost, 2.5);
});

test('⚠️ marked as losing no weight, the product ignores the recipe\'s loss', () => {
  assert.equal(batchTotals(product({ noWeightLoss: true }), tables(20)).cost, 2);
});

test('the switch changes only that product — the same recipe, another product, still pays the loss', () => {
  const t = tables(20);
  assert.equal(batchTotals(product({ noWeightLoss: true }), t).cost, 2);
  assert.equal(batchTotals(product({ id: 'P2' }), t).cost, 2.5);
  assert.equal(t.recipes.DOUGH.lossPct, 20, 'the recipe keeps its own number');
});

test('a recipe with no loss costs the same either way', () => {
  assert.equal(batchTotals(product({ noWeightLoss: true }), tables(0)).cost, 2);
  assert.equal(batchTotals(product(), tables(0)).cost, 2);
});

test('it reaches the answer the screen shows', () => {
  const off = costProduct(product(), tables(20));
  const on = costProduct(product({ noWeightLoss: true }), tables(20));
  assert.ok(on.unitCost < off.unitCost, 'a product with no loss is cheaper per kilo');
});

test('⚠️ only a literal true switches it on', () => {
  assert.equal(normalizeProduct(product({ noWeightLoss: true })).noWeightLoss, true);
  for (const junk of [undefined, null, false, 'true', 1, 0, {}]) {
    assert.equal(normalizeProduct(product({ noWeightLoss: junk })).noWeightLoss, false, `${JSON.stringify(junk)} is not an answer`);
  }
});
