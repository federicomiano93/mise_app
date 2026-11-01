// Recipe categories on the three screens: the list, the recipe editor and Settings
// (js/catalogue/catalogue-list.js, catalogue-editor.js, catalogue-settings.js, catalogue-main.js). P15.
//
// No jsdom in this project, so the wiring is pinned at source level, naming what a later edit could
// quietly break: headings decided over the WHOLE list, the save flag, the word-by-word writes that
// protect the saved list, and every word of the screens living in both dictionaries.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _dictionaries } from '../js/i18n.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const LIST = codeOf(read('js/catalogue/catalogue-list.js'));
const EDITOR = codeOf(read('js/catalogue/catalogue-editor.js'));
const SETTINGS = codeOf(read('js/catalogue/catalogue-settings.js'));
const MAIN = codeOf(read('js/catalogue/catalogue-main.js'));
const DICT = _dictionaries();

test('the list groups the visible recipes by category, keeping the usage order inside a group', () => {
  assert.match(LIST, /groupByCategory\(visible, sortedCategories\(categories, localeTag\(\)\)\)/);
  assert.match(LIST, /sortByUsage\(filterByName\(currentRecipes, query\), currentUsage\)/);
});

test('the headings are decided over the WHOLE recipe list, not over the search result', () => {
  assert.match(LIST, /groupByCategory\(currentRecipes, categories\)\.some\(group => group\.category\)/);
  assert.match(LIST, /if \(headings\)/);
  assert.match(LIST, /el\('h2', \{\s*class: 'cat-group-head'/);
});

test('the list asks for the categories at every paint, through a getter', () => {
  assert.match(LIST, /getCategories = \(\) => \[\]/);
  assert.match(LIST, /const categories = getCategories\(\)/);
  assert.match(MAIN, /getCategories: \(\) => getRecipeCategories\(\)/);
});

test('the editor draws the category menu only for a non-empty list, and never freezes it at load', () => {
  assert.match(EDITOR, /getRecipeCategories = \(\) => \[\]/);
  assert.match(EDITOR, /const categorySelect = categories\.length\s*\?\s*el\('select'/);
  assert.match(EDITOR, /id: 'catRecipeCategory', class: 'set-select cat-category-select'/);
  assert.match(EDITOR, /el\('label', \{ for: 'catRecipeCategory'/);
  assert.match(MAIN, /getRecipeCategories: \(\) => getRecipeCategories\(\)/);
});

test('the editor flags a real move only, and keeps the flag off the database', () => {
  assert.match(EDITOR, /working\.categoryMoved = e\.target\.value !== initialCategory/);
  assert.match(EDITOR, /const initialCategory = draft \? '' : categoryOf\(working, categories\)/);
  // A draft carries a typed choice across the photo screen and back.
  assert.match(EDITOR, /typeof draft\.category === 'string' && draft\.category/);
  assert.match(EDITOR, /category: draft\.category, categoryMoved: true/);
  // The store lists its fields by hand: the flag is read, never written.
  const store = codeOf(read('js/catalogue/catalogue-store.js'));
  assert.doesNotMatch(store, /categoryMoved:/);
});

test('Settings changes one word at a time, judged against what the store holds now', () => {
  assert.match(SETTINGS, /addCategory\(getCategories\(\), input\.value\)/);
  assert.match(SETTINGS, /onAddCategory\(word\)/);
  assert.match(SETTINGS, /onRemoveCategory\(word\)/);
  assert.match(MAIN, /getCategories: \(\) => getRecipeCategories\(\)/);
  assert.match(MAIN, /onAddCategory: word => addRecipeCategory\(word\)/);
  assert.match(MAIN, /onRemoveCategory: word => removeRecipeCategory\(word\)/);
  assert.match(MAIN, /countRecipes: \(word, list\) => countInCategory\(getRecipes\(\), word, list\)/);
});

test('⚠️ the list is never written whole: an old copy on a phone would wipe the venue\'s words', () => {
  const layer = codeOf(read('js/catalogue/firebase-catalogue.js'));
  assert.match(layer, /recipeCategories: arrayUnion\(word\)/);
  assert.match(layer, /recipeCategories: arrayRemove\(\.\.\.words\)/);
  const store = codeOf(read('js/catalogue/catalogue-store.js'));
  assert.doesNotMatch(store, /saveLabelProfile\(\{ recipeCategories/);
  assert.doesNotMatch(store, /saveLabelConfig\(\{ recipeCategories/);
  // What a refusal puts back is that one word, never an earlier copy of the document.
  assert.match(store, /\.catch\(err => categoryWriteRefused\(err, list => removeCategory\(list, word\)\)\)/);
  assert.match(store, /\.catch\(err => categoryWriteRefused\(err, list => \[\.\.\.list, word\]\)\)/);
});

test('deleting a category asks first, and the question says how many recipes are affected', () => {
  assert.match(SETTINGS, /await confirm\(\{[\s\S]*?danger: true/);
  assert.match(SETTINGS, /t\('cat\.shelf\.deleteCategoryUsed', \{ n \}\)/);
});

test('a refused save says so wherever the person is, and the refused word comes back to the box', () => {
  const store = codeOf(read('js/catalogue/catalogue-store.js'));
  assert.match(store, /onSyncError\(t\('cat\.shelf\.categoriesNotSaved'\)\)/);
  assert.match(SETTINGS, /if \(root\.isConnected && !input\.value\) input\.value = word/);
  assert.match(SETTINGS, /role: 'alert'/);
});

test('after a delete the focus goes to the next bin, never to the box: it would raise the keyboard', () => {
  const remove = SETTINGS.slice(SETTINGS.indexOf('async function remove(word)'), SETTINGS.indexOf("addBtn.addEventListener('click', add)"));
  assert.match(remove, /next\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(remove, /input\.focus\(\)/);
});

test('the Settings card is first on the screen and re-worded when the language arrives', () => {
  assert.match(SETTINGS, /root\.append\(\s*categories\.card,\s*photoCard/);
  assert.match(SETTINGS, /categories\.dispose\(\)/);
  assert.match(SETTINGS, /stop = onLanguageChange\(\(\) => \{ if \(root\.isConnected\) paint\(\); \}\)/);
  assert.match(SETTINGS, /refreshCategories: categories\.refresh/);
});

test('a snapshot while Settings is open refreshes its category list', () => {
  assert.match(MAIN, /view === 'settings' && activeSettings\) activeSettings\.refreshCategories\(\)/);
});

test('every phrase of the three screens exists in English and Italian, plurals as plurals', () => {
  const used = new Set();
  for (const src of [LIST, EDITOR, SETTINGS]) {
    for (const m of src.matchAll(/'(cat\.shelf\.[A-Za-z.]+)'/g)) used.add(m[1]);
  }
  for (const m of SETTINGS.matchAll(/`(cat\.shelf\.refusal\.)\$\{/g)) {
    for (const r of ['empty', 'tooLong', 'taken', 'full']) used.add(m[1] + r);
  }
  assert.ok(used.size >= 15, 'the screens use the cat.shelf keys');
  for (const lang of ['en', 'it']) {
    for (const key of used) assert.ok(key in DICT[lang], `${lang} lacks ${key}`);
    const plural = DICT[lang]['cat.shelf.deleteCategoryUsed'];
    assert.equal(typeof plural, 'object');
    assert.ok(plural.one.includes('{n}') && plural.other.includes('{n}'));
  }
});

test('the category stylesheet rules exist, built from tokens', () => {
  const css = read('catalogue.css');
  for (const cls of ['.cat-group-head', '.cat-category-select', '.cat-category-del', '.cat-category-add']) {
    assert.ok(css.includes(cls), `${cls} is missing`);
  }
  assert.match(css, /\.cat-group-head \{[^}]*var\(--cat-text-2\)/);
});

test('the list and Settings reach the data only through what main hands them', () => {
  for (const src of [LIST, SETTINGS]) {
    assert.doesNotMatch(src, /from '[^']*(firebase-catalogue|catalogue-store|firebase)[^']*'/);
  }
});
