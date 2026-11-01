// tests/recipe-categories-model.test.mjs — the venue's list of recipe categories and how recipes
// are grouped under it, plus the pins that keep a category from being lost by a save.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RECIPE_CATEGORY_MAX, RECIPE_CATEGORIES_MAX,
  categoryKey, normalizeRecipeCategories, sortedCategories, categoryOf,
  groupByCategory, countInCategory, addCategory, removeCategory,
} from '../js/catalogue/recipe-categories-model.js';
import { normalizeCatalogueRecipe } from '../js/catalogue/catalogue-model.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('two spellings of a word are one category', () => {
  assert.equal(categoryKey(' Natale  di casa '), categoryKey('natale di casa'));
  assert.equal(categoryKey(null), '');
  assert.equal(categoryKey(7), '');
});

test('the stored list is made safe: strings only, tidied, each word once, capped', () => {
  assert.deepEqual(normalizeRecipeCategories(['Natale', ' natale ', '', '  ', 4, null, 'Estate  fredda']),
    ['Natale', 'Estate fredda']);
  assert.deepEqual(normalizeRecipeCategories(undefined), []);
  assert.deepEqual(normalizeRecipeCategories('Natale'), []);
  const long = Array.from({ length: RECIPE_CATEGORIES_MAX + 5 }, (_, i) => `c${i}`);
  assert.equal(normalizeRecipeCategories(long).length, RECIPE_CATEGORIES_MAX);
});

test('the list reads alphabetically, whatever the case and the accents, and the original is left alone', () => {
  const list = ['pane', 'Dolci', 'Èstate', 'Focacce'];
  assert.deepEqual(sortedCategories(list, 'it'), ['Dolci', 'Èstate', 'Focacce', 'pane']);
  assert.deepEqual(list, ['pane', 'Dolci', 'Èstate', 'Focacce']);
});

test('a recipe reads its category as the list spells it, and a word off the list as none', () => {
  const list = ['Natale', 'Pane'];
  assert.equal(categoryOf({ category: 'natale' }, list), 'Natale');
  assert.equal(categoryOf({ category: 'Pasqua' }, list), '');
  assert.equal(categoryOf({}, list), '');
  assert.equal(categoryOf(null, list), '');
  assert.equal(categoryOf({ category: 5 }, list), '');
});

test('the groups follow the given order, keep the recipes\' order, and «no category» comes last', () => {
  const a = { id: 'a', category: 'Pane' };
  const b = { id: 'b' };
  const c = { id: 'c', category: 'natale' };
  const d = { id: 'd', category: 'Pane' };
  const e = { id: 'e', category: 'Taken off the list' };
  assert.deepEqual(groupByCategory([a, b, c, d, e], ['Natale', 'Pane', 'Empty']), [
    { category: 'Natale', recipes: [c] },
    { category: 'Pane', recipes: [a, d] },
    { category: '', recipes: [b, e] },
  ]);
});

test('with no category in use there is one group and no word: the list as it always was', () => {
  const recipes = [{ id: 'a' }, { id: 'b', category: 'Gone' }];
  assert.deepEqual(groupByCategory(recipes, []), [{ category: '', recipes }]);
  assert.deepEqual(groupByCategory([], ['Natale']), []);
});

test('counting a word counts every spelling of it and nothing off the list', () => {
  const list = ['Natale'];
  const recipes = [{ category: 'Natale' }, { category: 'NATALE' }, { category: 'Pane' }, {}];
  assert.equal(countInCategory(recipes, 'natale', list), 2);
  assert.equal(countInCategory(recipes, 'Pane', list), 0);
  assert.equal(countInCategory(recipes, '', list), 0);
});

test('adding a word tidies it, and refuses the empty, the long, the taken and the full', () => {
  assert.deepEqual(addCategory(['Pane'], '  Natale  di casa '), { list: ['Pane', 'Natale di casa'] });
  assert.deepEqual(addCategory([], 'x'.repeat(RECIPE_CATEGORY_MAX)), { list: ['x'.repeat(RECIPE_CATEGORY_MAX)] });
  assert.deepEqual(addCategory([], '   '), { refusal: 'empty' });
  assert.deepEqual(addCategory([], undefined), { refusal: 'empty' });
  assert.deepEqual(addCategory([], 'x'.repeat(RECIPE_CATEGORY_MAX + 1)), { refusal: 'tooLong' });
  assert.deepEqual(addCategory(['Natale'], ' NATALE '), { refusal: 'taken' });
  const full = Array.from({ length: RECIPE_CATEGORIES_MAX }, (_, i) => `c${i}`);
  assert.deepEqual(addCategory(full, 'one more'), { refusal: 'full' });
});

test('removing a word takes it off whatever the case and leaves the rest', () => {
  const list = ['Natale', 'Pane'];
  assert.deepEqual(removeCategory(list, ' natale'), ['Pane']);
  assert.deepEqual(removeCategory(list, 'Pasqua'), ['Natale', 'Pane']);
  assert.deepEqual(list, ['Natale', 'Pane']);
});

test('the local copy of a recipe carries the category as stored, absent rather than empty', () => {
  const base = { id: 'r', name: 'Pane', ingredients: [] };
  assert.equal(normalizeCatalogueRecipe({ ...base, category: ' Natale ' }).category, 'Natale');
  // A word off the list stays: it comes back if the word is put back.
  assert.equal(normalizeCatalogueRecipe({ ...base, category: 'Gone' }).category, 'Gone');
  assert.equal('category' in normalizeCatalogueRecipe(base), false);
  assert.equal('category' in normalizeCatalogueRecipe({ ...base, category: '  ' }), false);
  assert.equal('category' in normalizeCatalogueRecipe({ ...base, category: 3 }), false);
});

test('a save sends the category only when the menu moved it, and the screen\'s copy keeps it otherwise', () => {
  const store = read('js/catalogue/catalogue-store.js');
  assert.match(store, /if \(recipe\.categoryMoved === true\) data\.category = recipe\.category \|\| null;/);
  assert.match(store, /\['lossPct', 'rawGrams', 'cookedGrams', 'category'\]\.forEach/);
  // Whatever marks the move must never reach the document: the rules whitelist the keys by name.
  assert.doesNotMatch(store, /data\.categoryMoved/);
});

test('an emptied category travels as a removal: the rules refuse an empty word', () => {
  const layer = read('js/catalogue/firebase-catalogue.js');
  assert.match(layer, /CLEARABLE_RECIPE_FIELDS = \[[^\]]*'category'[^\]]*\]/);
  assert.match(layer, /setDoc\(doc\(db, pathFor\(RECIPES\), id\), withBakery\(out\), \{ merge: true \}\)/);
});

test('the rules know both fields, bounded like the app', () => {
  const rules = read('firestore.rules');
  const recipes = rules.slice(rules.indexOf('match /recipes/{id}'), rules.indexOf('allow delete', rules.indexOf('match /recipes/{id}')));
  assert.match(recipes.slice(recipes.indexOf('hasOnly(['), recipes.indexOf('])')), /'category'/);
  assert.match(recipes, /category\.size\(\) > 0/);
  assert.match(recipes, /category\.size\(\) <= 100/);
  const labels = rules.slice(rules.indexOf('match /config/labels'), rules.indexOf('allow delete', rules.indexOf('match /config/labels')));
  assert.match(labels, /'recipeCategories'/);
  assert.match(labels, /recipeCategories\.size\(\) <= 100/);
});

test('the list is never written before the listener has given a real answer', () => {
  const store = read('js/catalogue/catalogue-store.js');
  assert.match(store, /if \(remote \|\| !fromCache\) labelConfigAnswered = true;/);
  assert.match(read('js/catalogue/firebase-catalogue.js'), /snap\.metadata\.fromCache/);
});
