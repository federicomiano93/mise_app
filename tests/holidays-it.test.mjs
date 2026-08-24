// The twelve Italian national holidays, and the one of them that has to be
// calculated.
//
// ⚠️ THIS IS THE ONLY PIECE OF ARITHMETIC IN THE FIX, so it carries the weight of
// it. Ten of the twelve are fixed dates and cannot be wrong; Easter and Easter
// Monday move every year, and a wrong Easter would tell an Italian bakery the wrong
// week to stock up in — quietly, and only in the years nobody checked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  easterSunday, easterMonday, italianHolidays, ITALIAN_HOLIDAY_COUNT,
} from '../js/orders/holidays-it.js';

// ── Easter, against dates that were not produced by this code ────────────────

// ⚠️⚠️ THE POINT OF A TABLE THIS LONG IS THAT IT IS INDEPENDENT. A test that
// computed the expected answer would only prove the algorithm agrees with itself.
// These are the published Gregorian dates; twenty years is enough to cross both of
// the two centuries' worth of correction terms the algorithm carries.
const KNOWN_EASTER = Object.freeze({
  2020: '2020-04-12',
  2021: '2021-04-04',
  2022: '2022-04-17',
  2023: '2023-04-09',
  2024: '2024-03-31',
  2025: '2025-04-20',
  2026: '2026-04-05',
  2027: '2027-03-28',
  2028: '2028-04-16',
  2029: '2029-04-01',
  2030: '2030-04-21',
  2031: '2031-04-13',
  2032: '2032-03-28',
  2035: '2035-03-25',
  2038: '2038-04-25',
});

test('Easter Sunday matches the published date, every year in the table', () => {
  for (const [year, iso] of Object.entries(KNOWN_EASTER)) {
    assert.equal(easterSunday(Number(year)), iso, `Easter ${year}`);
  }
});

// ⚠️ THE TWO ENDS OF THE RANGE EASTER CAN REACH. It is never earlier than 22 March
// nor later than 25 April, and both extremes are rare — 1818 and 2038 — which is
// exactly why an off-by-one in the algorithm survives a decade of ordinary years.
test('⚠️ the earliest and the latest Easter there can be', () => {
  assert.equal(easterSunday(1818), '1818-03-22', 'the earliest date Easter can fall on');
  assert.equal(easterSunday(2038), '2038-04-25', 'the latest date Easter can fall on');
});

// ⚠️⚠️ THE TRAP THIS TEST EXISTS FOR: 32 MARCH IS NOT A DATE. Easter fell on 31
// March in 2024, so "Easter Monday = Easter + 1" written as day + 1 on the number
// produces 2024-03-32 — a string that looks like a date, sorts like a date, and
// matches nothing for ever. It is built through Date precisely so that it rolls.
test('⚠️⚠️ Easter Monday rolls into the next month when Easter is the 31st', () => {
  assert.equal(easterSunday(2024), '2024-03-31');
  assert.equal(easterMonday(2024), '2024-04-01');
});

test('Easter Monday is the day after Easter, at both ends of the range', () => {
  assert.equal(easterMonday(2038), '2038-04-26');
  assert.equal(easterMonday(2026), '2026-04-06');
  assert.equal(easterMonday(1818), '1818-03-23');
});

// ── The twelve ───────────────────────────────────────────────────────────────

test('there are twelve, and they are the twelve national ones', () => {
  const holidays = italianHolidays(2026);
  assert.equal(holidays.length, ITALIAN_HOLIDAY_COUNT);
  assert.equal(holidays.length, 12);
  assert.deepEqual(holidays, [
    '2026-01-01', // Capodanno
    '2026-01-06', // Epifania
    '2026-04-05', // Pasqua
    '2026-04-06', // Lunedì dell'Angelo
    '2026-04-25', // Liberazione
    '2026-05-01', // Festa dei Lavoratori
    '2026-06-02', // Repubblica
    '2026-08-15', // Ferragosto
    '2026-11-01', // Ognissanti
    '2026-12-08', // Immacolata
    '2026-12-25', // Natale
    '2026-12-26', // Santo Stefano
  ]);
});

// ⚠️ Easter is appended after the ten fixed dates, so without the sort the list
// would come back with April in the middle of December. Everything that reads a
// calendar in this app looks for "the next one".
test('⚠️ the list comes back in date order, Easter included', () => {
  for (const year of [2024, 2026, 2027, 2035, 2038]) {
    const holidays = italianHolidays(year);
    assert.deepEqual(holidays, [...holidays].sort(), `${year} is out of order`);
  }
});

test('the movable pair is in the list, and it is the right pair', () => {
  for (const year of [2024, 2025, 2026, 2027]) {
    const holidays = italianHolidays(year);
    assert.ok(holidays.includes(easterSunday(year)), `Easter ${year} missing`);
    assert.ok(holidays.includes(easterMonday(year)), `Easter Monday ${year} missing`);
  }
});

// ⚠️ Ferragosto is the whole point of this file: the day everything in Italy is
// shut, and the day the app said nothing about while announcing Britain's.
test('⚠️ Ferragosto is there, every year', () => {
  for (const year of [2025, 2026, 2027, 2030]) {
    assert.ok(italianHolidays(year).includes(`${year}-08-15`));
  }
});

// ⚠️⚠️ THE ONE THAT IS DELIBERATELY ABSENT. Every comune has a patron saint's day
// and it IS a public holiday there — but the app knows a venue's country, not its
// town, so a list that included one would be wrong for almost everybody reading it.
// Pinned so that "we forgot Milan" is never the conclusion somebody draws.
test('⚠️⚠️ the local patron saint days are NOT in the national list', () => {
  const holidays = italianHolidays(2026);
  assert.ok(!holidays.includes('2026-12-07'), "Sant'Ambrogio is Milan's, not Italy's");
  assert.ok(!holidays.includes('2026-06-24'), "San Giovanni is Turin's, not Italy's");
  assert.ok(!holidays.includes('2026-06-29'), "San Pietro is Rome's, not Italy's");
});

// ── Junk in, silence out ─────────────────────────────────────────────────────

test('an impossible year answers an empty calendar and never throws', () => {
  for (const bad of [undefined, null, NaN, 'not a year', 0, 1500, 9999, Infinity]) {
    assert.deepEqual(italianHolidays(bad), [], `${String(bad)} should give nothing`);
    assert.equal(easterSunday(bad), null);
    assert.equal(easterMonday(bad), null);
  }
});

// ⚠️ Asked up to twenty-one times a paint (a 7-day look-ahead plus a 14-day
// conflict window), so the answer is kept. It must still be the same answer.
test('⚠️ asking twice gives the same list', () => {
  assert.deepEqual(italianHolidays(2026), italianHolidays(2026));
  assert.equal(italianHolidays(2026).length, 12, 'and the cache did not grow it');
});

// ⚠️ Frozen, because it is handed straight out of the cache: a caller that sorted
// or spliced it in place would corrupt every later read on that page.
test('⚠️ the cached list cannot be edited by whoever receives it', () => {
  const holidays = italianHolidays(2026);
  assert.throws(() => holidays.push('2026-07-04'), TypeError);
  assert.equal(italianHolidays(2026).length, 12);
});
