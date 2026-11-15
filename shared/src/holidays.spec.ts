// Tests for the public-holiday calendar, and the country it belongs to (P15). holidays.ts is an ADAPTED port of
// js/orders/holidays.js (see its header), so parity.spec.ts does NOT pair it. The pure tests of tests/holidays.test.mjs run against
// BOTH files wherever the call shape is the same; what only the port has (the UK list as an argument, `ukDatesFromFeed`, the list to
// 2028, `HOLIDAY_COUNTRIES`) is tested on the port alone.
//
// ⚠️⚠️ THE DEFECT THESE WERE REWRITTEN FOR. Federico, 24 Aug 2026, on Panificio Miano — a bakery in Italy: «mi sta suggerendo le
// festivita' in uk ma dovrebbe suggerirmi le festivita' in Italia». There was one calendar, Britain's, and every venue got it. The old
// version of this file asserted that calendar carefully and could not have caught it, because it never asked whose calendar it was.
//
// ⚠️ THE ORIGINAL'S UK LIST IN NODE. js/orders/holidays.js reads localStorage at import; in Node there is none, so it falls back to
// its built-in list, which STOPS AT 2026-12-28 (finding F-8). The port's built-in list runs to 2028. So a test that depends on the UK
// list after 2026 runs on the port alone, and says so.
//
// PORTED (both files): the UK-vs-Italy pair, the shared days, the UK substitution, unknown country → nothing (with the prototype
// names), every country of market.ts has a calendar, junk dates, `nextHoliday` (first on or after, the day itself, late December
// looks into the new year), `isHolidayWithinNextDays` (found, quiet, the window starts tomorrow).
// LEFT OUT (they read source text, the network, the dictionary or the precache list, which Mise 2 does not have in this form; they
// still run on the current app's side through tests/holidays.test.mjs):
//   - «the venue country is read inside a function», «the Orders screen hands the country to the alert renderer», «the calendar
//     refresh waits for a venue to be open», «the country survives closing and reopening a notice» — regexes over
//     js/orders/orders-main.js and notifications.js. (In Mise 2 the country is an argument by construction.)
//   - «the Italian calendar imports nothing at all» — reads the source of holidays-it.js; shared/ cannot read files (tsconfig
//     `types: []`) and holidays-it.ts has no import line.
//   - «both new modules are precached» — the js/ precache list.
//   - «an Italian venue never goes to gov.uk» and «a venue with no country fetches nothing» — `refreshHolidays`, which fetches. The
//     port has no fetch: app/src/orders/ukHolidays.ts owns it and tests those rules there.
//   - «no phrase about a holiday names a country, in either language» — the dictionary, which in Mise 2 belongs to the app.

import { describe, expect, test } from 'vitest';
import * as ported from './holidays';
import { COUNTRIES } from './market';
import * as legacyJs from '../../js/orders/holidays.js';

// The original has the same pure functions with fewer parameters; the shared tests only use the two it has.
const legacy = legacyJs as unknown as Pick<typeof ported, 'isHoliday' | 'nextHoliday' | 'isHolidayWithinNextDays'>;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const { isHoliday, nextHoliday, isHolidayWithinNextDays } = m;

  // ── The two calendars are different, and that is the whole fix ─────────────

  // ⚠️⚠️ THE PAIR OF DATES THAT IS THE BUG REPORT ITSELF. 31 August 2026 is Britain's late summer bank holiday and means nothing in
  // Italy; 15 August is Ferragosto, the day everything in Italy shuts, and means nothing in Britain. Asserted in BOTH directions on
  // purpose: a version that simply swapped one list for the other would pass half of this and be the same defect facing the other way.
  test('⚠️⚠️ a UK bank holiday is not an Italian one, and Ferragosto is not a UK one', () => {
    expect(isHoliday('2026-08-31', 'GB'), 'UK late summer bank holiday').toBe(true);
    expect(isHoliday('2026-08-31', 'IT'), 'means nothing in Italy').toBe(false);

    expect(isHoliday('2026-08-15', 'IT'), 'Ferragosto').toBe(true);
    expect(isHoliday('2026-08-15', 'GB'), 'means nothing in the UK').toBe(false);
  });

  test('the days the two countries share are holidays in both', () => {
    expect(isHoliday('2026-12-25', 'GB')).toBe(true);
    expect(isHoliday('2026-12-25', 'IT')).toBe(true);
    expect(isHoliday('2026-01-01', 'GB')).toBe(true);
    expect(isHoliday('2026-01-01', 'IT')).toBe(true);
  });

  // ⚠️ Boxing Day is a holiday in both, but the UK moved it to Monday 28 December in 2026 because the 26th is a Saturday, and Italy
  // does not substitute at all. It is the clearest example of why Britain's calendar has to be downloaded and Italy's can be worked out.
  test('⚠️ the UK substitutes a weekend holiday and Italy does not', () => {
    expect(isHoliday('2026-12-26', 'IT'), 'Santo Stefano, Saturday or not').toBe(true);
    expect(isHoliday('2026-12-28', 'GB'), 'substituted to the Monday').toBe(true);
    expect(isHoliday('2026-12-28', 'IT'), 'Italy substitutes nothing').toBe(false);
  });

  // ── No country means no calendar, never Britain's ──────────────────────────

  // ⚠️⚠️ THE SAFE DIRECTION, AND IT IS THE SAME ONE countryOf() TAKES IN market. Falling back to 'GB' is tempting — it is what every
  // venue used to get — and it is precisely the behaviour being removed: announcing one country's holidays to another is telling
  // somebody the wrong day their suppliers are shut.
  test('⚠️⚠️ an unknown country gets no holidays at all, never the UK list', () => {
    // ⚠️ 'constructor' AND 'toString' ARE IN THIS LIST ON PURPOSE. A plain object answers those from its prototype, so a lookup
    // written `CALENDAR[country]` hands back a function and THROWS rather than answering "no calendar".
    for (const country of [null, undefined, '', 'FR', 'gb', 'uk', 0, {},
      'constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(isHoliday('2026-12-25', country), `${JSON.stringify(country)} must not inherit a calendar`).toBe(false);
      expect(nextHoliday(new Date(2026, 5, 1), country)).toBeNull();
      expect(isHolidayWithinNextDays(new Date(2026, 11, 21), 7, country)).toBe(false);
    }
  });

  // ⚠️⚠️ A RULE, NOT A LIST. market.ts is the one place a country may be added, and this asserts that adding one there fails the
  // build until somebody has decided what its holidays are — rather than letting it quietly inherit an empty calendar and look like
  // a venue that simply has no holidays.
  test('⚠️⚠️ every country the app admits has a calendar of its own', () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(2);
    for (const country of COUNTRIES) {
      expect(nextHoliday(new Date(2026, 0, 1), country),
        `${country} is in market COUNTRIES but has no calendar in holidays`).toBeTruthy();
    }
  });

  // ── Junk in, false out ─────────────────────────────────────────────────────

  test('a date that is not a date is not a holiday', () => {
    for (const country of ['GB', 'IT']) {
      expect(isHoliday('not-a-date', country)).toBe(false);
      expect(isHoliday('', country)).toBe(false);
      expect(isHoliday(undefined, country)).toBe(false);
      expect(isHoliday(null, country)).toBe(false);
      expect(isHoliday('2026-13-45', country)).toBe(false);
      expect(isHoliday('26-12-25', country)).toBe(false);
    }
  });

  // ── nextHoliday ────────────────────────────────────────────────────────────

  test('nextHoliday returns the first holiday on or after the given date', () => {
    // 1 June 2026 → the next UK bank holiday is 31 August.
    expect(nextHoliday(new Date(2026, 5, 1), 'GB')).toBe('2026-08-31');
    // 26 December 2026 → the substitute day, 28 December.
    expect(nextHoliday(new Date(2026, 11, 26), 'GB')).toBe('2026-12-28');
    // In Italy the same two questions have different answers — and the first of them is not even close: 2 June is the Festa della
    // Repubblica, so an Italian venue asking on 1 June has a holiday the very next day while a UK one has three clear months.
    expect(nextHoliday(new Date(2026, 5, 1), 'IT')).toBe('2026-06-02');
    expect(nextHoliday(new Date(2026, 11, 26), 'IT')).toBe('2026-12-26');
  });

  test('the day itself counts — a holiday today is the next holiday', () => {
    expect(nextHoliday(new Date(2026, 11, 25), 'GB')).toBe('2026-12-25');
    expect(nextHoliday(new Date(2026, 7, 15), 'IT')).toBe('2026-08-15');
  });

  // ⚠️⚠️ THE CASE A ONE-YEAR LOOKUP GETS WRONG, AND IT IS THE WORST WEEK OF THE YEAR TO GET IT WRONG IN. Italy's calendar is worked
  // out a year at a time, so asking only for the current year answers null every 27 December — on the screen whose job is to warn
  // about the days the suppliers are shut.
  test('⚠️⚠️ late December still finds the new year', () => {
    expect(nextHoliday(new Date(2026, 11, 27), 'IT')).toBe('2027-01-01');
    expect(nextHoliday(new Date(2026, 11, 29), 'IT')).toBe('2027-01-01');
  });

  // ── isHolidayWithinNextDays ────────────────────────────────────────────────

  test('a holiday inside the window is found, in either country', () => {
    // 21 December 2026: Christmas is 4 days away.
    expect(isHolidayWithinNextDays(new Date(2026, 11, 21), 7, 'GB')).toBe(true);
    expect(isHolidayWithinNextDays(new Date(2026, 11, 21), 7, 'IT')).toBe(true);
  });

  test('a quiet stretch answers false, in either country', () => {
    // Mid-June 2026 is clear in both calendars.
    expect(isHolidayWithinNextDays(new Date(2026, 5, 17), 7, 'GB')).toBe(false);
    expect(isHolidayWithinNextDays(new Date(2026, 5, 17), 7, 'IT')).toBe(false);
  });

  // ⚠️ It looks ahead FROM TOMORROW. Standing on Christmas Day itself, there is no holiday "coming" in the next day — the notice is
  // about planning ahead, and one that fires on the morning of the day it is warning about is too late to be worth reading.
  test('⚠️ the window starts tomorrow, not today', () => {
    expect(isHolidayWithinNextDays(new Date(2026, 11, 24), 1, 'GB')).toBe(true);
    expect(isHolidayWithinNextDays(new Date(2026, 11, 25), 1, 'GB')).toBe(false);
    expect(isHolidayWithinNextDays(new Date(2026, 7, 14), 1, 'IT')).toBe(true);
    expect(isHolidayWithinNextDays(new Date(2026, 7, 15), 1, 'IT')).toBe(false);
  });
});

// ── What only the port has ───────────────────────────────────────────────────

describe('the port: the UK list is an argument, not module state', () => {
  const { isHoliday, nextHoliday, isHolidayWithinNextDays, UK_FALLBACK, UK_SOURCE_URL, UK_CACHE_KEY, HOLIDAY_COUNTRIES } = ported;

  test('the constants are the current app’s: same address, same cache key', () => {
    expect(UK_SOURCE_URL).toBe('https://www.gov.uk/bank-holidays.json');
    // ⚠️ Unchanged on purpose: both apps share one origin, so a copy one downloaded is the other's offline copy.
    expect(UK_CACHE_KEY).toBe('uk-bank-holidays');
  });

  test('HOLIDAY_COUNTRIES is frozen and holds exactly the countries of market.ts', () => {
    expect(Object.isFrozen(HOLIDAY_COUNTRIES)).toBe(true);
    expect([...HOLIDAY_COUNTRIES].sort()).toStrictEqual([...COUNTRIES].sort());
    expect([...HOLIDAY_COUNTRIES]).toStrictEqual(['GB', 'IT']);
  });

  // ⚠️ FINDING F-8: the original's list stops at 2026-12-28, so a UK venue with no cached copy and no network heard nothing about
  // 2027. The exact dates are gov.uk's England & Wales list.
  test('⚠️ the built-in UK list is England & Wales, 2025 to 2028, sorted, each day once, and frozen', () => {
    expect(Object.isFrozen(UK_FALLBACK)).toBe(true);
    expect(UK_FALLBACK).toStrictEqual([
      '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-05', '2025-05-26', '2025-08-25', '2025-12-25', '2025-12-26',
      '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
      '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28',
      '2028-01-03', '2028-04-14', '2028-04-17', '2028-05-01', '2028-05-29', '2028-08-28', '2028-12-25', '2028-12-26',
    ]);
    expect(UK_FALLBACK).toStrictEqual([...new Set(UK_FALLBACK)].sort());
    expect(UK_FALLBACK.length).toBe(32);
  });

  test('2027 and 2028 are known without any download', () => {
    // A weekend holiday is substituted: 25 December 2027 is a Saturday, 1 January 2028 a Saturday.
    expect(isHoliday('2027-12-27', 'GB')).toBe(true);
    expect(isHoliday('2027-12-28', 'GB')).toBe(true);
    expect(isHoliday('2027-12-25', 'GB')).toBe(false);
    expect(isHoliday('2028-01-03', 'GB')).toBe(true);
    expect(isHoliday('2028-01-01', 'GB')).toBe(false);
    expect(isHoliday('2027-03-26', 'GB'), 'Good Friday 2027').toBe(true);
    expect(isHoliday('2028-04-17', 'GB'), 'Easter Monday 2028').toBe(true);
    expect(nextHoliday(new Date(2026, 11, 29), 'GB')).toBe('2027-01-01');
    expect(nextHoliday(new Date(2027, 5, 1), 'GB')).toBe('2027-08-30');
    expect(nextHoliday(new Date(2028, 11, 27), 'GB'), 'the list ends here, and says so with null').toBeNull();
  });

  test('the UK list and the Italian calendar stay two different things after 2026 too', () => {
    expect(isHoliday('2027-08-15', 'GB')).toBe(false);
    expect(isHoliday('2027-08-15', 'IT')).toBe(true);
    expect(isHoliday('2027-08-30', 'IT')).toBe(false);
  });

  // ⚠️ The module holds no list of its own to mutate: the one a caller passes is the one that is read, and the next call without
  // one reads the built-in again.
  test('an explicit UK list replaces the built-in one for that call only', () => {
    const mine = ['2026-06-10'];
    expect(isHoliday('2026-06-10', 'GB', mine)).toBe(true);
    expect(isHoliday('2026-08-31', 'GB', mine), 'the built-in list is not merged in').toBe(false);
    expect(isHoliday('2026-06-10', 'GB'), 'and was not remembered').toBe(false);
    expect(isHoliday('2026-08-31', 'GB')).toBe(true);

    expect(nextHoliday(new Date(2026, 5, 1), 'GB', mine)).toBe('2026-06-10');
    expect(isHolidayWithinNextDays(new Date(2026, 5, 5), 7, 'GB', mine)).toBe(true);
    expect(isHolidayWithinNextDays(new Date(2026, 5, 5), 7, 'GB')).toBe(false);
  });

  test('an empty UK list means no UK holidays, and never the built-in ones', () => {
    expect(isHoliday('2026-12-25', 'GB', [])).toBe(false);
    expect(nextHoliday(new Date(2026, 0, 1), 'GB', [])).toBeNull();
  });

  test('the UK list does not touch the Italian calendar', () => {
    expect(isHoliday('2026-08-15', 'IT', [])).toBe(true);
    expect(isHoliday('2026-06-10', 'IT', ['2026-06-10'])).toBe(false);
  });

  test('the defaults: today, seven days, no country', () => {
    expect(isHolidayWithinNextDays()).toBe(false);
    expect(nextHoliday()).toBeNull();
    expect(nextHoliday(undefined, 'IT')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('the port: ukDatesFromFeed', () => {
  const { ukDatesFromFeed } = ported;

  test('reads the England & Wales dates from gov.uk’s feed', () => {
    const feed = {
      'england-and-wales': {
        division: 'england-and-wales',
        events: [
          { title: 'New Year’s Day', date: '2027-01-01', notes: '', bunting: true },
          { title: 'Good Friday', date: '2027-03-26', notes: '', bunting: false },
        ],
      },
      scotland: { events: [{ title: 'St Andrew’s Day', date: '2027-11-30' }] },
    };
    expect(ukDatesFromFeed(feed)).toStrictEqual(['2027-01-01', '2027-03-26']);
  });

  test('a missing region answers an empty list', () => {
    expect(ukDatesFromFeed({ scotland: { events: [{ date: '2027-11-30' }] } })).toStrictEqual([]);
    expect(ukDatesFromFeed({ 'england-and-wales': {} })).toStrictEqual([]);
    expect(ukDatesFromFeed({ 'england-and-wales': { events: 'soon' } })).toStrictEqual([]);
  });

  // ⚠️ Only a real day is kept: a junk string in the cache would sit there for ever and match nothing.
  test('events whose date is not a day are skipped, the rest kept', () => {
    const feed = {
      'england-and-wales': {
        events: [
          { date: '2027-01-01' }, { date: 20270326 }, { date: null }, {}, null, 'x', { date: '' },
          { date: 'next Friday' }, { date: '2027-3-26' }, { date: '2027-05-03T00:00' }, { date: '2027-05-31' },
        ],
      },
    };
    expect(ukDatesFromFeed(feed)).toStrictEqual(['2027-01-01', '2027-05-31']);
  });

  test('junk anywhere answers an empty list and never throws', () => {
    for (const junk of [undefined, null, 0, 1, '', 'html', true, [], [1, 2], {}, { 'england-and-wales': null }, { 'england-and-wales': [] }]) {
      expect(ukDatesFromFeed(junk), JSON.stringify(junk)).toStrictEqual([]);
    }
  });

  test('the answer is a new list each time', () => {
    const feed = { 'england-and-wales': { events: [{ date: '2027-01-01' }] } };
    const first = ukDatesFromFeed(feed);
    first.push('2099-01-01');
    expect(ukDatesFromFeed(feed)).toStrictEqual(['2027-01-01']);
  });

  test('what it reads can be handed straight back as the UK list', () => {
    const dates = ukDatesFromFeed({ 'england-and-wales': { events: [{ date: '2030-01-01' }] } });
    expect(ported.isHoliday('2030-01-01', 'GB', dates)).toBe(true);
  });
});
