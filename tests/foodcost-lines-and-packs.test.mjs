// foodcost-lines-and-packs.test.mjs — ingredients on a product, selling by the pack, and
// the product model that keeps an out-of-date phone from deleting either.
//
// Federico, 13 Sep 2026:
//   «dopo avere aggiunto una ricetta mi dai aggiungi ricetta o ingrediente … se faccio un
//    cornetto alla crema devo poter inserire la ricetta cornetto, la ricetta crema e
//    l'ingrediente zucchero a velo»;
//   «nella sezione "venduto" aggiungi venduto a confezione e sotto fammi inserire il peso e
//    fammi scegliere il gr, kg ecc»;
//   and, asked about packaging: «per pezzo o confezione ma togli infornata non ha senso».

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  normalizeProduct, batchTotals, packagingPerUnit, costProduct, productionCost, unitsPerBatch,
  ingredientLineCost, snapshotWorthTaking, productSnapshot, productsUsingRecipe, draftFromRecipe,
  PRODUCT_MODEL, PACK_UNITS, LINE_UNITS,
} from '../js/foodcost/foodcost-model.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const AT = '2026-09-13T09:00:00.000Z';

// £3.20/kg dough; icing sugar £1.50/kg; chocolate buttons bought by the piece at 5p and
// weighing 2 g; eggs by the piece with no weight said; a tray at 20p.
const INGREDIENTS = {
  FLOUR: { id: 'FLOUR', name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 },
  BUTTER: { id: 'BUTTER', name: 'Butter', priceUnit: 'kg', pricePerUnit: 8 },
  ICING: { id: 'ICING', name: 'Icing sugar', priceUnit: 'kg', pricePerUnit: 1.5 },
  BUTTON: { id: 'BUTTON', name: 'Chocolate button', priceUnit: 'pcs', pricePerUnit: 0.05, unitWeightKg: 0.002 },
  EGG: { id: 'EGG', name: 'Egg', priceUnit: 'pcs', pricePerUnit: 0.3 },
  NOPRICE: { id: 'NOPRICE', name: 'Sprinkles' },
  TRAY: { id: 'TRAY', name: 'Tray', priceUnit: 'pcs', pricePerUnit: 0.2, kind: 'packaging' },
};
const DOUGH = {
  id: 'DOUGH', name: 'Dough', lossPct: 0,
  ingredients: [
    { label: 'Flour', grams: 800, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Butter', grams: 200, unit: 'g', kind: 'ingredient', refId: 'BUTTER' },
  ],
};
const TABLES = { ingredients: INGREDIENTS, recipes: { DOUGH } };

const product = (over = {}) => ({
  id: 'P1', name: 'Cornetto',
  components: [{ recipeId: 'DOUGH', qtyKg: 10 }],
  packaging: [],
  sellingMode: 'piece', piecesPerBatch: 100, packSize: null, packUnit: null,
  sellingPrice: 1.2, vatRate: 20, foodCostTarget: 30,
  ...over,
});

// ── Ingredients added straight to a product ─────────────────────────────────

test('an ingredient line in grams adds its cost AND its weight to the batch', () => {
  const out = batchTotals(product({ components: [
    { recipeId: 'DOUGH', qtyKg: 10 },
    { kind: 'ingredient', ingredientId: 'ICING', qty: 200, unit: 'g' },
  ] }), TABLES);
  assert.equal(out.cost, 32.3, '£32 of dough + 0.2 kg of £1.50/kg icing sugar');
  assert.equal(out.kg, 10.2);
  assert.equal(out.partial, false);
  assert.equal(out.rows[1].kind, 'ingredient');
});

test('…in kilos, the same', () => {
  const line = ingredientLineCost({ qty: 0.2, unit: 'kg' }, INGREDIENTS.ICING);
  assert.deepEqual(line, { cost: 0.3, kg: 0.2, reason: null });
});

test('…in pieces, bought by the piece: the price each, and the weight if it is known', () => {
  assert.deepEqual(ingredientLineCost({ qty: 100, unit: 'pcs' }, INGREDIENTS.BUTTON), { cost: 5, kg: 0.2, reason: null });
  assert.deepEqual(ingredientLineCost({ qty: 10, unit: 'pcs' }, INGREDIENTS.EGG), { cost: 3, kg: 0, reason: null },
    'an egg with no weight said still costs what it costs; it only adds no weight');
});

test('⚠️ a line that cannot be costed adds no weight, marks the batch partial, and says why', () => {
  assert.equal(ingredientLineCost({ qty: 50, unit: 'g' }, INGREDIENTS.NOPRICE).reason, 'no-ingredient-price');
  assert.equal(ingredientLineCost({ qty: 50, unit: 'g' }, INGREDIENTS.EGG).reason, 'no-piece-weight',
    'grams of something bought by the piece need what one piece weighs');
  assert.equal(ingredientLineCost({ qty: 5, unit: 'pcs' }, INGREDIENTS.ICING).reason, 'no-piece-price',
    'pieces of something bought by weight need what one piece weighs');
  const out = batchTotals(product({ components: [
    { recipeId: 'DOUGH', qtyKg: 10 },
    { kind: 'ingredient', ingredientId: 'NOPRICE', qty: 50, unit: 'g' },
    { kind: 'ingredient', ingredientId: 'GONE', qty: 50, unit: 'g' },
  ] }), TABLES);
  assert.equal(out.cost, 32);
  assert.equal(out.kg, 10, 'the unpriced sprinkles weigh nothing here');
  assert.equal(out.partial, true);
  assert.deepEqual(out.rows.slice(1).map(r => r.reason), ['no-ingredient-price', 'missing-ingredient']);
});

test('a product can be made of ingredients alone, and is costed', () => {
  const p = product({ components: [{ kind: 'ingredient', ingredientId: 'BUTTON', qty: 1000, unit: 'pcs' }] });
  assert.equal(costProduct(p, TABLES).unitCost, 0.5, '1000 buttons at 5p over 100 pieces');
});

test('⚠️ the recipe line keeps its old shape exactly, so a product saved before is read — and written — unchanged', () => {
  const out = normalizeProduct({ components: [
    { recipeId: 'DOUGH', qtyKg: 10 },
    { kind: 'ingredient', ingredientId: 'ICING', qty: '200', unit: 'g' },
    { kind: 'ingredient', ingredientId: 'ICING', qty: -1, unit: 'lb' },
    { kind: 'ingredient', qty: 5 },
  ] });
  assert.deepEqual(out.components, [
    { recipeId: 'DOUGH', qtyKg: 10 },
    { kind: 'ingredient', ingredientId: 'ICING', qty: 200, unit: 'g' },
    { kind: 'ingredient', ingredientId: 'ICING', qty: 0, unit: 'g' },
  ], 'junk is safe, a line with no ingredient is dropped, and the recipe line has no `kind`');
  assert.deepEqual([...LINE_UNITS], ['g', 'kg', 'pcs']);
});

// ── Sold by the pack ─────────────────────────────────────────────────────────

test('a pack that holds a WEIGHT: the batch cost per kilo, times what one pack holds', () => {
  // 10 kg at £3.20/kg; a 250 g pack costs £0.80, plus its tray.
  const p = product({ sellingMode: 'pack', packSize: 250, packUnit: 'g', piecesPerBatch: null, sellingPrice: 3,
    packaging: [{ ingredientId: 'TRAY', qtyPcs: 1 }] });
  assert.equal(unitsPerBatch(normalizeProduct(p), batchTotals(p, TABLES)), 40);
  const out = costProduct(p, TABLES);
  assert.equal(out.unitCost, 1, '£0.80 of dough + £0.20 tray');
  assert.equal(productionCost(p, TABLES).unit, 'pack');
  assert.equal(productionCost(p, TABLES).batchCost, 40, '£32 of dough + 40 trays');
  assert.equal(costProduct(product({ sellingMode: 'pack', packSize: 0.25, packUnit: 'kg', piecesPerBatch: null }), TABLES).unitCost, 0.8,
    'the same pack said in kilos');
});

test('a pack that holds PIECES: the cost of a piece, times how many are in the pack', () => {
  const p = product({ sellingMode: 'pack', packSize: 6, packUnit: 'pcs', piecesPerBatch: 100 });
  assert.equal(costProduct(p, TABLES).unitCost, 1.92, '£0.32 a piece × 6');
});

test('⚠️ a pack says what is missing: its size, or — in pieces — how many pieces a batch makes', () => {
  assert.ok(costProduct(product({ sellingMode: 'pack', packSize: null, packUnit: 'g' }), TABLES).blockers.includes('no-pack-size'));
  assert.ok(costProduct(product({ sellingMode: 'pack', packSize: 250, packUnit: null }), TABLES).blockers.includes('no-pack-size'));
  assert.ok(costProduct(product({ sellingMode: 'pack', packSize: 6, packUnit: 'pcs', piecesPerBatch: null }), TABLES).blockers.includes('no-pieces'));
  const noWeight = costProduct(product({ sellingMode: 'pack', packSize: 250, packUnit: 'g', components: [{ recipeId: 'DOUGH', qtyKg: 0 }] }), TABLES);
  assert.ok(noWeight.blockers.includes('no-weight'), 'a weight pack of a batch that weighs nothing cannot be divided');
  assert.equal(productionCost(product({ sellingMode: 'pack', packSize: null, packUnit: null }), TABLES).unitCost, null);
  assert.deepEqual([...PACK_UNITS], ['g', 'kg', 'pcs']);
});

test('junk in a pack is not a pack', () => {
  const out = normalizeProduct({ sellingMode: 'pack', packSize: '-3', packUnit: 'box' });
  assert.equal(out.packSize, null);
  assert.equal(out.packUnit, null);
});

// ── The same number everywhere ───────────────────────────────────────────────

test('⚠️⚠️ the production cost and the food cost divide by the SAME number, in every way of selling', () => {
  const cases = [
    product({ components: [{ recipeId: 'DOUGH', qtyKg: 10 }, { kind: 'ingredient', ingredientId: 'ICING', qty: 150, unit: 'g' }],
      packaging: [{ ingredientId: 'TRAY', qtyPcs: 2 }] }),
    product({ sellingMode: 'weight', sellingPrice: 12, piecesPerBatch: null, packaging: [{ ingredientId: 'TRAY', qtyPcs: 1 }] }),
    product({ sellingMode: 'pack', packSize: 300, packUnit: 'g', sellingPrice: 4, packaging: [{ ingredientId: 'TRAY', qtyPcs: 1 }] }),
    product({ sellingMode: 'pack', packSize: 4, packUnit: 'pcs', sellingPrice: 4 }),
  ];
  for (const p of cases) {
    const full = costProduct(p, TABLES);
    assert.notEqual(full.unitCost, null, JSON.stringify(full.blockers));
    assert.equal(productionCost(p, TABLES).unitCost, full.unitCost);
  }
});

// ── History, and the recipe link ─────────────────────────────────────────────

test('changing an ingredient line, or the pack, is a change worth a margin point', () => {
  const before = product({ components: [{ recipeId: 'DOUGH', qtyKg: 10 }, { kind: 'ingredient', ingredientId: 'ICING', qty: 200, unit: 'g' }] });
  assert.equal(snapshotWorthTaking(before, { ...before, components: [before.components[0], { ...before.components[1], qty: 250 }] }), true);
  assert.equal(snapshotWorthTaking(before, { ...before, components: [before.components[0], { ...before.components[1], unit: 'kg' }] }), true);
  const pack = product({ sellingMode: 'pack', packSize: 250, packUnit: 'g' });
  assert.equal(snapshotWorthTaking(pack, { ...pack, packSize: 300 }), true);
  assert.equal(snapshotWorthTaking(pack, { ...pack, packUnit: 'kg' }), true);
  assert.equal(snapshotWorthTaking(pack, { ...pack }), false);
});

test('a snapshot freezes the price of an ingredient added straight to the product', () => {
  const p = product({ components: [{ recipeId: 'DOUGH', qtyKg: 10 }, { kind: 'ingredient', ingredientId: 'ICING', qty: 200, unit: 'g' },
    { kind: 'ingredient', ingredientId: 'EGG', qty: 2, unit: 'pcs' }] });
  const snap = productSnapshot(p, costProduct(p, TABLES), AT, TABLES);
  assert.equal(snap.frozenPrices.ICING, 1.5);
  assert.equal(snap.frozenPrices.EGG, 0.3, 'bought by the piece and weight unknown: the price of one');
  assert.equal(snap.frozenPrices.FLOUR, 2, 'and the recipe is still walked');
});

test('an ingredient line is never taken for a recipe', () => {
  const products = [product({ id: 'A', components: [{ kind: 'ingredient', ingredientId: 'DOUGH', qty: 1, unit: 'kg' }] })];
  assert.deepEqual(productsUsingRecipe(products, 'DOUGH'), [], 'an ingredient that shares an id is not the recipe');
  const draft = draftFromRecipe({ id: 'DOUGH', name: 'Dough' });
  assert.equal(draft.packSize, null);
  assert.equal(draft.packUnit, null);
});

// ── The product model: what stops an old phone deleting all of this ─────────

test('⚠️⚠️ every save carries the product model, and the rules refuse a save without it over one that has it', () => {
  assert.equal(PRODUCT_MODEL, 2);
  const store = codeOf(read('js/foodcost/foodcost-store.js'));
  const save = store.slice(store.indexOf('export function saveProduct('), store.indexOf('const prev = products.find'));
  assert.match(save, /model: PRODUCT_MODEL,/, 'the store writes the model on every save');
  assert.match(save, /packSize: product\.packSize \?\? null,/);
  assert.match(save, /packUnit: product\.packUnit \?\? null,/);

  const rules = read('firestore.rules');
  const block = rules.slice(rules.indexOf('match /products/{id}'), rules.indexOf('match /snapshots/{snapshotId}'));
  assert.match(block, /'foodCostTarget', 'model'/, 'the model is a known key');
  assert.match(block, /request\.resource\.data\.sellingMode in \['piece', 'weight', 'pack'\]/);
  assert.match(block, /request\.resource\.data\.packUnit in \['g', 'kg', 'pcs'\]/);
  assert.match(block, /\|\| request\.resource\.data\.get\('model', 0\) >= resource\.data\.model\)/,
    'a save without the model, over a product that has one, is refused');
  const snaps = rules.slice(rules.indexOf('match /snapshots/{snapshotId}'));
  assert.match(snaps, /request\.resource\.data\.sellingMode in \['piece', 'weight', 'pack'\]/, 'a pack product can record its margin');
});

// ── On the screen ────────────────────────────────────────────────────────────

test('«Composto da» is one card: the lines, the add button, and the weighings LAST', () => {
  const editor = codeOf(read('js/foodcost/foodcost-editor.js'));
  assert.match(editor, /const madeOf = el\('div', \{ class: 'fc-madeof' \}, \[componentRows, addLineBtn, weighRows\]\);/);
  assert.match(editor, /addLineBtn\.textContent = working\.components\.length \? t\('fc\.addRecipeOrIngredient'\) : t\('fc\.addRecipe'\);/,
    'empty: add a recipe; after one: a recipe or an ingredient');
  assert.match(editor, /const chosen = await pick\(working\.components\.length \? 'line' : 'recipe'\);/);
  assert.match(editor, /weighRows\.contains\(document\.activeElement\)/,
    '⚠️ a live update must not rebuild a weighing under the finger, now that they have their own container');
  assert.match(editor, /const recipeIds = \[\.\.\.new Set\(recipeIdsOn\(working\.components\)\)\];/, 'one pair of weighings per recipe');
});

test('the name suggests recipes only while the product is made of nothing yet', () => {
  const editor = codeOf(read('js/foodcost/foodcost-editor.js'));
  assert.match(editor, /if \(working\.components\.length\) return \{ items: \[\], total: 0 \};/);
  assert.match(editor, /working\.name = String\(recipe\.name \|\| ''\)\.trim\(\);\s*nameInput\.value = working\.name;/,
    'a tap names the product after the recipe (Federico\'s choice)');
  assert.match(editor, /working\.components\.unshift\(\{ recipeId, qtyKg: 0 \}\)/, 'and puts the recipe first');
});

test('⚠️ ingredients offered to a product are never packaging, and packaging offered is only packaging', () => {
  const main = codeOf(read('js/foodcost/foodcost-main.js'));
  const ing = main.slice(main.indexOf('ingredientOptions()'), main.indexOf('packagingOptions()'));
  assert.match(ing, /!isPackaging\(i\)/);
  assert.doesNotMatch(ing, /formatRate|priceEach|notPriced/, 'no price on an ingredient offered to «Composto da»');
  const pack = main.slice(main.indexOf('packagingOptions()'));
  assert.match(pack, /isPackaging\(i\)/);
});
