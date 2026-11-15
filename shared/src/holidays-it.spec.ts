// Tests for the twelve Italian national holidays, and the one of them that has to be calculated (P15), run against BOTH
// implementations: the TypeScript port in shared/ and js/orders/holidays-it.js, which the live app uses today. The module is a FULL
// port, so parity.spec.ts also compares its exports.
//
// PORTED: every test of tests/holidays-it.test.mjs. LEFT OUT: nothing in that file — the guard «the Italian calendar imports nothing
// at all» lives in tests/holidays.test.mjs and READS THE SOURCE of js/orders/holidays-it.js; shared/ has no Node types to read the
// port's source with (tsconfig `types: []`, and no other spec does), so «zero imports» is kept by this file importing nothing of the
// port's but its exports, and by the module itself, which has no import line.
//
// ⚠️ THIS IS THE ONLY PIECE OF ARITHMETIC IN THE CALENDAR, so it carries the weight of it. Ten of the twelve are fixed dates and
// cannot be wrong; Easter and Easter Monday move every year, and a wrong Easter would tell an Italian bakery the wrong week to
// stock up in — quietly, and only in the years nobody checked.

import { describe, expect, test } from 'vitest';
import * as ported from './holidays-it';
import * as legacyJs from '../../js/orders/holidays-it.js';

const legacy = legacyJs as unknown as typeof ported;

// ⚠️⚠️ THE POINT OF A TABLE THIS LONG IS THAT IT IS INDEPENDENT. A test that computed the expected answer would only prove the
// algorithm agrees with itself. These are the published Gregorian dates; twenty years is enough to cross both of the two
// centuries' worth of correction terms the algorithm carries.
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

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const { easterSunday, easterMonday, italianHolidays, ITALIAN_HOLIDAY_COUNT } = m;

  // ── Easter, against dates that were not produced by this code ──────────────

  test('Easter Sunday matches the published date, every year in the table', () => {
    for (const [year, iso] of Object.entries(KNOWN_EASTER)) {
      expect(easterSunday(Number(year)), `Easter ${year}`).toBe(iso);
    }
  });

  // ⚠️ THE TWO ENDS OF THE RANGE EASTER CAN REACH. It is never earlier than 22 March nor later than 25 April, and both extremes
  // are rare — 1818 and 2038 — which is exactly why an off-by-one in the algorithm survives a decade of ordinary years.
  test('⚠️ the earliest and the latest Easter there can be', () => {
    expect(easterSunday(1818), 'the earliest date Easter can fall on').toBe('1818-03-22');
    expect(easterSunday(2038), 'the latest date Easter can fall on').toBe('2038-04-25');
  });

  // ⚠️⚠️ THE TRAP: 32 MARCH IS NOT A DATE. Easter fell on 31 March in 2024, so "Easter Monday = Easter + 1" written as day + 1 on
  // the number produces 2024-03-32 — a string that looks like a date, sorts like a date, and matches nothing for ever.
  test('⚠️⚠️ Easter Monday rolls into the next month when Easter is the 31st', () => {
    expect(easterSunday(2024)).toBe('2024-03-31');
    expect(easterMonday(2024)).toBe('2024-04-01');
  });

  test('Easter Monday is the day after Easter, at both ends of the range', () => {
    expect(easterMonday(2038)).toBe('2038-04-26');
    expect(easterMonday(2026)).toBe('2026-04-06');
    expect(easterMonday(1818)).toBe('1818-03-23');
  });

  // ── The twelve ─────────────────────────────────────────────────────────────

  test('there are twelve, and they are the twelve national ones', () => {
    const holidays = italianHolidays(2026);
    expect(holidays.length).toBe(ITALIAN_HOLIDAY_COUNT);
    expect(holidays.length).toBe(12);
    expect(holidays).toStrictEqual([
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

  // ⚠️ Easter is appended after the ten fixed dates, so without the sort the list would come back with April in the middle of
  // December. Everything that reads a calendar in this app looks for "the next one".
  test('⚠️ the list comes back in date order, Easter included', () => {
    for (const year of [2024, 2026, 2027, 2035, 2038]) {
      const holidays = italianHolidays(year);
      expect(holidays, `${year} is out of order`).toStrictEqual([...holidays].sort());
    }
  });

  test('the movable pair is in the list, and it is the right pair', () => {
    for (const year of [2024, 2025, 2026, 2027]) {
      const holidays = italianHolidays(year);
      expect(holidays.includes(easterSunday(year)!), `Easter ${year} missing`).toBe(true);
      expect(holidays.includes(easterMonday(year)!), `Easter Monday ${year} missing`).toBe(true);
    }
  });

  // ⚠️ Ferragosto is the whole point of the calendar: the day everything in Italy is shut, and the day the app said nothing about
  // while announcing Britain's.
  test('⚠️ Ferragosto is there, every year', () => {
    for (const year of [2025, 2026, 2027, 2030]) {
      expect(italianHolidays(year).includes(`${year}-08-15`)).toBe(true);
    }
  });

  // ⚠️⚠️ THE ONE THAT IS DELIBERATELY ABSENT. Every comune has a patron saint's day and it IS a public holiday there — but the app
  // knows a venue's country, not its town, so a list that included one would be wrong for almost everybody reading it. Pinned so
  // that "we forgot Milan" is never the conclusion somebody draws.
  test('⚠️⚠️ the local patron saint days are NOT in the national list', () => {
    const holidays = italianHolidays(2026);
    expect(holidays.includes('2026-12-07'), "Sant'Ambrogio is Milan's, not Italy's").toBe(false);
    expect(holidays.includes('2026-06-24'), "San Giovanni is Turin's, not Italy's").toBe(false);
    expect(holidays.includes('2026-06-29'), "San Pietro is Rome's, not Italy's").toBe(false);
  });

  // ── Junk in, silence out ───────────────────────────────────────────────────

  test('an impossible year answers an empty calendar and never throws', () => {
    for (const bad of [undefined, null, NaN, 'not a year', 0, 1500, 9999, Infinity]) {
      expect(italianHolidays(bad), `${String(bad)} should give nothing`).toStrictEqual([]);
      expect(easterSunday(bad)).toBeNull();
      expect(easterMonday(bad)).toBeNull();
    }
  });

  // ⚠️ Asked up to twenty-one times a paint (a 7-day look-ahead plus a 14-day conflict window), so the answer is kept. It must
  // still be the same answer.
  test('⚠️ asking twice gives the same list', () => {
    expect(italianHolidays(2026)).toStrictEqual(italianHolidays(2026));
    expect(italianHolidays(2026).length, 'and the cache did not grow it').toBe(12);
  });

  // ⚠️ Frozen, because it is handed straight out of the cache: a caller that sorted or spliced it in place would corrupt every
  // later read on that page.
  test('⚠️ the cached list cannot be edited by whoever receives it', () => {
    const holidays = italianHolidays(2026) as string[];
    expect(() => holidays.push('2026-07-04')).toThrow(TypeError);
    expect(italianHolidays(2026).length).toBe(12);
  });

  // ⚠️⚠️ TWO OF THE TWELVE CAN BE THE SAME DAY, roughly three times a century. Easter next falls on 25 April in 2038, which is also
  // the Festa della Liberazione — so the twelve rules name eleven distinct days. Every question the app asks answers correctly
  // either way, which is exactly why a duplicate would sit there unnoticed until somebody first printed the list out.
  test('⚠️⚠️ a day named by two rules appears once, not twice', () => {
    expect(easterSunday(2038), 'Easter and Liberazione collide').toBe('2038-04-25');
    const holidays = italianHolidays(2038);
    expect(holidays, 'no date appears twice').toStrictEqual([...new Set(holidays)]);
    expect(holidays.length, 'twelve rules, eleven days').toBe(11);
    expect(ITALIAN_HOLIDAY_COUNT, 'the constant counts the RULES').toBe(12);

    // The same in 1943, the previous time it happened.
    expect(easterSunday(1943)).toBe('1943-04-25');
    expect(italianHolidays(1943).length).toBe(11);
  });

  test('an ordinary year still has all twelve as distinct days', () => {
    for (const year of [2025, 2026, 2027, 2030]) {
      expect(italianHolidays(year).length, `${year}`).toBe(ITALIAN_HOLIDAY_COUNT);
    }
  });
});
