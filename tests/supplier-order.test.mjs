// The order the suppliers are listed in on the Orders main screen (config/orders
// .supplierOrder). The model is executed; the wiring is read from source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSupplierOrder, sortSuppliersByOrder } from '../js/orders/supplier-order.js';
import { normalizeOrdersConfig } from '../js/orders/orders-config.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const withoutComments = src => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const labelOf = s => s.name;

test('normalizeSupplierOrder: anything that is not an array is empty', () => {
  for (const v of [undefined, null, 'a', 5, {}, true]) assert.deepEqual(normalizeSupplierOrder(v), []);
});

test('normalizeSupplierOrder: drops duplicates, empties and non-strings, keeps first position', () => {
  assert.deepEqual(normalizeSupplierOrder(['b', 'a', 'b', '', 3, null, 'c', 'a']), ['b', 'a', 'c']);
});

test('normalizeSupplierOrder: caps the id length and the number of entries', () => {
  assert.deepEqual(normalizeSupplierOrder(['x'.repeat(201), 'ok']), ['ok']);
  assert.equal(normalizeSupplierOrder(['x'.repeat(200)]).length, 1);
  const many = Array.from({ length: 400 }, (_, i) => `id${i}`);
  assert.equal(normalizeSupplierOrder(many).length, 300);
});

test('sortSuppliersByOrder: stored order first, new suppliers alphabetical after', () => {
  const s = [
    { id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' },
    { id: 'z', name: 'Zulu' }, { id: 'm', name: 'Mike' }, { id: 'c', name: 'Charlie' },
  ];
  const out = sortSuppliersByOrder(s, ['z', 'a'], labelOf).map(x => x.id);
  assert.deepEqual(out, ['z', 'a', 'b', 'c', 'm']);
});

test('sortSuppliersByOrder: ids that match no supplier are ignored', () => {
  const s = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];
  assert.deepEqual(sortSuppliersByOrder(s, ['ghost', 'b', 'a'], labelOf).map(x => x.id), ['b', 'a']);
});

test('sortSuppliersByOrder: an empty or missing order is alphabetical', () => {
  const s = [{ id: 'b', name: 'Beta' }, { id: 'a', name: 'Alpha' }];
  for (const order of [[], undefined, null, 'junk']) {
    assert.deepEqual(sortSuppliersByOrder(s, order, labelOf).map(x => x.id), ['a', 'b']);
  }
});

test('sortSuppliersByOrder: does not mutate its input', () => {
  const s = [{ id: 'b', name: 'Beta' }, { id: 'a', name: 'Alpha' }];
  const order = ['b'];
  const out = sortSuppliersByOrder(s, order, labelOf);
  assert.notEqual(out, s);
  assert.deepEqual(s.map(x => x.id), ['b', 'a']);
  assert.deepEqual(order, ['b']);
});

test('normalizeOrdersConfig carries supplierOrder, empty by default', () => {
  assert.deepEqual(normalizeOrdersConfig(null).supplierOrder, []);
  assert.deepEqual(normalizeOrdersConfig({ supplierOrder: ['a', 'a', 'b'] }).supplierOrder, ['a', 'b']);
  assert.deepEqual(normalizeOrdersConfig({ supplierOrder: 'oops' }).supplierOrder, []);
});

test('activeSuppliers sorts through sortSuppliersByOrder with the config order', () => {
  const src = withoutComments(read('js/orders/orders-main.js'));
  assert.match(src, /memoLast\(\(suppliers, order\) => sortSuppliersByOrder\(/);
  assert.match(src, /function activeSuppliers\(\) \{[^}]*sortActiveSuppliers\(state\.suppliers, ordersConfig\.supplierOrder\)/);
  assert.match(src, /ordersConfig\.supplierOrder/);
  // Drawn by the one-pass scheduler since the render pass (tests/orders-render-scheduler.test.mjs).
  assert.match(src, /if \(orderChanged\) scheduleRender\('list'\)/);
});

test('the Settings door sits inside the boss-only branch', () => {
  const src = withoutComments(read('js/orders/management.js'));
  assert.match(src, /boss && actions\.openSupplierOrder/);
  assert.match(src, /orders\.supplierOrder\.door/);
});

test('the screen saves the whole list through saveOrdersConfig', () => {
  const src = withoutComments(read('js/orders/supplier-order-screen.js'));
  assert.match(src, /saveOrdersConfig\(\{ supplierOrder: /);
  assert.match(src, /supplierLabel\(/);
  assert.doesNotMatch(src, /\.name\b/);
});

// Review of 4 Oct 2026: a setDoc never settles offline, so a save queued behind the previous
// one lived only in page memory and was lost when the app closed (P20).
test('every move goes to Firestore at once, and switched-off suppliers keep their place', () => {
  const src = withoutComments(read('js/orders/supplier-order-screen.js'));
  assert.doesNotMatch(src, /chain/);
  assert.doesNotMatch(src, /await saveOrdersConfig/);
  assert.match(src, /const offScreen = currentOrder\(\)\.filter\(id => !byId\.has\(id\)\);/);
  assert.match(src, /saveOrdersConfig\(\{ supplierOrder: \[\.\.\.next, \.\.\.offScreen\] \}\)/);
});

test('the screen ignores an Escape another layer already handled', () => {
  const src = withoutComments(read('js/orders/supplier-order-screen.js'));
  assert.match(src, /event\.defaultPrevented/);
});

test('every supplier-order key exists in both languages', () => {
  const src = read('js/i18n.js');
  for (const key of ['door', 'doorSub', 'title', 'hint', 'move', 'saving', 'none', 'err']) {
    const found = src.match(new RegExp(`'orders\\.supplierOrder\\.${key}':`, 'g')) || [];
    assert.equal(found.length, 2, `orders.supplierOrder.${key} must exist in EN and IT`);
  }
});
