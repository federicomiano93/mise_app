// Tests for the day a supplier's typed quantities are FOR (js/orders/order-day.js).
// The bug this prevents: next week's quantities typed after this week's order was placed
// used to be stamped «today», so the next morning they nagged as «order not placed» and
// on the same day as «changed after ordering». Dates below: 12 Oct 2026 is a Monday.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  nextOrderDay, targetDayFor, stampFor, recordDay, isFutureDay, notForLater,
  previewDay, nextOrderOffer, nextDeliveryAfter, dayChoices,
} from '../js/orders/order-day.js';
import { spellShortDate, spellLongDate } from '../js/orders/day.js';
import { pendingSuppliers } from '../js/orders/reminders.js';
import { untoldChanges } from '../js/orders/untold-changes.js';

const MON = '2026-10-12', TUE = '2026-10-13', WED = '2026-10-14', THU = '2026-10-15';
const NEXT_MON = '2026-10-19';

const free = { id: 's1', name: 'Free' };
const monOnly = { id: 's1', name: 'Mon', orderDays: ['Monday'] };
const monThu = { id: 's1', name: 'MonThu', orderDays: ['Monday', 'Thursday'] };
const SAT = '2026-10-17', SUN = '2026-10-18';

test('nextOrderDay: none without order days, and strictly after today', () => {
  assert.equal(nextOrderDay(free, WED), null);
  assert.equal(nextOrderDay({ id: 'x', orderDays: [] }, WED), null);
  assert.equal(nextOrderDay(monOnly, WED), NEXT_MON);
  assert.equal(nextOrderDay(monOnly, MON), NEXT_MON);   // today does not count
  assert.equal(nextOrderDay(monThu, TUE), THU);
  assert.equal(nextOrderDay(monThu, THU), NEXT_MON);
});

test('nextOrderDay ignores values that are not weekday names', () => {
  assert.equal(nextOrderDay({ id: 'x', orderDays: ['Lunedì'] }, WED), null);
});

test('no order days: the target is today, always', () => {
  assert.equal(targetDayFor({ supplier: free, today: WED }), WED);
});

test('today is an order day: the target is today', () => {
  assert.equal(targetDayFor({ supplier: monOnly, today: MON }), MON);
  assert.equal(targetDayFor({ supplier: monThu, today: THU }), THU);
});

test('any other day: the next order day, with no history needed (wraps over the weekend)', () => {
  assert.equal(targetDayFor({ supplier: monOnly, today: WED }), NEXT_MON);
  assert.equal(targetDayFor({ supplier: monThu, today: TUE }), THU);
  assert.equal(targetDayFor({ supplier: monThu, today: SUN }), '2026-10-19');
});

test('stampFor keeps a stamp that is today or in the future', () => {
  const base = { supplier: monOnly, today: WED };
  assert.equal(stampFor({ ...base, current: WED }), WED);
  assert.equal(stampFor({ ...base, current: '2026-10-26' }), '2026-10-26');
  assert.equal(stampFor({ ...base, current: THU }), THU);
});

test('stampFor recomputes a stale or missing stamp', () => {
  const base = { supplier: monOnly, today: WED };
  assert.equal(stampFor({ ...base, current: MON }), NEXT_MON);
  assert.equal(stampFor({ ...base, current: undefined }), NEXT_MON);
  assert.equal(stampFor({ supplier: free, today: WED, current: MON }), WED);
});

test('nextDeliveryAfter: strictly after the day, wraps the week, empty without delivery days', () => {
  const tueFri = { id: 's1', deliveryDays: ['Tuesday', 'Friday'] };
  assert.equal(nextDeliveryAfter(tueFri, MON), TUE);
  assert.equal(nextDeliveryAfter(tueFri, TUE), '2026-10-16');       // the day itself does not count
  assert.equal(nextDeliveryAfter(tueFri, SAT), '2026-10-20');       // wraps into next week
  assert.equal(nextDeliveryAfter(free, MON), '');
  assert.equal(nextDeliveryAfter({ id: 'x', deliveryDays: [] }, MON), '');
  assert.equal(nextDeliveryAfter({ id: 'x', deliveryDays: ['Lunedì'] }, MON), '');
  assert.equal(nextDeliveryAfter(tueFri, ''), '');
});

test('recordDay clamps a future stamp to today and leaves past and today alone', () => {
  assert.equal(recordDay(NEXT_MON, WED), WED);
  assert.equal(recordDay(WED, WED), WED);
  assert.equal(recordDay(MON, WED), MON);
  assert.equal(recordDay('', WED), '');
});

test('isFutureDay', () => {
  assert.equal(isFutureDay(THU, WED), true);
  assert.equal(isFutureDay(WED, WED), false);
  assert.equal(isFutureDay('', WED), false);
  assert.equal(isFutureDay(undefined, WED), false);
});

test('notForLater drops suppliers stamped for a later day', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const out = notForLater(list, { a: WED, b: NEXT_MON, c: MON }, WED);
  assert.deepEqual(out.map(s => s.id), ['a', 'c']);
});

test('a future stamp never fires the pending banner', () => {
  const ingredients = [{ id: 'i1', supplierId: 's1', name: 'Flour', active: true }];
  const base = {
    suppliers: [monOnly], ingredients, entries: { i1: { qty: 3 } }, fallbackDay: '', today: WED,
  };
  assert.equal(pendingSuppliers({ ...base, days: { s1: NEXT_MON } }).length, 0);
  assert.equal(pendingSuppliers({ ...base, days: { s1: MON } }).length, 1);
});

test('untoldChanges is quiet for a supplier filtered out as «for later»', () => {
  const ingredients = [{ id: 'i1', supplierId: 's1', name: 'Flour', active: true }];
  const args = {
    ingredients, entries: { i1: { qty: 5 } }, requests: [],
    history: [{ id: `${WED}_s1`, date: WED, supplierId: 's1', quantities: { i1: 2 } }],
    today: WED,
  };
  assert.equal(untoldChanges({ ...args, suppliers: [monOnly] }).length, 1);
  assert.equal(
    untoldChanges({ ...args, suppliers: notForLater([monOnly], { s1: NEXT_MON }, WED) }).length, 0);
});

test('the short and long day phrases carry no year and read from the dictionary', () => {
  assert.equal(spellShortDate(NEXT_MON), 'Mon 19');
  assert.equal(spellLongDate(NEXT_MON), 'Monday 19 October');
  assert.equal(spellShortDate(''), '');
});

test('previewDay: the future order day in effect, or empty for today', () => {
  const base = { supplier: monOnly, today: WED };
  assert.equal(previewDay({ ...base, current: undefined }), NEXT_MON);
  assert.equal(previewDay({ ...base, current: MON }), NEXT_MON);       // stale stamp
  assert.equal(previewDay({ ...base, current: THU }), THU);            // already future
  assert.equal(previewDay({ ...base, current: WED }), '');             // «Today» already chosen
  assert.equal(previewDay({ ...base, supplier: free }), '');
  assert.equal(previewDay({ ...base, today: MON, current: undefined }), '');    // an order day
});

test('nextOrderOffer: not on an order day, and only with a next order day', () => {
  assert.equal(nextOrderOffer(monThu, TUE), THU);
  assert.equal(nextOrderOffer(monThu, THU), null);   // today is an order day
  assert.equal(nextOrderOffer(free, TUE), null);
});

const read = f => readFileSync(new URL(`../js/orders/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('wiring: recording uses the clamped day, stamps go through stampFor', () => {
  const main = read('orders-main.js');
  assert.match(main, /function dayForSupplier\(supplierId\) \{\n  return recordDay\(rawDayFor\(supplierId\), todayISO\(\)\);/);
  const stamp = main.slice(main.indexOf('function stampNow'), main.indexOf('function dayInfoFor'));
  assert.match(stamp, /stampFor\(\{/);
  assert.doesNotMatch(stamp, /history/, 'the rule needs no history');
  const after = main.slice(main.indexOf('afterChange(supplierId,'), main.indexOf('onPlaced(supplierId)'));
  assert.match(after, /if \(!stockOnly\) stampNow\(supplierId, state\.days\[supplierId\]\)/);
  assert.doesNotMatch(after, /= todayISO\(\)/);
});

test('wiring: the untold banner skips suppliers stamped for later', () => {
  const main = read('orders-main.js');
  const fn = main.slice(main.indexOf('function renderUntoldChanges'), main.indexOf('function checkPendingOnce'));
  assert.match(fn, /suppliers: notForLater\(orderSupplierList\(\), state\.days, todayISO\(\)\)/);
});

test('wiring: a failed restamp puts the old stamp back and re-queues the autosave', () => {
  const main = read('orders-main.js');
  const fn = main.slice(main.indexOf('async function restamp'), main.indexOf('// "Discard"'));
  assert.match(fn, /if \(previous\) state\.days\[supplierId\] = previous; else delete state\.days\[supplierId\];\n[\s\S]*scheduleDraftSave\(state\.entries, state\.days\);/);
});

test('wiring: the pending banner draws the 4th button only when given a next day', () => {
  const view = read('reminder-view.js');
  assert.match(view, /const nextDay = nextDayOf \? nextDayOf\(supplier\) : null;/);
  assert.match(view, /nextDay \? el\('button'[\s\S]*?orders\.pendingForNext[\s\S]*?: null,/);
  assert.match(read('orders-main.js'), /nextDayOf: supplier => nextOrderOffer\(supplier, todayISO\(\)\)/);
});

test('wiring: the supplier screen builds the day line always and toggles hidden', () => {
  const detail = read('supplier-detail.js');
  assert.match(detail, /dayLine = buildDayLine\(next\.dayInfo, supplier\.id\);\n\s*body\.appendChild\(dayLine\.node\);/);
  assert.match(detail, /node\.hidden = !now;/);
  assert.match(detail, /role: 'status', 'aria-live': 'polite'/);
});

test('wiring: the day line is decided by dayChoices; the old buttons are gone', () => {
  const main = read('orders-main.js');
  const fn = main.slice(main.indexOf('function choicesFor'), main.indexOf('async function setSupplierDay'));
  assert.match(fn, /dayChoices\(\{/);
  assert.match(fn, /choices\.options\.length < 2\) return null;/);
  assert.match(fn, /nextDeliveryAfter\(supplier, choices\.selectedDay\)/);
  const set = main.slice(main.indexOf('async function setSupplierDay'), main.indexOf('// ⚠️ THE SAME-DAY UNIT CHECK'));
  assert.match(set, /choice\.kind === 'past'/);
  assert.match(set, /restamp\(supplierId, choice\.day\)/);
  assert.doesNotMatch(main, /moveAsideDay|focusTitle/);
  assert.doesNotMatch(read('supplier-detail.js'), /focusTitle|supplier-day-btn/);
});

test('wiring: only a stock edit that fills no quantity passes stockOnly', () => {
  const rows = read('ingredients.js');
  const stock = rows.slice(rows.indexOf("stockInput.addEventListener('input'"), rows.indexOf("qtyInput.addEventListener('input'"));
  assert.match(stock, /hooks\.afterChange\(supplier\.id, \{ stockOnly: true \}\)/);
  assert.equal((rows.match(/stockOnly/g) || []).length, 2, 'the flag is on the stock path alone (one code, one comment)');
});

const SATURDAY_ONLY = { id: 's1', orderDays: ['Saturday'] };
const kinds = c => c.options.map(o => `${o.kind}:${o.day}`);

test('dayChoices: an order day with no stamp offers today (selected) and the next order', () => {
  const c = dayChoices({ supplier: monOnly, stamp: undefined, hasItems: false, today: MON });
  assert.deepEqual(kinds(c), [`today:${MON}`, `next:${NEXT_MON}`]);
  assert.equal(c.selected, 'today');
  assert.equal(c.selectedDay, MON);
});

test('dayChoices: a non-order day with no stamp selects the next order day', () => {
  const c = dayChoices({ supplier: monOnly, stamp: undefined, hasItems: false, today: WED });
  assert.deepEqual(kinds(c), [`today:${WED}`, `next:${NEXT_MON}`]);
  assert.equal(c.selected, 'next');
  assert.equal(c.selectedDay, NEXT_MON);
});

test('dayChoices: a stamp of today on a non-order day stays «today»', () => {
  const c = dayChoices({ supplier: monOnly, stamp: WED, hasItems: true, today: WED });
  assert.equal(c.selected, 'today');
  assert.equal(c.options.length, 2);
});

test('dayChoices: a future stamp equal to the next order day is just «next» (deduped)', () => {
  const c = dayChoices({ supplier: monOnly, stamp: NEXT_MON, hasItems: true, today: WED });
  assert.deepEqual(kinds(c), [`today:${WED}`, `next:${NEXT_MON}`]);
  assert.equal(c.selected, 'next');
});

test('dayChoices: a future stamp that is not the next order day (order days edited) is shown and selected', () => {
  const c = dayChoices({ supplier: monThu, stamp: NEXT_MON, hasItems: true, today: WED });
  assert.deepEqual(kinds(c), [`today:${WED}`, `next:${THU}`, `later:${NEXT_MON}`]);
  assert.equal(c.selected, 'later');
  assert.equal(c.selectedDay, NEXT_MON);
});

test('dayChoices: a past stamp WITH items is offered and selected; without items it is ignored', () => {
  const withItems = dayChoices({ supplier: monOnly, stamp: MON, hasItems: true, today: WED });
  assert.deepEqual(kinds(withItems), [`past:${MON}`, `today:${WED}`, `next:${NEXT_MON}`]);
  assert.equal(withItems.selected, 'past');
  assert.equal(withItems.selectedDay, MON);
  const without = dayChoices({ supplier: monOnly, stamp: MON, hasItems: false, today: WED });
  assert.deepEqual(kinds(without), [`today:${WED}`, `next:${NEXT_MON}`]);
  assert.equal(without.selected, 'next');
});

test('dayChoices: no order days — one answer, unless a future stamp is stored', () => {
  const plain = dayChoices({ supplier: free, stamp: undefined, hasItems: true, today: WED });
  assert.deepEqual(kinds(plain), [`today:${WED}`]);
  assert.equal(plain.selected, 'today');
  const stuck = dayChoices({ supplier: free, stamp: THU, hasItems: true, today: WED });
  assert.deepEqual(kinds(stuck), [`today:${WED}`, `later:${THU}`]);
  assert.equal(stuck.selected, 'later');
});

test('dayChoices: options come in date order, and a Saturday-only supplier wraps correctly', () => {
  const c = dayChoices({ supplier: SATURDAY_ONLY, stamp: undefined, hasItems: false, today: SUN });
  assert.equal(c.options[1].day, '2026-10-24');
});

test('wiring: the list row tag needs something typed', () => {
  const list = read('suppliers.js');
  assert.match(list, /filled \? forDay : ''/);
  assert.match(list, /filled \? data\.forDay\?\.\(supplier\.id\) \|\| '' : ''/);
});
