// Favourite suppliers on the Fornitori page: the pure module is executed; the screen, the data
// layer and the wiring are pinned by reading their source (the screen needs a browser).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeFavourites, splitByFavourite, MAX_FAVOURITES } from '../js/orders/favourite-suppliers.js';
import { _dictionaries } from '../js/i18n.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('normalizeFavourites: anything that is not an array is no favourites', () => {
  for (const bad of [undefined, null, 'a', 3, {}, { 0: 'a' }, true]) {
    assert.deepEqual(normalizeFavourites(bad), []);
  }
});

test('normalizeFavourites: unique non-empty strings, order kept', () => {
  assert.deepEqual(normalizeFavourites(['b', 'a', 'b', '', 3, null, 'c', 'a']), ['b', 'a', 'c']);
});

test('normalizeFavourites: at most 300', () => {
  const many = Array.from({ length: 450 }, (_, i) => `s${i}`);
  const out = normalizeFavourites(many);
  assert.equal(MAX_FAVOURITES, 300);
  assert.equal(out.length, 300);
  assert.equal(out[299], 's299');
});

test('splitByFavourite: splits, keeping the input order in both groups', () => {
  const suppliers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const { favourites, others } = splitByFavourite(suppliers, ['d', 'b']);
  assert.deepEqual(favourites.map(s => s.id), ['b', 'd']);
  assert.deepEqual(others.map(s => s.id), ['a', 'c']);
});

test('splitByFavourite: ids that match no supplier are ignored; bad input is safe', () => {
  const { favourites, others } = splitByFavourite([{ id: 'a' }], ['gone', 'a']);
  assert.deepEqual(favourites, [{ id: 'a' }]);
  assert.deepEqual(others, []);
  assert.deepEqual(splitByFavourite([{ id: 'a' }], undefined), { favourites: [], others: [{ id: 'a' }] });
  assert.deepEqual(splitByFavourite(undefined, ['a']), { favourites: [], others: [] });
});

test('the module stays pure: no DOM, no Firestore, no imports', () => {
  assert.doesNotMatch(codeOf(read('js/orders/favourite-suppliers.js')), /\bimport\b|document\.|firebase/);
});

test('the list draws the two headings only when favourites exist', () => {
  const code = codeOf(read('js/orders/registry.js'));
  const start = code.indexOf('function paintSuppliers()');
  const body = code.slice(start, code.indexOf('function paintItems', start));
  assert.match(body, /splitByFavourite\(visible, data\.favouriteSuppliers\(\)\)/);
  const earlyReturn = body.indexOf('if (!favourites.length)');
  assert.ok(earlyReturn > 0, 'no-favourites branch missing');
  assert.ok(body.indexOf("t('orders.favourites.title')") > earlyReturn, 'title drawn before the no-favourites return');
  assert.ok(body.indexOf("t('orders.favourites.others')") > earlyReturn);
  assert.match(body, /if \(others\.length\)/);
  assert.match(body, /`supplier:\$\{s\.id\}`/, 'rows keep their data-sel key');
});

test('the header star exists only when the action is a function, and is optimistic', () => {
  const code = codeOf(read('js/orders/registry.js'));
  assert.match(code, /typeof actions\.toggleFavouriteSupplier === 'function'/);
  assert.match(code, /overlay\(entry, supplierLabel\(supplier\), body, undefined, star\)/);
  assert.match(code, /'aria-pressed': String\(isFav\)/);
  assert.match(code, /orders-icon-btn/);
  assert.doesNotMatch(code, /await actions\.toggleFavouriteSupplier/, 'must not wait before updating the UI');
  assert.match(code, /alertDialog\(t\('orders\.favourite\.err'\)\)/);
});

test('the toggle action is a getter gated on canManageHere', () => {
  const code = codeOf(read('js/orders/registry-main.js'));
  assert.match(code, /get toggleFavouriteSupplier\(\) \{\s*return canManageHere\(\)/);
  assert.match(code, /favouriteSuppliers: \(\) => state\.favouriteSuppliers/);
  assert.match(code, /state\.favouriteSuppliers = normalizeFavourites\(doc\?\.favouriteSuppliers\)/);
});

test('the data layer stars with arrayUnion / arrayRemove, never a whole-list write', () => {
  const code = codeOf(read('js/orders/firebase-orders.js'));
  assert.match(code, /export function setFavouriteSupplier\(id, on\)/);
  assert.match(code, /favouriteSuppliers: on \? arrayUnion\(id\) : arrayRemove\(id\)/);
  assert.match(code, /^\s*arrayUnion,$/m);
  assert.match(code, /^\s*arrayRemove,$/m);
});

test('the four labels exist in English and Italian', () => {
  const dictionaries = _dictionaries();
  for (const lang of ['en', 'it']) {
    for (const key of ['orders.favourites.title', 'orders.favourites.others', 'orders.favourite.label', 'orders.favourite.err']) {
      assert.ok(dictionaries[lang][key], `${lang} is missing ${key}`);
    }
  }
});
