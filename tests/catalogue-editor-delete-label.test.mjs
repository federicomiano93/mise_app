// The recipe editor's Delete button speaks the venue's language.
//
// Federico's screenshot of an Italian venue, 13 Sep 2026: «Salva» and, beside it,
// «Delete». The word was written into the code, so no dictionary could reach it — and
// no i18n guard saw it, because a single capitalised word with no punctuation passes
// every «is this English prose?» check this project has.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _dictionaries } from '../js/i18n.js';

const EDITOR = readFileSync(new URL('../js/catalogue/catalogue-editor.js', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('⚠️ the recipe editor writes no bare «Delete» on its button', () => {
  assert.ok(!/'Delete'/.test(EDITOR), 'the label must come from the dictionary');
  assert.match(EDITOR, /class: 'cat-del-btn'[\s\S]{0,200}t\('cat\.deleteRecipe'\)/,
    'the same key the recipe screen\'s own Delete button uses');
});

test('the key it asks for exists in both languages', () => {
  const { en, it } = _dictionaries();
  assert.ok(en['cat.deleteRecipe'] && it['cat.deleteRecipe']);
  assert.notEqual(it['cat.deleteRecipe'], en['cat.deleteRecipe'], 'the Italian must not be the English');
});
