// inventory-model.test.mjs — the month's stocktake: what you had, what you
// bought, what is left, and therefore what you used.
//
// The owner cannot read code, so these tests are the safety net (P15). The one
// they exist for above all others is the first section: an empty box is not a
// zero. Read as a zero, a product nobody counted reports its whole stock as
// consumed — a made-up number that would then be believed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MONTH_PATTERN, isMonthId, monthKey, shiftMonth, previousMonth, nextMonth,
  monthBounds, readCount, COUNT_MAPS, FROZEN_MAPS, normalizeMonth, isClosed,
  consumption, progressOf, carryOver, toDocument,
} from '../js/inventory/inventory-model.js';

const FLOUR = 'flour';
const BUTTER = 'butter';

// A month with flour counted end to end: 3 on the shelf, 12 bought, 4 left.
const month = (over = {}) => normalizeMonth({
  month: '2026-09',
  opening: { [FLOUR]: 3 },
  purchased: { [FLOUR]: 12 },
  closing: { [FLOUR]: 4 },
  ...over,
});

// ── An empty box is not a zero ───────────────────────────────────────────────

test('a product nobody counted has NO consumption, not a full one', () => {
  // The trap this whole file exists for: flour started at 3, 12 arrived, and
  // nobody walked past the shelf. Read as "0 left" it would claim 15 used.
  const m = month({ closing: {} });
  const line = consumption(m, FLOUR);
  assert.equal(line.counted, false);
  assert.equal(line.closing, null);
  assert.equal(line.used, null);
});

test('a product counted AND found empty consumed everything — the other state', () => {
  const line = consumption(month({ closing: { [FLOUR]: 0 } }), FLOUR);
  assert.equal(line.counted, true);
  assert.equal(line.closing, 0);
  assert.equal(line.used, 15);
});

test('without an opening there is no answer either, however much was bought', () => {
  const line = consumption(month({ opening: {} }), FLOUR);
  assert.equal(line.hasOpening, false);
  assert.equal(line.used, null);
});

test('a product never mentioned at all answers null, never NaN', () => {
  const line = consumption(month(), 'never-heard-of-it');
  assert.equal(line.used, null);
  assert.equal(line.opening, null);
  assert.equal(line.purchased, 0);
});

test('a missing PURCHASED is a real zero — the one field that runs the other way', () => {
  // Deliberate: most products are not reordered every month, so "bought none" is
  // the ordinary case. The screen prints the 0 rather than hiding it.
  const line = consumption(month({ purchased: {} }), FLOUR);
  assert.equal(line.purchased, 0);
  assert.equal(line.used, -1);
});

// ── The subtraction ──────────────────────────────────────────────────────────

test('used = had + bought − left', () => {
  assert.equal(consumption(month(), FLOUR).used, 11);
});

test('half a sack is a real quantity, and the thirds of a decimal do not leak', () => {
  const m = month({ opening: { [FLOUR]: 0.1 }, purchased: { [FLOUR]: 0.2 }, closing: { [FLOUR]: 0 } });
  assert.equal(consumption(m, FLOUR).used, 0.3);
});

test('more on the shelf than could possibly be there stays NEGATIVE', () => {
  // Impossible arithmetic is evidence of a mistyped number or an unrecorded
  // delivery. Clamped to zero it would read as a normal month.
  const m = month({ opening: { [FLOUR]: 1 }, purchased: { [FLOUR]: 0 }, closing: { [FLOUR]: 9 } });
  assert.equal(consumption(m, FLOUR).used, -8);
});

test('a month object that is missing every map cannot throw', () => {
  assert.deepEqual(consumption({}, FLOUR).used, null);
  assert.deepEqual(consumption(null, FLOUR).used, null);
});

// ── What a count box accepts ─────────────────────────────────────────────────

test('an empty box, a blank one and nothing at all all mean "not said"', () => {
  assert.equal(readCount(''), null);
  assert.equal(readCount('   '), null);
  assert.equal(readCount(null), null);
  assert.equal(readCount(undefined), null);
});

test('an Italian keyboard types 3,5 and it means three and a half', () => {
  assert.equal(readCount('3,5'), 3.5);
  assert.equal(readCount('3.5'), 3.5);
});

test('a negative count is refused, never quietly turned into zero', () => {
  assert.equal(readCount(-2), null);
  assert.equal(readCount('-2'), null);
});

test('junk in a box is refused rather than becoming NaN', () => {
  assert.equal(readCount('HELLO'), null);
  assert.equal(readCount(Infinity), null);
  assert.equal(readCount(NaN), null);
  assert.equal(readCount({}), null);
  assert.equal(readCount([]), null);
});

test('zero typed on purpose is a real answer', () => {
  assert.equal(readCount('0'), 0);
  assert.equal(readCount(0), 0);
});

// ── Which month, and the one either side of it ───────────────────────────────

test('a month id is a year and a real month, nothing else', () => {
  assert.equal(isMonthId('2026-09'), true);
  assert.equal(isMonthId('2026-13'), false);
  assert.equal(isMonthId('2026-00'), false);
  assert.equal(isMonthId('2026-9'), false);
  assert.equal(isMonthId('2026-09-01'), false);
  assert.equal(isMonthId(''), false);
  assert.equal(isMonthId(null), false);
  assert.ok(MONTH_PATTERN instanceof RegExp);
});

test('the month comes from the LOCAL clock, so half past midnight is the new month', () => {
  // Built in local time on purpose: at 00:30 on 1 October in British Summer Time
  // UTC still says September, and a stocktake would be written into the month
  // that had already ended.
  assert.equal(monthKey(new Date(2026, 9, 1, 0, 30).getTime()), '2026-10');
  assert.equal(monthKey(new Date(2026, 8, 30, 23, 59).getTime()), '2026-09');
});

test('a broken clock answers null rather than a made-up month', () => {
  assert.equal(monthKey(NaN), null);
});

test('the year rolls at December without anyone writing an if', () => {
  assert.equal(nextMonth('2026-12'), '2027-01');
  assert.equal(previousMonth('2026-01'), '2025-12');
  assert.equal(shiftMonth('2026-09', 0), '2026-09');
  assert.equal(shiftMonth('2026-09', -9), '2025-12');
});

test('a month nobody could name shifts to nothing', () => {
  assert.equal(shiftMonth('nonsense', 1), null);
  assert.equal(shiftMonth('2026-09', 1.5), null);
});

test('a month is bounded from its first day up to — not including — the next', () => {
  assert.deepEqual(monthBounds('2026-02'), { from: '2026-02-01', to: '2026-03-01' });
  assert.deepEqual(monthBounds('2026-12'), { from: '2026-12-01', to: '2027-01-01' });
  assert.equal(monthBounds('2026-13'), null);
});

// ── Cleaning what comes back from the database ───────────────────────────────

test('a document with no month at all is refused', () => {
  assert.equal(normalizeMonth({}), null);
  assert.equal(normalizeMonth(null), null);
  assert.equal(normalizeMonth({ month: 'junk' }), null);
});

test('the id can come from the field, from the document id, or be handed in', () => {
  assert.equal(normalizeMonth({ month: '2026-09' }).id, '2026-09');
  assert.equal(normalizeMonth({ id: '2026-08' }).id, '2026-08');
  assert.equal(normalizeMonth({}, '2026-07').id, '2026-07');
});

test('a corrupt value inside a map is dropped, not carried into the arithmetic', () => {
  const m = normalizeMonth({
    month: '2026-09',
    opening: { [FLOUR]: 'HELLO', [BUTTER]: '2,5' },
    closing: 'not a map',
  });
  assert.deepEqual(m.opening, { [BUTTER]: 2.5 });
  assert.deepEqual(m.closing, {});
});

test('every map exists after normalising, so nothing downstream has to check', () => {
  const m = normalizeMonth({ month: '2026-09' });
  [...COUNT_MAPS, ...FROZEN_MAPS].forEach(key => {
    assert.deepEqual(m[key], {}, `${key} should be an empty map`);
  });
});

test('a frozen name is kept as text and a junk one is dropped', () => {
  const m = normalizeMonth({ month: '2026-09', names: { [FLOUR]: '  Farina 00 25kg ', [BUTTER]: 7 } });
  assert.deepEqual(m.names, { [FLOUR]: 'Farina 00 25kg' });
});

test('a month is open until something is written into closedAt', () => {
  assert.equal(isClosed(normalizeMonth({ month: '2026-09' })), false);
  assert.equal(isClosed(normalizeMonth({ month: '2026-09', closedAt: '2026-10-01T09:00:00.000Z' })), true);
  assert.equal(isClosed(null), false);
});

// ── How far through the count you are ────────────────────────────────────────

test('progress counts the boxes filled in, not the products that exist', () => {
  const m = month({ closing: { [FLOUR]: 4 } });
  assert.deepEqual(progressOf(m, [FLOUR, BUTTER]), { counted: 1, total: 2, done: false });
});

test('a count of zero counts as counted', () => {
  const m = month({ closing: { [FLOUR]: 0, [BUTTER]: 0 } });
  assert.deepEqual(progressOf(m, [FLOUR, BUTTER]), { counted: 2, total: 2, done: true });
});

test('no products at all is not a finished count', () => {
  assert.deepEqual(progressOf(month(), []), { counted: 0, total: 0, done: false });
});

// ── Opening the next month ───────────────────────────────────────────────────

test("what is left at the end of September is what you have at the start of October", () => {
  const september = month({ closing: { [FLOUR]: 4, [BUTTER]: 1.5 } });
  const october = carryOver(september, '2026-10', 'NOW');
  assert.deepEqual(october.opening, { [FLOUR]: 4, [BUTTER]: 1.5 });
  assert.equal(october.month, '2026-10');
  assert.equal(october.closedAt, '');
  assert.equal(october.createdAt, 'NOW');
});

test('last month\'s purchases and counts do NOT come with it', () => {
  const october = carryOver(month(), '2026-10');
  assert.deepEqual(october.purchased, {});
  assert.deepEqual(october.closing, {});
});

test('the weight of a sack is typed once and travels from month to month', () => {
  const september = month({ packKg: { [FLOUR]: 25 } });
  assert.deepEqual(carryOver(september, '2026-10').packKg, { [FLOUR]: 25 });
});

test('a product nobody counted inherits no opening — "not said" stays not said', () => {
  const september = month({ closing: { [FLOUR]: 4 } });
  const october = carryOver(september, '2026-10');
  assert.equal(october.opening[BUTTER], undefined);
  assert.equal(consumption(october, BUTTER).hasOpening, false);
});

test('the very first month starts empty rather than refusing to exist', () => {
  const first = carryOver(null, '2026-09');
  assert.deepEqual(first.opening, {});
  assert.equal(first.month, '2026-09');
});

test('a month nobody could name is not created', () => {
  assert.equal(carryOver(month(), 'later'), null);
});

// ── What is written to Firestore ─────────────────────────────────────────────

test('the payload carries exactly the keys the rules allow, and no id', () => {
  const doc = toDocument(month());
  assert.deepEqual(Object.keys(doc).sort(), [
    'closedAt', 'closing', 'createdAt', 'month', 'names',
    'opening', 'packKg', 'pricePerKg', 'purchased', 'updatedAt',
  ]);
  assert.equal('id' in doc, false);
  assert.equal('bakery' in doc, false, 'the data layer stamps bakery, not the model');
});

test('there is nothing to write for a month that does not exist', () => {
  assert.equal(toDocument(null), null);
  assert.equal(toDocument({ month: 'junk' }), null);
});
