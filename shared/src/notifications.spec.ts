// Tests for the Orders alert engine (P15). notifications.ts is an ADAPTED, PARTIAL port of js/orders/notifications.js (see its header),
// so parity.spec.ts does NOT pair it. The assertions about WHICH alerts appear — their kinds, their keys, how many, in what order —
// run against BOTH files; what the port returns instead of words (the supplier, the ISO day, how many days away, the next delivery)
// is tested on the port alone.
//
// ⚠️⚠️ THE DIFFERENCE ON PURPOSE (finding F-6). The original builds sentences inside the engine and pours the English word «tomorrow»,
// English weekday names and raw ISO dates into Italian text. The port returns DATA and no words. So the text assertions of
// tests/notifications.test.mjs («Order to place today», «ACME — Friday», «in 4 days», the sentence naming no country in either
// language) are NOT ported: they move to the Mise 2 screen that spells the data with the app's dictionary.
//
// PORTED (kinds and keys, both files): the place-order alert (order day today, one grouped alert, none when no supplier orders today,
// a supplier with delivery days but no order days, inactive ignored), the holiday notice in the coming week, the UK-vs-Italy pair of
// 24 Aug 2026 and Ferragosto, no country → no calendar alerts, the delivery clash and its country, a missing list never throws, and
// the three isReminderDue tests. ADDED (both files): the order of the alerts when all three kinds appear at once.
// ADDED (port only): the data fields, the "tomorrow" case as a number, the explicit UK list, 2027 from the built-in list (the
// original's stops at 2026-12-28, so the same question has a different answer there), the exact shapes, the constants.
// The original is imported as the original test does (it pulls in the dictionary and the DOM helper, neither of which does anything at
// import); in Node it has no localStorage, so it reads its built-in UK list.
//
// Weekdays are derived in-test from the same dates (not hard-coded), so the assertions hold on any machine/CI timezone.

import { describe, expect, test } from 'vitest';
import * as ported from './notifications';
import * as legacyJs from '../../js/orders/notifications.js';

type Alerts = ReturnType<typeof ported.computeAlerts>;
type Supplier = { id: string; name: string; active?: boolean; orderDays?: string[]; deliveryDays?: string[] };

// The original returns more fields (title, items, text): only the ones both files have are compared.
const legacy = {
  computeAlerts: legacyJs.computeAlerts as unknown as (suppliers: readonly Supplier[] | null | undefined, now?: Date, country?: string | null) => Array<{ kind: string; key: string }>,
  isReminderDue: legacyJs.isReminderDue as unknown as typeof ported.isReminderDue,
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayOf = (date: Date): string => WEEKDAYS[date.getDay()]!;

// A quiet week well away from any fallback bank holiday, so only the order-day logic fires (mid-June 2026: nearest holidays are 25 May
// and 31 Aug).
const QUIET_NOW = new Date(2026, 5, 17); // Wednesday 17 June 2026

describe.each([
  ['shared/ (TypeScript)', (s: readonly Supplier[] | null | undefined, now?: Date, country?: string | null) => ported.computeAlerts(s, now, country), ported.isReminderDue],
  ['js/ (current app)', legacy.computeAlerts, legacy.isReminderDue],
] as const)('%s', (_name, computeAlerts, isReminderDue) => {
  // What both files agree on: the kind and the key of each alert, in order.
  const shape = (alerts: Array<{ kind: string; key: string }>): Array<[string, string]> => alerts.map(a => [a.kind, a.key]);

  test('flags a place-order alert when a supplier’s order day is today', () => {
    const today = weekdayOf(QUIET_NOW);
    const suppliers = [{ id: 's1', name: 'ACME', active: true, orderDays: [today], deliveryDays: ['Friday'] }];
    expect(shape(computeAlerts(suppliers, QUIET_NOW))).toStrictEqual([['order', 'order-2026-06-17']]);
  });

  test('groups every supplier due today into ONE alert', () => {
    const today = weekdayOf(QUIET_NOW);
    const suppliers = [
      { id: 's1', name: 'Flour Co', active: true, orderDays: [today], deliveryDays: ['Wednesday'] },
      { id: 's2', name: 'Dairy Ltd', active: true, orderDays: [today], deliveryDays: ['Thursday'] },
    ];
    expect(shape(computeAlerts(suppliers, QUIET_NOW)), 'a single grouped alert, not one per supplier')
      .toStrictEqual([['order', 'order-2026-06-17']]);
  });

  test('no place-order alert when no supplier orders today', () => {
    // Order day two days ahead — not today.
    const otherDay = weekdayOf(new Date(2026, 5, 19));
    const suppliers = [{ id: 's1', name: 'ACME', active: true, orderDays: [otherDay], deliveryDays: ['Friday'] }];
    expect(computeAlerts(suppliers, QUIET_NOW)).toStrictEqual([]);
  });

  test('a supplier with delivery days but no order days raises no place-order alert', () => {
    const today = weekdayOf(QUIET_NOW);
    const suppliers = [{ id: 's1', name: 'ACME', active: true, deliveryDays: [today] }];
    expect(computeAlerts(suppliers, QUIET_NOW)).toStrictEqual([]);
  });

  test('inactive suppliers are ignored', () => {
    const today = weekdayOf(QUIET_NOW);
    const suppliers = [{ id: 's1', name: 'ACME', active: false, orderDays: [today], deliveryDays: [today] }];
    expect(computeAlerts(suppliers, QUIET_NOW)).toStrictEqual([]);
  });

  test('a supplier with no `active` field counts as active', () => {
    const today = weekdayOf(QUIET_NOW);
    expect(computeAlerts([{ id: 's1', name: 'ACME', orderDays: [today] }], QUIET_NOW).length).toBe(1);
  });

  test('warns about a public holiday in the coming week', () => {
    // Monday 21 Dec 2026: Christmas Day (25 Dec) is 4 days away. No suppliers, so the holiday notice is the only alert.
    expect(shape(computeAlerts([], new Date(2026, 11, 21), 'GB'))).toStrictEqual([['holiday', 'bh-2026-12-25']]);
  });

  // ⚠️⚠️ THE DEFECT, AS FEDERICO SAW IT ON HIS OWN PHONE, 24 Aug 2026. Panificio Miano is in Italy and the app announced Britain's late
  // summer bank holiday to it. On 24 August the UK has one in 7 days and Italy has none within the week — so the two countries give
  // OPPOSITE answers on the same date, which is what makes this the assertion worth having.
  test('⚠️⚠️ an Italian venue is not told about a UK bank holiday', () => {
    const now = new Date(2026, 7, 24); // Monday 24 August 2026
    expect(shape(computeAlerts([], now, 'GB')), 'the UK venue still gets its late summer bank holiday')
      .toStrictEqual([['holiday', 'bh-2026-08-31']]);
    expect(computeAlerts([], now, 'IT'), 'an Italian venue hears nothing about a British bank holiday').toStrictEqual([]);
  });

  // ⚠️ And the other half of the same fix: the day Italy actually shuts. Ferragosto went unmentioned for the whole life of the feature.
  test('⚠️ an Italian venue IS told about Ferragosto, and a UK venue is not', () => {
    const now = new Date(2026, 7, 11); // Tuesday 11 August 2026 — Ferragosto is 4 days off
    expect(shape(computeAlerts([], now, 'IT'))).toStrictEqual([['holiday', 'bh-2026-08-15']]);
    expect(computeAlerts([], now, 'GB')).toStrictEqual([]);
  });

  // ⚠️ NO COUNTRY MEANS NO CALENDAR, never Britain's by default. The Home badge calls computeAlerts with no country on purpose (it reads
  // only the `order` alert), so this is the behaviour that keeps that call honest.
  test('⚠️ with no country there is no holiday notice at all', () => {
    const now = new Date(2026, 11, 21); // Christmas is 4 days away in both calendars
    expect(computeAlerts([], now)).toStrictEqual([]);
    expect(computeAlerts([], now, null)).toStrictEqual([]);
  });

  test('⚠️ an unknown country gets no calendar alerts either', () => {
    const now = new Date(2026, 11, 21);
    for (const country of ['FR', 'gb', '', 'constructor', 'toString']) {
      expect(computeAlerts([], now, country), country).toStrictEqual([]);
    }
  });

  test('warns about a delivery day that clashes with an upcoming public holiday', () => {
    // 15 Dec 2026: Christmas Day (25 Dec) is within the 14-day conflict window, though not the 7-day holiday one.
    const now = new Date(2026, 11, 15);
    const christmasWeekday = weekdayOf(new Date(2026, 11, 25));
    const suppliers = [{ id: 's1', name: 'ACME', active: true, deliveryDays: [christmasWeekday] }];
    expect(shape(computeAlerts(suppliers, now, 'GB'))).toStrictEqual([['conflict', 'conf-s1-2026-12-25']]);
  });

  // ⚠️ The conflict notice reads the same calendar as the countdown does. A version that fixed only the "holiday ahead" notice would
  // still tell an Italian bakery its supplier's delivery clashed with a British bank holiday.
  test('⚠️ the delivery-clash notice follows the country too', () => {
    const now = new Date(2026, 7, 24); // 31 Aug is a UK bank holiday, and nothing in Italy
    const weekday = weekdayOf(new Date(2026, 7, 31));
    const suppliers = [{ id: 's1', name: 'ACME', active: true, deliveryDays: [weekday] }];

    expect(computeAlerts(suppliers, now, 'GB').some(a => a.kind === 'conflict')).toBe(true);
    expect(computeAlerts(suppliers, now, 'IT').some(a => a.kind === 'conflict')).toBe(false);
  });

  // The order of the alerts is part of what the screen draws: the order alert, then the holiday notice, then one clash per holiday
  // (soonest first) and, within a holiday, per supplier in the list's order. Italy, so that both files read the same calendar.
  test('all three kinds at once come in the order: order, holiday, then the clashes by day and by supplier', () => {
    const now = new Date(2026, 11, 21); // Monday
    const suppliers = [
      { id: 's1', name: 'Alba', orderDays: ['Monday'], deliveryDays: ['Friday', 'Saturday'] },
      { id: 's2', name: 'Etna', orderDays: ['Tuesday'], deliveryDays: ['Friday'] },
      { id: 's3', name: 'Closed', active: false, orderDays: ['Monday'], deliveryDays: ['Friday'] },
    ];
    expect(shape(computeAlerts(suppliers, now, 'IT'))).toStrictEqual([
      ['order', 'order-2026-12-21'],
      ['holiday', 'bh-2026-12-25'],
      ['conflict', 'conf-s1-2026-12-25'],
      ['conflict', 'conf-s2-2026-12-25'],
      ['conflict', 'conf-s1-2026-12-26'],
      ['conflict', 'conf-s1-2027-01-01'],
      ['conflict', 'conf-s2-2027-01-01'],
    ]);
  });

  test('a missing supplier list produces no alerts (and never throws)', () => {
    expect(computeAlerts(undefined, QUIET_NOW)).toStrictEqual([]);
    expect(computeAlerts(null, QUIET_NOW)).toStrictEqual([]);
  });

  // ── Daily Home reminder gate (isReminderDue) ───────────────────────────────

  test('reminder is due when it has never been shown', () => {
    expect(isReminderDue(null, QUIET_NOW)).toBe(true);
    expect(isReminderDue(undefined, QUIET_NOW)).toBe(true);
  });

  test('reminder is NOT due again on the same day it was last shown', () => {
    expect(isReminderDue('2026-06-17', QUIET_NOW)).toBe(false); // matches QUIET_NOW (17 June 2026)
  });

  test('reminder is due again once the day has changed', () => {
    expect(isReminderDue('2026-06-16', QUIET_NOW)).toBe(true);
  });
});

// ── What only the port has: data, not words ──────────────────────────────────

describe('the port returns data, not words (finding F-6)', () => {
  const { computeAlerts, HOLIDAY_WINDOW_DAYS, CONFLICT_WINDOW_DAYS } = ported;

  const acme = (over: Partial<Supplier> = {}): Supplier => ({ id: 's1', name: 'ACME', active: true, orderDays: ['Wednesday'], deliveryDays: ['Friday'], ...over });

  test('the order alert lists each supplier with the day it next delivers', () => {
    const flour = acme({ id: 's1', name: 'Flour Co', deliveryDays: ['Friday'] });
    const dairy = acme({ id: 's2', name: 'Dairy Ltd', deliveryDays: ['Thursday', 'Saturday'] });
    const none = acme({ id: 's3', name: 'No days', deliveryDays: undefined });
    // QUIET_NOW is Wednesday 17 June 2026: Thursday 18 is tomorrow, Friday 19 is two days away.
    expect(computeAlerts([flour, dairy, none], QUIET_NOW)).toStrictEqual([{
      kind: 'order',
      key: 'order-2026-06-17',
      lines: [
        { supplier: flour, nextDelivery: { iso: '2026-06-19', inDays: 2 } },
        { supplier: dairy, nextDelivery: { iso: '2026-06-18', inDays: 1 } },
        { supplier: none, nextDelivery: null },
      ],
    }]);
  });

  test('«tomorrow» is the number 1 — the screen words it, not the engine', () => {
    const alerts = computeAlerts([acme({ deliveryDays: ['Thursday'] })], QUIET_NOW);
    expect(alerts[0]).toMatchObject({ kind: 'order', lines: [{ nextDelivery: { inDays: 1 } }] });
  });

  test('only the NEXT delivery is returned, never the full list of delivery days', () => {
    const alerts = computeAlerts([acme({ deliveryDays: ['Thursday', 'Saturday'] })], QUIET_NOW);
    const line = (alerts[0] as Extract<Alerts[number], { kind: 'order' }>).lines[0]!;
    expect(line.nextDelivery).toStrictEqual({ iso: '2026-06-18', inDays: 1 });
  });

  test('a delivery on the same weekday as today is a week away, not today', () => {
    const alerts = computeAlerts([acme({ deliveryDays: ['Wednesday'] })], QUIET_NOW);
    expect(alerts[0]).toMatchObject({ lines: [{ nextDelivery: { iso: '2026-06-24', inDays: 7 } }] });
  });

  test('a supplier with no delivery days has a null next delivery, and is still listed', () => {
    const noDays = acme({ deliveryDays: [] });
    expect(computeAlerts([noDays], QUIET_NOW)).toStrictEqual([
      { kind: 'order', key: 'order-2026-06-17', lines: [{ supplier: noDays, nextDelivery: null }] },
    ]);
  });

  test('the holiday alert says which day and how many days away', () => {
    expect(computeAlerts([], new Date(2026, 11, 21), 'GB')).toStrictEqual([
      { kind: 'holiday', key: 'bh-2026-12-25', iso: '2026-12-25', inDays: 4 },
    ]);
    expect(computeAlerts([], new Date(2026, 11, 24), 'IT')).toStrictEqual([
      { kind: 'holiday', key: 'bh-2026-12-25', iso: '2026-12-25', inDays: 1 },
    ]);
  });

  test('the holiday window is seven days from tomorrow: day 7 is in, day 8 is not', () => {
    expect(HOLIDAY_WINDOW_DAYS).toBe(7);
    expect(computeAlerts([], new Date(2026, 11, 18), 'GB')).toStrictEqual([
      { kind: 'holiday', key: 'bh-2026-12-25', iso: '2026-12-25', inDays: 7 },
    ]);
    expect(computeAlerts([], new Date(2026, 11, 17), 'GB'), 'eight days away').toStrictEqual([]);
  });

  test('the conflict window is fourteen days from tomorrow: day 14 is in, day 15 is not', () => {
    expect(CONFLICT_WINDOW_DAYS).toBe(14);
    const friday = acme({ orderDays: [], deliveryDays: ['Friday'] });
    const in14 = computeAlerts([friday], new Date(2026, 11, 11), 'GB'); // 25 Dec is 14 days off
    expect(in14).toStrictEqual([{ kind: 'conflict', key: 'conf-s1-2026-12-25', supplier: friday, iso: '2026-12-25' }]);
    expect(computeAlerts([friday], new Date(2026, 11, 10), 'GB'), '15 days off').toStrictEqual([]);
  });

  test('the conflict alert carries the supplier itself and the ISO day — no sentence', () => {
    const friday = acme({ orderDays: [], deliveryDays: ['Friday'] });
    const alerts = computeAlerts([friday], new Date(2026, 11, 15), 'GB');
    expect(alerts.length).toBe(1);
    const conflict = alerts[0] as Extract<Alerts[number], { kind: 'conflict' }>;
    expect(conflict.supplier).toBe(friday);
    expect(conflict.iso).toBe('2026-12-25');
    expect(Object.keys(conflict).sort()).toStrictEqual(['iso', 'key', 'kind', 'supplier']);
  });

  test('the conflict key is the supplier id and the day', () => {
    const alerts = computeAlerts([acme({ id: 'SUP_A', orderDays: [], deliveryDays: ['Friday'] })], new Date(2026, 11, 15), 'GB');
    expect(alerts[0]!.key).toBe('conf-SUP_A-2026-12-25');
  });

  // ⚠️ The stored weekday names are English DATA: a Monday supplier must match a Monday whatever the interface language.
  test('weekday matching stays on the stored English names', () => {
    const italianNames = acme({ orderDays: ['mercoledì', 'Mercoledì'], deliveryDays: ['venerdì'] });
    expect(computeAlerts([italianNames], QUIET_NOW)).toStrictEqual([]);
    expect(computeAlerts([italianNames], new Date(2026, 11, 15), 'GB')).toStrictEqual([]);
  });

  // ── The UK list is an argument ─────────────────────────────────────────────

  // ⚠️ FINDING F-8: the original's built-in list stops at 2026-12-28, so from 29 December a UK venue with no cached copy heard nothing
  // about 1 January 2027. The port's runs to 2028.
  test('⚠️ the built-in UK list reaches 2027 and 2028', () => {
    expect(computeAlerts([], new Date(2026, 11, 29), 'GB')).toStrictEqual([
      { kind: 'holiday', key: 'bh-2027-01-01', iso: '2027-01-01', inDays: 3 },
    ]);
    expect(computeAlerts([], new Date(2027, 11, 20), 'GB')).toStrictEqual([
      { kind: 'holiday', key: 'bh-2027-12-27', iso: '2027-12-27', inDays: 7 },
    ]);
    expect(computeAlerts([], new Date(2028, 11, 20), 'GB')).toStrictEqual([
      { kind: 'holiday', key: 'bh-2028-12-25', iso: '2028-12-25', inDays: 5 },
    ]);
  });

  test('a UK list passed in replaces the built-in one', () => {
    const now = new Date(2026, 5, 17);
    expect(computeAlerts([], now, 'GB', ['2026-06-19'])).toStrictEqual([
      { kind: 'holiday', key: 'bh-2026-06-19', iso: '2026-06-19', inDays: 2 },
    ]);
    expect(computeAlerts([], new Date(2026, 11, 21), 'GB', []), 'an empty list is no UK holidays, not the built-in ones').toStrictEqual([]);
  });

  test('the UK list does not touch an Italian venue', () => {
    expect(computeAlerts([], new Date(2026, 5, 17), 'IT', ['2026-06-19'])).toStrictEqual([]);
  });

  test('the same call always gives the same answer — no module state between calls', () => {
    const now = new Date(2026, 5, 17);
    computeAlerts([], now, 'GB', ['2026-06-19']);
    expect(computeAlerts([], now, 'GB')).toStrictEqual([]);
  });

  // ── What the port exports ──────────────────────────────────────────────────

  test('exports the two functions it ports and the two windows, and nothing else', () => {
    expect(Object.keys(ported).sort()).toStrictEqual(['CONFLICT_WINDOW_DAYS', 'HOLIDAY_WINDOW_DAYS', 'computeAlerts', 'isReminderDue']);
  });

  test('the two functions have the original’s names and number of required parameters', () => {
    expect(ported.computeAlerts.name).toBe(legacyJs.computeAlerts.name);
    expect(ported.computeAlerts.length).toBe(legacyJs.computeAlerts.length);
    expect(ported.isReminderDue.name).toBe(legacyJs.isReminderDue.name);
    expect(ported.isReminderDue.length).toBe(legacyJs.isReminderDue.length);
  });
});
