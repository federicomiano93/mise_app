// Unit tests for the Orders day helpers (P15 — the owner cannot read code, so
// these tests are the safety net). An order is filed under a DAY, so a bug here
// files it under the wrong date — the exact thing this feature exists to prevent.
//
// The timezone trap these lock down: `new Date('2026-07-13')` is UTC midnight,
// which is 12 July locally west of Greenwich. Every helper must go through local
// getters, so the assertions below hold whatever timezone the machine/CI runs in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toISODate, parseISODate, todayISO, addDays, isBefore, weekdayOf, dayLabel, dayPhrase,
  daySpoken, dayWhen, spellDay, localDayOf,
} from '../js/orders/day.js';

test('toISODate reads a Date with local getters', () => {
  assert.equal(toISODate(new Date(2026, 6, 13)), '2026-07-13');
  assert.equal(toISODate(new Date(2026, 0, 5)), '2026-01-05'); // zero-padded
});

test('parseISODate lands on LOCAL midnight, not UTC midnight', () => {
  const d = parseISODate('2026-07-13');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 6);
  assert.equal(d.getDate(), 13); // would be the 12th if parsed as UTC
  assert.equal(d.getHours(), 0);
});

test('an ISO day survives a round trip through parse and format', () => {
  assert.equal(toISODate(parseISODate('2026-07-13')), '2026-07-13');
});

test('todayISO is today', () => {
  assert.equal(todayISO(new Date(2026, 6, 13, 23, 55)), '2026-07-13');
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(toISODate(addDays(new Date(2026, 6, 31), 1)), '2026-08-01');
  assert.equal(toISODate(addDays(new Date(2026, 0, 1), -1)), '2025-12-31');
});

test('addDays is DST-safe (British Summer Time starts 29 March 2026)', () => {
  // The clocks go forward overnight, so that day is 23 hours long. Adding
  // 86 400 000 ms would land on the same calendar day; setDate must not.
  assert.equal(toISODate(addDays(new Date(2026, 2, 29), 1)), '2026-03-30');
  assert.equal(toISODate(addDays(new Date(2026, 9, 25), 1)), '2026-10-26'); // clocks back
});

test('isBefore compares ISO days, and is false for equal or missing days', () => {
  assert.equal(isBefore('2026-07-12', '2026-07-13'), true);
  assert.equal(isBefore('2026-07-13', '2026-07-13'), false);
  assert.equal(isBefore('2026-07-14', '2026-07-13'), false);
  assert.equal(isBefore('2025-12-31', '2026-01-01'), true);
  assert.equal(isBefore('', '2026-07-13'), false);
  assert.equal(isBefore(undefined, '2026-07-13'), false);
});

test('weekdayOf names the day the supplier orderDays use', () => {
  assert.equal(weekdayOf('2026-07-13'), 'Monday');
  assert.equal(weekdayOf('2026-07-19'), 'Sunday');
});

test('dayLabel says Today and Yesterday', () => {
  const now = new Date(2026, 6, 13, 9, 30);
  assert.equal(dayLabel('2026-07-13', now), 'Today');
  assert.equal(dayLabel('2026-07-12', now), 'Yesterday');
});

test('dayLabel spells out any other day, identically on every device', () => {
  const now = new Date(2026, 6, 13);
  assert.equal(dayLabel('2026-07-06', now), 'Mon 6 Jul 2026');
  assert.equal(dayLabel('2025-12-31', now), 'Wed 31 Dec 2025');
});

test('dayLabel handles a missing or unreadable day without throwing', () => {
  assert.equal(dayLabel('', new Date(2026, 6, 13)), '');
  assert.equal(dayLabel('not-a-date', new Date(2026, 6, 13)), 'not-a-date');
});

test('spellDay always spells the date out, never "Today"', () => {
  // The legacy weekly card names its week, where "Today" would be meaningless.
  assert.equal(spellDay('2026-07-13'), 'Mon 13 Jul 2026');
  assert.equal(spellDay(''), '');
});

test('dayPhrase reads inside a sentence, and every confirm uses it', () => {
  const now = new Date(2026, 6, 13);
  // "Record Alba's order for yesterday?" — not "...order yesterday?".
  assert.equal(dayPhrase('2026-07-13', now), 'for today');
  assert.equal(dayPhrase('2026-07-12', now), 'for yesterday');
  assert.equal(dayPhrase('2026-07-06', now), 'for Mon 6 Jul 2026');
  assert.equal(dayPhrase('', now), '');
});

test('a spoken day keeps a real date\'s capitals — "sat 11 jul 2026" reads like a typo', () => {
  const now = new Date(2026, 6, 13);
  assert.equal(daySpoken('2026-07-13', now), 'today');
  assert.equal(daySpoken('2026-07-12', now), 'yesterday');
  assert.equal(daySpoken('2026-07-11', now), 'Sat 11 Jul 2026');
  assert.equal(daySpoken('', now), '');
});

test('dayWhen adds the preposition a date needs, and a relative day does not', () => {
  const now = new Date(2026, 6, 13);
  // "3 items typed yesterday" — but "3 items typed ON Sat 11 Jul 2026".
  assert.equal(dayWhen('2026-07-12', now), 'yesterday');
  assert.equal(dayWhen('2026-07-13', now), 'today');
  assert.equal(dayWhen('2026-07-11', now), 'on Sat 11 Jul 2026');
  assert.equal(dayWhen('', now), '');
});

test('localDayOf reads the local day of a draft timestamp', () => {
  // Midday UTC is the same calendar day in every timezone the bakery could be in.
  assert.equal(localDayOf('2026-07-12T12:00:00.000Z'), '2026-07-12');
  assert.equal(localDayOf(''), '');
  assert.equal(localDayOf(null), '');
  assert.equal(localDayOf('rubbish'), '');
});
