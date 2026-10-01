// line-unit-cost.test.mjs — what ONE of a line's CHOSEN unit costs (lineUnitCost).
// A busta is priced only from a stored case of packages; every other way of pricing it
// would be a guess that looks like a number (review of 30 Sep 2026).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lineUnitCost, unitCost } from '../js/order-cost.js';

const card = { unit: 'cartone', packUnit: 'busta', weight: '2.5kg' };
const pcsNoCase = { ...card, priceUnit: 'pcs', pricePerUnit: 20 };
const kgNoCase = { ...card, priceUnit: 'kg', pricePerUnit: 2 };
const packCase = {
  ...card, priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack',
};
const pcsCase = {
  ...card, priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs',
};

test('a per-piece price without a case cannot price a busta', () => {
  assert.equal(lineUnitCost(pcsNoCase, pcsNoCase, 'busta'), null);
  assert.equal(lineUnitCost(pcsNoCase, pcsNoCase, 'cartone'), 20);
});

test('a per-kilo price without a case cannot price a busta', () => {
  assert.equal(lineUnitCost(kgNoCase, kgNoCase, 'busta'), null);
});

test('a stored case of packages prices both units', () => {
  assert.equal(lineUnitCost(packCase, packCase, 'busta'), 5);
  assert.equal(lineUnitCost(packCase, packCase, 'Busta'), 5);
  assert.equal(lineUnitCost(packCase, packCase, 'cartone'), 20);
});

test('a stale or unknown unit gets no price', () => {
  assert.equal(lineUnitCost(packCase, packCase, 'sacchetto'), null);
  assert.equal(lineUnitCost(pcsNoCase, pcsNoCase, 'sacchetto'), null);
});

test('a case that is not a case of packages cannot price the package word', () => {
  assert.equal(lineUnitCost(pcsCase, pcsCase, 'busta'), null);
});

test('no unit or the card unit is exactly unitCost()', () => {
  for (const p of [pcsNoCase, kgNoCase, packCase, pcsCase]) {
    assert.equal(lineUnitCost(p, p, ''), unitCost(p, p));
    assert.equal(lineUnitCost(p, p, undefined), unitCost(p, p));
    assert.equal(lineUnitCost(p, p, 'cartone'), unitCost(p, p));
  }
});

// ── «Cartone: contiene 50 × pezzo» with no weight to read (1 Oct 2026) ───────
test('a pieces case priced for a card whose packCount is its count prices the inner word too', () => {
  const carton = { unit: 'cartone', packUnit: 'pezzo', packCount: 50, weight: '' };
  assert.equal(lineUnitCost(carton, pcsCase, 'pezzo'), 0.4);
  assert.equal(lineUnitCost(carton, pcsCase, 'cartone'), 20);
  assert.equal(lineUnitCost(carton, pcsCase, ''), 20, 'no choice is the card unit');
});

test('without that packCount a pieces case still cannot price the package word', () => {
  assert.equal(lineUnitCost({ ...card, packUnit: 'busta' }, pcsCase, 'busta'), null);
  assert.equal(lineUnitCost({ ...card, packUnit: 'busta', packCount: 12 }, pcsCase, 'busta'), null, 'a count that is not the case\'s');
  assert.equal(lineUnitCost({ ...card, packUnit: 'busta', packCount: 50 }, pcsCase, 'sacco'), null, 'a stale unit is still nothing');
});

test('a pack case is priced the same with or without the packCount', () => {
  assert.equal(lineUnitCost({ ...card, packCount: 4 }, packCase, 'busta'), 5);
  assert.equal(lineUnitCost({ ...card, packCount: 4 }, packCase, 'cartone'), 20);
  assert.equal(lineUnitCost(card, packCase, 'busta'), 5);
});
