// The public-holiday calendar, and the country it belongs to.
//
// ⚠️⚠️ THE DEFECT THESE WERE REWRITTEN FOR. Federico, 24 Aug 2026, on Panificio
// Miano — a bakery in Italy: «mi sta suggerendo le festivita' in uk ma dovrebbe
// suggerirmi le festivita' in Italia». There was one calendar, Britain's, and every
// venue got it. The old version of this file asserted that calendar carefully and
// could not have caught it, because it never asked whose calendar it was.
//
// In Node there is no localStorage; holidays.js wraps that read in try/catch, so the
// module falls back to its built-in UK list (2025-01-01 … 2026-12-28) and the GB
// assertions below are pinned to it. The Italian side needs no fixture at all — it
// is worked out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isHoliday, nextHoliday, isHolidayWithinNextDays } from '../js/orders/holidays.js';
import { COUNTRIES } from '../js/market.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
// ⚠️ THE CODE, NOT THE FILE. This project explains itself in its comments, and the
// comments below name the very things these guards forbid — a guard that matched
// inside one would enforce nothing and still pass.
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── The two calendars are different, and that is the whole fix ───────────────

// ⚠️⚠️ THE PAIR OF DATES THAT IS THE BUG REPORT ITSELF. 31 August 2026 is Britain's
// late summer bank holiday and means nothing in Italy; 15 August is Ferragosto, the
// day everything in Italy shuts, and means nothing in Britain. Asserted in BOTH
// directions on purpose: a version that simply swapped one list for the other would
// pass half of this and would be the same defect facing the other way.
test('⚠️⚠️ a UK bank holiday is not an Italian one, and Ferragosto is not a UK one', () => {
  assert.equal(isHoliday('2026-08-31', 'GB'), true, 'UK late summer bank holiday');
  assert.equal(isHoliday('2026-08-31', 'IT'), false, 'means nothing in Italy');

  assert.equal(isHoliday('2026-08-15', 'IT'), true, 'Ferragosto');
  assert.equal(isHoliday('2026-08-15', 'GB'), false, 'means nothing in the UK');
});

test('the days the two countries share are holidays in both', () => {
  assert.equal(isHoliday('2026-12-25', 'GB'), true);
  assert.equal(isHoliday('2026-12-25', 'IT'), true);
  assert.equal(isHoliday('2026-01-01', 'GB'), true);
  assert.equal(isHoliday('2026-01-01', 'IT'), true);
});

// ⚠️ Boxing Day is a holiday in both, but the UK moved it to Monday 28 December in
// 2026 because the 26th is a Saturday, and Italy does not substitute at all. It is
// the clearest example of why Britain's calendar has to be downloaded and Italy's
// can be worked out.
test('⚠️ the UK substitutes a weekend holiday and Italy does not', () => {
  assert.equal(isHoliday('2026-12-26', 'IT'), true, 'Santo Stefano, Saturday or not');
  assert.equal(isHoliday('2026-12-28', 'GB'), true, 'substituted to the Monday');
  assert.equal(isHoliday('2026-12-28', 'IT'), false, 'Italy substitutes nothing');
});

// ── No country means no calendar, never Britain's ────────────────────────────

// ⚠️⚠️ THE SAFE DIRECTION, AND IT IS THE SAME ONE countryOf() TAKES IN market.js.
// Falling back to 'GB' is tempting — it is what every venue used to get — and it is
// precisely the behaviour being removed: announcing one country's holidays to
// another is not "a bit off", it is telling somebody the wrong day their suppliers
// are shut. Checked against production first: all three live venues carry a country,
// so this silence costs nobody a calendar they have today.
test('⚠️⚠️ an unknown country gets no holidays at all, never the UK list', () => {
  for (const country of [null, undefined, '', 'FR', 'gb', 'uk', 0, {}]) {
    assert.equal(isHoliday('2026-12-25', country), false,
      `${JSON.stringify(country)} must not inherit a calendar`);
    assert.equal(nextHoliday(new Date(2026, 5, 1), country), null);
    assert.equal(isHolidayWithinNextDays(new Date(2026, 11, 21), 7, country), false);
  }
});

// ⚠️⚠️ A RULE, NOT A LIST. js/market.js is the one place a country may be added, and
// this asserts that adding one there fails the build until somebody has decided what
// its holidays are — rather than letting it quietly inherit an empty calendar and
// look like a venue that simply has no holidays. The same guard market.js already
// uses to stop a third country printing pounds.
test('⚠️⚠️ every country the app admits has a calendar of its own', () => {
  assert.ok(COUNTRIES.length >= 2);
  for (const country of COUNTRIES) {
    assert.ok(nextHoliday(new Date(2026, 0, 1), country),
      `${country} is in market.js COUNTRIES but has no calendar in js/orders/holidays.js`);
  }
});

// ── Junk in, false out ───────────────────────────────────────────────────────

test('a date that is not a date is not a holiday', () => {
  for (const country of ['GB', 'IT']) {
    assert.equal(isHoliday('not-a-date', country), false);
    assert.equal(isHoliday('', country), false);
    assert.equal(isHoliday(undefined, country), false);
    assert.equal(isHoliday(null, country), false);
    assert.equal(isHoliday('2026-13-45', country), false);
    assert.equal(isHoliday('26-12-25', country), false);
  }
});

// ── nextHoliday ──────────────────────────────────────────────────────────────

test('nextHoliday returns the first holiday on or after the given date', () => {
  // 1 June 2026 → the next UK bank holiday is 31 August.
  assert.equal(nextHoliday(new Date(2026, 5, 1), 'GB'), '2026-08-31');
  // 26 December 2026 → the substitute day, 28 December.
  assert.equal(nextHoliday(new Date(2026, 11, 26), 'GB'), '2026-12-28');
  // In Italy the same two questions have different answers — and the first of them
  // is not even close: 2 June is the Festa della Repubblica, so an Italian venue
  // asking on 1 June has a holiday the very next day while a UK one has three
  // clear months.
  assert.equal(nextHoliday(new Date(2026, 5, 1), 'IT'), '2026-06-02');
  assert.equal(nextHoliday(new Date(2026, 11, 26), 'IT'), '2026-12-26');
});

test('the day itself counts — a holiday today is the next holiday', () => {
  assert.equal(nextHoliday(new Date(2026, 11, 25), 'GB'), '2026-12-25');
  assert.equal(nextHoliday(new Date(2026, 7, 15), 'IT'), '2026-08-15');
});

// ⚠️⚠️ THE CASE A ONE-YEAR LOOKUP GETS WRONG, AND IT IS THE WORST WEEK OF THE YEAR
// TO GET IT WRONG IN. Italy's calendar is worked out a year at a time, so asking
// only for the current year answers null every 27 December — on the screen whose job
// is to warn about the days the suppliers are shut.
test('⚠️⚠️ late December still finds the new year', () => {
  assert.equal(nextHoliday(new Date(2026, 11, 27), 'IT'), '2027-01-01');
  assert.equal(nextHoliday(new Date(2026, 11, 29), 'IT'), '2027-01-01');
});

test('nextHoliday returns null when the UK list has run out', () => {
  // The built-in fallback ends at 2026-12-28, and the fetch never runs in Node.
  assert.equal(nextHoliday(new Date(2027, 0, 1), 'GB'), null);
});

// ── isHolidayWithinNextDays ──────────────────────────────────────────────────

test('a holiday inside the window is found, in either country', () => {
  // 21 December 2026: Christmas is 4 days away.
  assert.equal(isHolidayWithinNextDays(new Date(2026, 11, 21), 7, 'GB'), true);
  assert.equal(isHolidayWithinNextDays(new Date(2026, 11, 21), 7, 'IT'), true);
});

test('a quiet stretch answers false, in either country', () => {
  // Mid-June 2026 is clear in both calendars.
  assert.equal(isHolidayWithinNextDays(new Date(2026, 5, 17), 7, 'GB'), false);
  assert.equal(isHolidayWithinNextDays(new Date(2026, 5, 17), 7, 'IT'), false);
});

// ⚠️ It looks ahead FROM TOMORROW. Standing on Christmas Day itself, there is no
// holiday "coming" in the next day — the notice is about planning ahead, and one
// that fires on the morning of the day it is warning about is too late to be worth
// reading.
test('⚠️ the window starts tomorrow, not today', () => {
  assert.equal(isHolidayWithinNextDays(new Date(2026, 11, 24), 1, 'GB'), true);
  assert.equal(isHolidayWithinNextDays(new Date(2026, 11, 25), 1, 'GB'), false);
  assert.equal(isHolidayWithinNextDays(new Date(2026, 7, 14), 1, 'IT'), true);
  assert.equal(isHolidayWithinNextDays(new Date(2026, 7, 15), 1, 'IT'), false);
});

// ── The wiring, which nothing on screen can show ─────────────────────────────

// ⚠️⚠️ THE ONE MISTAKE THIS FIX IS MOST LIKELY TO BE "TIDIED" INTO. A module is
// evaluated once, at first import, and that happens before the session has opened a
// venue — so `const COUNTRY = countryOf(...)` at the top of orders-main.js would be
// null for the life of the page and every venue would silently lose its calendar.
// It is the v1.57.0 defect, which was in fourteen places on 21 August, and no test
// that only reads computeAlerts could see it.
test('⚠️⚠️ the venue country is read inside a function, never at module load', () => {
  const src = codeOf(read('js/orders/orders-main.js'));
  const calls = src.match(/countryOf\s*\(/g) || [];
  assert.equal(calls.length, 1, 'countryOf must be asked in exactly one place');

  const fn = src.slice(src.indexOf('function venueCountry()'));
  const body = fn.slice(0, fn.search(/^\}/m));
  assert.ok(body.length > 20, 'the slice must not be empty');
  assert.ok(body.includes('countryOf('), 'and that place is inside venueCountry()');

  assert.ok(!/^(const|let|var)\s+\w+\s*=\s*countryOf\s*\(/m.test(src),
    'a module-level constant would freeze the country for the life of the page');
});

// ⚠️ THE SCREEN HAS TO BE GIVEN IT. computeAlerts builds no calendar without a
// country, so a showAlerts() that stopped passing one would not throw, would not
// look broken, and would simply take the holiday notice away from every venue.
test('⚠️ the Orders screen hands the country to the alert renderer', () => {
  const src = codeOf(read('js/orders/orders-main.js'));
  const fn = src.slice(src.indexOf('function showAlerts()'));
  const body = fn.slice(0, fn.search(/^\}/m));
  assert.ok(body.length > 20, 'the slice must not be empty');
  // ⚠️ NOT `renderAlerts\([^)]*venueCountry\(\)\)`. The first argument is itself a
  // call — document.getElementById('orders-alerts') — so `[^)]*` stops at ITS closing
  // bracket and the guard fails on correct code. It did, first time.
  assert.ok(body.includes('renderAlerts('), 'showAlerts draws the alerts');
  assert.ok(body.includes('venueCountry()'), 'and it hands over the venue country');
  assert.match(src, /refreshHolidays\(venueCountry\(\)\)/,
    'and so must the calendar refresh, or a UK venue fetches nothing');
});

// ⚠️⚠️ AND IT HAS TO SURVIVE A REDRAW. Closing or reopening a notice re-enters
// renderAlerts, so a dropped argument there would leave the venue with the right
// calendar until the first time somebody used the close button — and then with no
// calendar at all. It would read as "closing one closed them all", which nobody
// would think to blame on the country.
test('⚠️⚠️ the country survives closing and reopening a notice', () => {
  const src = codeOf(read('js/orders/notifications.js'));
  const fn = src.slice(src.indexOf('export function renderAlerts('));
  const body = fn.slice(0, fn.search(/^\}/m));
  assert.ok(body.length > 200, 'the slice must not be empty');

  // The two re-entries are close() and reopen(). Counted as well as matched: a guard
  // that only asserted "at least one passes the country" would pass on code where the
  // other one does not.
  const reentries = body.match(/renderAlerts\(container[^;]*\);/g) || [];
  assert.equal(reentries.length, 2, 'close() and reopen() each re-render');
  for (const call of reentries) {
    assert.ok(/,\s*country\s*\)/.test(call), `${call.trim()} drops the country on a redraw`);
  }
  assert.match(body, /computeAlerts\(suppliers, now, country\)/);
});

// ⚠️ PURE AND IMPORT-FREE, because it is the one piece of arithmetic here and it
// must stay testable without a browser, a session or a network.
test('⚠️ the Italian calendar imports nothing at all', () => {
  const src = codeOf(read('js/orders/holidays-it.js'));
  assert.ok(!/^\s*import\s/m.test(src), 'js/orders/holidays-it.js must stay import-free');
  assert.ok(!/\bfetch\s*\(|localStorage|document\.|window\./.test(src),
    'it is arithmetic — no network, no storage, no DOM');
});

test('both new modules are precached, or an offline phone 404s on them', () => {
  const sw = read('sw.js');
  assert.ok(sw.includes("'./js/orders/holidays.js'"));
  assert.ok(sw.includes("'./js/orders/holidays-it.js'"));
  assert.ok(!sw.includes("'./js/orders/bank-holidays.js'"), 'the renamed file must go');
});
