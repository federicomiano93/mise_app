// The leavening of a Calculator tab LINKED to a Catalogue recipe.
//
// ⚠️ THE DEFECT (found 18 Oct 2026, driving a linked tab on the emulator): in
// Settings → Recipes the leavening dropdown of a linked tab offered the Catalogue
// rows by their `rid`, but looked the pick up in the tab's own leftover list, where
// no rid is ever found — so the choice was silently dropped and `leaveningRid`
// never saved. And the knob, the box and the derived baseline all read the tab's
// own `leaveningKey`: a tab linked after it had a leavening showed a knob named
// after the old row that moved the % and changed no gram; a tab linked fresh
// showed no knob at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chooseLeavening, resolveRecipe, sheetRecipe } from '../js/calculator-recipe-source.js';
import { tabLeaveningId, showsLeaveningKnob, normalizeConfig, recipeSpec } from '../js/calculator-config.js';
import { scaleRecipe } from '../js/calculator-dough-math.js';

const CATALOGUE = {
  'cat-1': {
    name: 'Focaccia',
    ingredients: [
      { rid: 'r-flour', label: 'Flour', grams: 1000, unit: 'g' },
      { rid: 'r-water', label: 'Water', grams: 700, unit: 'g' },
      { rid: 'r-yeast', label: 'Fresh yeast', grams: 10, unit: 'g' },
    ],
  },
};

// A tab linked after it had its own leavening — the shape left behind by linking.
const legacy = () => ({
  id: 'r1', name: 'Focaccia', logic: 'both', catalogueId: 'cat-1', leaveningRid: null,
  ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }, { key: 'yeast', label: 'Yeast', grams: 10 }],
  leaveningKey: 'yeast', leaveningDefaultPct: 1, baselinePct: 1, showLeavening: true,
});
// A tab linked with nothing of its own.
const fresh = () => ({
  id: 'r2', name: 'Focaccia', logic: 'both', catalogueId: 'cat-1', leaveningRid: null,
  ingredients: [], leaveningKey: null, leaveningDefaultPct: 0, baselinePct: null, showLeavening: true,
});
const rowsOf = tab => resolveRecipe(tab, CATALOGUE).ingredients;

test('tabLeaveningId: a linked tab answers with its Catalogue row, never its leftover key', () => {
  assert.equal(tabLeaveningId(legacy()), null);
  assert.equal(tabLeaveningId({ ...legacy(), leaveningRid: 'r-yeast' }), 'r-yeast');
  assert.equal(tabLeaveningId({ ...legacy(), leaveningRid: '  ' }), null);
  assert.equal(tabLeaveningId({ leaveningKey: 'yeast' }), 'yeast');
  assert.equal(tabLeaveningId({ leaveningKey: 'yeast', leaveningRid: 'r-yeast' }), 'yeast', 'an own tab ignores leaveningRid');
  assert.equal(tabLeaveningId(null), null);
});

test('chooseLeavening on a linked tab saves the Catalogue row id it was offered', () => {
  for (const tab of [legacy(), fresh()]) {
    assert.equal(chooseLeavening(tab, 'r-yeast', rowsOf(tab)), true);
    assert.equal(tab.leaveningRid, 'r-yeast');
  }
});

test('chooseLeavening on a fresh linked tab starts the % and the baseline at 1', () => {
  const tab = fresh();
  chooseLeavening(tab, 'r-yeast', rowsOf(tab));
  assert.equal(tab.leaveningDefaultPct, 1);
  assert.equal(tab.baselinePct, 1);
});

test('chooseLeavening keeps a % and a baseline that are already there', () => {
  const tab = { ...legacy(), leaveningDefaultPct: 2.5, baselinePct: 3 };
  chooseLeavening(tab, 'r-yeast', rowsOf(tab));
  assert.equal(tab.leaveningDefaultPct, 2.5);
  assert.equal(tab.baselinePct, 3);
});

test('chooseLeavening on a linked tab refuses a row the Catalogue does not have', () => {
  const tab = legacy();
  assert.equal(chooseLeavening(tab, 'yeast', rowsOf(tab)), false, 'the leftover own key is not a Catalogue row');
  assert.equal(tab.leaveningRid, null);
});

test('chooseLeavening «nothing rises» clears the side the tab reads', () => {
  const linked = { ...legacy(), leaveningRid: 'r-yeast' };
  chooseLeavening(linked, '', rowsOf(linked));
  assert.equal(linked.leaveningRid, null);
  const own = { leaveningKey: 'yeast', ingredients: [{ key: 'yeast', label: 'Yeast', grams: 10 }] };
  chooseLeavening(own, '', null);
  assert.equal(own.leaveningKey, null);
});

test('chooseLeavening on an own tab still works by key and mints a key for a keyless row', () => {
  const own = { ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }, { key: '', label: 'Lievito Madre', grams: 200 }] };
  assert.equal(chooseLeavening(own, 'flour', null), true);
  assert.equal(own.leaveningKey, 'flour');
  assert.equal(chooseLeavening(own, '#1', null), true);
  assert.equal(own.leaveningKey, 'lievito-madre-1');
  assert.equal(own.ingredients[1].key, 'lievito-madre-1');
  assert.equal(chooseLeavening(own, 'nope', null), false);
});

test('showsLeaveningKnob: a linked tab shows the knob for its Catalogue row, not for its leftover key', () => {
  assert.equal(showsLeaveningKnob(legacy()), false, 'a knob here moved the % and scaled nothing');
  assert.equal(showsLeaveningKnob({ ...legacy(), leaveningRid: 'r-yeast' }), true);
  assert.equal(showsLeaveningKnob({ ...fresh(), leaveningRid: 'r-yeast' }), true);
  assert.equal(showsLeaveningKnob({ ...fresh(), leaveningRid: 'r-yeast', showLeavening: false }), false);
  assert.equal(showsLeaveningKnob({ ...fresh(), leaveningRid: 'r-yeast', logic: 'total' }), false);
  assert.equal(showsLeaveningKnob({ logic: 'orders', leaveningKey: 'yeast', showLeavening: true }), true, 'own tabs unchanged');
});

test('normalizeRecipe derives the baseline from the default % when a linked tab has a leavening row', () => {
  const [withRid, withoutRid] = normalizeConfig({ clients: [], recipes: [
    { ...fresh(), leaveningRid: 'r-yeast', leaveningDefaultPct: 2 },
    { ...legacy(), id: 'r3', baselinePct: null, leaveningDefaultPct: 2 },
  ] }).recipes;
  assert.equal(withRid.baselinePct, 2);
  assert.equal(withoutRid.baselinePct, null, 'the leftover own key gives a linked tab no baseline');
});

test('a fresh linked tab, after the pick, scales the yeast with the knob', () => {
  const tab = fresh();
  chooseLeavening(tab, 'r-yeast', rowsOf(tab));
  const saved = normalizeConfig({ clients: [], recipes: [tab] }).recipes[0];
  assert.equal(showsLeaveningKnob(saved), true);
  const grams = pct => scaleRecipe(recipeSpec(sheetRecipe(saved, resolveRecipe(saved, CATALOGUE))), 1710, pct);
  assert.ok(grams(2)[2] > grams(1)[2], `yeast at 2% (${grams(2)[2]}) must exceed yeast at 1% (${grams(1)[2]})`);
  assert.equal(Math.round(grams(2).reduce((a, b) => a + b, 0)), 1710);
});

test('the screens go through the shared helpers', () => {
  const recipes = readFileSync(new URL('../js/recipes.js', import.meta.url), 'utf8');
  assert.match(recipes, /chooseLeavening\(recipe, select\.value, linkedRows\)/);
  assert.match(recipes, /if \(tabLeaveningId\(recipe\)\)/);
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /buildRecipePanel\(r, effectiveRecipe\(r\)\)/, 'the knob is named after the row it scales');
});
