// catalogue-reorder.test.mjs — putting a recipe's ingredients in a different order.
//
// Federico, 13 Sep 2026: «nella scheda ricetta dammi la possibilità di spostare l'ordine
// degli ingredienti già compilati».

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moveRow } from '../js/catalogue/catalogue-model.js';
import { _dictionaries } from '../js/i18n.js';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('a row moves to its new place, and the others close up around it', () => {
  const [a, b, c, d] = ['flour', 'water', 'salt', 'yeast'].map(label => ({ label }));
  assert.deepEqual(moveRow([a, b, c, d], 0, 2).map(r => r.label), ['water', 'salt', 'flour', 'yeast']);
  assert.deepEqual(moveRow([a, b, c, d], 3, 0).map(r => r.label), ['yeast', 'flour', 'water', 'salt']);
});

test('⚠️⚠️ the SAME row objects move, so a row keeps its link and its rid — the step that points at it', () => {
  const flour = { label: 'flour', rid: 'r1', kind: 'ingredient', refId: 'FLOUR' };
  const water = { label: 'water', rid: 'r2' };
  const out = moveRow([flour, water], 0, 1);
  assert.equal(out[1], flour, 'not a copy: the very row');
  assert.equal(out[1].rid, 'r1');
  assert.equal(out[1].refId, 'FLOUR');
});

test('a move that goes nowhere, or off the end, changes nothing and never throws', () => {
  const rows = [{ label: 'a' }, { label: 'b' }];
  for (const [from, to] of [[0, 0], [-1, 0], [0, 2], [5, 1], ['x', 1], [null, undefined]]) {
    assert.deepEqual(moveRow(rows, from, to), rows, `${from} → ${to}`);
  }
  assert.notEqual(moveRow(rows, 0, 1), rows, 'a new list, never the one it was given');
  assert.deepEqual(moveRow(null, 0, 1), []);
});

test('⚠️ the editor reorders in a MODE, by drag (held on a phone) or by arrow keys, and marks the recipe changed', () => {
  const editor = codeOf(read('js/catalogue/catalogue-editor.js'));
  assert.match(editor, /import Sortable from '\.\.\/vendor\/sortable\.esm\.js';/);
  assert.match(editor, /delay: 200,\s*delayOnTouchOnly: true,/, 'hold to drag on a phone, so a scroll never moves a row');
  assert.match(editor, /draggable: '\.cat-reorder-row',/);
  assert.match(editor, /sortable\?\.destroy\(\);/, 'the old instance goes before the rows are rebuilt');
  assert.match(editor, /working\.ingredients = moveRow\(working\.ingredients, from, to\);\s*markDirty\(\);/,
    'a move is an edit: nothing is saved until Save, and leaving asks first');
  assert.match(editor, /event\.key !== 'ArrowUp' && event\.key !== 'ArrowDown'/, 'the keyboard can do it too (P18)');
  assert.match(editor, /reorderBtn\.hidden = working\.ingredients\.length < 2;/, 'nothing to reorder with one row');
});

test('the words exist in both languages', () => {
  const { en, it } = _dictionaries();
  for (const key of ['cat.reorder', 'cat.reorderDone', 'cat.reorderHint', 'cat.moveRow', 'cat.unnamedRow']) {
    assert.ok(en[key] && it[key], `${key} in both languages`);
    assert.notEqual(en[key], it[key], `${key} in Italian must not be the English`);
  }
  assert.match(it['cat.moveRow'], /\{name\}/);
});

test('⚠️ Save with a row to fix leaves reorder mode first, so that row can be shown and reached', () => {
  // The code review of 14 Sep 2026: the reorder rows have no name or amount box, so a Save
  // refused in that mode redrew rows with nothing to highlight.
  const editor = codeOf(read('js/catalogue/catalogue-editor.js'));
  const save = editor.slice(editor.indexOf('async function onSave()'), editor.indexOf('async function onDelete()'));
  assert.match(save, /if \(problem\) \{\s*showErrors = true;\s*if \(reordering\) setReordering\(false\);\s*renderIngredientRows\(\);/);
  assert.match(editor, /onclick: \(\) => setReordering\(!reordering\),/, 'the button and the save share one way out');
});
