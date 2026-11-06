// The «Cost per 1 kg» block of the Food cost product editor, pinned at source level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The editor is checked in with CRLF line ends: compare on LF.
const src = readFileSync(new URL('../js/foodcost/foodcost-editor.js', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');

test('the editor imports costPerKg and calls it with the live tables inside paintPerKg', () => {
  assert.match(src, /import \{ costPerKg \} from '\.\/per-kg-model\.js'/);
  const body = /function paintPerKg\(tables\) \{([\s\S]*?)\n  \}\n/.exec(src);
  assert.ok(body, 'paintPerKg exists');
  assert.match(body[1], /costPerKg\(working, tables\)/);
  const paint = /function paintAnswer\(\) \{([\s\S]{0,400})/.exec(src)[1];
  assert.match(paint, /const tables = liveTables\(\)/);
  assert.match(paint, /paintPerKg\(tables\)/);
});

test('the block is one persistent details element, in root after the answer, never inside Composto da', () => {
  assert.match(src, /const perKg = el\('details', \{ class: 'fc-perkg' \}\)/);
  const root = /const root = el\('div', \{ class: 'fc-view fc-editor' \}, \[([\s\S]*?)\n    el\('div', \{ class: 'fc-field' \}/.exec(src);
  assert.ok(root, 'root found');
  assert.ok(root[1].indexOf('answer,') > -1 && root[1].indexOf('answer,') < root[1].indexOf('perKg,'));
  const madeOf = /const madeOf = el\([^\n]*/.exec(src)[0];
  assert.doesNotMatch(madeOf, /perKg/);
});

test('the reason key table holds the three reasons', () => {
  const table = /const PER_KG_REASON_TEXT = \{([\s\S]*?)\};/.exec(src);
  assert.ok(table);
  assert.match(table[1], /'no-price': 'fc\.perKg\.noPrice'/);
  assert.match(table[1], /'not-weighed': 'fc\.perKg\.notWeighed'/);
  assert.match(table[1], /'no-recipe': 'fc\.perKg\.noRecipe'/);
});
