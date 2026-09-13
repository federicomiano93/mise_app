// The Food cost product screen speaks the venue's language, menus and labels included.
//
// Found by the code review of the weighing move, 13 Sep 2026: beside the new Italian
// boxes the same screen still wrote «20% — standard», «not priced», «each», «partly
// priced» and four aria-labels in English, straight into the code. No i18n guard saw
// them — an all-lowercase phrase with no punctuation reads like a CSS class list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _dictionaries } from '../js/i18n.js';

const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = p => codeOf(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));

const GONE = ["'Recipe'", "'Packaging item'", "'Kilos'", "'Pieces'", 'partly priced', ' each`',
  "'20% — standard'", "'5% — reduced'", "'0% — zero-rated'", "'not priced'", "'priced by weight'"];

test('⚠️ no English phrase is written into the Food cost screens any more', () => {
  for (const file of ['js/foodcost/foodcost-editor.js', 'js/foodcost/foodcost-main.js']) {
    const src = read(file);
    for (const phrase of GONE) assert.ok(!src.includes(phrase), `${file} still writes ${phrase}`);
  }
});

test('every key they ask for exists in both languages, and the Italian is Italian', () => {
  const { en, it } = _dictionaries();
  const keys = ['fc.vat.standard', 'fc.vat.reduced', 'fc.vat.minimum', 'fc.vat.zero', 'fc.notPriced', 'fc.pricedByWeight',
    'fc.priceEach', 'fc.thisRecipePartlyPriced', 'fc.aria.recipe', 'fc.aria.packagingItem', 'fc.aria.kilos', 'fc.aria.pieces'];
  // The VAT words are named in the model's per-country table, the rest in the two screens.
  const used = read('js/foodcost/foodcost-editor.js') + read('js/foodcost/foodcost-main.js')
    + read('js/foodcost/foodcost-model.js');
  for (const key of keys) {
    assert.ok(used.includes(`'${key}'`), `${key} must actually be asked for`);
    assert.ok(en[key] && it[key], `${key} must exist in both languages`);
    assert.notEqual(it[key], en[key], `${key} in Italian must not be the English`);
  }
  assert.match(en['fc.priceEach'], /\{price\}/);
  assert.match(it['fc.priceEach'], /\{price\}/);
});
