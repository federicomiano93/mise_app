// ⚠️⚠️ MONEY MUST NEVER REACH THE SUPPLIER. buildOrderMessage() (order-text.js)
// builds the exact text a WhatsApp message sends; this pins that adding a
// price (and a VAT rate) to an ingredient cannot change one byte of that text
// — the amounts live only in js/order-cost.js / js/orders/order-summary.js,
// read by screens gated on who may see money, never by the message itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrderMessage } from '../js/orders/order-text.js';

const withoutPrice = [{
  supplierName: 'Salvo',
  items: [
    { name: 'Flour', weight: '25kg', qty: 3 },
    { name: 'Bacon', weight: '2.27kg', qty: 5 },
  ],
}];

const withPrice = [{
  supplierName: 'Salvo',
  items: [
    { name: 'Flour', weight: '25kg', qty: 3, priceUnit: 'kg', pricePerUnit: 1.8, vatRate: 4 },
    { name: 'Bacon', weight: '2.27kg', qty: 5, priceUnit: 'kg', pricePerUnit: 9.5, vatRate: 20 },
  ],
}];

test('buildOrderMessage ignores price/VAT fields entirely, byte for byte', () => {
  const a = buildOrderMessage(withoutPrice);
  const b = buildOrderMessage(withPrice);
  assert.equal(a, b);
  assert.doesNotMatch(a, /€|£|VAT|IVA|price|prezzo/i);
});
