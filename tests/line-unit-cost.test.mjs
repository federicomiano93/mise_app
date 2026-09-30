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
