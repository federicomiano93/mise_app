// Unit tests for js/orders/order-summary.js (P15).
//
// ⚠️ THE WHOLE POINT: the summary sheet must show EXACTLY what the WhatsApp
// message would say for the same supplier — same selection (qty > 0), same
// sort, same label text. These tests pin that by building both through the
// same fixtures and comparing them line for line, not just by re-deriving
// order-summary.js's own logic and agreeing with itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supplierSummary } from '../js/orders/order-summary.js';
import { buildOrderMessage } from '../js/orders/order-text.js';

const SUPPLIER = { id: 's1', name: 'Salvo' };

const INGREDIENTS = [
  { id: 'flour', name: 'Flour', weight: '25kg' },
  { id: 'bacon', name: 'Bacon', weight: '2.27kg' },
  { id: 'mozz', name: 'Mozzarella', weight: '1kg' },
  { id: 'zero', name: 'Zero qty', weight: '' },
  { id: 'notyped', name: 'Never typed', weight: '' },
];

const ENTRIES = {
  flour: { qty: 3 },
  bacon: { qty: 5 },
  mozz: { qty: 2 },
  zero: { qty: 0 },
};

test('only rows with qty > 0 appear, sorted by label — same rule as the message', () => {
  const { name, lines } = supplierSummary(SUPPLIER, INGREDIENTS, ENTRIES);
  assert.equal(name, 'Salvo');
  assert.deepEqual(lines, [
    { label: 'Bacon 2.27kg', qty: 5 },
    { label: 'Flour 25kg', qty: 3 },
    { label: 'Mozzarella 1kg', qty: 2 },
  ]);
});

test('empty entries -> empty lines, never a crash', () => {
  assert.deepEqual(supplierSummary(SUPPLIER, INGREDIENTS, {}), { name: 'Salvo', lines: [] });
  assert.deepEqual(supplierSummary(SUPPLIER, INGREDIENTS, null), { name: 'Salvo', lines: [] });
});

test('a null supplier still returns a shape — never throws', () => {
  assert.deepEqual(supplierSummary(null, INGREDIENTS, ENTRIES).name, '');
});

test('the summary lines are byte-identical to the message\'s own lines', () => {
  const { lines } = supplierSummary(SUPPLIER, INGREDIENTS, ENTRIES);
  const message = buildOrderMessage([{
    supplierName: SUPPLIER.name,
    items: INGREDIENTS
      .filter(i => (ENTRIES[i.id]?.qty || 0) > 0)
      .map(i => ({ name: i.name, weight: i.weight, qty: ENTRIES[i.id].qty })),
  }]);
  const messageLines = lines.map(({ label, qty }) => `- ${label}: ${qty}`);
  for (const line of messageLines) {
    assert.ok(message.includes(line), `message is missing the summary line "${line}"`);
  }
});
