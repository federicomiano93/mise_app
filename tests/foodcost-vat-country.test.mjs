// The VAT choices on a Food cost product follow the venue's COUNTRY.
//
// Federico, 13 Sep 2026, told that Panificio Miano was being offered the UK's 20 / 5 / 0:
// «si dammi aliquota iva per quelle italiane». An Italian venue now offers 22 / 10 / 4;
// a UK venue keeps 20 / 5 / 0; and a rate already stored is never changed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { vatRatesFor, VAT_RATES_BY_COUNTRY } from '../js/foodcost/foodcost-model.js';
import { COUNTRIES } from '../js/market.js';
import { _dictionaries } from '../js/i18n.js';

const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = p => codeOf(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const rates = country => vatRatesFor(country).map(choice => choice.rate);

test('⚠️ an Italian venue is offered the Italian rates', () => {
  assert.deepEqual(rates('IT'), [22, 10, 4]);
});

test('a UK venue keeps the UK rates, zero-rated included', () => {
  assert.deepEqual(rates('GB'), [20, 5, 0]);
});

test('a country the app does not know gets the UK\'s choices, never an empty menu', () => {
  for (const unknown of [null, undefined, '', 'FR', 'it', '__proto__', 'constructor']) {
    assert.deepEqual(rates(unknown), [20, 5, 0], String(unknown));
  }
});

test('⚠️ every country the app knows has its own list — a new one cannot quietly get the UK\'s', () => {
  for (const country of COUNTRIES) {
    assert.ok(Object.prototype.hasOwnProperty.call(VAT_RATES_BY_COUNTRY, country),
      `${country} is a country the app sells in, so it needs its own VAT choices`);
  }
});

test('every choice has words in both languages, with its rate in them', () => {
  const { en, it } = _dictionaries();
  for (const country of Object.keys(VAT_RATES_BY_COUNTRY)) {
    for (const { key } of vatRatesFor(country)) {
      for (const [lang, dict] of [['en', en], ['it', it]]) {
        assert.match(dict[key] || '', /\{rate\}%/, `${key} in ${lang} must carry the rate`);
      }
      assert.notEqual(it[key], en[key], `${key} in Italian must not be the English`);
    }
  }
});

test('⚠️ the editor asks the venue\'s country where it draws the menu, and keeps a rate it does not list', () => {
  const editor = read('js/foodcost/foodcost-editor.js');
  assert.match(editor, /const vatChoices = vatRatesFor\(app\.country\(\)\);/,
    'the menu comes from the country — and inside renderEditor, not at module load, '
    + 'where no venue is open yet');
  assert.ok(editor.indexOf('const vatChoices') > editor.indexOf('export function renderEditor('));
  assert.match(editor, /t\(choice\.key, \{ rate: String\(choice\.rate\) \}\)/, 'the words come from the dictionary');
  assert.match(editor, /if \(working\.vatRate !== null && !vatRates\.includes\(working\.vatRate\)\) \{\s*vatSelect\.value = 'other';\s*vatOther\.value = String\(working\.vatRate\);/,
    '⚠️ a product saved at 20% on an Italian venue shows 20 in the free field — never silently re-rated');
  assert.ok(!/VAT_RATES\b(?!_BY)/.test(editor), 'the old UK-only list is gone');

  assert.match(read('js/foodcost/firebase-foodcost.js'),
    /export function venueCountry\(\) \{\s*return countryOf\(currentSession\(\)\.location\);/,
    'the country is the VENUE\'s, from js/market.js — never the interface language');
  assert.match(read('js/foodcost/foodcost-main.js'), /country: venueCountry,/);
});
