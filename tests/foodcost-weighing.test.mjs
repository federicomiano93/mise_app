// The oven loss, typed on a product's recipe line in Food cost and stored on the RECIPE.
//
// Federico, 13 Sep 2026: «togli dalla scheda ricetta il peso crudo e cotto e aggiungilo
// nella scheda del food cost» — and, asked, the loss belongs to the recipe.
//
// ⚠️⚠️ THESE RUN THE CODE. The same rules used to be guarded by reading the recipe
// editor's source for `if (!weighed) {` and friends, which is how a guard ends up
// green on a branch it never reached. What they protect is the one property nothing on
// screen can show: A PRODUCT SOMEBODY ONLY OPENS MUST NOT CHANGE WHAT A RECIPE COSTS.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startWeighing, typeRaw, typeCooked, readWeighing, withWeighings, weighingPatches,
  otherProductsUsing,
} from '../js/foodcost/foodcost-weighing.js';

// 600 + 400 = 1000 g of weighable dough, plus a row with no weight that must not count.
const recipe = (extra = {}) => ({
  id: 'foc', name: 'Focaccia',
  ingredients: [
    { label: 'Flour', grams: 600, unit: 'g' },
    { label: 'Water', grams: 400, unit: 'g' },
    { label: 'Rosemary', grams: 0, unit: 'to taste' },
  ],
  ...extra,
});

// ── 1. Nothing is written unless a person typed it ───────────────────────────

test('⚠️⚠️ an untouched line produces no patch, whatever the recipe carries', () => {
  const variants = [
    recipe(),
    recipe({ lossPct: 0 }),
    recipe({ lossPct: 12 }),
    recipe({ lossPct: 20, rawGrams: 1000, cookedGrams: 800 }),
    // An old document the recipe editor could store: a pair that disagrees with its own
    // percentage. Opening it must still write nothing.
    recipe({ lossPct: 5, rawGrams: 1000, cookedGrams: 1200 }),
    recipe({ rawGrams: 1000 }),
  ];
  for (const r of variants) {
    const state = startWeighing(r);
    assert.equal(state.touched, false);
    assert.equal(readWeighing(r, state).patch, null, JSON.stringify(r));
  }
});

test('an unweighed recipe: the raw box follows the total, the cooked box is empty', () => {
  const state = startWeighing(recipe({ lossPct: 12 }));
  assert.equal(state.rawTyped, false);
  assert.equal(state.weighed, false);
  assert.equal(state.cooked, 0, 'no cooked weight is derived from a percentage');
  assert.equal(readWeighing(recipe({ lossPct: 12 }), state).rawShown, '1000',
    'the total of the rows that have a weight — «to taste» is not in it');
});

test('⚠️⚠️ a stored 0 is «nobody has weighed it», never «loses 0%»', () => {
  const r = recipe({ lossPct: 0 });
  const shown = readWeighing(r, startWeighing(r));
  assert.deepEqual(shown.message, { key: 'fc.lossNotYet', params: {} });
});

test('a stored percentage above zero is named, and invites a new weighing', () => {
  const r = recipe({ lossPct: 12 });
  assert.deepEqual(readWeighing(r, startWeighing(r)).message,
    { key: 'fc.lossStored', params: { pct: '12' } });
});

test('⚠️ a weighed recipe opens showing its weights, and states the percentage it is COSTED at', () => {
  const r = recipe({ lossPct: 5, rawGrams: 1000, cookedGrams: 800 });
  const state = startWeighing(r);
  assert.equal(state.raw, 1000);
  assert.equal(state.cooked, 800);
  assert.deepEqual(readWeighing(r, state).message, { key: 'fc.lossIs', params: { pct: '5' } },
    'the boxes work out to 20%, but the cost model divides by the stored 5% — say that one');
});

// ── 2. A person types ────────────────────────────────────────────────────────

test('typing the cooked weight alone works the loss out against the recipe total', () => {
  const r = recipe({ lossPct: 12 });
  const state = typeCooked(startWeighing(r), '800');
  const shown = readWeighing(r, state);
  assert.deepEqual(shown.patch, { lossPct: 20, rawGrams: 1000, cookedGrams: 800 });
  assert.deepEqual(shown.message, { key: 'fc.lossIs', params: { pct: '20' } });
  assert.equal(shown.warning, null);
});

test('a typed raw weight overrides the total, and clearing it hands the box back', () => {
  const r = recipe();
  let state = typeRaw(startWeighing(r), '1250');
  state = typeCooked(state, '1000');
  assert.deepEqual(readWeighing(r, state).patch, { lossPct: 20, rawGrams: 1250, cookedGrams: 1000 });
  state = typeRaw(state, '   ');
  assert.equal(state.rawTyped, false);
  assert.equal(readWeighing(r, state).rawShown, '1000');
  assert.equal(readWeighing(r, state).patch.rawGrams, 1000);
});

test('⚠️ a half-filled pair writes nothing and still names the stored percentage', () => {
  const r = recipe({ lossPct: 12 });
  const state = typeRaw(startWeighing(r), '1000');
  const shown = readWeighing(r, state);
  assert.equal(shown.patch, null, 'one weight cannot make a percentage');
  assert.deepEqual(shown.message, { key: 'fc.lossStored', params: { pct: '12' } },
    'and it must not hide the real percentage the recipe already carries');
});

test('⚠️ a cooked dough heavier than the raw one is refused, not read as «loses nothing»', () => {
  const r = recipe({ lossPct: 12 });
  const shown = readWeighing(r, typeCooked(startWeighing(r), '1100'));
  assert.equal(shown.patch, null);
  assert.deepEqual(shown.warning, { key: 'fc.lossCookedHeavier', params: {} });
  assert.deepEqual(shown.message, { key: 'fc.lossStored', params: { pct: '12' } });
});

test('⚠️⚠️ a loss past 99% is capped and the screen admits it', () => {
  const r = recipe();
  const shown = readWeighing(r, typeCooked(startWeighing(r), '1'));
  assert.equal(shown.patch.lossPct, 99,
    'a stored 100 divides the price per kilo by zero: every product on it would cost Infinity');
  assert.deepEqual(shown.warning, { key: 'fc.lossCapped', params: { max: '99' } });
});

test('retyping the numbers a recipe already carries is not a change', () => {
  const r = recipe({ lossPct: 20, rawGrams: 1000, cookedGrams: 800 });
  const state = typeCooked(typeRaw(startWeighing(r), '1000'), '800');
  assert.equal(state.touched, true);
  assert.equal(readWeighing(r, state).patch, null,
    'a patch here would record a margin point for something that did not happen');
});

test('typing does not change the state it was given', () => {
  const start = startWeighing(recipe());
  const copy = { ...start };
  typeRaw(start, '900');
  typeCooked(start, '700');
  assert.deepEqual(start, copy);
});

// ── 3. What Save writes, and what the screen costs with ─────────────────────

test('⚠️ Save writes only for recipes still on the product, still existing, and really changed', () => {
  const recipes = {
    foc: recipe({ lossPct: 12 }),
    bri: { id: 'bri', name: 'Brioche', ingredients: [{ label: 'Flour', grams: 500, unit: 'g' }] },
    same: recipe({ id: 'same', lossPct: 20, rawGrams: 1000, cookedGrams: 800 }),
  };
  const states = {
    foc: typeCooked(startWeighing(recipes.foc), '800'),
    bri: typeCooked(startWeighing(recipes.bri), '400'),        // typed, then its line removed
    // Its recipe was deleted. Both boxes typed, so the pair alone WOULD make a patch —
    // only the «still exists» rule stops it.
    gone: typeCooked(typeRaw(startWeighing(recipe()), '1000'), '800'),
    same: typeCooked(startWeighing(recipes.same), '800'),       // retyped, unchanged
  };
  const patches = weighingPatches(recipes, states, ['foc', 'same', 'gone', '']);
  assert.deepEqual(patches, { foc: { lossPct: 20, rawGrams: 1000, cookedGrams: 800 } });
});

test('the screen costs with the typed weighing, without touching the stored tables', () => {
  const tables = { recipes: { foc: recipe({ lossPct: 12 }) }, ingredients: {} };
  const frozen = JSON.stringify(tables);
  const live = withWeighings(tables, { foc: { lossPct: 20, rawGrams: 1000, cookedGrams: 800 } });
  assert.equal(live.recipes.foc.lossPct, 20);
  assert.equal(live.recipes.foc.name, 'Focaccia', 'the recipe keeps everything else');
  assert.equal(live.ingredients, tables.ingredients);
  assert.equal(JSON.stringify(tables), frozen, 'the stored tables are not mutated');
  assert.equal(withWeighings(tables, {}), tables, 'no weighing, no copy');
  assert.equal(withWeighings(tables, { nope: { lossPct: 5 } }).recipes.nope, undefined,
    'a patch for a recipe that is not there invents nothing');
});

test('the note counts the OTHER products a recipe\'s loss changes', () => {
  const products = [
    { id: 'p1', components: [{ recipeId: 'foc', qtyKg: 1 }] },
    { id: 'p2', components: [{ recipeId: 'foc', qtyKg: 2 }, { recipeId: 'bri', qtyKg: 1 }] },
    { id: 'p3', components: [{ recipeId: 'bri', qtyKg: 1 }] },
    null,
  ];
  assert.equal(otherProductsUsing(products, 'foc', 'p1'), 1);
  assert.equal(otherProductsUsing(products, 'foc', null), 2, 'a new product has no id yet');
  assert.equal(otherProductsUsing(products, 'none', 'p1'), 0);
});
