// The name of a field is ONE definition (Federico, 1 Oct 2026: «tutti i nomi delle caselle
// in grassetto, leggermente più grandi e visibili del contenuto»). tokens.css holds the
// size / weight / colour; every class that names an input takes all three and keeps no
// value of its own. A label class missing from this list is a label that drifts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

// [stylesheet, selector as written there]
const FIELD_LABELS = [
  ['orders.css', '.mgmt-field-label'],
  ['records.css', '.rec-host .mgmt-field-label'],
  ['tokens.css', '.set-label'],
  ['order.css', '.co-label'],
  ['style.css', '.cp-label'],
  ['style.css', '.cp-field-label'],
  ['style.css', '.param-label'],
  ['foodcost.css', '.fc-label'],
  ['foodcost.css', '.fc-weigh-label'],
  ['inventory.css', '.inv-label'],
  ['catalogue.css', '.cat-editor label'],
  ['catalogue.css', '.cat-loss-label'],
  ['catalogue.css', '.lab-size-field-name'],
  ['pastries.css', '.pas-editor-label'],
  ['auth.css', '.auth-label'],
  ['orders.css', '.field-label'],
  ['orders.css', '.alg-nut-label'],
  ['records.css', '.rec-host .alg-nut-label'],
  // Found by the review of 1 Oct 2026.
  ['auth.css', '.away-label'],
  ['tokens.css', '.people-label'],
  ['orders.css', '.preview-format-label'],
  ['style.css', '.extra-dough-label'],
];

// Text that is NOT a field's name and must keep the look it had before the tokens: each has
// its own class, and the element no longer wears a field-label class.
const NOT_FIELD_LABELS = [
  ['js/pastries/pastries-editor.js', /class: 'pas-editor-heading'/, 'pastries.css', '.pas-editor-heading'],
  ['js/ingredient-record-form.js', /class: 'alg-nut-title'/, 'orders.css', '.alg-nut-title'],
  ['js/ingredient-record-form.js', /class: 'mgmt-history-label'/, 'orders.css', '.mgmt-history-label'],
  ['js/catalogue/catalogue-editor.js', /class: 'cat-ing-head-label'/, 'catalogue.css', '.cat-editor .cat-ing-head-label'],
];

const ruleOf = (css, selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`));
  assert.ok(m, `${selector} rule missing`);
  return m[1];
};

test('the field-label tokens exist: bold, one step above the 15–16px boxes, full text colour', () => {
  const tokens = read('tokens.css');
  const size = Number(tokens.match(/--field-label-size:\s*(\d+)px;/)?.[1]);
  assert.ok(size >= 17, 'larger than the 16px boxes (the iOS no-zoom size)');
  assert.match(tokens, /--field-label-weight:\s*700;/);
  assert.match(tokens, /--field-label-color:\s*var\(--text\);/);
});

test('every field-label class takes size, weight and colour from the tokens', () => {
  for (const [file, selector] of FIELD_LABELS) {
    const rule = ruleOf(read(file), selector);
    assert.match(rule, /font-size:\s*var\(--field-label-size\)/, `${selector} (${file}) size`);
    assert.match(rule, /font-weight:\s*var\(--field-label-weight\)/, `${selector} (${file}) weight`);
    assert.match(rule, /color:\s*var\(--field-label-color\)/, `${selector} (${file}) colour`);
    assert.doesNotMatch(rule, /text-transform:\s*uppercase/, `${selector} must be sentence case`);
    assert.doesNotMatch(rule, /letter-spacing/, `${selector} must not be letter-spaced`);
  }
});

test('a heading that only looked like a label keeps its own look and its own class', () => {
  for (const [js, usage, css, selector] of NOT_FIELD_LABELS) {
    assert.match(read(js), usage, `${js} uses its own class`);
    const rule = ruleOf(read(css), selector);
    assert.doesNotMatch(rule, /--field-label-/, `${selector} must not take the field-label tokens`);
    assert.match(rule, /font-size:\s*(10px|12px|\.78rem)/, `${selector} keeps its small size`);
  }
  assert.doesNotMatch(read('js/ingredient-record-form.js'), /mgmt-field-label alg-nut-title/);
  assert.doesNotMatch(read('js/pastries/pastries-editor.js'),
    /class: 'pas-editor-label',\s*\n?\s*text: t\('past\.toProveFor/);
});

test('the unit inside a bold label is not bold', () => {
  assert.match(ruleOf(read('catalogue.css'), '.cat-loss-unit'), /font-weight:\s*400/);
});
