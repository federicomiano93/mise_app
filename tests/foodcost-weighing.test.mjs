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
  weighingsChangeCost, otherProductsUsing, restoreAfterRefusal,
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

test('⚠️ an unweighed recipe opens with BOTH boxes empty — the raw box is never filled with the total', () => {
  const state = startWeighing(recipe({ lossPct: 12 }));
  assert.equal(state.weighed, false);
  assert.equal(state.raw, 0, 'Federico, Nov 2026: until both are written, the whole recipe weight stands');
  assert.equal(state.cooked, 0, 'no cooked weight is derived from a percentage');
  assert.ok(!('rawTyped' in state), 'there is no «raw follows the total» state any more');
  assert.ok(!('rawShown' in readWeighing(recipe({ lossPct: 12 }), state)));
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

test('⚠️⚠️ the cooked weight ALONE writes no patch and leaves the stored loss as it is', () => {
  const r = recipe({ lossPct: 12 });
  const shown = readWeighing(r, typeCooked(startWeighing(r), '800'));
  assert.equal(shown.patch, null, 'it used to work the loss out against the recipe total — an unmeasured raw');
  assert.deepEqual(shown.message, { key: 'fc.lossNeedBoth', params: {} },
    'one box alone says that both are needed, rather than «weigh the baked dough»');
  assert.equal(shown.warning, null);
});

test('⚠️ nothing half-filled keeps the stored message; exactly one weight asks for the other', () => {
  const stored = recipe({ lossPct: 12 });
  assert.deepEqual(readWeighing(stored, startWeighing(stored)).message, { key: 'fc.lossStored', params: { pct: '12' } });
  const none = recipe();
  assert.deepEqual(readWeighing(none, startWeighing(none)).message, { key: 'fc.lossNotYet', params: {} });
  // Typed and then both cleared: nothing is half-filled any more.
  const both = typeCooked(typeRaw(startWeighing(stored), '1000'), '800');
  assert.deepEqual(readWeighing(stored, typeCooked(typeRaw(both, ''), '')).message,
    { key: 'fc.lossStored', params: { pct: '12' } });
  for (const state of [typeRaw(startWeighing(none), '1000'), typeCooked(startWeighing(none), '800')]) {
    assert.deepEqual(readWeighing(none, state).message, { key: 'fc.lossNeedBoth', params: {} });
  }
});

test('the words say BOTH weights are needed, in both languages', async () => {
  const { _dictionaries } = await import('../js/i18n.js');
  const { en, it } = _dictionaries();
  assert.equal(en['fc.lossNotYet'], 'Oven loss: weigh the dough raw and baked, both, to work it out');
  assert.equal(it['fc.lossNotYet'], 'Calo peso in cottura: pesa l’impasto crudo e cotto, tutti e due, per saperlo');
  assert.equal(en['fc.lossNeedBoth'], 'Fill in both weights to work out the loss.');
  assert.equal(it['fc.lossNeedBoth'], 'Compila tutti e due i pesi per calcolare il calo.');
});

test('⚠️⚠️ the raw weight ALONE writes no patch either, and keeps naming the stored percentage', () => {
  const r = recipe({ lossPct: 12 });
  const shown = readWeighing(r, typeRaw(startWeighing(r), '1000'));
  assert.equal(shown.patch, null, 'one weight cannot make a percentage');
  assert.deepEqual(shown.message, { key: 'fc.lossNeedBoth', params: {} });
  assert.equal(shown.warning, null);
});

test('⚠️ both boxes written: the loss is worked out and a patch exists', () => {
  const r = recipe({ lossPct: 12 });
  const state = typeCooked(typeRaw(startWeighing(r), '1250'), '1000');
  const shown = readWeighing(r, state);
  assert.deepEqual(shown.patch, { lossPct: 20, rawGrams: 1250, cookedGrams: 1000 });
  assert.equal(shown.keepsOnly, false);
  assert.deepEqual(shown.message, { key: 'fc.lossIs', params: { pct: '20' } });
  assert.equal(shown.warning, null);
});

test('⚠️ both written and then ONE cleared: no patch, the stored loss stays', () => {
  const r = recipe({ lossPct: 12 });
  const both = typeCooked(typeRaw(startWeighing(r), '1250'), '1000');
  for (const state of [typeRaw(both, '   '), typeCooked(both, ''), typeRaw(both, '0')]) {
    const shown = readWeighing(r, state);
    assert.equal(shown.patch, null);
    assert.deepEqual(shown.message, { key: 'fc.lossNeedBoth', params: {} });
  }
});

test('a recipe weighed before opens showing its weights; changing one box re-works the loss', () => {
  const r = recipe({ lossPct: 20, rawGrams: 1000, cookedGrams: 800 });
  const state = typeCooked(startWeighing(r), '700');
  assert.equal(state.raw, 1000, 'the stored raw weight is the other half of the pair');
  assert.deepEqual(readWeighing(r, state).patch, { lossPct: 30, rawGrams: 1000, cookedGrams: 700 });
});

test('⚠️⚠️ a cooked dough heavier than the raw one is KEPT, with the stored loss untouched', () => {
  // Federico, Nov 2026: «per sbaglio avevo scritto il peso cotto maggiore del crudo, l'ho
  // salvato e quando sono tornato nella scheda i valori non c'erano più».
  const r = recipe({ lossPct: 12 });
  const shown = readWeighing(r, typeCooked(typeRaw(startWeighing(r), '1000'), '1100'));
  assert.deepEqual(shown.patch, { rawGrams: 1000, cookedGrams: 1100 },
    'the numbers are written and the loss is NOT sent at all: a typo must never make a product cheaper, '
    + 'and this phone\'s copy of the loss must never overwrite another phone\'s weighing');
  assert.ok(!('lossPct' in shown.patch));
  assert.equal(shown.keepsOnly, true);
  assert.deepEqual(shown.warning, { key: 'fc.lossCookedHeavier', params: {} });
  assert.deepEqual(shown.message, { key: 'fc.lossStored', params: { pct: '12' } });
});

test('a kept wrong pair on a recipe with no loss yet writes no loss either — «nobody has said»', () => {
  const r = recipe();
  const shown = readWeighing(r, typeCooked(typeRaw(startWeighing(r), '1000'), '1100'));
  assert.deepEqual(shown.patch, { rawGrams: 1000, cookedGrams: 1100 });
  assert.deepEqual(shown.message, { key: 'fc.lossNotYet', params: {} }, 'never «loses 0%»');
});

test('⚠️ a wrong pair that is already stored is not written again, and still warns', () => {
  const r = recipe({ lossPct: 12, rawGrams: 1000, cookedGrams: 1100 });
  const shown = readWeighing(r, typeCooked(typeRaw(startWeighing(r), '1000'), '1100'));
  assert.equal(shown.patch, null);
  assert.deepEqual(shown.warning, { key: 'fc.lossCookedHeavier', params: {} });
});

test('⚠️⚠️ a kept wrong pair opens RED again, showing its stored numbers, with no patch', () => {
  const r = recipe({ lossPct: 5, rawGrams: 1000, cookedGrams: 1200 });
  const state = startWeighing(r);
  assert.equal(state.raw, 1000);
  assert.equal(state.cooked, 1200, 'the boxes show what was kept');
  const shown = readWeighing(r, state);
  assert.deepEqual(shown.warning, { key: 'fc.lossCookedHeavier', params: {} });
  assert.equal(shown.patch, null, 'opening it writes nothing');
  assert.deepEqual(shown.message, { key: 'fc.lossStored', params: { pct: '5' } });
  const never = recipe({ rawGrams: 1000, cookedGrams: 1200 });
  assert.deepEqual(readWeighing(never, startWeighing(never)).message, { key: 'fc.lossNotYet', params: {} },
    'a recipe that was never given a loss does not say «loses 0%»');
});

test('⚠️⚠️ a loss past 99% is capped and the screen admits it', () => {
  const r = recipe();
  const shown = readWeighing(r, typeCooked(typeRaw(startWeighing(r), '1000'), '1'));
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
    foc: typeCooked(typeRaw(startWeighing(recipes.foc), '1000'), '800'),
    bri: typeCooked(typeRaw(startWeighing(recipes.bri), '500'), '400'),   // typed, then its line removed
    // Its recipe was deleted. Both boxes typed, so the pair alone WOULD make a patch —
    // only the «still exists» rule stops it.
    gone: typeCooked(typeRaw(startWeighing(recipe()), '1000'), '800'),
    same: typeCooked(startWeighing(recipes.same), '800'),       // retyped, unchanged
  };
  const patches = weighingPatches(recipes, states, ['foc', 'same', 'gone', '']);
  assert.deepEqual(patches, { foc: { lossPct: 20, rawGrams: 1000, cookedGrams: 800 } });
});

test('⚠️ a kept wrong pair is written but is NOT a cost change, so no margin point is recorded for it', () => {
  const recipes = { foc: recipe({ lossPct: 12 }), bri: recipe({ id: 'bri', lossPct: 12 }) };
  const wrong = typeCooked(typeRaw(startWeighing(recipes.foc), '1000'), '1100');
  const right = typeCooked(typeRaw(startWeighing(recipes.bri), '1000'), '800');
  assert.deepEqual(weighingPatches(recipes, { foc: wrong }, ['foc']),
    { foc: { rawGrams: 1000, cookedGrams: 1100 } });
  assert.equal(weighingsChangeCost(recipes, { foc: wrong }, ['foc']), false);
  assert.equal(weighingsChangeCost(recipes, { foc: wrong, bri: right }, ['foc', 'bri']), true,
    'one real change among them is enough');
  assert.equal(weighingsChangeCost(recipes, { bri: right }, []), false, 'a recipe off the product counts for nothing');
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

// ── 4. When the database refuses ─────────────────────────────────────────────

test('⚠️ a refused weighing puts back exactly what the recipe had', () => {
  const prev = recipe({ lossPct: 12 });
  const patch = { lossPct: 20, rawGrams: 1000, cookedGrams: 800 };
  const restored = restoreAfterRefusal({ ...prev, ...patch }, prev, patch);
  assert.equal(restored.lossPct, 12);
  assert.ok(!('rawGrams' in restored) && !('cookedGrams' in restored),
    '⚠️ a weight the recipe never had is REMOVED, not left behind and not set to 0');
  assert.equal(restored.name, 'Focaccia', 'the rest of the recipe is untouched');

  const weighed = recipe({ lossPct: 5, rawGrams: 900, cookedGrams: 855 });
  assert.deepEqual(
    (({ lossPct, rawGrams, cookedGrams }) => ({ lossPct, rawGrams, cookedGrams }))(
      restoreAfterRefusal({ ...weighed, ...patch }, weighed, patch)),
    { lossPct: 5, rawGrams: 900, cookedGrams: 855 });
});

test('⚠️⚠️ …but never over a newer weighing that has landed since', () => {
  const prev = recipe({ lossPct: 12 });
  const patch = { lossPct: 20, rawGrams: 1000, cookedGrams: 800 };
  const newer = { ...prev, lossPct: 25, rawGrams: 1000, cookedGrams: 750 };
  assert.equal(restoreAfterRefusal(newer, prev, patch), null,
    'somebody else\'s real number must not be thrown away to put an older one back');
  assert.equal(restoreAfterRefusal(null, prev, patch), null, 'a recipe gone meanwhile is left gone');
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

test('⚠️ a FINISHED product is not counted: a loss typed here does not change its cost', () => {
  const products = [
    { id: 'p1', components: [{ recipeId: 'foc', qtyKg: 1 }] },
    { id: 'p2', noWeightLoss: true, components: [{ recipeId: 'foc', qtyKg: 2 }] },
    { id: 'p3', noWeightLoss: false, components: [{ recipeId: 'foc', qtyKg: 2 }] },
  ];
  assert.equal(otherProductsUsing(products, 'foc', 'p1'), 1, 'only p3');
  assert.equal(otherProductsUsing(products, 'foc', null), 2);
});

test('⚠️ a refused kept wrong pair puts back ONLY the two numbers it carried', () => {
  const prev = recipe({ lossPct: 12, rawGrams: 900, cookedGrams: 700 });
  const patch = { rawGrams: 1000, cookedGrams: 1100 };
  const restored = restoreAfterRefusal({ ...prev, ...patch }, prev, patch);
  assert.deepEqual(
    (({ lossPct, rawGrams, cookedGrams }) => ({ lossPct, rawGrams, cookedGrams }))(restored),
    { lossPct: 12, rawGrams: 900, cookedGrams: 700 });
  // The loss moved on another phone meanwhile: that is not what the patch carried, so it
  // must neither block the rollback nor be rolled back.
  const moved = { ...prev, ...patch, lossPct: 25 };
  assert.equal(restoreAfterRefusal(moved, prev, patch).lossPct, 25);
  const never = recipe({ lossPct: 12 });
  const back = restoreAfterRefusal({ ...never, ...patch }, never, patch);
  assert.ok(!('rawGrams' in back) && !('cookedGrams' in back));
  assert.equal(back.lossPct, 12);
  assert.equal(restoreAfterRefusal({ ...prev }, prev, {}), null, 'an empty patch rolls back nothing');
});
