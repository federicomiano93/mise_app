// case-price.test.mjs — a price quoted per CASE (30 Sep 2026): «il cartone costa 20 euro
// e ho 50 pz» / «4 buste da 2.5 kg». The division happens ONCE, at save time, and the
// case is stored beside the rate it produced.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  caseRate, caseOf, pricePatch, priceChanged, priceRecord, splitPriceFields, withPrices,
  PRICE_FIELDS, INGREDIENT_DRAINED_FIELDS, CASE_MODE,
} from '../js/price-model.js';
import { unitCost } from '../js/order-cost.js';
import { packPrice, valueBlocker, lineValue } from '../js/inventory/inventory-value.js';

const AT = '2026-09-30T09:00:00.000Z';
const CASE_KEYS = ['casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit'];

// ── caseRate: the pure division ──────────────────────────────────────────────

test('20 for a case of 50 pieces is 0.40 a piece', () => {
  assert.deepEqual(caseRate({ casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' }),
    { priceUnit: 'pcs', pricePerUnit: 0.4 });
});

test('pieces ignore the size box', () => {
  assert.deepEqual(caseRate({ casePrice: 20, caseCount: 50, caseItemSize: 999, caseItemUnit: 'pcs' }),
    { priceUnit: 'pcs', pricePerUnit: 0.4 });
});

test('20 for 4 bags of 2.5 kg is 2 a kilo', () => {
  assert.deepEqual(caseRate({ casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' }),
    { priceUnit: 'kg', pricePerUnit: 2 });
});

test('grams are thousandths of a kilo: 20 for 4 × 500 g is 10 a kilo', () => {
  assert.deepEqual(caseRate({ casePrice: 20, caseCount: 4, caseItemSize: 500, caseItemUnit: 'g' }),
    { priceUnit: 'kg', pricePerUnit: 10 });
});

test('litres and millilitres price per litre', () => {
  assert.deepEqual(caseRate({ casePrice: 12, caseCount: 6, caseItemSize: 1, caseItemUnit: 'l' }),
    { priceUnit: 'l', pricePerUnit: 2 });
  assert.deepEqual(caseRate({ casePrice: 12, caseCount: 6, caseItemSize: 500, caseItemUnit: 'ml' }),
    { priceUnit: 'l', pricePerUnit: 4 });
});

test('the rate is rounded to four decimals, never left with floating-point noise', () => {
  assert.equal(caseRate({ casePrice: 10, caseCount: 3, caseItemUnit: 'pcs' }).pricePerUnit, 3.3333);
});

test('anything missing, zero, negative or not a number gives null, never a guess', () => {
  const ok = { casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' };
  assert.notEqual(caseRate(ok), null);
  for (const bad of [
    { casePrice: '' }, { casePrice: 0 }, { casePrice: -1 }, { casePrice: 'abc' }, { casePrice: NaN },
    { caseCount: '' }, { caseCount: 0 }, { caseCount: -2 },
    { caseItemSize: '' }, { caseItemSize: 0 }, { caseItemSize: null },
    { caseItemUnit: '' }, { caseItemUnit: 'oz' }, { caseItemUnit: null },
  ]) {
    assert.equal(caseRate({ ...ok, ...bad }), null, JSON.stringify(bad));
  }
  assert.equal(caseRate(), null);
  assert.equal(caseRate({}), null);
});

test('a case so cheap that four decimals round it to nothing is not free', () => {
  assert.equal(caseRate({ casePrice: 0.0001, caseCount: 100000, caseItemUnit: 'pcs' }), null);
});

test('caseOf keeps a whole case and drops a partial one', () => {
  assert.deepEqual(caseOf({ casePrice: 20, caseCount: 50, caseItemSize: 3, caseItemUnit: 'pcs' }),
    { casePrice: 20, caseCount: 50, caseItemSize: null, caseItemUnit: 'pcs' });
  assert.deepEqual(caseOf({ casePrice: '20', caseCount: '4', caseItemSize: '2.5', caseItemUnit: 'kg' }),
    { casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' });
  assert.equal(caseOf({ casePrice: 20, caseCount: 4, caseItemUnit: 'kg' }), null);
  assert.equal(caseOf({ priceUnit: 'kg', pricePerUnit: 2 }), null);
  assert.equal(caseOf(null), null);
});

// ── pricePatch ───────────────────────────────────────────────────────────────

test('a case in the form writes the case AND the derived rate', () => {
  const p = pricePatch({ priceUnit: CASE_MODE, casePrice: '20', caseCount: '4', caseItemSize: '2.5', caseItemUnit: 'kg', vatRate: '4' }, AT);
  assert.equal(p.priceUnit, 'kg');
  assert.equal(p.pricePerUnit, 2);
  assert.deepEqual(
    [p.casePrice, p.caseCount, p.caseItemSize, p.caseItemUnit], [20, 4, 2.5, 'kg']);
  assert.equal(p.priceUpdatedAt, AT);
  assert.equal(p.vatRate, 4);
});

test('a case of pieces stores no size and keeps the piece weight', () => {
  const p = pricePatch({ priceUnit: CASE_MODE, casePrice: 20, caseCount: 50, caseItemSize: 7, caseItemUnit: 'pcs', unitWeightKg: '0.055' }, AT);
  assert.equal(p.priceUnit, 'pcs');
  assert.equal(p.pricePerUnit, 0.4);
  assert.equal(p.caseItemSize, null);
  assert.equal(p.unitWeightKg, 0.055);
});

test('an incomplete case is «no price» with all four case keys null', () => {
  const p = pricePatch({ priceUnit: CASE_MODE, casePrice: 20, caseCount: '', caseItemSize: 2.5, caseItemUnit: 'kg' }, AT);
  assert.equal(p.priceUnit, null);
  assert.equal(p.pricePerUnit, null);
  assert.equal(p.priceUpdatedAt, null);
  CASE_KEYS.forEach(key => assert.equal(p[key], null, key));
});

test('any other mode sends the four case keys as null, so a merge clears an old case', () => {
  for (const form of [
    { priceUnit: 'kg', pricePerUnit: 2 },
    { priceUnit: 'pcs', pricePerUnit: 0.4 },
    { priceUnit: null },
    // stale case boxes must be ignored outside case mode
    { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' },
  ]) {
    const p = pricePatch(form, AT);
    CASE_KEYS.forEach(key => {
      assert.ok(key in p, `${key} must be present`);
      assert.equal(p[key], null, key);
    });
  }
});

test('the patch never carries a bad case value', () => {
  const p = pricePatch({ priceUnit: CASE_MODE, casePrice: -5, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'oz' }, AT);
  CASE_KEYS.forEach(key => assert.equal(p[key], null, key));
});

test('the history records the derived rate; a case price that moves the rate is a change', () => {
  const before = pricePatch({ priceUnit: CASE_MODE, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' }, AT);
  const same = pricePatch({ priceUnit: CASE_MODE, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' }, AT);
  const dearer = pricePatch({ priceUnit: CASE_MODE, casePrice: 24, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' }, AT);
  assert.equal(priceChanged(before, same), false);
  assert.equal(priceChanged(before, dearer), true);
  const record = priceRecord({ supplierId: 'S1' }, dearer, AT);
  assert.equal(record.pricePerUnit, 2.4);
  assert.equal(record.priceUnit, 'kg');
  CASE_KEYS.forEach(key => assert.equal(key in record, false, `${key} is not a history field`));
});

// ── Where the case is stored ─────────────────────────────────────────────────

test('the case keys are price fields but are never drained onto an ingredient', () => {
  CASE_KEYS.forEach(key => {
    assert.ok(PRICE_FIELDS.includes(key), key);
    assert.equal(INGREDIENT_DRAINED_FIELDS.includes(key), false, key);
  });
});

test('splitPriceFields sends the case to the price half only', () => {
  const p = pricePatch({ priceUnit: CASE_MODE, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' }, AT);
  const { ingredient, price } = splitPriceFields({ name: 'Eggs', ...p });
  CASE_KEYS.forEach(key => {
    assert.equal(key in ingredient, false, `${key} must not reach the ingredient`);
    assert.ok(key in price, key);
  });
  assert.equal(price.casePrice, 20);
});

test('withPrices puts the case back on the ingredient for the screens', () => {
  const p = pricePatch({ priceUnit: CASE_MODE, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' }, AT);
  const [merged] = withPrices([{ id: 'E1', name: 'Eggs' }], { E1: p });
  assert.equal(merged.casePrice, 20);
  assert.equal(merged.caseCount, 50);
  assert.equal(merged.pricePerUnit, 0.4);
});

// ── Orders: what ONE ORDERED UNIT costs ──────────────────────────────────────

const eggs = { casePrice: 20, caseCount: 50, caseItemSize: null, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.4 };
const flour = { casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg', priceUnit: 'kg', pricePerUnit: 2 };

test('1 cartone of 50 pz at 20 is 20, not 0.40', () => {
  assert.equal(unitCost({ unit: 'cartone', weight: '' }, eggs), 20);
  assert.equal(unitCost({ unit: 'cassa', weight: '' }, eggs), 20);
  assert.equal(unitCost({ unit: 'box' }, eggs), 20);
});

test('an empty order unit reads as one case', () => {
  assert.equal(unitCost({ unit: '' }, eggs), 20);
  assert.equal(unitCost({}, eggs), 20);
});

test('ordered by the piece, a case of pieces costs the per-piece rate', () => {
  for (const unit of ['pz', 'pz.', 'Pezzi', 'pezzo', 'pcs', 'pc', 'piece', 'pieces', 'each']) {
    assert.equal(unitCost({ unit }, eggs), 0.4, unit);
  }
});

test('ordered by weight, a case of pieces stays null (as any per-piece price does)', () => {
  assert.equal(unitCost({ unit: 'kg' }, eggs), null);
});

test('ordered by weight, a case of kilos is the rate times that unit', () => {
  assert.equal(unitCost({ unit: 'kg' }, flour), 2);
  assert.equal(unitCost({ unit: 'g' }, flour), 0.002);
});

test('a case of kilos ordered in cartoni is the case price, whatever the pack text says', () => {
  assert.equal(unitCost({ unit: 'cartone', weight: '2.5kg' }, flour), 20);
});

test('a piece word on a case of kilos is still one case', () => {
  assert.equal(unitCost({ unit: 'pz' }, flour), 20);
});

test('without a stored case, unitCost is exactly what it was', () => {
  assert.equal(unitCost({ weight: '25kg' }, { priceUnit: 'kg', pricePerUnit: 1.8 }), 45);
  assert.equal(unitCost({ unit: 'pz' }, { priceUnit: 'pcs', pricePerUnit: 0.9 }), 0.9);
  assert.equal(unitCost({ unit: 'kg' }, { priceUnit: 'pcs', pricePerUnit: 0.9 }), null);
  // a half-stored case is not a case
  assert.equal(unitCost({ unit: 'cartone' }, { priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20 }), 0.4);
});

// ── The stocktake ────────────────────────────────────────────────────────────

test('an open month counts one case as one unit: the case price, no pack weight needed', () => {
  assert.equal(packPrice({}, { id: 'e', weight: '', ...eggs }, false), 20);
  assert.equal(packPrice({}, { id: 'f', weight: 'sacco', ...flour }, false), 20);
});

test('a case carries no blocker', () => {
  assert.equal(valueBlocker({}, { id: 'f', weight: '', ...flour }, false), null);
  assert.equal(valueBlocker({}, { id: 'e', weight: '', ...eggs }, false), null);
});

test('a line is valued at the case price', () => {
  assert.deepEqual(lineValue({}, { id: 'e', ...eggs }, 3, false), { value: 60, blocker: null });
});

test('a closed month still uses only what was frozen into it', () => {
  const month = { unitPrice: { e: 18 } };
  assert.equal(packPrice(month, { id: 'e', ...eggs }, true), 18);
  assert.equal(packPrice({ unitPrice: {} }, { id: 'e', ...eggs }, true), null);
});

test('an ingredient without a case is valued as before', () => {
  assert.equal(packPrice({}, { id: 'x', weight: '25kg', priceUnit: 'kg', pricePerUnit: 0.8 }, false), 20);
  assert.equal(packPrice({}, { id: 'p', priceUnit: 'pcs', pricePerUnit: 0.15 }, false), 0.15);
});
