// A linked tab must SAVE the dough its screen shows. The tab's own ingredients are only
// a leftover copy once it is linked; saving from them stored old (or zero) grams after
// the Catalogue recipe was corrected.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRecipe, sheetRecipe, canCalculate } from '../js/calculator-recipe-source.js';
import { buildSheet, recipeSnapshot } from '../js/log-model.js';
import { recipeSpec } from '../js/calculator-config.js';
import { scaleRecipe } from '../js/calculator-dough-math.js';

const catalogue = {
  'cat-1': {
    name: 'Focaccia',
    ingredients: [
      { rid: 'r-flour', label: 'Flour', grams: 650, unit: 'g' },
      { rid: 'r-water', label: 'Water', grams: 400, unit: 'g' },
      { rid: 'r-yeast', label: 'Yeast', grams: 10, unit: 'g' },
    ],
  },
};
const STALE = [{ key: 'flour', label: 'Flour', grams: 600 }, { key: 'water', label: 'Water', grams: 400 }];
const tab = {
  id: 'foc', name: 'Focaccia', logic: 'total', catalogueId: 'cat-1', leaveningRid: 'r-yeast',
  ingredients: STALE, leaveningDefaultPct: 1, baselinePct: 1,
};

test('a linked tab saves the Catalogue grams, equal to what the screen scales', () => {
  const resolved = resolveRecipe(tab, catalogue);
  const sheet = buildSheet({ recipe: sheetRecipe(tab, resolved), items: [], totalInput: 2000, leaveningPct: 1 });
  const spec = recipeSpec(resolved);
  spec.leaveningKey = null; // logic 'total', as calc.js does
  const screen = scaleRecipe(spec, 2000, 1).map(Math.round);
  assert.deepEqual(sheet.ingredients.map(i => i.grams), screen);
  assert.deepEqual(sheet.ingredients.map(i => i.name), ['Flour', 'Water', 'Yeast']);
  assert.ok(sheet.ingredients[0].grams > 0);
});

test('the snapshot freezes the Catalogue ingredients, not the leftover copy', () => {
  const snap = recipeSnapshot(sheetRecipe(tab, resolveRecipe(tab, catalogue)));
  assert.deepEqual(snap.ingredients.map(i => i.grams), [650, 400, 10]);
  assert.equal(snap.leaveningKey, 'r-yeast');
  assert.equal(snap.name, 'Focaccia');
  assert.equal(snap.id, 'foc');
});

test('a leftover copy that is empty no longer gives a sheet of zeros', () => {
  const empty = { ...tab, ingredients: [] };
  const sheet = buildSheet({ recipe: sheetRecipe(empty, resolveRecipe(empty, catalogue)), items: [], totalInput: 2000, leaveningPct: 1 });
  assert.equal(sheet.ingredients.length, 3);
  assert.ok(sheet.ingredients.every(i => i.grams > 0));
});

test('an unlinked tab is returned untouched', () => {
  const own = { id: 'x', name: 'X', ingredients: STALE, leaveningKey: 'water' };
  assert.equal(sheetRecipe(own, resolveRecipe(own, {})), own);
});

test('an unresolved link cannot be calculated, so the save is refused', () => {
  assert.equal(canCalculate(resolveRecipe(tab, {})), false);
});
