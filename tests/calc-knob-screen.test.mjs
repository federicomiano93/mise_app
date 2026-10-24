// The leavening knob must change the grams ON SCREEN, and the screen must show the
// grams the saved dough stores.
//
// ⚠️ THE DEFECT (found 12 Oct 2026 while porting the Calculator to Mise 2): calc.js built
// the scaling spec from the RESOLVED recipe, which carries no baselinePct (that lives on
// the tab). With no baseline, scaleRecipe scales pro-rata: the knob moved the % shown and
// changed no gram, while the Dough history — built from sheetRecipe(), which keeps the
// tab's baselinePct — stored the grams AT the knob's %. Screen and log disagreed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveRecipe, sheetRecipe } from '../js/calculator-recipe-source.js';
import { recipeSpec } from '../js/calculator-config.js';
import { scaleRecipe } from '../js/calculator-dough-math.js';

const OWN = {
  id: 'r1', name: 'Pizza', logic: 'orders', leaveningKey: 'yeast', baselinePct: 2, showLeavening: true,
  ingredients: [
    { key: 'flour', label: 'Flour', grams: 1000 },
    { key: 'water', label: 'Water', grams: 650 },
    { key: 'yeast', label: 'Yeast', grams: 20 },
  ],
};

const LINKED = { id: 'r2', name: 'Pizza', logic: 'orders', catalogueId: 'cat-1', leaveningRid: 'r-yeast', baselinePct: 2 };
const CATALOGUE = {
  'cat-1': {
    name: 'Pizza',
    ingredients: [
      { rid: 'r-flour', label: 'Flour', grams: 1000, unit: 'g' },
      { rid: 'r-water', label: 'Water', grams: 650, unit: 'g' },
      { rid: 'r-yeast', label: 'Yeast', grams: 20, unit: 'g' },
    ],
  },
};

// What calc.js scales the screen from — the same sheetRecipe() the saved dough is built
// from (log.js → recipeToSave), which is what makes the two agree.
const screenGrams = (tab, catalogue, pct) =>
  scaleRecipe(recipeSpec(sheetRecipe(tab, resolveRecipe(tab, catalogue))), 2000, pct);

for (const [label, tab, catalogue] of [['own ingredients', OWN, {}], ['linked to the Catalogue', LINKED, CATALOGUE]]) {
  test(`a tab with ${label}: moving the knob changes the leavening on screen`, () => {
    const at2 = screenGrams(tab, catalogue, 2);
    const at4 = screenGrams(tab, catalogue, 4);
    assert.ok(at4[2] > at2[2], `yeast at 4% (${at4[2]}) must exceed yeast at 2% (${at2[2]})`);
    assert.equal(at4.reduce((a, b) => a + b, 0), 2000, 'the grams still add up to the target');
  });

  test(`a tab with ${label}: the resolved recipe alone has no baseline (why calc.js must not scale from it)`, () => {
    assert.equal(recipeSpec(resolveRecipe(tab, catalogue)).baselinePct, null);
    assert.equal(recipeSpec(sheetRecipe(tab, resolveRecipe(tab, catalogue))).baselinePct, 2);
  });
}

test('calc.js builds the screen\'s spec through sheetRecipe(), never from the resolved recipe alone', () => {
  const src = readFileSync(new URL('../js/calc.js', import.meta.url), 'utf8');
  assert.match(src, /recipeSpec\(sheetRecipe\(recipe, source\)\)/);
  assert.doesNotMatch(src, /recipeSpec\(source\)/);
});
