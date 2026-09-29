// The ingredient card's save guards and their words. No DOM is available under node --test,
// so this pins the wiring that a pure test cannot reach; the decisions themselves are tested
// in pack-size-weight.test.mjs (isUnusableWeight) and record-choices.test.mjs (isBlankNewChoice).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const FORM = read('js/ingredient-record-form.js');
const I18N = read('js/i18n.js');

test('the weight placeholder is a bare number, in both languages', () => {
  assert.match(I18N, /'orders\.eg\.packWeight': 'e\.g\. 2\.5'/);
  assert.match(I18N, /'orders\.eg\.packWeight': 'es\. 2\.5'/);
  assert.doesNotMatch(I18N, /'orders\.eg\.packWeight': '[^']*kg/);
});

test('save is blocked, before anything is written, by an unusable weight or an empty «new …» box', () => {
  const guard = FORM.indexOf('[weight, category, unit].find(control => control.invalid())');
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
  assert.match(FORM, /ariaLabel: t\('orders\.choice\.unitAria'\)/);
  for (const key of ['orders.weight.remove', 'orders.choice.categoryAria', 'orders.choice.unitAria']) {
    assert.equal(I18N.split(`'${key}':`).length - 1, 2, key);
  }
});

test('the menus match the stored value by its exact spelling', () => {
  assert.match(FORM, /values\.find\(v => v === wanted\)/);
  assert.doesNotMatch(FORM, /toLowerCase\(\) === wanted/);
});
