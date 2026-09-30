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
import { buildOrderMessage, orderedItems } from '../js/orders/order-text.js';

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
  const empty = { name: 'Salvo', lines: [], costLines: [], totals: {
    net: 0, vatByRate: {}, gross: 0, missingPrice: 0, missingVat: 0, costed: 0,
  } };
  assert.deepEqual(supplierSummary(SUPPLIER, INGREDIENTS, {}), empty);
  assert.deepEqual(supplierSummary(SUPPLIER, INGREDIENTS, null), empty);
});

test('money: a priced, VAT-rated line costs correctly; an unpriced one is flagged, not zero', () => {
  const priced = [
    { id: 'flour', name: 'Flour', weight: '25kg', priceUnit: 'kg', pricePerUnit: 1.8, vatRate: 4 },
    { id: 'bacon', name: 'Bacon', weight: '2.27kg' }, // no price at all
  ];
  const entries = { flour: { qty: 2 }, bacon: { qty: 1 } };
  const { costLines, totals } = supplierSummary(SUPPLIER, priced, entries);
  const flourLine = costLines.find(l => l.label.startsWith('Flour'));
  const baconLine = costLines.find(l => l.label.startsWith('Bacon'));
  assert.equal(flourLine.unitCost, 45); // 1.8 * 25kg
  assert.equal(flourLine.vatRate, 4);
  assert.equal(baconLine.unitCost, null);
  assert.equal(totals.net, 90); // 2 * 45, bacon excluded
  assert.equal(totals.missingPrice, 1);
});

test('a null supplier still returns a shape — never throws', () => {
  assert.deepEqual(supplierSummary(null, INGREDIENTS, ENTRIES).name, '');
});

// ⚠️ EQUAL, NOT `includes()`. `includes` only proves the summary's lines are
// SOMEWHERE in the message — it would still pass if the message carried
// extra lines the summary left out, or the same lines in a different order.
// This builds the message through orderedItems(), the SAME selection
// function order-summary.js itself calls (order-text.js), so both halves of
// the comparison come from the one real code path rather than two separate
// re-implementations of "what is in this supplier's order" agreeing with
// each other by coincidence.
test('the summary lines equal the message section lines — exactly, in order', () => {
  const { lines } = supplierSummary(SUPPLIER, INGREDIENTS, ENTRIES);
  const items = orderedItems(INGREDIENTS, ENTRIES);
  const message = buildOrderMessage([{ supplierName: SUPPLIER.name, items }]);

  // `${title}\n\n*Salvo*\n- line\n- line…` — the section after the title,
  // with its bold supplier heading dropped.
  const section = message.split('\n\n')[1];
  const messageLines = section.split('\n').slice(1);

  const summaryLines = lines.map(({ label, qty }) => `- ${label}: ${qty}`);
  assert.deepEqual(summaryLines, messageLines);
});

test('a supplier with nothing ordered: the summary is empty and the message carries no section for it', () => {
  const { lines } = supplierSummary(SUPPLIER, INGREDIENTS, {});
  assert.deepEqual(lines, []);
  const items = orderedItems(INGREDIENTS, {});
  assert.equal(buildOrderMessage([{ supplierName: SUPPLIER.name, items }]), '');
});

// ── A line priced in ITS unit (30 Sep 2026) ──────────────────────────────────
// Flour is sold by the case of 4 bags at 20. The same card is 20 a cartone or 5 a busta,
// and the order must be priced in whichever the line was placed in.
test('money: a line is priced in its own unit — cartone by default, busta when chosen', () => {
  const flour = {
    id: 'flour', name: 'Flour', weight: '2.5kg', unit: 'cartone', packUnit: 'busta',
    priceUnit: 'kg', pricePerUnit: 2, unitWeightKg: null, vatRate: 4,
    caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack', casePrice: 20,
  };
  const asCarton = supplierSummary(SUPPLIER, [flour], { flour: { qty: 2 } });
  const asBag = supplierSummary(SUPPLIER, [flour], { flour: { qty: 2, unit: 'busta' } });
  assert.equal(asCarton.costLines[0].unitCost, 20);
  assert.equal(asBag.costLines[0].unitCost, 5);
  assert.equal(asBag.costLines[0].unit, 'busta');
  assert.equal(asBag.totals.net, 10);
  assert.equal(asCarton.costLines[0].unit, 'cartone');
});
