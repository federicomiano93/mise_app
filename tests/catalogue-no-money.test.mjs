// catalogue-no-money.test.mjs — the recipe catalogue shows no money, and loads none.
//
// Federico, 13 Sep 2026: «togli il costo del prodotto dalla scheda ricetta perché non
// scrivendo il calo peso ed ulteriori ingredienti che si aggiungono in un secondo
// momento alla ricetta, il costo non è reale […] inserisci il costo prodotto in food
// cost». A price creeping back onto a catalogue screen would look like a perfectly
// working feature — nothing breaks — so it is the ABSENCE that is pinned here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// Every catalogue screen that shows an ingredient or a recipe.
const SCREENS = [
  'js/catalogue/catalogue-detail.js',
  'js/catalogue/catalogue-editor.js',
  'js/catalogue/ingredient-picker.js',
  'js/catalogue/ingredient-suggest.js',
  'js/catalogue/catalogue-list.js',
  'js/catalogue/allergen-sheet.js',
  'js/catalogue/label-view.js',
  // ⚠️ SHARED since 13 Sep 2026 and drawn inside the catalogue: they take their words from
  // the caller and must never format a price of their own.
  'js/pick-suggest.js',
  'js/pick-screen.js',
];

test('⚠️ no catalogue screen computes or formats money', () => {
  for (const file of SCREENS) {
    const code = codeOf(read(file));
    assert.doesNotMatch(code, /\b(formatMoney|formatRate|pricePerKg|costRecipe|partialCostText|currentCurrency)\b/,
      `${file} works with money again`);
    assert.doesNotMatch(code, /price-model\.js|recipe-cost-model\.js'/, `${file} imports a price or cost model`);
  }
});

test('⚠️ the recipe screen holds no cost card, and its styles are gone', () => {
  const detail = codeOf(read('js/catalogue/catalogue-detail.js'));
  assert.doesNotMatch(detail, /costPanel|cat-cost-panel/, 'the cost card is back on the recipe screen');
  assert.doesNotMatch(read('catalogue.css'), /\.cat-cost-(panel|head|label|value|basis|partial|none)\b/,
    'styles for a card that no longer exists');
});

test('⚠️⚠️ the catalogue does not even READ the prices', () => {
  // With nothing showing a price, reading them would cost one read per priced
  // ingredient on every open, and leave them cached on every phone that opens the
  // catalogue — an employee's included.
  const layer = codeOf(read('js/catalogue/firebase-catalogue.js'));
  assert.doesNotMatch(layer, /ingredient-prices|INGREDIENT_PRICES|withPrices/,
    'the catalogue is listening to the price collection again');
  // ⚠️ AND NOT THE LEGACY PRICE FIELDS some ingredient documents still carry (they drain
  // out only as each ingredient is saved again). Found by driving the app: one was in the
  // catalogue's localStorage copy after the price listener had gone.
  assert.match(layer, /import \{ PRICE_FIELDS \} from '\.\.\/price-model\.js';/,
    'the list of price fields comes from the one place that defines it');
  assert.match(layer, /snap => onChange\(snap\.docs\.map\(d => withoutPrice\(\{ id: d\.id, \.\.\.d\.data\(\) \}\)\)\)/,
    'every ingredient passes through withoutPrice before the catalogue sees it');
  assert.match(layer, /PRICE_FIELDS\.forEach\(key => \{ delete out\[key\]; \}\);/);
});

test('the words only the cost card used are gone from both languages', () => {
  const dict = read('js/i18n.js');
  for (const key of ['cat.noCostYetLink', 'cat.cost', 'cat.costOver', 'cat.costOverLoss', 'cat.noPriceYet']) {
    assert.ok(!dict.includes(`'${key}':`), `${key} is still in the dictionary with nothing using it`);
  }
});

// Comments stripped before every source check — a guard that fires on its own warning
// comment is a guard people widen. Copied from tests/photo-image-model.test.mjs.
function codeOf(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => { const at = line.indexOf('//'); return at === -1 ? line : line.slice(0, at); })
    .join('\n');
}
