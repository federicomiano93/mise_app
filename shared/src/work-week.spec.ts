// Where the working week starts, and what "this week" means (P15), run against BOTH implementations: the
// TypeScript port in shared/ and js/orders/work-week.js, which the live app uses today. Ported from
// tests/work-week.test.mjs; the module is a FULL port, so parity.spec.ts also compares its exports.
//
// PORTED: 11 of 11 tests of tests/work-week.test.mjs.
//
// ⚠️ THE TEST THAT MATTERS MOST IS THE BOUNDARY DAY ITSELF. Every off-by-one in a week
// calculation lives on the first day: getting it wrong moves an entire week's orders
// into the wrong bucket, silently, and only on one day out of seven — which is exactly
// the kind of defect that ships and is found six weeks later.

import { describe, expect, test } from 'vitest';
import * as ported from './work-week';
import * as legacyJs from '../../js/orders/work-week.js';

const legacy = legacyJs as unknown as typeof ported;

// 2026-08-14 is a Friday. 2026-08-09 is the Sunday before it.
const FRI = '2026-08-14';
const SUN = '2026-08-09';
const SAT = '2026-08-15';

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const {
    WEEKDAYS, DEFAULT_WEEK_START, weekStartOf, isValidWeekStart, weekStart, inCurrentWeek, beforeCurrentWeek,
  } = m;

  // ── ⚠️ THE BOUNDARY DAY ──────────────────────────────────────────────────────

  // ⚠️ THE STARTING DAY BELONGS TO THE WEEK IT OPENS, not the one it closes. Get this
  // backwards and every Sunday the whole of the coming week reads as "last week".
  test('⚠️ the starting day belongs to the week it OPENS', () => {
    expect(weekStart(SUN, 'Sunday'), 'Sunday opens its own week').toBe(SUN);
    expect(inCurrentWeek(SUN, SUN, 'Sunday')).toBe(true);
    expect(beforeCurrentWeek(SUN, SUN, 'Sunday')).toBe(false);
  });

  test('the Sunday→Saturday week, from any day inside it', () => {
    expect(weekStart(FRI, 'Sunday')).toBe(SUN);
    expect(weekStart(SAT, 'Sunday'), 'Saturday is the LAST day, not a new week').toBe(SUN);
    expect(weekStart('2026-08-16', 'Sunday'), 'the next Sunday opens the next one').toBe('2026-08-16');
  });

  // ⚠️ The whole point of the setting: the same day lands in a different week.
  test('⚠️ a Monday start really moves the boundary', () => {
    expect(weekStart(FRI, 'Monday')).toBe('2026-08-10');
    // Sunday the 9th is the END of the Monday-start week, but the START of a Sunday one.
    expect(inCurrentWeek(SUN, FRI, 'Monday'), 'Sunday 9th is last week when weeks start Monday').toBe(false);
    expect(inCurrentWeek(SUN, FRI, 'Sunday'), 'and this week when they start Sunday').toBe(true);
  });

  test('the last day of the week is IN it, the day before the first is not', () => {
    expect(inCurrentWeek(SAT, FRI, 'Sunday'), 'Saturday closes the week').toBe(true);
    expect(inCurrentWeek('2026-08-08', FRI, 'Sunday'), 'the Saturday before does not').toBe(false);
    expect(beforeCurrentWeek('2026-08-08', FRI, 'Sunday')).toBe(true);
  });

  // ── ⚠️ WHAT MUST NOT HAPPEN ──────────────────────────────────────────────────

  // ⚠️ AN UNREADABLE SETTING LEAVES A WORKING SCREEN. Falling back to "no week at all"
  // would empty the list and look exactly like the feature working.
  test('⚠️ anything unrecognised falls back to the default, never to no week', () => {
    [undefined, null, {}, { weekStartsOn: '' }, { weekStartsOn: 'Funday' },
      { weekStartsOn: 42 }, { weekStartsOn: ['Monday'] }].forEach(doc => {
      expect(weekStartOf(doc), JSON.stringify(doc)).toBe(DEFAULT_WEEK_START);
    });
    expect(DEFAULT_WEEK_START, 'the UK week Federico named').toBe('Sunday');
  });

  test('a real setting is honoured, whatever case it was stored in', () => {
    expect(weekStartOf({ weekStartsOn: 'Monday' })).toBe('Monday');
    expect(weekStartOf({ weekStartsOn: 'monday' })).toBe('Monday');
    expect(weekStartOf({ weekStartsOn: '  Monday  ' })).toBe('Monday');
  });

  test('only a real weekday is valid, and the list is the one day.js uses', () => {
    expect(isValidWeekStart('Sunday')).toBe(true);
    expect(isValidWeekStart('Funday')).toBe(false);
    expect(isValidWeekStart('')).toBe(false);
    expect(isValidWeekStart(null)).toBe(false);
    expect([...WEEKDAYS]).toStrictEqual(
      ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
  });

  test('junk in, no throw out', () => {
    expect(weekStart('', 'Sunday')).toBe('');
    expect(weekStart('not-a-date', 'Sunday')).toBe('');
    expect(inCurrentWeek('2026-08-14', '', 'Sunday')).toBe(false);
    expect(inCurrentWeek('', FRI, 'Sunday')).toBe(false);
    expect(beforeCurrentWeek('', FRI, 'Sunday')).toBe(false);
  });

  // ⚠️ An unknown start day must not silently shift the boundary by an arbitrary amount:
  // indexOf returns -1, and -1 as a day index would move every week by a day.
  test('⚠️ an unknown start day does not shift the week by minus one', () => {
    expect(weekStart(FRI, 'Funday')).toBe(weekStart(FRI, 'Sunday'));
  });

  // ── The window is a WINDOW, and the past is what has to be answered for ──────

  test('an order from three weeks ago is not in this week, and IS before it', () => {
    const old = '2026-07-20';
    expect(inCurrentWeek(old, FRI, 'Sunday')).toBe(false);
    expect(beforeCurrentWeek(old, FRI, 'Sunday'),
      'which is what puts it in front of somebody instead of dropping it').toBe(true);
  });

  // ⚠️ A future-dated order is neither: it has not happened yet, so it is not overdue.
  test('a day in the future is not "before this week"', () => {
    expect(beforeCurrentWeek('2026-09-01', FRI, 'Sunday')).toBe(false);
    expect(inCurrentWeek('2026-09-01', FRI, 'Sunday')).toBe(false);
  });
});
