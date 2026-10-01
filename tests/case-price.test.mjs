// case-price.test.mjs — a price quoted per CASE (30 Sep 2026): «il cartone costa 20 euro
// e ho 50 pz» / «4 buste da 2.5 kg». The division happens ONCE, at save time, and the
// case is stored beside the rate it produced.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  caseRate, caseOf, storedCaseOf, formatRate, pricePatch, priceChanged, priceRecord, splitPriceFields, withPrices,
  PRICE_FIELDS, INGREDIENT_DRAINED_FIELDS, CASE_MODE,
} from '../js/price-model.js';
import { unitCost } from '../js/order-cost.js';
import { packPrice, valueBlocker, lineValue, casePackNote, NO_PRICE } from '../js/inventory/inventory-value.js';

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

test('a derived rate keeps six decimals, never floating-point noise', () => {
  assert.equal(caseRate({ casePrice: 10, caseCount: 3, caseItemUnit: 'pcs' }).pricePerUnit, 3.333333);
});

test('a very small derived rate is kept, not rounded to nothing', () => {
  // 2000 straws at 3.49 is 0.001745 each — four decimals would store 0.0017 (2.6% out)
  assert.equal(caseRate({ casePrice: 3.49, caseCount: 2000, caseItemUnit: 'pcs' }).pricePerUnit, 0.001745);
  // 10,000 pieces at 0.49 is 0.000049 each, which is not free
  assert.equal(caseRate({ casePrice: 0.49, caseCount: 10000, caseItemUnit: 'pcs' }).pricePerUnit, 0.000049);
});

test('formatRate shows such small rates in full, never as 0.00', () => {
  assert.match(formatRate(0.001745), /0\.001745$/);
  assert.match(formatRate(0.000049), /0\.000049$/);
  assert.match(formatRate(7.2), /7\.20$/);
  assert.match(formatRate(0.035), /0\.035$/);
});

test('a typed rate is still stored to four decimals', () => {
  assert.equal(pricePatch({ priceUnit: 'kg', pricePerUnit: 1.23456789 }, AT).pricePerUnit, 1.2346);
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

test('a case so cheap that even six decimals round it to nothing is not free', () => {
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

test('a piece word on a case of kilos is ONE ITEM of the case (a bag), not the case', () => {
  assert.equal(unitCost({ unit: 'pz' }, flour), 5);
});

test('case words and an empty unit are the whole case; other words on a case of several are null', () => {
  for (const unit of ['cartone', 'cartoni', 'cassa', 'casse', 'collo', 'colli', 'confezione', 'confezioni',
    'scatola', 'scatole', 'box', 'case', 'cases', 'carton', 'crate', 'pack', 'Cartone']) {
    assert.equal(unitCost({ unit }, flour), 20, unit);
  }
  assert.equal(unitCost({ unit: '' }, flour), 20);
  for (const unit of ['busta', 'sacco', 'bottiglia']) {
    assert.equal(unitCost({ unit }, flour), null, unit);
  }
});

test('a case of ONE costs the case price for any non-weight word', () => {
  const sack = { casePrice: 20, caseCount: 1, caseItemSize: 25, caseItemUnit: 'kg', priceUnit: 'kg', pricePerUnit: 0.8 };
  assert.equal(unitCost({ unit: 'sacco' }, sack), 20);
  assert.equal(unitCost({ unit: 'pz' }, sack), 20);
  assert.equal(unitCost({ unit: 'kg' }, sack), 0.8);
});

test('without a stored case, unitCost is exactly what it was', () => {
  assert.equal(unitCost({ weight: '25kg' }, { priceUnit: 'kg', pricePerUnit: 1.8 }), 45);
  assert.equal(unitCost({ unit: 'pz' }, { priceUnit: 'pcs', pricePerUnit: 0.9 }), 0.9);
  assert.equal(unitCost({ unit: 'kg' }, { priceUnit: 'pcs', pricePerUnit: 0.9 }), null);
  // a half-stored case is not a case
  assert.equal(unitCost({ unit: 'cartone' }, { priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20 }), 0.4);
});

// ── A stale case is ignored (an old phone saved a rate over it) ──────────────

test('storedCaseOf accepts a case that reproduces its own rate exactly', () => {
  assert.deepEqual(storedCaseOf(flour),
    { casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' });
  assert.notEqual(storedCaseOf(eggs), null);
  const small = { casePrice: 3.49, caseCount: 2000, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.001745 };
  assert.notEqual(storedCaseOf(small), null);
});

test('the patch a case save writes is recognised by storedCaseOf, at every size', () => {
  for (const form of [
    { casePrice: 3.49, caseCount: 2000, caseItemUnit: 'pcs' },
    { casePrice: 10, caseCount: 3, caseItemUnit: 'pcs' },
    { casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' },
    { casePrice: 12, caseCount: 7, caseItemSize: 330, caseItemUnit: 'ml' },
  ]) {
    assert.notEqual(storedCaseOf(pricePatch({ priceUnit: CASE_MODE, ...form }, AT)), null, JSON.stringify(form));
  }
});

test('a rate typed on an old phone over the old case makes that case stale: null', () => {
  assert.equal(storedCaseOf({ ...flour, pricePerUnit: 2.5 }), null);
  assert.equal(storedCaseOf({ ...flour, priceUnit: 'l' }), null);
  assert.equal(storedCaseOf({ ...eggs, priceUnit: 'kg' }), null);
});

test('a price deleted on an old phone stays deleted: the leftover case is not a price', () => {
  const deleted = { ...flour, priceUnit: null, pricePerUnit: null };
  assert.equal(storedCaseOf(deleted), null);
  assert.equal(unitCost({ unit: 'cartone' }, deleted), null);
  assert.equal(packPrice({}, { id: 'f', ...deleted }, false), null);
  assert.equal(valueBlocker({}, { id: 'f', ...deleted }, false), NO_PRICE);
});

test('orders and the stocktake use the typed rate, not the stale case', () => {
  const stale = { ...flour, pricePerUnit: 3 };
  assert.equal(unitCost({ unit: 'kg' }, stale), 3);
  assert.equal(unitCost({ unit: 'cartone', weight: '10kg' }, stale), 30);
  assert.equal(packPrice({}, { id: 'f', weight: '10kg', ...stale }, false), 30);
});

test('storedCaseOf of nothing is null', () => {
  assert.equal(storedCaseOf(null), null);
  assert.equal(storedCaseOf({}), null);
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

test('counted in the ORDER unit: 720 eggs from a 360-egg case at 54 cost 108, not 38,880', () => {
  const egg = { id: 'e', unit: 'pz', casePrice: 54, caseCount: 360, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.15 };
  assert.equal(packPrice({}, egg, false), 0.15);
  assert.equal(lineValue({}, egg, 720, false).value, 108);
  assert.equal(lineValue({}, { ...egg, unit: 'cartone' }, 2, false).value, 108);
});

test('counted in kilos: 50 kg from a 25 kg case at 20 cost 40', () => {
  const sack = { id: 'f', unit: 'kg', casePrice: 20, caseCount: 1, caseItemSize: 25, caseItemUnit: 'kg', priceUnit: 'kg', pricePerUnit: 0.8 };
  assert.equal(lineValue({}, sack, 50, false).value, 40);
});

test('an order unit that leaves doubt gives no value, with the no-price blocker', () => {
  const bag = { id: 'f', unit: 'busta', ...flour };
  assert.equal(packPrice({}, bag, false), null);
  assert.deepEqual(lineValue({}, bag, 3, false), { value: null, blocker: NO_PRICE });
});

test('a tiny per-item cost is not rounded away in the stocktake', () => {
  const straw = { id: 's', unit: 'pz', casePrice: 0.49, caseCount: 10000, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.000049 };
  assert.equal(packPrice({}, straw, false), 0.000049);
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

// ── The stocktake detail's sentence for a case ───────────────────────────────

test('casePackNote: the price of one counted unit, in the ingredient order unit', () => {
  const egg = { unit: 'pz', ...eggs };
  assert.deepEqual(casePackNote(egg), { key: 'inv.packCasePer', value: 0.4, unit: 'pz' });
  assert.deepEqual(casePackNote({ unit: 'cartone', ...eggs }), { key: 'inv.packCasePer', value: 20, unit: 'cartone' });
  assert.deepEqual(casePackNote({ unit: 'kg', ...flour }), { key: 'inv.packCasePer', value: 2, unit: 'kg' });
  assert.deepEqual(casePackNote({ ...flour }), { key: 'inv.packCasePer', value: 20, unit: '' });
});

test('casePackNote keeps a tiny price whole, for formatRate to show', () => {
  const straw = { unit: 'pz', casePrice: 3.49, caseCount: 2000, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.001745 };
  assert.equal(casePackNote(straw).value, 0.001745);
});

test('casePackNote names the fix when the order unit leaves doubt, and is null without a valid case', () => {
  assert.deepEqual(casePackNote({ unit: 'busta', ...flour }), { key: 'inv.packCaseAmbiguous' });
  assert.equal(casePackNote({ unit: 'pz', priceUnit: 'pcs', pricePerUnit: 0.4 }), null);
  assert.equal(casePackNote({ unit: 'pz', ...eggs, pricePerUnit: 9 }), null);
});

// ── A legacy explicit-size case written back by an untouched save (1 Oct 2026) ──
// The card no longer offers «Contiene count × size × unit», but 4 × 2.5 kg cases typed with it
// are in production: reopened and saved without a touch they must come back as they were.
import { storedPriceInput } from '../js/price-model.js';

test('a legacy explicit-size case (kg, g, l, ml) written back untouched is the same case and the same rate', () => {
  for (const stored of [
    { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' },
    { priceUnit: 'kg', pricePerUnit: 10, casePrice: 20, caseCount: 4, caseItemSize: 500, caseItemUnit: 'g' },
    { priceUnit: 'l', pricePerUnit: 2, casePrice: 12, caseCount: 6, caseItemSize: 1, caseItemUnit: 'l' },
    { priceUnit: 'l', pricePerUnit: 4, casePrice: 12, caseCount: 6, caseItemSize: 500, caseItemUnit: 'ml' },
  ]) {
    assert.ok(storedCaseOf(stored), 'it stands before');
    const patch = pricePatch(storedPriceInput(stored, ''), AT, '');
    for (const key of ['priceUnit', 'pricePerUnit', ...CASE_KEYS]) assert.equal(patch[key], stored[key], key);
    assert.deepEqual(storedCaseOf(patch), storedCaseOf(stored), 'and it stands after');
    assert.equal(priceChanged(stored, patch), false);
  }
});
