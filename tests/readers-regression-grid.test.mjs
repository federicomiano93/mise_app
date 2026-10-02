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

// ⚠️ EXACTLY ONE SHAPE READS DIFFERENTLY FROM MAIN (2nd review, 1 Oct 2026), and it goes from null to a number —
// never from a number to another number, never the other way. It is asserted here by a hand-made expectation;
// every other shape must be identical. (A package word on a case of PIECES stays null on purpose: on legacy data
// a case of 30 eggs ordered by its own package word is not ONE egg — refuse rather than guess.)
const norm = (v) => String(v || '').trim().toLowerCase().replace(/\.$/, '');
const WEIGHT_WORDS = ['kg', 'g', 'l', 'ml'];   // the weight words the grid uses (js/order-cost.js knows more)
// B. A WEIGHT WORD ON A PER-PIECE PRICE THAT REMEMBERS ONE PIECE'S WEIGHT: kilos × (rate ÷ piece weight).
const shapeB = (ing) => ing.priceUnit === 'pcs' && ing.unitWeightKg > 0 && ing.pricePerUnit > 0 && WEIGHT_WORDS.includes(norm(ing.unit));
const expectedB = (ing) => ({ kg: 1, l: 1, g: 0.001, ml: 0.001 })[norm(ing.unit)] * (ing.pricePerUnit / ing.unitWeightKg);
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-9;
const hasCase = (ing) => ing.caseItemUnit !== undefined && ing.casePrice > 0;

test('the grid is big enough to mean something', () => {
  let n = 0;
  for (const _ of shapes()) n += 1;
  assert.ok(n > 90000, `${n} shapes`);
});

test('unitCost and lineUnitCost give EXACTLY the old numbers for every item with no packCount, but for the named shape', () => {
  const bad = [];
  let changed = 0;
  for (const { name, ing } of shapes()) {
    const now = unitCost(ing, ing);
    const was = old.unitCost(ing, ing);
    if (!same(now, was)) {
      if (shapeB(ing) && was === null && near(now, expectedB(ing))) changed += 1;
      else bad.push(`unitCost ${name} ${JSON.stringify(ing)}: ${was} -> ${now}`);
    }
    for (const chosen of ['', ing.unit, ing.packUnit, 'cartone', 'busta', 'pz']) {
      const viaUnit = chosen === '' || norm(chosen) === norm(ing.unit);
      const a = lineUnitCost(ing, ing, chosen);
      const b = old.lineUnitCost(ing, ing, chosen);
      if (same(a, b)) continue;
      // a line in the card's own unit goes through unitCost: the same shape; any other unit is unchanged
      if (viaUnit && shapeB(ing) && b === null && near(a, expectedB(ing))) continue;
      bad.push(`lineUnitCost(${chosen}) ${name} ${JSON.stringify(ing)}`);
    }
    if (bad.length > 5) break;
  }
  assert.deepEqual(bad, []);
  assert.ok(changed > 0, 'the named shape must actually occur in the grid');
});

test('the changed shape, spelled out by hand — and the one that must NOT change', () => {
  // a per-piece price with one piece's weight read by weight — 0.25 an egg of 60 g is 4.1667 a kilo (was: no price)
  const egg = { unit: 'kg', packUnit: '', weight: '', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
  assert.equal(old.unitCost(egg, egg), null);
  assert.ok(near(unitCost(egg, egg), 0.25 / 0.06));
  assert.ok(near(unitCost({ ...egg, unit: 'g' }, egg), 0.25 / 0.06 / 1000));
  // without a piece weight it stays no price
  assert.equal(unitCost(egg, { priceUnit: 'pcs', pricePerUnit: 0.25 }), null);
  // ⚠️ A «vaschetta» of 30 eggs ordered by its own package word is NOT one egg: refuse rather than guess
  const tray = { unit: 'vaschetta', packUnit: 'vaschetta', weight: '', priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 12, caseCount: 30, caseItemUnit: 'pcs' };
  assert.equal(old.unitCost(tray, tray), null);
  assert.equal(unitCost(tray, tray), null);
  assert.equal(packPrice({ packKg: {} }, tray, false), null);
  // and an explicit-size case still says nothing
  const kgCase = { unit: 'busta', packUnit: 'busta', weight: '', priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' };
  assert.equal(unitCost(kgCase, kgCase), null);
});

test('the stocktake gives EXACTLY the old numbers for every item with no packCount, but for the named shape', () => {
  const bad = [];
  const months = [{ packKg: {} }, { packKg: { x: 12 } }, { packKg: { x: 0 } }, null];
  for (const { name, ing } of shapes()) {
    const touched = shapeB(ing) && hasCase(ing);
    for (const month of months) {
      for (const closed of [false, true]) {
        const m = month && closed ? { ...month, unitPrice: { x: 1.5 } } : month;
        if (!same(packKgFor(m, ing, closed), oldValue.packKgFor(m, ing, closed))) bad.push(`packKgFor ${name} ${JSON.stringify(ing)}`);
        const p = packPrice(m, ing, closed);
        const q = oldValue.packPrice(m, ing, closed);
        if (!same(p, q) && !(touched && !closed && q === null && typeof p === 'number')) bad.push(`packPrice ${name} ${JSON.stringify(ing)} ${JSON.stringify(m)}: ${q} -> ${p}`);
        const v = valueBlocker(m, ing, closed);
        const w = oldValue.valueBlocker(m, ing, closed);
        if (v !== w && !(touched && !closed && w === 'no-price' && v === null)) bad.push(`valueBlocker ${name} ${JSON.stringify(ing)}`);
      }
    }
    const note = casePackNote(ing);
    const was = oldValue.casePackNote(ing);
    if (JSON.stringify(note) !== JSON.stringify(was) && !(touched && was && was.key === 'inv.packCaseAmbiguous' && note && note.key === 'inv.packCasePer')) bad.push(`casePackNote ${name} ${JSON.stringify(ing)}`);
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
