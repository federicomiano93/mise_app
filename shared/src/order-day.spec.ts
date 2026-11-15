// Tests for the day a supplier's typed quantities are FOR (P15), run against BOTH implementations: the
// TypeScript port in shared/ and js/orders/order-day.js, which the live app uses today. Ported from
// tests/order-day.test.mjs; the module is a FULL port, so parity.spec.ts also compares its exports.
//
// PORTED: 22 of 32 tests of tests/order-day.test.mjs.
//
// NOT PORTED (10): 'a future stamp never fires the pending banner' and 'untoldChanges is quiet for a supplier
// filtered out as «for later»' (they run pendingSuppliers and untoldChanges, the reminders and the untold-changes
// banner, which are not in shared/ yet), and the eight 'wiring:' tests, which read the source text of the current
// app's screens. order-day.ts needs no dictionary: it imports only the day arithmetic of day.ts.
//
// The bug this prevents: next week's quantities typed after this week's order was placed
// used to be stamped «today», so the next morning they nagged as «order not placed» and
// on the same day as «changed after ordering». Dates below: 12 Oct 2026 is a Monday.

import { describe, expect, test } from 'vitest';
import * as ported from './order-day';
import * as portedDay from './day';
import * as legacyJs from '../../js/orders/order-day.js';
import * as legacyDayJs from '../../js/orders/day.js';
import { t } from '../../js/i18n.js';

const legacy = legacyJs as unknown as typeof ported;
const legacyDay = legacyDayJs as unknown as {
  spellShortDate(iso: string): string;
  spellLongDate(iso: string): string;
};

const MON = '2026-10-12', TUE = '2026-10-13', WED = '2026-10-14', THU = '2026-10-15';
const NEXT_MON = '2026-10-19';

const free = { id: 's1', name: 'Free' };
const monOnly = { id: 's1', name: 'Mon', orderDays: ['Monday'] };
const monThu = { id: 's1', name: 'MonThu', orderDays: ['Monday', 'Thursday'] };
const SAT = '2026-10-17', SUN = '2026-10-18';
const SATURDAY_ONLY = { id: 's1', orderDays: ['Saturday'] };

describe.each([
  ['shared/ (TypeScript)', ported, (iso: string) => portedDay.spellShortDate(iso, t), (iso: string) => portedDay.spellLongDate(iso, t)],
  ['js/ (current app)', legacy, (iso: string) => legacyDay.spellShortDate(iso), (iso: string) => legacyDay.spellLongDate(iso)],
] as const)('%s', (_name, m, spellShortDate, spellLongDate) => {
  const {
    nextOrderDay, targetDayFor, stampFor, recordDay, isFutureDay, notForLater,
    previewDay, nextOrderOffer, nextDeliveryAfter, dayChoices,
  } = m;

  test('nextOrderDay: none without order days, and strictly after today', () => {
    expect(nextOrderDay(free, WED)).toBe(null);
    expect(nextOrderDay({ id: 'x', orderDays: [] }, WED)).toBe(null);
    expect(nextOrderDay(monOnly, WED)).toBe(NEXT_MON);
    expect(nextOrderDay(monOnly, MON)).toBe(NEXT_MON);   // today does not count
    expect(nextOrderDay(monThu, TUE)).toBe(THU);
    expect(nextOrderDay(monThu, THU)).toBe(NEXT_MON);
  });

  test('nextOrderDay ignores values that are not weekday names', () => {
    expect(nextOrderDay({ id: 'x', orderDays: ['Lunedì'] }, WED)).toBe(null);
  });

  test('no order days: the target is today, always', () => {
    expect(targetDayFor({ supplier: free, today: WED })).toBe(WED);
  });

  test('today is an order day: the target is today', () => {
    expect(targetDayFor({ supplier: monOnly, today: MON })).toBe(MON);
    expect(targetDayFor({ supplier: monThu, today: THU })).toBe(THU);
  });

  test('any other day: the next order day, with no history needed (wraps over the weekend)', () => {
    expect(targetDayFor({ supplier: monOnly, today: WED })).toBe(NEXT_MON);
    expect(targetDayFor({ supplier: monThu, today: TUE })).toBe(THU);
    expect(targetDayFor({ supplier: monThu, today: SUN })).toBe('2026-10-19');
  });

  test('stampFor keeps a stamp that is today or in the future', () => {
    const base = { supplier: monOnly, today: WED };
    expect(stampFor({ ...base, current: WED })).toBe(WED);
    expect(stampFor({ ...base, current: '2026-10-26' })).toBe('2026-10-26');
    expect(stampFor({ ...base, current: THU })).toBe(THU);
  });

  test('stampFor recomputes a stale or missing stamp', () => {
    const base = { supplier: monOnly, today: WED };
    expect(stampFor({ ...base, current: MON })).toBe(NEXT_MON);
    expect(stampFor({ ...base, current: undefined })).toBe(NEXT_MON);
    expect(stampFor({ supplier: free, today: WED, current: MON })).toBe(WED);
  });

  test('nextDeliveryAfter: strictly after the day, wraps the week, empty without delivery days', () => {
    const tueFri = { id: 's1', deliveryDays: ['Tuesday', 'Friday'] };
    expect(nextDeliveryAfter(tueFri, MON)).toBe(TUE);
    expect(nextDeliveryAfter(tueFri, TUE)).toBe('2026-10-16');       // the day itself does not count
    expect(nextDeliveryAfter(tueFri, SAT)).toBe('2026-10-20');       // wraps into next week
    expect(nextDeliveryAfter(free, MON)).toBe('');
    expect(nextDeliveryAfter({ id: 'x', deliveryDays: [] }, MON)).toBe('');
    expect(nextDeliveryAfter({ id: 'x', deliveryDays: ['Lunedì'] }, MON)).toBe('');
    expect(nextDeliveryAfter(tueFri, '')).toBe('');
  });

  test('recordDay clamps a future stamp to today and leaves past and today alone', () => {
    expect(recordDay(NEXT_MON, WED)).toBe(WED);
    expect(recordDay(WED, WED)).toBe(WED);
    expect(recordDay(MON, WED)).toBe(MON);
    expect(recordDay('', WED)).toBe('');
  });

  test('isFutureDay', () => {
    expect(isFutureDay(THU, WED)).toBe(true);
    expect(isFutureDay(WED, WED)).toBe(false);
    expect(isFutureDay('', WED)).toBe(false);
    expect(isFutureDay(undefined, WED)).toBe(false);
  });

  test('notForLater drops suppliers stamped for a later day', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const out = notForLater(list, { a: WED, b: NEXT_MON, c: MON }, WED);
    expect(out.map(s => s.id)).toStrictEqual(['a', 'c']);
  });

  test('the short and long day phrases carry no year and read from the dictionary', () => {
    expect(spellShortDate(NEXT_MON)).toBe('Mon 19');
    expect(spellLongDate(NEXT_MON)).toBe('Monday 19 October');
    expect(spellShortDate('')).toBe('');
  });

  test('previewDay: the future order day in effect, or empty for today', () => {
    const base = { supplier: monOnly, today: WED };
    expect(previewDay({ ...base, current: undefined })).toBe(NEXT_MON);
    expect(previewDay({ ...base, current: MON })).toBe(NEXT_MON);       // stale stamp
    expect(previewDay({ ...base, current: THU })).toBe(THU);            // already future
    expect(previewDay({ ...base, current: WED })).toBe('');             // «Today» already chosen
    expect(previewDay({ ...base, supplier: free })).toBe('');
    expect(previewDay({ ...base, today: MON, current: undefined })).toBe('');    // an order day
  });

  test('nextOrderOffer: not on an order day, and only with a next order day', () => {
    expect(nextOrderOffer(monThu, TUE)).toBe(THU);
    expect(nextOrderOffer(monThu, THU)).toBe(null);   // today is an order day
    expect(nextOrderOffer(free, TUE)).toBe(null);
  });

  const kinds = (c: { options: { kind: string; day: string }[] }): string[] => c.options.map(o => `${o.kind}:${o.day}`);

  test('dayChoices: an order day with no stamp offers today (selected) and the next order', () => {
    const c = dayChoices({ supplier: monOnly, stamp: undefined, hasItems: false, today: MON });
    expect(kinds(c)).toStrictEqual([`today:${MON}`, `next:${NEXT_MON}`]);
    expect(c.selected).toBe('today');
    expect(c.selectedDay).toBe(MON);
  });

  test('dayChoices: a non-order day with no stamp selects the next order day', () => {
    const c = dayChoices({ supplier: monOnly, stamp: undefined, hasItems: false, today: WED });
    expect(kinds(c)).toStrictEqual([`today:${WED}`, `next:${NEXT_MON}`]);
    expect(c.selected).toBe('next');
    expect(c.selectedDay).toBe(NEXT_MON);
  });

  test('dayChoices: a stamp of today on a non-order day stays «today»', () => {
    const c = dayChoices({ supplier: monOnly, stamp: WED, hasItems: true, today: WED });
    expect(c.selected).toBe('today');
    expect(c.options.length).toBe(2);
  });

  test('dayChoices: a future stamp equal to the next order day is just «next» (deduped)', () => {
    const c = dayChoices({ supplier: monOnly, stamp: NEXT_MON, hasItems: true, today: WED });
    expect(kinds(c)).toStrictEqual([`today:${WED}`, `next:${NEXT_MON}`]);
    expect(c.selected).toBe('next');
  });

  test('dayChoices: a future stamp that is not the next order day (order days edited) is shown and selected', () => {
    const c = dayChoices({ supplier: monThu, stamp: NEXT_MON, hasItems: true, today: WED });
    expect(kinds(c)).toStrictEqual([`today:${WED}`, `next:${THU}`, `later:${NEXT_MON}`]);
    expect(c.selected).toBe('later');
    expect(c.selectedDay).toBe(NEXT_MON);
  });

  test('dayChoices: a past stamp WITH items is offered and selected; without items it is ignored', () => {
    const withItems = dayChoices({ supplier: monOnly, stamp: MON, hasItems: true, today: WED });
    expect(kinds(withItems)).toStrictEqual([`past:${MON}`, `today:${WED}`, `next:${NEXT_MON}`]);
    expect(withItems.selected).toBe('past');
    expect(withItems.selectedDay).toBe(MON);
    const without = dayChoices({ supplier: monOnly, stamp: MON, hasItems: false, today: WED });
    expect(kinds(without)).toStrictEqual([`today:${WED}`, `next:${NEXT_MON}`]);
    expect(without.selected).toBe('next');
  });

  test('dayChoices: no order days — one answer, unless a future stamp is stored', () => {
    const plain = dayChoices({ supplier: free, stamp: undefined, hasItems: true, today: WED });
    expect(kinds(plain)).toStrictEqual([`today:${WED}`]);
    expect(plain.selected).toBe('today');
    const stuck = dayChoices({ supplier: free, stamp: THU, hasItems: true, today: WED });
    expect(kinds(stuck)).toStrictEqual([`today:${WED}`, `later:${THU}`]);
    expect(stuck.selected).toBe('later');
  });

  test('dayChoices: options come in date order, and a Saturday-only supplier wraps correctly', () => {
    const c = dayChoices({ supplier: SATURDAY_ONLY, stamp: undefined, hasItems: false, today: SUN });
    expect(c.options[1]?.day).toBe('2026-10-24');
  });
});
