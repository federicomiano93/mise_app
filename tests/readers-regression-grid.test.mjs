// readers-regression-grid.test.mjs — «an item with no packCount must give EXACTLY today's numbers».
//
// ⚠️ THE READERS WERE REWRITTEN FOR «CARTONE» (1 Oct 2026, review), and the one promise that must
// outlive that is that nothing already in production reprices. So this runs a FROZEN COPY of the old
// functions (tests/helpers/legacy-*.mjs, taken from `git show main:…`) against the live ones over
// every stored shape that has no packCount — or an invalid one, which the rules would never store —
// and demands IDENTICAL results, number for number, null for null.
// It also runs the carton cases of the review against hand-computed answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { unitCost, lineUnitCost } from '../js/order-cost.js';
import { packPrice, packKgFor, valueBlocker, casePackNote } from '../js/inventory/inventory-value.js';
import { qtyInCardUnit } from '../js/inventory/inventory-purchases.js';
import * as old from './helpers/legacy-order-cost.mjs';
import * as oldValue from './helpers/legacy-inventory-value.mjs';
import * as oldPurchases from './helpers/legacy-inventory-purchases.mjs';

const UNITS = ['', 'kg', 'g', 'l', 'ml', 'pz', 'pezzo', 'cartone', 'Cassa', 'busta', 'sacco', 'scatola', 'vassoio', 'confezione', 'box.'];
const PACK_UNITS = ['', 'busta', 'pezzo', 'scatola', 'sacco'];
const WEIGHTS = ['', '25kg', '2.5kg', '500g', '750ml', '1l', '6x1kg', 'sacco', '2,27 kg', '12x500g', '360 pz'];
// What the rules would never store, or nothing: all of them mean «no packCount».
const NO_COUNT = [undefined, null, 0, -1, 2.5, '4', NaN];

const CASES = {
  none: {},
  rateKg: { priceUnit: 'kg', pricePerUnit: 2 },
  rateL: { priceUnit: 'l', pricePerUnit: 3.2 },
  ratePcs: { priceUnit: 'pcs', pricePerUnit: 0.4 },
  ratePcsWeighed: { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 },
  packCase: { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' },
  packCaseL: { priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 0.5, caseItemUnit: 'pack' },
  oneBag: { priceUnit: 'kg', pricePerUnit: 0.8, casePrice: 20, caseCount: 1, caseItemSize: 25, caseItemUnit: 'pack' },
  kgCase: { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' },
  gCase: { priceUnit: 'kg', pricePerUnit: 10, casePrice: 20, caseCount: 4, caseItemSize: 500, caseItemUnit: 'g' },
  mlCase: { priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 500, caseItemUnit: 'ml' },
  pcsCase: { priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' },
  pcsCaseOne: { priceUnit: 'pcs', pricePerUnit: 5, casePrice: 5, caseCount: 1, caseItemUnit: 'pcs' },
  staleCase: { priceUnit: 'kg', pricePerUnit: 3, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' },
  zeroRate: { priceUnit: 'kg', pricePerUnit: 0 },
  badUnit: { priceUnit: 'box', pricePerUnit: 2 },
};

function* shapes() {
  for (const [name, price] of Object.entries(CASES)) {
    for (const unit of UNITS) {
      for (const packUnit of PACK_UNITS) {
        for (const weight of WEIGHTS) {
          for (const packCount of NO_COUNT) {
            yield { name, ing: { id: 'x', unit, packUnit, weight, packCount, ...price } };
          }
        }
      }
    }
  }
}

const same = (a, b) => Object.is(a, b) || (typeof a === 'number' && typeof b === 'number' && a === b);

test('the grid is big enough to mean something', () => {
  let n = 0;
  for (const _ of shapes()) n += 1;
  assert.ok(n > 90000, `${n} shapes`);
});

test('unitCost and lineUnitCost give EXACTLY the old numbers for every item with no packCount', () => {
  const bad = [];
  for (const { name, ing } of shapes()) {
    if (!same(unitCost(ing, ing), old.unitCost(ing, ing))) bad.push(`unitCost ${name} ${JSON.stringify(ing)}`);
    for (const chosen of ['', ing.unit, ing.packUnit, 'cartone', 'busta', 'pz']) {
      if (!same(lineUnitCost(ing, ing, chosen), old.lineUnitCost(ing, ing, chosen))) {
        bad.push(`lineUnitCost(${chosen}) ${name} ${JSON.stringify(ing)}`);
      }
    }
    if (bad.length > 5) break;
  }
  assert.deepEqual(bad, []);
});

test('the stocktake (packPrice, packKgFor, valueBlocker, casePackNote) gives EXACTLY the old numbers', () => {
  const bad = [];
  const months = [{ packKg: {} }, { packKg: { x: 12 } }, { packKg: { x: 0 } }, null];
  for (const { name, ing } of shapes()) {
    for (const month of months) {
      for (const closed of [false, true]) {
        const m = month && closed ? { ...month, unitPrice: { x: 1.5 } } : month;
        if (!same(packKgFor(m, ing, closed), oldValue.packKgFor(m, ing, closed))) bad.push(`packKgFor ${name} ${JSON.stringify(ing)}`);
        if (!same(packPrice(m, ing, closed), oldValue.packPrice(m, ing, closed))) bad.push(`packPrice ${name} ${JSON.stringify(ing)} ${JSON.stringify(m)}`);
        if (valueBlocker(m, ing, closed) !== oldValue.valueBlocker(m, ing, closed)) bad.push(`valueBlocker ${name} ${JSON.stringify(ing)}`);
      }
    }
    assert.deepEqual(casePackNote(ing), oldValue.casePackNote(ing), `casePackNote ${name}`);
    if (bad.length > 5) break;
  }
  assert.deepEqual(bad, []);
});

test('qtyInCardUnit gives EXACTLY the old numbers for every item with no packCount', () => {
  const bad = [];
  for (const { name, ing } of shapes()) {
    for (const line of ['', ing.unit, ing.packUnit, 'cartone', 'busta']) {
      if (!same(qtyInCardUnit(8, line, ing), oldPurchases.qtyInCardUnit(8, line, ing))) bad.push(`${line} ${name} ${JSON.stringify(ing)}`);
    }
    if (bad.length > 5) break;
  }
  assert.deepEqual(bad, []);
});

// ── The carton cases of the review, against hand-computed answers ────────────

test('2(a) 2(b) 2(c) and 3 give 20 / 5 / 20 / 12 on the stocktake as well as on the order', () => {
  const month = { packKg: {} };
  // (a) a one-pack case of 5 turned into a carton of 4
  const a = { id: 'a', unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg',
    priceUnit: 'kg', pricePerUnit: 2, casePrice: 5, caseCount: 1, caseItemSize: 2.5, caseItemUnit: 'pack' };
  assert.equal(unitCost(a, a), 20);
  assert.equal(packPrice(month, a, false), 20);
  // (b) a pack case of 4 turned into a Singola (the card writes the package word as the unit)
  const b = { id: 'b', unit: 'busta', packUnit: 'busta', weight: '2.5kg',
    priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
  assert.equal(unitCost(b, b), 5);
  assert.equal(packPrice(month, b, false), 5);
  // (c) a typed 0.40 a piece turned into a carton of 50
  const c = { id: 'c', unit: 'cartone', packUnit: 'pezzo', packCount: 50, weight: '', priceUnit: 'pcs', pricePerUnit: 0.4 };
  assert.equal(unitCost(c, c), 20);
  assert.equal(packPrice(month, c, false), 20);
  assert.equal(valueBlocker(month, c, false), null);
  // 3: a legacy «6x1kg» weight with packCount 6, a rate of 2 a kilo
  const d = { id: 'd', unit: 'cartone', packUnit: 'busta', packCount: 6, weight: '6x1kg', priceUnit: 'kg', pricePerUnit: 2 };
  assert.equal(unitCost(d, d), 12);
  assert.equal(packKgFor(month, d), 6, 'the whole ordered unit, not multiplied');
  assert.equal(packPrice(month, d, false), 12);
});

test('the stocktake counts a carton card in cartons: weight × packCount, or the per-item rate × packCount', () => {
  const month = { packKg: {} };
  const kg = { id: 'k', unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2 };
  assert.equal(packKgFor(month, kg), 10);
  assert.equal(packPrice(month, kg, false), 20);
  assert.equal(packKgFor({ packKg: { k: 12 } }, kg), 12, 'a weight typed into the month still wins');
  assert.equal(packKgFor(month, { ...kg, unit: 'busta' }), 2.5, 'counted in the package word, one item');
  const egg = { id: 'e', unit: 'cartone', packUnit: 'uovo', packCount: 30, weight: '60g', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
  assert.equal(packPrice(month, egg, false), 7.5);
  assert.equal(packPrice(month, { ...egg, unit: 'uovo' }, false), 0.25);
});
