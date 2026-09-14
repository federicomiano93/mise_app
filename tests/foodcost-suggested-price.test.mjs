// «What do I sell it at?» — the suggested selling price, and no money under a recipe line.
//
// Federico, 13 Sep 2026: «la sezione riguardante il prezzo di vendita … un'altra versione
// dove avendo calcolato sopra il costo … io inserisco … l'iva, il food cost che voglio
// avere e lui mi da il prezzo a cui lo dovrei vendere». Asked whether that should be a
// switch or both at once, he chose ONE SCREEN. And: «nella sezione "composto da" non
// mostrare il prezzo».

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { suggestedGrossPrice, costProduct } from '../js/foodcost/foodcost-model.js';
import { _dictionaries } from '../js/i18n.js';

const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = p => codeOf(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));

test('the suggested price puts the food cost exactly at its target, VAT added back', () => {
  // 0.60 to make, 30% target → 2.00 net; with 10% VAT → 2.20 on the label.
  assert.equal(suggestedGrossPrice({ unitCost: 0.6, vatRate: 10, targetPct: 30 }), 2.2);
  assert.equal(suggestedGrossPrice({ unitCost: 0.6, vatRate: 22, targetPct: 30 }), 2.44);
  assert.equal(suggestedGrossPrice({ unitCost: 1.25, vatRate: 20, targetPct: 25 }), 6);
});

test('⚠️ a VAT rate of 0 is a real rate (UK takeaway bread), not a missing one', () => {
  assert.equal(suggestedGrossPrice({ unitCost: 0.6, vatRate: 0, targetPct: 30 }), 2);
});

test('⚠️⚠️ ROUNDED UP to the cent, so the real food cost is never above the target', () => {
  // 0.50 / 0.30 × 1.10 = 1.8333… → 1.84, never 1.83.
  const price = suggestedGrossPrice({ unitCost: 0.5, vatRate: 10, targetPct: 30 });
  assert.equal(price, 1.84);
  const product = {
    name: 'p', components: [{ recipeId: 'R', qtyKg: 1 }], packaging: [],
    sellingMode: 'weight', piecesPerBatch: null, sellingPrice: price, vatRate: 10, foodCostTarget: 30,
  };
  const tables = { recipes: { R: { id: 'R', name: 'R', ingredients: [{ label: 'x', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'I' }] } },
    ingredients: { I: { id: 'I', priceUnit: 'kg', pricePerUnit: 0.5 } } };
  const result = costProduct(product, tables);
  assert.equal(result.unitCost, 0.5, 'the fixture really costs 0.50 a kilo');
  assert.ok(result.foodCostPct <= 30, `at the suggested price the food cost is ${result.foodCostPct}%, not above 30%`);
});

test('a price that is already a whole number of cents is not pushed up by floating-point dust', () => {
  // 0.72 / 0.30 = 2.4000000000000004 in binary floating point.
  assert.equal(suggestedGrossPrice({ unitCost: 0.72, vatRate: 0, targetPct: 30 }), 2.4);
});

test('nothing is suggested without the cost, the VAT rate and a target', () => {
  for (const input of [
    {}, { unitCost: 0.6, vatRate: 10 }, { unitCost: 0.6, targetPct: 30 }, { vatRate: 10, targetPct: 30 },
    { unitCost: 0, vatRate: 10, targetPct: 30 }, { unitCost: 0.6, vatRate: -1, targetPct: 30 },
    { unitCost: 0.6, vatRate: 10, targetPct: 0 }, { unitCost: 0.6, vatRate: 10, targetPct: 120 },
    { unitCost: 'abc', vatRate: 10, targetPct: 30 },
  ]) {
    assert.equal(suggestedGrossPrice(input), null, JSON.stringify(input));
  }
  assert.equal(suggestedGrossPrice(), null);
});

test('⚠️ the editor draws the suggestion from the SAME unit cost as the production cost, and «Use this price» fills the price', () => {
  const editor = read('js/foodcost/foodcost-editor.js');
  assert.match(editor, /const price = suggestedGrossPrice\(\{ unitCost: cost\.unitCost, vatRate: working\.vatRate, targetPct: working\.foodCostTarget \}\);/,
    'the suggestion is asked of the model, with the production cost\'s own unit cost');
  assert.match(editor, /const cost = productionCost\(working, tables\);/, 'and that cost includes the weighings being typed');
  assert.match(editor, /working\.sellingPrice = price;\s*priceInput\.value = String\(price\);\s*markDirty\(\);/,
    'the button sets the product\'s price AND the box a person sees, and marks the product changed');
  assert.match(editor, /paintSuggestion\(tables\);/, 'repainted with every other figure');
});

test('⚠️⚠️ no money under a recipe line, and none in the recipe chooser', () => {
  const editor = read('js/foodcost/foodcost-editor.js');
  const start = editor.indexOf('function lineNote(');
  const recipeBranch = editor.slice(start, editor.indexOf('const ingredient = tables.ingredients', start));
  assert.ok(recipeBranch.length > 50, 'the recipe branch of lineNote must be found');
  assert.doesNotMatch(recipeBranch, /formatRate|formatMoney|\/ kg/, 'a recipe line says nothing about money');
  assert.match(recipeBranch, /t\('fc\.thisRecipeIsNot'\)/, 'but a recipe with no price still says so');

  const main = read('js/foodcost/foodcost-main.js');
  const opt = main.slice(main.indexOf('recipeOptions()'), main.indexOf('packagingOptions()'));
  assert.doesNotMatch(opt, /costRecipe|formatRate|notPriced|\/ kg/, 'the chooser names recipes and nothing else');
});

test('every new word exists in both languages, and the Italian is Italian', () => {
  const { en, it } = _dictionaries();
  for (const key of ['fc.suggestedPrice', 'fc.suggestedPriceBasis', 'fc.suggestedPriceNeeds', 'fc.suggestedPricePartial',
    'fc.suggestedPriceInUse', 'fc.useThisPrice', 'fc.thisRecipePartlyPriced']) {
    assert.ok(en[key] && it[key], `${key} in both languages`);
    assert.notEqual(en[key], it[key], `${key} in Italian must not be the English`);
  }
  for (const lang of [en, it]) {
    assert.match(lang['fc.suggestedPriceBasis'], /\{vat\}/);
    assert.match(lang['fc.suggestedPriceBasis'], /\{target\}/);
  }
});
