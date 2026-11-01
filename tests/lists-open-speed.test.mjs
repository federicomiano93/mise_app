// tests/lists-open-speed.test.mjs — what makes Fornitori and Magazzino open faster on the lab tablet, pinned so a
// tidy-up cannot undo it unnoticed: nothing here shows on screen, only on a stopwatch.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { samePriceMaps } from '../js/price-model.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const price = (pricePerUnit, extra = {}) => ({ bakery: 'v1', priceUnit: 'kg', pricePerUnit, ...extra });

test('the same prices are the same, whichever object holds them', () => {
  assert.equal(samePriceMaps({ a: price(2), b: price(3) }, { a: price(2), b: price(3) }), true);
  assert.equal(samePriceMaps({ b: price(3), a: price(2) }, { a: price(2), b: price(3) }), true);
  assert.equal(samePriceMaps({}, {}), true);
  const map = { a: price(2) };
  assert.equal(samePriceMaps(map, map), true);
});

test('any real difference is a difference', () => {
  assert.equal(samePriceMaps({ a: price(2) }, { a: price(2.5) }), false);
  assert.equal(samePriceMaps({ a: price(2) }, { a: price(2, { vatRate: 4 }) }), false);
  assert.equal(samePriceMaps({ a: price(2) }, { a: price(2), b: price(3) }), false);
  assert.equal(samePriceMaps({ a: price(2), b: price(3) }, { a: price(2) }), false);
  assert.equal(samePriceMaps({ a: price(2) }, { b: price(2) }), false);
  assert.equal(samePriceMaps({ a: price(2) }, {}), false);
});

test('nothing to compare with is a difference: the first answer always draws', () => {
  assert.equal(samePriceMaps({ a: price(2) }, null), false);
  assert.equal(samePriceMaps(null, { a: price(2) }), false);
});

test('it can only err towards a redraw: the same fields in another order count as different', () => {
  assert.equal(samePriceMaps({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } }), false);
});

test('Fornitori: a price answer that changes nothing does not redraw, and still says whether prices are readable', () => {
  const src = read('js/orders/registry-main.js');
  const at = src.indexOf('watchIngredientPrices((map, readable) => {');
  const body = src.slice(at, src.indexOf('});', at));
  assert.ok(at > 0);
  // The two assignments stay above the check: a card opened later reads pricesReadable (registry.js).
  assert.ok(body.indexOf('state.pricesReadable = readable === true') < body.indexOf('samePriceMaps(map, state.mergedPrices)'));
  assert.ok(body.indexOf('state.ingredientPrices = map') < body.indexOf('samePriceMaps(map, state.mergedPrices)'));
  assert.match(body, /if \(state\.loaded\.ingredients && !samePriceMaps\(map, state\.mergedPrices\)\) \{\s+mergePrices\(\);\s+screen\.refresh\(\);/);
  // Both places that build the priced list go through the one function that records what it was built from.
  assert.equal(src.split('withPrices(').length - 1, 1);
  assert.match(src, /function mergePrices\(\) \{\s+state\.ingredients = withPrices\(state\.rawIngredients, state\.ingredientPrices\);\s+state\.mergedPrices = state\.ingredientPrices;/);
});

test('Fornitori: the listeners open suppliers, config, ingredients, prices', () => {
  const src = read('js/orders/registry-main.js');
  const order = [
    'watchCollection(COLLECTIONS.suppliers',
    "watchDoc(COLLECTIONS.config, 'orders'",
    'watchCollection(COLLECTIONS.ingredients',
    'watchIngredientPrices((map, readable)',
  ].map(call => src.indexOf(call));
  assert.ok(order.every(at => at > 0), JSON.stringify(order));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('Fornitori: a tap before the prices land waits for the listener and asks the network only if it was refused', () => {
  const src = read('js/orders/registry-main.js');
  assert.match(src, /readPrice: async \(id\) => \{\s+await pricesAnswered;\s+return state\.pricesReadable \? \(state\.ingredientPrices\[id\] \|\| null\) : readIngredientPrice\(id\);/);
  // Every answer settles it, the refusal included (firebase-orders.js calls back with false), or the tap would hang.
  const at = src.indexOf('watchIngredientPrices((map, readable) => {');
  const body = src.slice(at, src.indexOf('});', at));
  assert.ok(body.indexOf('state.pricesReadable = readable === true') < body.indexOf('answerPrices()'));
  assert.ok(body.indexOf('answerPrices()') < body.indexOf('if (state.loaded.ingredients'));
});

test('rows off screen are skipped: on the long list of Fornitori and on Magazzino, not in a supplier\'s own screen', () => {
  const orders = read('orders.css');
  assert.match(orders, /\.reg-list-host \.reg-row \{\s+content-visibility: auto;\s+contain-intrinsic-size: auto \d+px;/);
  // The room for a price not landed yet takes its place on the line and shows nothing (registry.test: when it is there).
  assert.match(orders, /\.reg-price-room \{ visibility: hidden; \}/);
  // That screen's rebuild puts its scroll back by number (registry.js refresh), so its rows keep their real height.
  assert.doesNotMatch(orders, /(^|\n)\.reg-row \{[^}]*content-visibility/);
  const inventory = read('inventory.css');
  assert.match(inventory, /\.inv-row \{[^}]*content-visibility: auto;\s+contain-intrinsic-size: auto \d+px;/);
});

test('a repaint hands each row\'s height to the row that replaces it', () => {
  const src = read('js/orders/registry.js');
  const paint = src.slice(src.indexOf('function paintList()'), src.indexOf('function rememberRowHeights'));
  // Before the old rows go: afterwards there is nothing left to measure.
  assert.ok(paint.indexOf('rememberRowHeights();') > 0 && paint.indexOf('rememberRowHeights();') < paint.indexOf('listHost.replaceChildren();'));
  const remember = src.slice(src.indexOf('function rememberRowHeights'), src.indexOf('function matches(name)'));
  assert.ok(remember.includes('if (height > 0)'), 'a row that is not laid out has no height to hand on');
  assert.match(remember, /rowHeights\.clear\(\);/, 'a new width forgets them all: a row off screen would hand on the old guess');
  assert.ok(remember.includes('row.offsetHeight - row.clientHeight'), 'contain-intrinsic-size does not include the border');
  assert.match(src, /const knownHeight = onList \? rowHeights\.get\(`ingredient:\$\{item\.id\}`\) : undefined;\s+if \(knownHeight\) frame\.style\.containIntrinsicSize = `auto \$\{knownHeight\}px`;/);
});
