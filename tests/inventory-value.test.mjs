// inventory-value.test.mjs — what a month's consumption was worth.
//
// The awkward joint of the whole feature: the count is in PACKS and the price is
// per KILO, and the only bridge is a free-text field somebody typed. These tests
// exist to pin the one rule that keeps the figure honest — where the bridge
// cannot be read, there is NO money, never a guessed one.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parsePackSize, packKgFor, packPrice, valueBlocker, lineValue, monthCost,
  NO_PRICE, NO_PACK, NO_FROZEN_PRICE,
} from '../js/inventory/inventory-value.js';

const byKg = (over = {}) => ({ id: 'flour', name: 'Flour', weight: '25kg', priceUnit: 'kg', pricePerUnit: 0.8, ...over });
const byPiece = (over = {}) => ({ id: 'box', name: 'Box', weight: '', priceUnit: 'pcs', pricePerUnit: 0.15, ...over });

// ── Reading a pack weight out of free text ───────────────────────────────────

test('the ordinary shapes somebody actually types', () => {
  assert.equal(parsePackSize('25kg'), 25);
  assert.equal(parsePackSize('2.27kg'), 2.27);
  assert.equal(parsePackSize('2,27 kg'), 2.27);
  assert.equal(parsePackSize('500g'), 0.5);
  assert.equal(parsePackSize('500 G'), 0.5);
  assert.equal(parsePackSize('1L'), 1);
  assert.equal(parsePackSize('750 ml'), 0.75);
  assert.equal(parsePackSize('50cl'), 0.5);
});

test('a case of several packs multiplies out', () => {
  assert.equal(parsePackSize('6x1kg'), 6);
  assert.equal(parsePackSize('12 x 500g'), 6);
  assert.equal(parsePackSize('6 × 1 kg'), 6);
});

test('the unit written first, the way an invoice often has it', () => {
  assert.equal(parsePackSize('kg 5'), 5);
  assert.equal(parsePackSize('KG 2,5'), 2.5);
});

test('⚠️ what it cannot read it refuses, rather than guessing', () => {
  // A guessed pack weight does not look wrong on the screen. It just makes the
  // month's cost wrong, which is worse.
  assert.equal(parsePackSize('sacco'), null);
  assert.equal(parsePackSize('10 pz'), null);
  assert.equal(parsePackSize('big bag'), null);
  assert.equal(parsePackSize('25'), null, 'a bare number names no unit');
  assert.equal(parsePackSize('25kg circa'), null);
  assert.equal(parsePackSize(''), null);
  assert.equal(parsePackSize('   '), null);
  assert.equal(parsePackSize(null), null);
  assert.equal(parsePackSize(25), null);
});

test('a zero or negative weight is not a pack', () => {
  assert.equal(parsePackSize('0kg'), null);
  assert.equal(parsePackSize('-2kg'), null);
});

// ── Which pack weight the month uses ─────────────────────────────────────────

test('what somebody typed in beats what the text says', () => {
  const month = { packKg: { flour: 20 } };
  assert.equal(packKgFor(month, byKg()), 20);
});

test('with nothing typed in, the text is read', () => {
  assert.equal(packKgFor({ packKg: {} }, byKg()), 25);
  assert.equal(packKgFor(null, byKg()), 25);
});

test('a corrupt stored weight falls back to the text rather than to nonsense', () => {
  assert.equal(packKgFor({ packKg: { flour: 'HELLO' } }, byKg()), 25);
  assert.equal(packKgFor({ packKg: { flour: 0 } }, byKg()), 25);
});

// ── What one pack costs ──────────────────────────────────────────────────────

test('a pack priced by weight costs its weight times the rate', () => {
  assert.equal(packPrice({ packKg: {} }, byKg(), false), 20);
});

test('⚠️ a product priced by the piece needs no pack weight at all', () => {
  // Its rate already is "per one of them", which is what the stocktake counts.
  assert.equal(packPrice({ packKg: {} }, byPiece(), false), 0.15);
  assert.equal(valueBlocker({ packKg: {} }, byPiece()), null);
});

test('no price means no pack price, and the screen is told which job would fix it', () => {
  const unpriced = byKg({ priceUnit: null, pricePerUnit: null });
  assert.equal(packPrice({ packKg: {} }, unpriced, false), null);
  assert.equal(valueBlocker({ packKg: {} }, unpriced), NO_PRICE);
});

test('an unreadable pack weight means no pack price, and says so differently', () => {
  const vague = byKg({ weight: 'sacco' });
  assert.equal(packPrice({ packKg: {} }, vague, false), null);
  assert.equal(valueBlocker({ packKg: {} }, vague), NO_PACK);
});

test('a piece-priced product with no price is a price problem, not a pack one', () => {
  assert.equal(valueBlocker({}, byPiece({ pricePerUnit: null })), NO_PRICE);
});

test('⚠️ a CLOSED month uses the price frozen into it, not today\'s', () => {
  // A price changed next spring must not restate what last September cost.
  const month = { packKg: { flour: 25 }, unitPrice: { flour: 12.5 } };
  assert.equal(packPrice(month, byKg(), true), 12.5, 'what one sack cost that month');
  assert.equal(packPrice(month, byKg(), false), 20, 'open month uses today\'s 0.80/kg');
});

test('⚠️ the frozen figure is a PACK price, so a piece-priced product freezes too', () => {
  // A rate per kilo could not hold this at all: the product has no weight and its
  // price is per one of them. Freezing the pack price makes both cases one case.
  const month = { packKg: {}, unitPrice: { box: 0.11 } };
  assert.equal(packPrice(month, byPiece(), true), 0.11);
  assert.equal(packPrice(month, byPiece(), false), 0.15);
});

// ── One row of the month ─────────────────────────────────────────────────────

test('a row is worth what was used times what a pack costs', () => {
  assert.deepEqual(lineValue({ packKg: {} }, byKg(), 3, false), { value: 60, blocker: null });
});

test('⚠️ a product nobody counted has no cost — not a zero cost', () => {
  // A zero would quietly flatter the total by exactly the amount nobody counted.
  assert.deepEqual(lineValue({ packKg: {} }, byKg(), null, false), { value: null, blocker: null });
});

test('a row that cannot be valued keeps its quantity and loses only its money', () => {
  const out = lineValue({ packKg: {} }, byKg({ weight: 'sacco' }), 3, false);
  assert.equal(out.value, null);
  assert.equal(out.blocker, NO_PACK);
});

test('half a pack is worth half a pack', () => {
  assert.equal(lineValue({ packKg: {} }, byKg(), 0.5, false).value, 10);
});

// ── The month, added up ──────────────────────────────────────────────────────

const used = map => ing => (ing.id in map ? map[ing.id] : null);

test('the month adds up, most expensive first, and counts what it could not value', () => {
  const ingredients = [
    byKg(),
    byPiece(),
    byKg({ id: 'oil', name: 'Oil', weight: 'damigiana', priceUnit: 'l', pricePerUnit: 3 }),
  ];
  const out = monthCost({
    month: { packKg: {}, unitPrice: {} },
    ingredients,
    consumptionOf: used({ flour: 3, box: 100, oil: 2 }),
    closed: false,
  });
  assert.equal(out.total, 75, '3 × 20 + 100 × 0.15');
  assert.equal(out.counted, 3);
  assert.equal(out.withoutValue, 1);
  assert.deepEqual(out.lines.map(l => l.ingredient.id), ['flour', 'box', 'oil']);
  assert.equal(out.lines[2].blocker, NO_PACK);
});

test('a row with no consumption is not in the list at all', () => {
  const out = monthCost({
    month: { packKg: {} },
    ingredients: [byKg(), byPiece()],
    consumptionOf: used({ flour: 1 }),
    closed: false,
  });
  assert.equal(out.lines.length, 1);
  assert.equal(out.counted, 1);
});

test('a month where nothing can be valued still adds up to zero without failing', () => {
  const out = monthCost({
    month: { packKg: {} },
    ingredients: [byKg({ priceUnit: null, pricePerUnit: null })],
    consumptionOf: used({ flour: 5 }),
    closed: false,
  });
  assert.equal(out.total, 0);
  assert.equal(out.withoutValue, 1);
  assert.equal(out.lines[0].blocker, NO_PRICE);
});

test('nothing at all is an empty month, not a crash', () => {
  const out = monthCost({ month: {}, ingredients: [], consumptionOf: () => null, closed: false });
  assert.deepEqual(out, { lines: [], total: 0, counted: 0, withoutValue: 0 });
});

test('pennies add up without float dust', () => {
  const cheap = byKg({ weight: '1kg', pricePerUnit: 0.1 });
  const out = monthCost({
    month: { packKg: {} },
    ingredients: [cheap],
    consumptionOf: used({ flour: 3 }),
    closed: false,
  });
  assert.equal(out.total, 0.3);
});

// ── A closed month is frozen, and «frozen» has to mean it ────────────────────
//
// ⚠️⚠️ THE DEFECT THESE PIN, BECAUSE IT SHIPPED AND WAS CAUGHT BY A REVIEW AND NOT
// BY A TEST: a closed month fell back to TODAY'S price when the frozen figure was
// missing, and to TODAY'S pack text when the frozen weight was. So a price typed in
// November, or a pack size corrected in the spring, silently changed what September
// had cost — while the screen said «this month is closed: its figures no longer
// change». A number business decisions are made on is not allowed to move.

test('⚠️⚠️ a closed month with no frozen price has NO cost — it does not borrow the price of today', () => {
  const closed = { packKg: { flour: 25 }, unitPrice: {} };
  assert.equal(packPrice(closed, byKg(), true), null,
    'the 0.80/kg on the product record belongs to today, not to the month that was closed');
  assert.equal(packPrice(closed, byKg(), false), 20, 'and an OPEN month still uses it');
});

test('⚠️ nor does a closed month read the live pack text', () => {
  // The pack text is free text on the product record. Correcting «sacco» to «25kg»
  // next spring must not hand every closed month a cost it never had.
  const closed = { packKg: {}, unitPrice: { flour: 12.5 } };
  assert.equal(packKgFor(closed, byKg(), true), null);
  assert.equal(packKgFor(closed, byKg(), false), 25);
  // The price is frozen, so the row is still worth what it was worth: the frozen
  // figure is per COUNTED UNIT and needs no weight to be useful.
  assert.equal(packPrice(closed, byKg(), true), 12.5);
});

test('⚠️ a closed month with nothing frozen says what happened, not what to do', () => {
  // "no price entered" would send somebody to enter one and change nothing.
  const closed = { packKg: {}, unitPrice: {} };
  assert.equal(valueBlocker(closed, byKg(), true), NO_FROZEN_PRICE,
    'the product still has a price and a readable pack — neither belongs to this month');
  assert.equal(valueBlocker(closed, byKg({ weight: 'sacco' }), false), NO_PACK,
    'while an open month names the job that would fix it');
  assert.deepEqual(lineValue(closed, byKg(), 3, true), { value: null, blocker: NO_FROZEN_PRICE });
});

test('a closed month that froze everything values every row', () => {
  const closed = { packKg: { flour: 25 }, unitPrice: { flour: 12.5, box: 0.11 } };
  assert.equal(valueBlocker(closed, byKg(), true), null);
  assert.deepEqual(lineValue(closed, byKg(), 2, true), { value: 25, blocker: null });
  assert.deepEqual(lineValue(closed, byPiece(), 100, true), { value: 11, blocker: null });
});

test('⚠️ a product DELETED after the close still costs what it cost', () => {
  // It reaches this file as the frozen label and its id, with no price and no pack
  // text of its own — everything the row needs was written into the month.
  const gone = { id: 'flour', name: 'Flour 25kg', weight: '' };
  const closed = { packKg: { flour: 25 }, unitPrice: { flour: 12.5 } };
  const out = monthCost({
    month: closed,
    ingredients: [gone],
    consumptionOf: () => 4,
    closed: true,
  });
  assert.equal(out.total, 50);
  assert.equal(out.withoutValue, 0);
});

test('a frozen price of zero is not a price', () => {
  // Nothing is free, and a 0 in that map is the shape a half-written close leaves.
  assert.equal(packPrice({ unitPrice: { flour: 0 } }, byKg(), true), null);
});
