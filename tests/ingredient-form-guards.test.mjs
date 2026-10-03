// The ingredient card's save guards and their words. No DOM is available under node --test,
// so this pins the wiring that a pure test cannot reach; the decisions themselves are tested
// in pack-size-weight.test.mjs (isUnusableWeight) and record-choices.test.mjs (isBlankNewChoice).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
import { newCardSource } from './helpers/card-source.mjs';
// The NEW card only: the card of before is pinned in legacy-card.test.mjs.
const FORM = newCardSource();
const I18N = read('js/i18n.js');

test('the weight placeholder is a bare number, in both languages', () => {
  assert.match(I18N, /'orders\.eg\.packWeight': 'e\.g\. 2\.5'/);
  assert.match(I18N, /'orders\.eg\.packWeight': 'es\. 2,5'/, 'Italian writes the comma; both marks are read');
  assert.doesNotMatch(I18N, /'orders\.eg\.packWeight': '[^']*kg/);
});

test('save is blocked, before anything is written, by an unusable weight or an empty «new …» box', () => {
  const guard = FORM.indexOf("[weight, category, ...(kind === 'carton' ? [pack] : [])].find(control => control.invalid())");
  assert.ok(guard > 0);
  assert.ok(guard < FORM.indexOf('await actions.saveIngredient('));
  assert.match(FORM, /refused\.markInvalid\(\)/);
  assert.match(FORM, /isUnusableWeight\(amount\.value, unit\.value\)/);
  assert.match(FORM, /isBlankNewChoice\(select\.value === NEW_CHOICE, typed\.value\)/);
  assert.match(FORM, /setAttribute\('aria-invalid', 'true'\)/);
});

test('an unreadable stored weight can be removed, and only by that button', () => {
  assert.match(FORM, /t\('orders\.weight\.remove'\)/);
  assert.match(FORM, /read: \(\) => joinWeight\(amount\.value, unit\.value\) \|\| legacy,/);
});

test('the «new …» boxes carry an accessible name, and the phrases exist in both languages', () => {
  assert.match(FORM, /ariaLabel: t\('orders\.choice\.categoryAria'\)/);
  assert.match(FORM, /ariaLabel: t\('orders\.choice\.packAria'\)/);
  assert.match(FORM, /selectLabel: t\('orders\.format\.innerAria'\)/, 'the inner-word menu itself is named too');
  assert.match(FORM, /'aria-label': t\('orders\.case\.count'\)/, 'and so is the count box');
  for (const key of ['orders.weight.remove', 'orders.choice.categoryAria', 'orders.choice.packAria', 'orders.format.innerAria']) {
    assert.equal(I18N.split(`'${key}':`).length - 1, 2, key);
  }
});

test('the menus match the stored value by its exact spelling', () => {
  assert.match(FORM, /values\.find\(v => v === wanted\)/);
  assert.doesNotMatch(FORM, /toLowerCase\(\) === wanted/);
});

test('a refused box shows a message tied to it by aria-describedby, and loses it once edited', () => {
  assert.match(FORM, /box\.setAttribute\('aria-describedby', id\)/);
  assert.match(FORM, /amount\.addEventListener\('input', refusal\.clear\)/);
  assert.match(FORM, /typed\.addEventListener\('input', refusal\.clear\)/);
  for (const key of ['orders.weight.invalid', 'orders.choice.categoryBlank', 'orders.choice.packBlank', 'orders.format.countInvalid', 'orders.weight.removeAria']) {
    assert.equal(I18N.split(`'${key}':`).length - 1, 2, key);
  }
  assert.match(FORM, /'aria-label': t\('orders\.weight\.removeAria', \{ value: legacy \}\)/);
});

test('the VAT line follows the order unit, package, count and weight as they stand in the open card', () => {
  assert.match(FORM, /unitCost\(\{ \.\.\.\(item \|\| \{\}\), \.\.\.ctx\.order\(\) \}, draft\)/);
  assert.match(FORM, /const now = \(\) => ctx\.now\(\);/, 'now() is the card as it stands');
  assert.match(FORM, /packCount: 'packCount' in patch \? patch\.packCount : \(item\?\.packCount \?\? null\),/);
  assert.match(FORM, /weight\.onChange\(syncFormat\)/);
  assert.match(FORM, /pack\.onChange\(syncFormat\)/);
});

test('the Italian case wording says cartone everywhere', () => {
  assert.match(I18N, /'orders\.case\.price': 'Prezzo cartone/);
  assert.match(I18N, /'orders\.case\.count': 'Quanti nel cartone'/);
  assert.match(I18N, /'orders\.case\.summaryPiece': '= \{rate\} al pezzo'/);
  assert.match(I18N, /'orders\.format\.carton': 'Cartone'/);
  assert.match(I18N, /'orders\.format\.summary': 'Cartone da \{items\} da \{size\} \(\{total\}\)'/);
});

test('a text link is at least 24px tall', () => {
  const CSS = read('orders.css');
  assert.match(CSS, /\.mgmt-link \{[^}]*min-height: 24px/);
});
