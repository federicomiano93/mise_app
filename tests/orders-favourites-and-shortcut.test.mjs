// Two small features of 7 Oct 2026. (1) Orders lists the starred suppliers first, under their own
// heading. (2) The Ricettario has a shortcut to Orders, and Orders a button back. The pure
// parts are executed; the screens are pinned by reading their source (they need a browser).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { favouriteGroups } from '../js/orders/favourite-suppliers.js';
import { normalizeOrdersConfig } from '../js/orders/orders-config.js';
import { filterSuppliers } from '../js/orders/ingredient-search.js';
import { ordersHref, catalogueOriginFromHash, mayOpenOrders, recipeHref } from '../js/recipe-link.js';
import { _dictionaries } from '../js/i18n.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const ids = (list) => list.map(s => s.id);

// ── Favourites in the Orders list ───────────────────────────────────────────

// Already in the venue's own order (what sortSuppliersByOrder hands the list).
const SUPPLIERS = [
  { id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }, { id: 'c', name: 'Gamma' }, { id: 'd', name: 'Delta' },
];

test('favourites come first under their heading, the rest under «others», order kept inside each', () => {
  const groups = favouriteGroups(SUPPLIERS, ['d', 'b']);
  assert.deepEqual(groups.map(g => g.headingKey), ['orders.favourites.title', 'orders.favourites.others']);
  assert.deepEqual(ids(groups[0].suppliers), ['b', 'd'], 'the venue order, not the order they were starred in');
  assert.deepEqual(ids(groups[1].suppliers), ['a', 'c']);
});

test('no starred supplier in view: one group, no heading', () => {
  for (const fav of [[], undefined, null, ['zzz']]) {
    const groups = favouriteGroups(SUPPLIERS, fav);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].headingKey, null);
    assert.deepEqual(ids(groups[0].suppliers), ['a', 'b', 'c', 'd']);
  }
});

test('search is applied BEFORE the split: a starred supplier the search hides leaves no heading', () => {
  const visible = filterSuppliers(SUPPLIERS, 'gamma');
  const groups = favouriteGroups(visible, ['b']);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].headingKey, null);
  assert.deepEqual(ids(groups[0].suppliers), ['c']);
});

test('only starred suppliers in view: the favourites heading alone', () => {
  const groups = favouriteGroups([SUPPLIERS[1]], ['b']);
  assert.deepEqual(groups.map(g => g.headingKey), ['orders.favourites.title']);
});

test('Orders reads favouriteSuppliers from config/orders, cleaned', () => {
  assert.deepEqual(normalizeOrdersConfig({ favouriteSuppliers: ['a', 'a', '', 3, 'b'] }).favouriteSuppliers, ['a', 'b']);
  assert.deepEqual(normalizeOrdersConfig(null).favouriteSuppliers, []);
  assert.deepEqual(normalizeOrdersConfig({ favouriteSuppliers: 'a' }).favouriteSuppliers, []);
});

test('the by-supplier list uses the groups; a star changed on another phone redraws it', () => {
  const list = codeOf(read('js/orders/suppliers.js'));
  assert.match(list, /favouriteGroups\(rows, ctx\.favourites\?\.\(\) \|\| \[\]\)/);
  assert.match(list, /t\(group\.headingKey\)/);
  const main = codeOf(read('js/orders/orders-main.js'));
  assert.match(main, /favourites: \(\) => ordersConfig\.favouriteSuppliers/);
  assert.match(main, /config\.favouriteSuppliers\.join/);
});

test('⚠️ Orders never writes favouriteSuppliers: every save is a patch of the fields it owns', () => {
  const dir = 'js/orders/';
  for (const file of ['orders-main.js', 'management.js', 'supplier-order-screen.js', 'suppliers.js']) {
    const src = codeOf(read(dir + file));
    assert.doesNotMatch(src, /setFavouriteSupplier/, file);
    assert.doesNotMatch(src, /favouriteSuppliers\s*:/, file);
  }
  const main = codeOf(read(dir + 'orders-main.js'));
  const saves = main.match(/saveOrdersConfig: patch => saveDoc\(COLLECTIONS\.config, 'orders', patch\)/g) || [];
  assert.equal(saves.length, 2, 'both Orders saves of config/orders take a patch');
  assert.doesNotMatch(main, /saveDoc\(COLLECTIONS\.config, 'orders', (ordersConfig|\{\s*\.\.\.)/);
});

// ── The shortcut and the way back ───────────────────────────────────────────

test('ordersHref: the list sends #from=catalogue, a recipe sends its encoded id', () => {
  assert.equal(ordersHref(null), 'orders.html#from=catalogue');
  assert.equal(ordersHref(''), 'orders.html#from=catalogue');
  assert.equal(ordersHref('abc123'), 'orders.html#from=recipe:abc123');
  assert.equal(ordersHref('a b&c'), 'orders.html#from=recipe:a%20b%26c');
  assert.equal(ordersHref('a/b'), 'orders.html#from=catalogue', 'an id that cannot travel falls back to the list');
});

test('catalogueOriginFromHash: the two valid shapes, and the round trip', () => {
  assert.deepEqual(catalogueOriginFromHash('#from=catalogue'), { href: 'catalogue.html' });
  assert.deepEqual(catalogueOriginFromHash('#from=recipe:abc123'), { href: recipeHref('abc123') });
  const sent = ordersHref('a b&c').slice('orders.html'.length);
  assert.deepEqual(catalogueOriginFromHash(sent), { href: recipeHref('a b&c') });
});

test('catalogueOriginFromHash: anything else is no button', () => {
  const bad = [
    '', '#', null, undefined, '#from=', '#from=home', '#from=Catalogue', '#from=catalogue&x=1',
    '#x=1&from=catalogue', '#from=catalogue/', '#from=recipe:', '#from=recipe', '#from=recipe:a/b',
    '#from=recipe:a%2Fb', '#from=recipe:a%23b', '#from=recipe:a%3Fb', '#from=recipe:a#b',
    '#from=recipe:a?b', '#from=recipe:%E0%A4%A', '#from=recipe:%20', '#from=recipe:a&b',
    `#from=recipe:${'x'.repeat(201)}`, 'from=catalogue', '#recipe=abc',
  ];
  for (const hash of bad) assert.equal(catalogueOriginFromHash(hash), null, String(hash));
});

test('⚠️ the Orders shortcut is offered exactly to whoever the Orders page lets in', () => {
  const venue = { sections: {} };
  assert.equal(mayOpenOrders(venue, true), true);
  assert.equal(mayOpenOrders(venue, false), true, 'an employee uses Orders');
  assert.equal(mayOpenOrders({ sections: { orders: false } }, true), false, 'a venue without Orders');
  assert.equal(mayOpenOrders({ sections: {}, staffHiddenCards: { orders: true } }, false), false,
    'a card the venue hid from staff');
  assert.equal(mayOpenOrders({ sections: {}, staffHiddenCards: { orders: true } }, true), true,
    'a manager still sees it');
  for (const loc of [null, undefined, 'bakery']) assert.equal(mayOpenOrders(loc, true), false);
});

test('the Catalogue passes `orders: true` from the list and a recipe only', () => {
  const main = codeOf(read('js/catalogue/catalogue-main.js'));
  // Calls only: `[^{}]*` keeps each match inside one call's own braces, so the
  // definition `setHeader({ … }) {` can no longer run on into the function body.
  const calls = (main.match(/setHeader\(\{[^{}]*\}\);/g) || []);
  assert.ok(calls.length >= 9, `every setHeader call was found (${calls.length})`);
  const withOrders = calls.filter(c => /orders: true/.test(c));
  assert.equal(withOrders.length, 2);
  assert.ok(withOrders.some(c => /section\.catalogue/.test(c)), 'the list');
  assert.ok(withOrders.some(c => /edit: true/.test(c) && /cat\.recipe/.test(c)), 'a recipe');
  assert.match(main, /ordersBtn\.hidden = !\(ordersWanted && mayOpenOrders\(session\.location, session\.canManage\)\)/);
  assert.match(main, /paintOrdersBtn\(\);\s*if \(view === 'list'\) showList\(\)/, 'repainted when the session lands');
  assert.match(main, /ordersHref\(view === 'detail' && currentRecipe \? currentRecipe\.id : null\)/);
});

test('the Catalogue button sits in the LEFT slot after Back, named and hidden to start with', () => {
  const html = read('catalogue.html');
  const left = html.slice(html.indexOf('<header class="app-header">'), html.indexOf('app-header-title'));
  assert.ok(left.indexOf('id="catBack"') < left.indexOf('id="catOrders"'));
  assert.match(left, /id="catOrders"[^>]*data-i18n="catalogue\.openOrders" data-i18n-attr="aria-label"[^>]*hidden/);
});

test('Orders: the way back sits after Back (which still goes Home), hidden, filled from the hash', () => {
  const html = read('orders.html');
  const left = html.slice(html.indexOf('<header class="app-header orders-header">'), html.indexOf('app-header-title'));
  assert.ok(left.indexOf('href="index.html"') < left.indexOf('id="orders-to-catalogue"'));
  const tag = left.match(/<a [^>]*id="orders-to-catalogue"[^>]*>/)[0];
  assert.match(tag, /\shidden[\s>]/);
  assert.match(tag, /data-i18n="orders\.backToCatalogue" data-i18n-attr="aria-label"/);
  const main = codeOf(read('js/orders/orders-main.js'));
  assert.match(main, /catalogueOriginFromHash\(window\.location\.hash\)/);
  assert.doesNotMatch(main, /history\.replaceState|location\.hash\s*=/, 'the hash stays, so a reload keeps the button');
});

test('the two new words exist in both languages', () => {
  const dictionaries = _dictionaries();
  assert.equal(dictionaries.en['catalogue.openOrders'], 'Go to Orders');
  assert.equal(dictionaries.it['catalogue.openOrders'], 'Vai agli Ordini');
  assert.equal(dictionaries.it['orders.backToCatalogue'], 'Torna al Ricettario');
  assert.equal(dictionaries.en['orders.backToCatalogue'], `Back to ${dictionaries.en['section.catalogue']}`);
});

test('Orders\' way back has two forms of one control: round button from 440px, a row under it below', () => {
  const html = read('orders.html');
  const row = html.match(/<a [^>]*id="orders-to-catalogue-row"[^>]*>[\s\S]*?<\/a>/)[0];
  assert.match(row, /\shidden[\s>]/, 'hidden until the hash is read');
  assert.match(row, /M15 18l-6-6 6-6/, 'the Back chevron');
  assert.match(row, /<span data-i18n="orders\.backToCatalogue"/, 'the visible words');
  assert.ok(html.indexOf('id="orders-to-catalogue-row"') < html.indexOf('id="orders-tablet-strip"'),
    'above the Order today band');
  const main = codeOf(read('js/orders/orders-main.js'));
  assert.match(main, /\['orders-to-catalogue', 'orders-to-catalogue-row'\]/, 'both share one address and one hash parse');
  const css = read('orders.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /@media \(max-width: 439px\) \{\s*#orders-to-catalogue \{ display: none; \}\s*\}/);
  assert.match(css, /@media \(max-width: 439px\) \{\s*body \.orders-return-row \{ display: flex; \}\s*\}/);
  assert.doesNotMatch(css, /min-width: 440px/, 'the app has ONE wide-screen query');
  const rule = css.match(/body \.orders-return-row \{([^}]*)\}/)[1];
  assert.match(rule, /display: none;\s*align-items: center;/);
  assert.match(rule, /min-height: 44px/);
});
