// Unit tests for the Orders alert engine (P15 — the owner cannot read code, so
// these tests are the safety net). computeAlerts() is the pure decision layer
// behind the in-app banners; the rendering/browser-notification parts are not
// tested here (they need a real browser).
//
// Note on imports: notifications.js pulls in holidays.js, which on load tries to
// read the browser cache. In Node there is no localStorage, but that read is wrapped
// in try/catch, so the module quietly falls back to its built-in UK list (which
// includes 2025-12-25 ... 2026-12-28). The GB tests below rely on that fixed
// fallback list; the Italian calendar needs no fixture, being worked out.
//
// ⚠️ EVERY CALL THAT EXPECTS A HOLIDAY NOTICE NOW PASSES A COUNTRY. Since 24 Aug 2026
// computeAlerts takes one, and with none it builds no calendar at all — so a test
// that forgot it would quietly assert nothing.
//
// Weekdays are derived in-test from the same dates (not hard-coded), so the
// assertions hold on any machine/CI timezone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAlerts, isReminderDue } from '../js/orders/notifications.js';
import { setLanguage } from '../js/i18n.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayOf = (date) => WEEKDAYS[date.getDay()];

// A quiet week well away from any fallback bank holiday, so only the order-day
// logic fires (mid-June 2026: nearest holidays are 25 May and 31 Aug).
const QUIET_NOW = new Date(2026, 5, 17); // Wednesday 17 June 2026

test('flags a place-order alert when a supplier’s order day is today', () => {
  const today = weekdayOf(QUIET_NOW);
  // QUIET_NOW is Wednesday 17 June 2026, so the next Friday is 2 days away.
  const suppliers = [{ id: 's1', name: 'ACME', active: true, orderDays: [today], deliveryDays: ['Friday'] }];
  const alerts = computeAlerts(suppliers, QUIET_NOW);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'order');
  assert.equal(alerts[0].items.length, 1);
  assert.equal(alerts[0].items[0], 'ACME — Friday');
  // Notification: title carries the action, body is the supplier names only.
  assert.equal(alerts[0].title, 'Order to place today');
  assert.equal(alerts[0].text, 'ACME');
});

test('place-order line says "tomorrow" when the next delivery is the next day', () => {
  const today = weekdayOf(QUIET_NOW);                    // Wednesday
  const tomorrow = weekdayOf(new Date(2026, 5, 18));     // Thursday 18 June
  const suppliers = [{ id: 's1', name: 'ACME', active: true, orderDays: [today], deliveryDays: [tomorrow] }];
  const alerts = computeAlerts(suppliers, QUIET_NOW);
  assert.equal(alerts[0].items[0], 'ACME — tomorrow');
});

test('place-order line shows ONLY the next delivery day, never the full list', () => {
  const today = weekdayOf(QUIET_NOW);                    // Wednesday
  const tomorrow = weekdayOf(new Date(2026, 5, 18));     // Thursday (next delivery)
  const later = weekdayOf(new Date(2026, 5, 20));        // Saturday (a further delivery day)
  const suppliers = [{ id: 's1', name: 'ACME', active: true, orderDays: [today], deliveryDays: [tomorrow, later] }];
  const alerts = computeAlerts(suppliers, QUIET_NOW);
  assert.equal(alerts[0].items[0], 'ACME — tomorrow');   // the soonest one only
  assert.doesNotMatch(alerts[0].items[0], new RegExp(later)); // the later day is not shown
});

test('place-order line shows just the name when the supplier has no delivery days', () => {
  const today = weekdayOf(QUIET_NOW);
  const suppliers = [{ id: 's1', name: 'ACME', active: true, orderDays: [today] }];
  const alerts = computeAlerts(suppliers, QUIET_NOW);
  assert.equal(alerts[0].items[0], 'ACME');
});

test('groups every supplier due today into ONE numbered banner', () => {
  const today = weekdayOf(QUIET_NOW);
  const suppliers = [
    { id: 's1', name: 'Flour Co', active: true, orderDays: [today], deliveryDays: ['Wednesday'] },
    { id: 's2', name: 'Dairy Ltd', active: true, orderDays: [today], deliveryDays: ['Thursday'] },
  ];
  const alerts = computeAlerts(suppliers, QUIET_NOW);
  assert.equal(alerts.length, 1);              // a single grouped banner, not one per supplier
  assert.equal(alerts[0].kind, 'order');
  assert.equal(alerts[0].items.length, 2);
  assert.equal(alerts[0].title, 'Orders to place today');  // plural for more than one
  assert.equal(alerts[0].text, 'Flour Co, Dairy Ltd');     // notification body: names only
});

test('no place-order alert when no supplier orders today', () => {
  // Order day two days ahead — not today.
  const otherDay = weekdayOf(new Date(2026, 5, 19));
  const suppliers = [{ id: 's1', name: 'ACME', active: true, orderDays: [otherDay], deliveryDays: ['Friday'] }];
  assert.deepEqual(computeAlerts(suppliers, QUIET_NOW), []);
});

test('a supplier with delivery days but no order days raises no place-order alert', () => {
  const today = weekdayOf(QUIET_NOW);
  const suppliers = [{ id: 's1', name: 'ACME', active: true, deliveryDays: [today] }];
  assert.deepEqual(computeAlerts(suppliers, QUIET_NOW), []);
});

test('inactive suppliers are ignored', () => {
  const today = weekdayOf(QUIET_NOW);
  const suppliers = [{ id: 's1', name: 'ACME', active: false, orderDays: [today], deliveryDays: [today] }];
  assert.deepEqual(computeAlerts(suppliers, QUIET_NOW), []);
});

test('warns about a public holiday in the coming week, with a day countdown', () => {
  // Monday 21 Dec 2026: Christmas Day (25 Dec, in the fallback list) is 4 days away.
  // No suppliers, so the holiday notice is the only alert.
  const now = new Date(2026, 11, 21);
  const alerts = computeAlerts([], now, 'GB');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, 'holiday');
  assert.match(alerts[0].text, /2026-12-25/);
  assert.match(alerts[0].text, /in 4 days/);
});

// ⚠️⚠️ THE DEFECT, AS FEDERICO SAW IT ON HIS OWN PHONE, 24 Aug 2026. Panificio Miano
// is in Italy and the app announced Britain's late summer bank holiday to it. On
// 24 August the UK has one in 7 days and Italy has none within the week — so the two
// countries give OPPOSITE answers on the same date, which is what makes this the
// assertion worth having. Reading only the Italian half would pass on code that had
// simply been switched from one hard-wired country to the other.
test('⚠️⚠️ an Italian venue is not told about a UK bank holiday', () => {
  const now = new Date(2026, 7, 24); // Monday 24 August 2026

  const uk = computeAlerts([], now, 'GB').find(a => a.kind === 'holiday');
  assert.ok(uk, 'the UK venue still gets its late summer bank holiday');
  assert.match(uk.text, /2026-08-31/);

  assert.deepEqual(computeAlerts([], now, 'IT'), [],
    'an Italian venue hears nothing about a British bank holiday');
});

// ⚠️ And the other half of the same fix: the day Italy actually shuts. Ferragosto
// went unmentioned for the whole life of the feature.
test('⚠️ an Italian venue IS told about Ferragosto, and a UK venue is not', () => {
  const now = new Date(2026, 7, 11); // Tuesday 11 August 2026 — Ferragosto is 4 days off

  const it = computeAlerts([], now, 'IT').find(a => a.kind === 'holiday');
  assert.ok(it, 'expected a Ferragosto notice');
  assert.match(it.text, /2026-08-15/);

  assert.equal(computeAlerts([], now, 'GB').find(a => a.kind === 'holiday'), undefined);
});

// ⚠️⚠️ THE SENTENCE MUST NOT NAME A COUNTRY — Federico's decision, 24 Aug 2026. It
// used to read «è festivo nel Regno Unito», and naming Italy instead would only move
// the defect. Checked in BOTH languages, because the English and the Italian entry
// are two separate strings and only one of them was ever read on his phone.
test('⚠️⚠️ the holiday sentence names no country, in either language', () => {
  const now = new Date(2026, 11, 21);
  const forbidden = /Regno Unito|United Kingdom|\bUK\b|\bGB\b|Italia\b|\bItaly\b/;
  for (const lang of ['en', 'it']) {
    setLanguage(lang);
    const text = computeAlerts([], now, 'GB').find(a => a.kind === 'holiday').text;
    assert.ok(!forbidden.test(text), `${lang}: the notice must not name a country — got "${text}"`);
  }
  setLanguage('en');
});

// ⚠️ NO COUNTRY MEANS NO CALENDAR, never Britain's by default. js/home-orders-badge.js
// calls computeAlerts with no country on purpose (it reads only the `order` alert),
// so this is the behaviour that keeps that call honest.
test('⚠️ with no country there is no holiday notice at all', () => {
  const now = new Date(2026, 11, 21); // Christmas is 4 days away in both calendars
  assert.deepEqual(computeAlerts([], now), []);
  assert.deepEqual(computeAlerts([], now, null), []);
});

test('warns about a delivery day that clashes with an upcoming public holiday', () => {
  // 15 Dec 2026: Christmas Day (25 Dec) is within the 14-day conflict window.
  const now = new Date(2026, 11, 15);
  const christmasWeekday = weekdayOf(new Date(2026, 11, 25));
  const suppliers = [{ id: 's1', name: 'ACME', active: true, deliveryDays: [christmasWeekday] }];
  const alerts = computeAlerts(suppliers, now, 'GB');
  const conflict = alerts.find(a => a.kind === 'conflict');
  assert.ok(conflict, 'expected a conflict alert');
  assert.match(conflict.text, /ACME/);
  assert.match(conflict.text, /2026-12-25/);
});

// ⚠️ The conflict notice reads the same calendar as the countdown does. A version
// that fixed only the "holiday ahead" banner would still tell an Italian bakery its
// supplier's delivery clashed with a British bank holiday.
test('⚠️ the delivery-clash notice follows the country too', () => {
  const now = new Date(2026, 7, 24); // 31 Aug is a UK bank holiday, and nothing in Italy
  const weekday = weekdayOf(new Date(2026, 7, 31));
  const suppliers = [{ id: 's1', name: 'ACME', active: true, deliveryDays: [weekday] }];

  assert.ok(computeAlerts(suppliers, now, 'GB').some(a => a.kind === 'conflict'));
  assert.ok(!computeAlerts(suppliers, now, 'IT').some(a => a.kind === 'conflict'));
});

test('a missing supplier list produces no alerts (and never throws)', () => {
  assert.deepEqual(computeAlerts(undefined, QUIET_NOW), []);
  assert.deepEqual(computeAlerts(null, QUIET_NOW), []);
});

// ── Daily Home reminder gate (isReminderDue) ──────────────────────────────────
test('reminder is due when it has never been shown', () => {
  assert.equal(isReminderDue(null, QUIET_NOW), true);
  assert.equal(isReminderDue(undefined, QUIET_NOW), true);
});

test('reminder is NOT due again on the same day it was last shown', () => {
  const today = '2026-06-17'; // matches QUIET_NOW (17 June 2026)
  assert.equal(isReminderDue(today, QUIET_NOW), false);
});

test('reminder is due again once the day has changed', () => {
  const yesterday = '2026-06-16';
  assert.equal(isReminderDue(yesterday, QUIET_NOW), true);
});
