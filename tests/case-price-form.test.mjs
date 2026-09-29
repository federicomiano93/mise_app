// The «A confezione (cartone)» mode of the ingredient card's price block. No DOM is
// available under node --test, so this pins the wiring that a pure test cannot reach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const FORM = read('js/ingredient-record-form.js');
const I18N = read('js/i18n.js');
const CSS = read('orders.css');

const KEYS = [
  'orders.priceByCase', 'orders.case.price', 'orders.case.contains', 'orders.case.count',
  'orders.case.size', 'orders.case.unit', 'orders.case.pcs',
  'orders.case.summaryUnit', 'orders.case.summaryPiece',
];

test('every case phrase exists once in English and once in Italian', () => {
  for (const key of KEYS) {
    const hits = I18N.split(`'${key}':`).length - 1;
    assert.equal(hits, 2, `${key} should be defined in both languages`);
    assert.ok(FORM.includes(`'${key}'`), `${key} is not used by the card`);
  }
});

test('the menu gains a case mode that is not a stored unit', () => {
  assert.match(FORM, /value: CASE_MODE, text: t\('orders\.priceByCase'\)/);
  assert.match(FORM, /priceUnit: unitSelect\.value \|\| null/);
});

test('the form hands all four case boxes to pricePatch', () => {
  for (const key of ['casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit']) {
    assert.match(FORM, new RegExp(key + ': [a-zA-Z]+\.value'), key);
  }
});

test('the count, size and unit boxes each carry an aria-label', () => {
  assert.match(FORM, /caseCountBox\.setAttribute\('aria-label', t\('orders\.case\.count'\)\)/);
  assert.match(FORM, /caseSizeBox\.setAttribute\('aria-label', t\('orders\.case\.size'\)\)/);
  assert.match(FORM, /'aria-label': t\('orders\.case\.unit'\)/);
});

test('pieces hide the size box, and a case reopens as typed', () => {
  assert.match(FORM, /caseSizeBox\.hidden = itemsArePieces/);
  assert.match(FORM, /const storedCase = item \? caseOf\(item\) : null/);
  assert.match(FORM, /rateField\.hidden = inCase/);
});

test('the phrases are read when the form is drawn, never at module level', () => {
  assert.doesNotMatch(FORM, /^const [A-Z_]+ = .*t\('orders\.(case|priceByCase)/m);
});

test('the row styles exist and let the boxes shrink at a narrow width', () => {
  assert.match(CSS, /\.mgmt-case-row \.mgmt-input \{[^}]*min-width: 0/);
  assert.match(CSS, /\.mgmt-case-row \{[^}]*display: flex[^}]*align-items: center/);
});
