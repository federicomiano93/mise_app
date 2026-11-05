// recipe-dividers-screens.test.mjs — the editor, the recipe screen, the words and the style of the divider lines.
// (The data, PDF and Calculator side is in recipe-dividers.test.mjs.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _dictionaries } from '../js/i18n.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the editor saves through withoutTrailingDivider(keepRows(, deletes through removeRow', () => {
  const editor = codeOf(read('js/catalogue/catalogue-editor.js'));
  assert.match(editor, /withoutTrailingDivider\(keepRows\(/);
  assert.match(editor, /working\.ingredients = removeRow\(working\.ingredients, idx\)/);
  assert.match(editor, /hasDividerAfter\(working\.ingredients, idx\)/);
});

test('the recipe screen asks hasDividerAfter for each row', () => {
  assert.match(codeOf(read('js/catalogue/catalogue-detail.js')), /hasDividerAfter\(recipe\.ingredients, i\)/);
});

test('the three words exist in English and Italian, and the name hole is there', () => {
  const dictionaries = _dictionaries();
  for (const lang of ['en', 'it']) {
    const d = dictionaries[lang];
    for (const key of ['cat.dividers', 'cat.dividersHint', 'cat.dividerUnder']) {
      assert.ok(typeof d[key] === 'string' && d[key].trim(), `${lang} ${key}`);
    }
    assert.match(d['cat.dividerUnder'], /\{name\}/);
  }
});

test('the stylesheet styles the line and the two header buttons', () => {
  const css = read('catalogue.css');
  assert.match(css, /\.cat-ing-row--divider/);
  assert.match(css, /\.cat-ing-head-actions/);
});
