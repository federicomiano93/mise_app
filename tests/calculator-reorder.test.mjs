// calculator-reorder.test.mjs — putting a Calculator recipe's ingredients in a different order.
//
// Federico, 29 Oct 2026: «inserisci la funzione di ordinare gli ingredienti nella scheda
// calcolatore come è fatta nella scheda ricette».

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moveIngredient, normalizeConfig, recipeSpec, DEFAULT_CONFIG } from '../js/calculator-config.js';
import { recipeTotal, scaleRecipe } from '../js/calculator-dough-math.js';
import { chooseLeavening } from '../js/calculator-recipe-source.js';
import { _dictionaries } from '../js/i18n.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('an ingredient moves to its new place, and the others close up around it', () => {
  const [a, b, c, d] = ['flour', 'water', 'salt', 'yeast'].map(label => ({ label }));
  assert.deepEqual(moveIngredient([a, b, c, d], 0, 2).map(r => r.label), ['water', 'salt', 'flour', 'yeast']);
  assert.deepEqual(moveIngredient([a, b, c, d], 3, 0).map(r => r.label), ['yeast', 'flour', 'water', 'salt']);
});

test('⚠️⚠️ the SAME row objects move, so an ingredient keeps its key', () => {
  const flour = { key: 'flour', label: 'flour', grams: 1000 };
  const yeast = { key: 'yeast', label: 'yeast', grams: 20 };
  const out = moveIngredient([flour, yeast], 1, 0);
  assert.equal(out[0], yeast, 'not a copy: the very row');
  assert.equal(out[0].key, 'yeast');
});

test('a move that goes nowhere, or off the end, changes nothing and never throws', () => {
  const rows = [{ label: 'a' }, { label: 'b' }];
  for (const [from, to] of [[0, 0], [-1, 0], [0, 2], [5, 1], ['x', 1], [null, undefined]]) {
    assert.deepEqual(moveIngredient(rows, from, to), rows, `${from} → ${to}`);
  }
  assert.notEqual(moveIngredient(rows, 0, 1), rows, 'a new list, never the one it was given');
  assert.deepEqual(moveIngredient(null, 0, 1), []);
});

test('⚠️ reordering changes only the ORDER: the leavening and the dough stay the same', () => {
  const recipe = {
    id: 'r1', name: 'Test', logic: 'orders', visible: true, order: 0,
    ingredients: [
      { key: 'flour', label: 'Flour', grams: 1000 },
      { key: 'water', label: 'Water', grams: 700 },
      { key: 'yeast', label: 'Yeast', grams: 20 },
      { key: 'salt', label: 'Salt', grams: 25 },
    ],
    leaveningKey: 'yeast', leaveningDefaultPct: 2, showLeavening: true, baselinePct: 2,
  };
  const moved = { ...recipe, ingredients: moveIngredient(recipe.ingredients, 2, 0) };
  assert.equal(moved.ingredients[0].key, 'yeast');

  const build = r => normalizeConfig({ ...DEFAULT_CONFIG, clients: [], recipes: [r] }).recipes.find(x => x.id === 'r1');
  const before = build(recipe);
  const after = build(moved);

  assert.equal(after.leaveningKey, before.leaveningKey);
  assert.equal(after.leaveningDefaultPct, before.leaveningDefaultPct);
  assert.equal(after.baselinePct, before.baselinePct);
  const set = r => r.ingredients.map(i => `${i.key}|${i.label}|${i.grams}`).sort();
  assert.deepEqual(set(after), set(before));
  assert.notDeepEqual(after.ingredients.map(i => i.key), before.ingredients.map(i => i.key), 'only the order differs');

  const specBefore = recipeSpec(before);
  const specAfter = recipeSpec(after);
  assert.equal(recipeTotal(specAfter.amounts), recipeTotal(specBefore.amounts));
  const gramsFor = (spec, pct) => {
    const out = scaleRecipe(spec, 5000, pct);
    return Object.fromEntries(Object.keys(spec.amounts).map((k, i) => [k, out[i]]));
  };
  for (const pct of [1, 2, 3.5]) {
    assert.deepEqual(gramsFor(specAfter, pct), gramsFor(specBefore, pct), `per-key grams at ${pct}%`);
  }
});

test('⚠️⚠️ a NEW row with the leavening’s name, dragged above it, never takes the leavening (code review, 29 Oct 2026)', () => {
  // The new «Yeast» has no key yet: on save its key is made from its name. It used to be
  // the FIRST row asking for `yeast` that got it — so dragged above the saved Yeast, the new
  // 5 g row became the leavening, and every dough of the recipe changed without a word.
  const recipe = {
    id: 'r1', name: 'Test', logic: 'orders', visible: true, order: 0,
    ingredients: [
      { key: 'flour', label: 'Flour', grams: 1000 },
      { key: 'yeast', label: 'Yeast', grams: 20 },
      { key: '', label: 'Yeast', grams: 5 },
    ],
    leaveningKey: 'yeast', leaveningDefaultPct: 2, showLeavening: true, baselinePct: 2,
  };
  const build = r => normalizeConfig({ ...DEFAULT_CONFIG, clients: [], recipes: [r] }).recipes.find(x => x.id === 'r1');
  for (const ingredients of [recipe.ingredients, moveIngredient(recipe.ingredients, 2, 1), moveIngredient(recipe.ingredients, 2, 0)]) {
    const out = build({ ...recipe, ingredients: ingredients.map(i => ({ ...i })) });
    const leaven = out.ingredients.find(i => i.key === out.leaveningKey);
    assert.equal(leaven.grams, 20, `the leavening stays the saved 20 g row (order ${ingredients.map(i => i.grams)})`);
    assert.equal(new Set(out.ingredients.map(i => i.key)).size, 3, 'every key unique');
  }
  // Rows that all have a key, or none, keep the keys they always had.
  const none = build({ ...recipe, leaveningKey: null, ingredients: [{ label: 'Yeast', grams: 1 }, { label: 'Yeast', grams: 2 }] });
  assert.deepEqual(none.ingredients.map(i => i.key), ['yeast', 'yeast-1']);
  const all = build({ ...recipe, ingredients: [{ key: 'a', label: 'A', grams: 1 }, { key: 'a', label: 'B', grams: 2 }] });
  assert.deepEqual(all.ingredients.map(i => i.key), ['a', 'a-1']);
});

test('⚠️ choosing a keyless row as the leavening gives it a key no other row has', () => {
  // «name-<index>» can already belong to an older row once rows move around.
  const recipe = { ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }, { key: 'yeast-2', label: 'Old', grams: 9 }, { key: '', label: 'Yeast', grams: 20 }] };
  assert.equal(chooseLeavening(recipe, '#2', null), true);
  assert.notEqual(recipe.leaveningKey, 'yeast-2');
  assert.equal(recipe.ingredients[2].key, recipe.leaveningKey);
  assert.equal(recipe.ingredients.filter(i => i.key === recipe.leaveningKey).length, 1);
});

test('⚠️ the recipe editor reorders in a MODE, by drag (held on a phone) or arrow keys, and marks the recipe changed', () => {
  const src = codeOf(read('js/recipes.js'));
  assert.match(src, /import Sortable from '\.\/vendor\/sortable\.esm\.js';/);
  assert.match(src, /delay: 200,\s*delayOnTouchOnly: true,/, 'hold to drag on a phone, so a scroll never moves a row');
  assert.match(src, /draggable: '\.cp-reorder-row',/);
  assert.match(src, /ingredientSortable\?\.destroy\(\);\s*ingredientSortable = null;/, 'the old instance goes before the redraw');
  assert.match(src, /r\.ingredients = moveIngredient\(r\.ingredients, from, to\);\s*markDirty\(\);/,
    'a move is an edit: nothing is saved until Save, and leaving asks first');
  assert.match(src, /event\.key !== 'ArrowUp' && event\.key !== 'ArrowDown'/, 'the keyboard can do it too (P18)');
  assert.match(src, /reorderBtn\.hidden = r\.ingredients\.length < 2;/, 'nothing to reorder with one row');
  assert.doesNotMatch(src, /catalogue\/catalogue-model|catalogue\/catalogue-editor/, 'a feature never imports another');
});

test('⚠️ Save with a row to fix leaves reorder mode first, so that row can be shown', () => {
  const src = codeOf(read('js/recipes.js'));
  assert.match(src, /showErrors = true;\s*reorderingIngredients = false;\s*activeRecipe = invalid;/);
});

test('the words exist in both languages', () => {
  const { en, it } = _dictionaries();
  for (const key of ['calc.reorderIngredients', 'calc.reorderDone', 'calc.reorderHint', 'calc.moveIngredient']) {
    assert.ok(en[key] && it[key], `${key} in both languages`);
    assert.notEqual(en[key], it[key], `${key} in Italian must not be the English`);
  }
  assert.match(en['calc.moveIngredient'], /\{name\}/);
  assert.match(it['calc.moveIngredient'], /\{name\}/);
});

test('the styles exist, and a hidden button really is hidden', () => {
  const css = read('style.css');
  assert.match(css, /\.cp-reorder-btn\s*\{/);
  assert.match(css, /\.cp-reorder-row\s*\{/);
  assert.match(css, /\.cp-reorder-btn\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
});
