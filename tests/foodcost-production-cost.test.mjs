// foodcost-production-cost.test.mjs — what a product costs to make, shown on its own.
//
// Federico, 13 Sep 2026: «togli il costo del prodotto dalla scheda ricetta […] invece
// inserisci il costo prodotto in food cost». Until then a product's cost was readable
// only inside the food cost sentence, and only once a selling price and a VAT rate had
// been typed. These tests pin the three things that matter about the new figure: it
// answers WITHOUT a price, it is never shown as zero, and it is the very same number
// the food cost % is built from.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { productionCost, costProduct } from '../js/foodcost/foodcost-model.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// £2/kg flour, £8/kg butter, a box at 12p each.
const INGREDIENTS = {
  FLOUR: { id: 'FLOUR', name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 },
  BUTTER: { id: 'BUTTER', name: 'Butter', priceUnit: 'kg', pricePerUnit: 8 },
  BOX: { id: 'BOX', name: 'Cake box', priceUnit: 'pcs', pricePerUnit: 0.12 },
};
// £3.20 per kilo, nothing lost in the oven.
const DOUGH = {
  id: 'DOUGH', name: 'Dough', lossPct: 0,
  ingredients: [
    { label: 'Flour', grams: 800, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Butter', grams: 200, unit: 'g', kind: 'ingredient', refId: 'BUTTER' },
  ],
};
const HALF = {
  id: 'HALF', name: 'Half', lossPct: 0,
  ingredients: [
    { label: 'Flour', grams: 500, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Mystery', grams: 500, unit: 'g' },
  ],
};
const MYSTERY = { id: 'MYSTERY', name: 'Mystery', lossPct: 0, ingredients: [{ label: 'Something', grams: 500, unit: 'g' }] };
const TABLES = { ingredients: INGREDIENTS, recipes: { DOUGH, HALF, MYSTERY } };

const product = (over = {}) => ({
  id: 'P1', name: 'Test product',
  components: [{ recipeId: 'DOUGH', qtyKg: 10 }],
  packaging: [],
  sellingMode: 'piece', piecesPerBatch: 100,
  sellingPrice: 1.20, vatRate: 20, foodCostTarget: 30,
  ...over,
});

test('sold by the piece: what one piece costs, and what the whole batch costs', () => {
  const out = productionCost(product(), TABLES);
  assert.equal(out.batchCost, 32);      // 10 kg of £3.20/kg dough
  assert.equal(out.unitCost, 0.32);     // over 100 pieces
  assert.equal(out.unit, 'piece');
  assert.equal(out.partial, false);
});

test('⚠️ it answers with NO selling price and NO VAT — the whole point of it', () => {
  // A product being built has neither yet, and that is exactly when somebody wants to
  // know what it costs. The food cost % rightly still refuses.
  const bare = product({ sellingPrice: null, vatRate: null, foodCostTarget: null });
  const out = productionCost(bare, TABLES);
  assert.equal(out.unitCost, 0.32);
  assert.equal(out.batchCost, 32);
  assert.equal(costProduct(bare, TABLES).foodCostPct, null, 'the food cost still needs a price');
});

test('sold by weight: what a kilo costs', () => {
  const out = productionCost(product({ sellingMode: 'weight', piecesPerBatch: null }), TABLES);
  assert.equal(out.unitCost, 3.2);
  assert.equal(out.unit, 'kg');
  assert.equal(out.batchCost, 32);
});

test('packaging adds to the cost of a piece, not to the weight of a kilo', () => {
  const boxed = productionCost(product({ packaging: [{ ingredientId: 'BOX', qtyPcs: 100 }] }), TABLES);
  assert.equal(boxed.batchCost, 44);
  assert.equal(boxed.unitCost, 0.44);
  const byWeight = productionCost(product({
    sellingMode: 'weight', piecesPerBatch: null, packaging: [{ ingredientId: 'BOX', qtyPcs: 100 }],
  }), TABLES);
  assert.equal(byWeight.unitCost, 4.4, '£44 over the same 10 kg — the boxes weigh nothing here');
});

test('no way of selling chosen, or no pieces said: the batch alone, and no unit', () => {
  for (const over of [{ sellingMode: null }, { sellingMode: 'piece', piecesPerBatch: null }]) {
    const out = productionCost(product(over), TABLES);
    assert.equal(out.batchCost, 32);
    assert.equal(out.unitCost, null, 'a division by nothing is not a cost');
    assert.equal(out.unit, null, 'and a unit without its number would mislabel the batch');
  }
});

test('⚠️ nothing priced, or nothing in it: NO cost, never a cost of zero', () => {
  // «€0.00» reads as a product that costs nothing to make.
  for (const over of [{ components: [{ recipeId: 'MYSTERY', qtyKg: 5 }] }, { components: [] }, { components: [{ recipeId: 'GONE', qtyKg: 1 }] }]) {
    const out = productionCost(product(over), TABLES);
    assert.equal(out.batchCost, null);
    assert.equal(out.unitCost, null);
  }
  assert.equal(productionCost(null, TABLES).batchCost, null);
});

test('⚠️ a partly priced product says so, because its cost is too LOW', () => {
  const out = productionCost(product({ components: [{ recipeId: 'HALF', qtyKg: 1 }] }), TABLES);
  assert.ok(out.batchCost > 0);
  assert.equal(out.partial, true);
});

test('the oven loss is already inside it, exactly as in the food cost', () => {
  const baked = { ...DOUGH, id: 'BAKED', lossPct: 25 };
  const tables = { ingredients: INGREDIENTS, recipes: { BAKED: baked } };
  const p = product({ components: [{ recipeId: 'BAKED', qtyKg: 10 }] });
  assert.equal(productionCost(p, tables).unitCost, 0.4267);
});

test('⚠️⚠️ it is the SAME number the food cost % is built from', () => {
  // Two divisions that drift would put one cost on top of the screen and another
  // inside the percentage under it, with nothing to say which is right.
  const cases = [
    product(),
    product({ sellingMode: 'weight', sellingPrice: 12, piecesPerBatch: null }),
    product({ packaging: [{ ingredientId: 'BOX', qtyPcs: 37 }], piecesPerBatch: 7 }),
    product({ components: [{ recipeId: 'HALF', qtyKg: 3 }, { recipeId: 'DOUGH', qtyKg: 1.7 }] }),
  ];
  for (const p of cases) {
    const full = costProduct(p, TABLES);
    assert.notEqual(full.unitCost, null, 'every case here is fully filled in');
    assert.equal(productionCost(p, TABLES).unitCost, full.unitCost);
  }
});

// ── On the screen ────────────────────────────────────────────────────────────

test('the product screen draws it, above the food cost answer, on every repaint', () => {
  const editor = codeOf(read('js/foodcost/foodcost-editor.js'));
  const paint = editor.slice(editor.indexOf('function paintAnswer()'), editor.indexOf('function paintAnswer()') + 200);
  assert.match(paint, /paintProductionCost\(\);/,
    'painted from paintAnswer, so every change that repaints the answer repaints the cost');
  assert.match(editor, /const cost = productionCost\(working, liveTables\(\)\);/,
    'from the live tables, or a weighing typed on this screen would not move it until Save');
  const view = editor.slice(editor.indexOf("el('div', { class: 'fc-view fc-editor' }"));
  assert.ok(view.indexOf('prodCost,') !== -1 && view.indexOf('prodCost,') < view.indexOf('answer,'),
    'the cost sits at the top, above the food cost answer');
  assert.match(editor, /prodCost\.hidden = cost\.batchCost === null;/, 'no box at all while nothing is costed');
});

test('⚠️ the product list no longer writes «cost» and «margin» in English', () => {
  const list = codeOf(read('js/foodcost/foodcost-list.js'));
  assert.doesNotMatch(list, /\} cost`|\} margin`/, 'English written into the code reaches no dictionary');
  assert.match(list, /t\('fc\.listCost'/);
  assert.match(list, /t\('fc\.listMargin'/);
});

// Comments stripped before every source check — a guard that fires on its own warning
// comment is a guard people widen. Copied from tests/photo-image-model.test.mjs.
function codeOf(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => { const at = line.indexOf('//'); return at === -1 ? line : line.slice(0, at); })
    .join('\n');
}
