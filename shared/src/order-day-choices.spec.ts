// Tests for the seven-day choice of a supplier with NO order days (P15). New in Mise 2 (Federico's decision F2),
// so there is no js/ original to run them against and parity.spec.ts does not pair it.
//
// Dates: 23 Oct 2026 is a Friday.

import { describe, expect, test } from 'vitest';
import { hasOrderDays, weekChoices } from './order-day-choices';

const TODAY = '2026-10-23';
const WEEK = ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'];

describe('weekChoices', () => {
  test('no stamp: seven options, today to today + 6, today selected', () => {
    const { options, selected, selectedDay } = weekChoices({ today: TODAY });
    expect(options.map(o => o.value)).toStrictEqual(WEEK);
    expect(options.map(o => o.kind)).toStrictEqual(['today', 'tomorrow', 'weekday', 'weekday', 'weekday', 'weekday', 'weekday']);
    expect(selected).toBe(TODAY);
    expect(selectedDay).toBe(TODAY);
  });

  test('every option’s day is its value', () => {
    for (const o of weekChoices({ today: TODAY, stamp: '2026-11-10', hasItems: true }).options) expect(o.day).toBe(o.value);
  });

  test('a stamp inside the week is that day’s option, selected, and adds none', () => {
    const { options, selected } = weekChoices({ today: TODAY, stamp: '2026-10-26', hasItems: true });
    expect(options.map(o => o.value)).toStrictEqual(WEEK);
    expect(selected).toBe('2026-10-26');
  });

  test('a stamp of today is today, a stamp on the last day of the week is not «later»', () => {
    expect(weekChoices({ today: TODAY, stamp: TODAY }).selected).toBe(TODAY);
    const last = weekChoices({ today: TODAY, stamp: '2026-10-29' });
    expect(last.options.length).toBe(7);
    expect(last.selected).toBe('2026-10-29');
  });

  test('a stamp ten days out adds a «later» option at the end, and is selected', () => {
    const { options, selected, selectedDay } = weekChoices({ today: TODAY, stamp: '2026-11-02', hasItems: false });
    expect(options.map(o => o.value)).toStrictEqual([...WEEK, '2026-11-02']);
    expect(options[7]!.kind).toBe('later');
    expect(selected).toBe('2026-11-02');
    expect(selectedDay).toBe('2026-11-02');
  });

  test('a past stamp with items comes first, as «past», and is selected', () => {
    const { options, selected } = weekChoices({ today: TODAY, stamp: '2026-10-20', hasItems: 3 });
    expect(options.map(o => o.value)).toStrictEqual(['2026-10-20', ...WEEK]);
    expect(options[0]!.kind).toBe('past');
    expect(selected).toBe('2026-10-20');
  });

  test('a past stamp with nothing typed adds no option and today is selected', () => {
    for (const hasItems of [false, 0, undefined, null]) {
      const { options, selected } = weekChoices({ today: TODAY, stamp: '2026-10-20', hasItems });
      expect(options.map(o => o.value)).toStrictEqual(WEEK);
      expect(selected).toBe(TODAY);
    }
  });

  test('a stamp that is not a valid day is treated as absent', () => {
    for (const stamp of ['', 'tomorrow', '2026-1-5', '2026-02-30', '2026-10-23T09:00', null, undefined, 20261030 as unknown as string]) {
      const { options, selected } = weekChoices({ today: TODAY, stamp, hasItems: true });
      expect(options.map(o => o.value), String(stamp)).toStrictEqual(WEEK);
      expect(selected, String(stamp)).toBe(TODAY);
    }
  });

  test('a week that crosses the clocks changing is still seven consecutive dates', () => {
    // British clocks go back on 25 Oct 2026, Italian ones too; adding 24-hour blocks would repeat or skip a day.
    const { options } = weekChoices({ today: '2026-10-22' });
    expect(options.map(o => o.value)).toStrictEqual(
      ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
    // ...and the spring change, 29 Mar 2026, across a month end.
    expect(weekChoices({ today: '2026-03-27' }).options.map(o => o.value)).toStrictEqual(
      ['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02']);
  });

  test('the year turns over inside the week', () => {
    expect(weekChoices({ today: '2026-12-29' }).options.map(o => o.value)).toStrictEqual(
      ['2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04']);
  });
});

describe('hasOrderDays', () => {
  test('false for a supplier with no order days, however it is missing', () => {
    expect(hasOrderDays(undefined)).toBe(false);
    expect(hasOrderDays(null)).toBe(false);
    expect(hasOrderDays({})).toBe(false);
    expect(hasOrderDays({ orderDays: [] })).toBe(false);
    expect(hasOrderDays({ orderDays: undefined })).toBe(false);
  });

  test('false for garbage', () => {
    expect(hasOrderDays({ orderDays: 'Monday' })).toBe(false);
    expect(hasOrderDays({ orderDays: { 0: 'Monday' } })).toBe(false);
    expect(hasOrderDays({ orderDays: ['monday', 'Lunedì', '', null, 3] })).toBe(false);
    expect(hasOrderDays('Monday')).toBe(false);
  });

  test('true when at least one of the seven English weekday words is there', () => {
    expect(hasOrderDays({ orderDays: ['Monday'] })).toBe(true);
    expect(hasOrderDays({ orderDays: ['nonsense', 'Sunday'] })).toBe(true);
    expect(hasOrderDays({ orderDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] })).toBe(true);
  });
});
