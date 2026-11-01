// catalogue-no-money.test.mjs — the recipe catalogue shows no money, and keeps none.
//
// Federico, 13 Sep 2026: «togli il costo del prodotto dalla scheda ricetta perché non
// scrivendo il calo peso ed ulteriori ingredienti che si aggiungono in un secondo
// momento alla ricetta, il costo non è reale […] inserisci il costo prodotto in food
// cost». A price creeping back onto a catalogue screen would look like a perfectly
// working feature — nothing breaks — so it is the ABSENCE that is pinned here.
//
// Federico, 28 Oct 2026, partly reversing that: the recipe editor marks a row Food cost
// cannot price with a small crossed-out euro — no words, no amount. For that the prices
// are read, but ONLY while the recipe editor is open, ONLY for somebody who may read Food
// cost, NEVER stored, and never shown or formatted. So the rule now is: the screens still
// touch no money and no cost model; one small pure file (unpriced-rows.js) is the only
// place the catalogue meets the cost model, and it answers with booleans.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unpricedRowFlags } from '../js/catalogue/unpriced-rows.js';

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
  // ⚠️ Since 13 Sep 2026 a recipe row can add a missing ingredient with the records' own card.
  // The price box inside that card is the CARD's; the catalogue's own code handles no money.
  'js/ingredient-create.js',
];

test('⚠️ no catalogue screen computes or formats money', () => {
  for (const file of SCREENS) {
    const code = codeOf(read(file));
    assert.doesNotMatch(code, /\b(formatMoney|formatRate|pricePerKg|costRecipe|partialCostText|currentCurrency)\b/,
      `${file} works with money again`);
    // ⚠️ The editor reaches the cost model ONLY through unpriced-rows.js (booleans).
    assert.doesNotMatch(code, /price-model\.js|recipe-cost-model\.js/, `${file} imports a price or cost model`);
  }
});

test('⚠️ the recipe screen holds no cost card, and its styles are gone', () => {
  const detail = codeOf(read('js/catalogue/catalogue-detail.js'));
  assert.doesNotMatch(detail, /costPanel|cat-cost-panel/, 'the cost card is back on the recipe screen');
  assert.doesNotMatch(read('catalogue.css'), /\.cat-cost-(panel|head|label|value|basis|partial|none)\b/,
    'styles for a card that no longer exists');
});

test('⚠️⚠️ the catalogue store still never reads the prices', () => {
  // The catalogue's own data layer feeds a store that is copied into localStorage on every
  // phone that opens it — an employee's included. Prices must never get in there.
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

  const store = codeOf(read('js/catalogue/catalogue-store.js'));
  assert.doesNotMatch(store, /editor-prices|unpriced-rows/, 'the store is holding editor prices');
});

test('⚠️ the editor price read is one-shot and keeps nothing', () => {
  const code = codeOf(read('js/catalogue/editor-prices.js'));
  assert.match(code, /\bgetDocs\b/);
  assert.doesNotMatch(code, /onSnapshot|localStorage|sessionStorage|indexedDB/,
    'the price read became a listener or left a copy behind');
  assert.match(code, /return null;/, 'a refused read must resolve null');
});

test('⚠️ the price read happens only for somebody who may read Food cost', () => {
  const main = codeOf(read('js/catalogue/catalogue-main.js'));
  const uses = main.match(/readPricesForEditor/g) || [];
  assert.equal(uses.length, 2, 'one import and one call, nothing else');
  assert.match(main, /readEditorPrices:\s*\(\)\s*=>\s*\{[^}]*mayOpenFoodCost\([^)]*\)\s*\?\s*readPricesForEditor\(\)\s*:\s*Promise\.resolve\(null\)/,
    'the read is not behind mayOpenFoodCost');
  assert.match(codeOf(read('js/catalogue/catalogue-editor.js')), /app\.readEditorPrices/,
    'the editor no longer asks for the prices');
});

test('unpricedRowFlags answers with booleans only, one per row', () => {
  const ingredients = {
    FLOUR: { name: 'Flour' },
    SALT: { name: 'Salt' },
  };
  const prices = { FLOUR: { priceUnit: 'kg', pricePerUnit: 2 } };
  const unpricedSub = { id: 'EMPTY', name: 'Empty', ingredients: [{ label: 'Mystery', grams: 100, unit: 'g' }] };
  const pricedSub = { id: 'DOUGH', name: 'Dough', ingredients: [
    { label: 'Flour', grams: 500, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Mystery', grams: 500, unit: 'g' },
  ] };
  const rows = [
    { label: 'Flour', grams: 100, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },        // 0 priced
    { label: 'Salt', grams: 10, unit: 'g', kind: 'ingredient', refId: 'SALT' },           // 1 no price
    { label: 'Gone', grams: 10, unit: 'g', kind: 'ingredient', refId: 'NOPE' },           // 2 missing
    { label: 'Loose', grams: 10, unit: 'g' },                                             // 3 not linked
    { label: 'Ghost', grams: 10, unit: 'g', kind: 'recipe', refId: 'GHOST' },             // 4 missing recipe
    { label: 'Empty', grams: 10, unit: 'g', kind: 'recipe', refId: 'EMPTY' },             // 5 sub not costable
    { label: 'Dough', grams: 10, unit: 'g', kind: 'recipe', refId: 'DOUGH' },             // 6 partly priced sub
    { label: 'Later', grams: '', unit: 'g' },                                             // 7 no amount
    { label: 'Pinch', grams: '', unit: 'to taste' },                                      // 8 to taste
  ];
  const flags = unpricedRowFlags({ id: 'TOP', name: 'Top', ingredients: rows }, {
    ingredients, recipes: [unpricedSub, pricedSub], prices,
  });
  assert.equal(flags.length, rows.length);
  flags.forEach(f => assert.equal(typeof f, 'boolean'));
  assert.deepEqual(flags, [false, true, true, true, true, true, false, false, false]);
});

test('unpricedRowFlags: no prices read means every linked ingredient row is unpriced, never a throw', () => {
  const flags = unpricedRowFlags(
    { id: 'T', ingredients: [{ label: 'Flour', grams: 100, unit: 'g', kind: 'ingredient', refId: 'FLOUR' }] },
    { ingredients: { FLOUR: { name: 'Flour' } }, recipes: [], prices: null });
  assert.deepEqual(flags, [true]);
  assert.deepEqual(unpricedRowFlags(null, {}), []);
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
