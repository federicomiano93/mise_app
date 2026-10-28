// foodcost-cards-from-recipes.test.mjs — Food cost products made from the recipe book.
//
// Federico, 28 Oct 2026: a product for every recipe, its name and what the recipe knows,
// the rest typed by him. Agreed: a button, a list he can untick, a confirm. What would go
// wrong unseen, and is therefore pinned: a duplicate (the link lost, or a hand-made product
// ignored), a product with numbers nobody typed, an id the rules or Firestore refuse, and a
// create that overwrites a product another phone has just made.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  recipeProductId, recipeIdOfProduct, wholeRecipeKg, productFromRecipe, recipesWithoutProducts,
} from '../js/foodcost/from-recipes.js';
import { normalizeProduct, PRODUCT_MODEL } from '../js/foodcost/foodcost-model.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const recipe = (id, name, rows = [{ label: 'Farina', grams: 1000, unit: 'g' }], extra = {}) =>
  ({ id, name, ingredients: rows, ...extra });

// ── The link ─────────────────────────────────────────────────────────────────

test('the product id comes from the recipe id, and back', () => {
  assert.equal(recipeProductId('abc123'), 'recipe-abc123');
  assert.equal(recipeIdOfProduct('recipe-abc123'), 'abc123');
  assert.equal(recipeIdOfProduct('Xy7randomId'), '');
});

test('an id Firestore would refuse makes no product at all', () => {
  for (const id of ['', '   ', null, undefined, 'a/b']) assert.equal(recipeProductId(id), '');
  assert.equal(productFromRecipe(recipe('a/b', 'Pane')), null);
});

// ── What the recipe gives ────────────────────────────────────────────────────

test('the whole recipe, less its oven loss, in kilos', () => {
  assert.equal(wholeRecipeKg(recipe('r', 'Pane', [
    { label: 'Farina', grams: 1, unit: 'kg' },
    { label: 'Acqua', grams: 700, unit: 'g' },
    { label: 'Uova', grams: 2, unit: 'pcs' },          // pieces weigh nothing here
  ], { lossPct: 10 })), 1.53);
  assert.equal(wholeRecipeKg(recipe('r', 'Pane', [{ label: 'Uova', grams: 3, unit: 'pcs' }])), 0);
  assert.equal(wholeRecipeKg(null), 0);
});

test('a product from a recipe: its name and its line — and nothing nobody typed', () => {
  const p = productFromRecipe(recipe('r1', '  Brioche col tuppo ', undefined, { lossPct: 0 }));
  assert.equal(p.id, 'recipe-r1');
  assert.equal(p.name, 'Brioche col tuppo');
  assert.deepEqual(p.components, [{ recipeId: 'r1', qtyKg: 1 }]);
  assert.deepEqual(p.packaging, []);
  for (const key of ['sellingMode', 'piecesPerBatch', 'packSize', 'packUnit', 'sellingPrice',
    'vatRate', 'foodCostTarget', 'labourMinutes', 'labourPeople']) {
    assert.equal(p[key], null, key);
  }
  assert.equal(p.model, PRODUCT_MODEL);
  // It survives the normaliser the store runs every product through, unchanged.
  const norm = normalizeProduct(p);
  assert.equal(norm.name, p.name);
  assert.deepEqual(norm.components, p.components);
});

test('a recipe without a name makes no product; a long one is cut to what the rules take', () => {
  assert.equal(productFromRecipe(recipe('r', '   ')), null);
  assert.equal(productFromRecipe(recipe('r', 'x'.repeat(250))).name.length, 200);
});

// ── Which recipes are missing ────────────────────────────────────────────────

test('⚠️ a recipe whose own product exists is never offered again — renamed or emptied', () => {
  const recipes = { r1: recipe('r1', 'Pane') };
  const products = [{ id: 'recipe-r1', name: 'Pagnotta', components: [] }];
  assert.deepEqual(recipesWithoutProducts(recipes, products), { create: [], maybe: [] });
});

test('⚠️ a hand-made product is only a «maybe», never a link', () => {
  const recipes = [recipe('r1', 'Crema pasticcera'), recipe('r2', 'Focaccia'), recipe('r3', 'Sfincione')];
  const products = [
    { id: 'p1', name: 'Cornetto alla crema', components: [{ recipeId: 'r1', qtyKg: 1 }] },
    { id: 'p2', name: '  FOCÀCCIA ', components: [] },
  ];
  const out = recipesWithoutProducts(recipes, products);
  assert.deepEqual(out.create.map(c => c.recipe.id), ['r3']);
  assert.deepEqual(out.maybe.map(m => [m.recipe.id, m.reason, m.productName]), [
    ['r1', 'used', 'Cornetto alla crema'],
    ['r2', 'same-name', 'FOCÀCCIA'],
  ]);
});

test('sorted by name; nameless recipes left out; kilos carried for the screen', () => {
  const out = recipesWithoutProducts({
    b: recipe('b', 'sfincione'), a: recipe('a', 'Brioche'), c: recipe('c', ''),
  }, []);
  assert.deepEqual(out.create.map(c => c.recipe.id), ['a', 'b']);
  assert.equal(out.create[0].kg, 1);
});

test('junk in, empty out', () => {
  assert.deepEqual(recipesWithoutProducts(null, null), { create: [], maybe: [] });
  assert.deepEqual(recipesWithoutProducts([null, 5, 'x'], [null]), { create: [], maybe: [] });
});

// ── The write ────────────────────────────────────────────────────────────────

test('⚠️⚠️ a create asks the SERVER first, so another device’s product is never overwritten', () => {
  // The phone's list can be an old offline copy; a plain set at a fixed id would land on a
  // product filled in elsewhere since. The store goes through the transaction, never saveProduct.
  const store = read('js/foodcost/foodcost-store.js').replace(/\r\n/g, '\n');
  const body = store.slice(store.indexOf('export async function createProductsFromRecipes'));
  const fn = body.slice(0, body.indexOf('\n}'));
  assert.match(fn, /createProductIfAbsent\(product\.id, productDocument\(product\)\)/);
  assert.doesNotMatch(fn, /saveProduct\(|saveProductWithSnapshot\(/);

  const data = read('js/foodcost/firebase-foodcost.js').replace(/\r\n/g, '\n');
  const tx = data.slice(data.indexOf('export async function createProductIfAbsent'));
  const txBody = tx.slice(0, tx.indexOf('\n}'));
  assert.match(txBody, /runTransaction\(db,/);
  const existsAt = txBody.indexOf('if (snap.exists()) return false;');
  const setAt = txBody.indexOf('tx.set(ref, withBakery(data))');
  assert.ok(existsAt > 0 && setAt > existsAt, 'the existing product must be checked before the set');
});

test('the product fields the store writes are all in the rules whitelist', () => {
  const rules = read('firestore.rules');
  const block = rules.slice(rules.indexOf('match /products/{id}'));
  const whitelist = block.slice(block.indexOf('hasOnly(['), block.indexOf('])'));
  const p = productFromRecipe(recipe('r', 'Pane'));
  for (const key of Object.keys(p).filter(k => k !== 'id')) assert.ok(whitelist.includes(`'${key}'`), key);
});
