// Tests for the day a supplier's typed quantities are FOR (js/orders/order-day.js).
// The bug this prevents: next week's quantities typed after this week's order was placed
// used to be stamped «today», so the next morning they nagged as «order not placed» and
// on the same day as «changed after ordering». Dates below: 12 Oct 2026 is a Monday.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  nextOrderDay, targetDayFor, stampFor, recordDay, isFutureDay, notForLater, moveAsideDay,
  previewDay, nextOrderOffer,
} from '../js/orders/order-day.js';
import { spellShortDate, spellLongDate } from '../js/orders/day.js';
import { pendingSuppliers } from '../js/orders/reminders.js';
import { untoldChanges } from '../js/orders/untold-changes.js';

const MON = '2026-10-12', TUE = '2026-10-13', WED = '2026-10-14', THU = '2026-10-15';
const NEXT_MON = '2026-10-19';

const free = { id: 's1', name: 'Free' };
const monOnly = { id: 's1', name: 'Mon', orderDays: ['Monday'] };
const monThu = { id: 's1', name: 'MonThu', orderDays: ['Monday', 'Thursday'] };
const rec = (date, supplierId = 's1') => ({ id: `${date}_${supplierId}`, date, supplierId });

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
  assert.equal(targetDayFor({ supplier: free, history: [rec(MON)], today: WED }), WED);
});

test('today is an order day: the target is today, with or without a record today', () => {
  assert.equal(targetDayFor({ supplier: monOnly, history: [], today: MON }), MON);
  assert.equal(targetDayFor({ supplier: monOnly, history: [rec(MON)], today: MON }), MON);
});

test('not an order day, cycle recorded: the next order day (wraps over the weekend)', () => {
  assert.equal(targetDayFor({ supplier: monOnly, history: [rec(MON)], today: WED }), NEXT_MON);
  assert.equal(targetDayFor({ supplier: monThu, history: [rec(MON)], today: TUE }), THU);
});

test('a record made after the order day also closes the cycle', () => {
  assert.equal(targetDayFor({ supplier: monOnly, history: [rec(TUE)], today: WED }), NEXT_MON);
});

test('not an order day, cycle not recorded: today', () => {
  assert.equal(targetDayFor({ supplier: monOnly, history: [], today: WED }), WED);
  // an old record of a previous cycle does not count, nor does another supplier's
  assert.equal(targetDayFor({ supplier: monOnly, history: [rec('2026-10-05')], today: WED }), WED);
  assert.equal(targetDayFor({ supplier: monOnly, history: [rec(MON, 'other')], today: WED }), WED);
});

test('stampFor keeps a stamp that is today or in the future', () => {
  const base = { supplier: monOnly, history: [rec(MON)], today: WED };
  assert.equal(stampFor({ ...base, current: WED }), WED);
  assert.equal(stampFor({ ...base, current: '2026-10-26' }), '2026-10-26');
  assert.equal(stampFor({ ...base, current: THU }), THU);
});

test('stampFor recomputes a stale or missing stamp', () => {
  const base = { supplier: monOnly, history: [rec(MON)], today: WED };
  assert.equal(stampFor({ ...base, current: MON }), NEXT_MON);
  assert.equal(stampFor({ ...base, current: undefined }), NEXT_MON);
  assert.equal(stampFor({ supplier: monOnly, history: [], today: WED, current: MON }), WED);
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

test('moveAsideDay: only on an order day with today recorded and a next order day', () => {
  assert.equal(moveAsideDay({ supplier: monOnly, history: [rec(MON)], today: MON }), NEXT_MON);
  assert.equal(moveAsideDay({ supplier: monOnly, history: [], today: MON }), null);
  assert.equal(moveAsideDay({ supplier: monOnly, history: [rec(MON)], today: TUE }), null);
  assert.equal(moveAsideDay({ supplier: free, history: [rec(MON)], today: MON }), null);
  assert.equal(
    moveAsideDay({ supplier: monOnly, history: [rec(MON)], today: MON, current: NEXT_MON }), null);
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

test('stampFor does not compute until the history has loaded', () => {
  const base = { supplier: monOnly, history: [], today: WED, historyLoaded: false };
  assert.equal(stampFor({ ...base, current: undefined }), undefined);
  assert.equal(stampFor({ ...base, current: MON }), MON);          // existing stamp untouched
  assert.equal(stampFor({ ...base, current: NEXT_MON }), NEXT_MON); // a future one is still kept
  assert.equal(stampFor({ ...base, historyLoaded: true, current: undefined }), WED);
});

test('previewDay shows the future day before anything is typed', () => {
  const base = { supplier: monOnly, history: [rec(MON)], today: WED };
  assert.equal(previewDay({ ...base, current: undefined }), NEXT_MON);
  assert.equal(previewDay({ ...base, current: MON }), NEXT_MON);       // stale stamp
  assert.equal(previewDay({ ...base, current: THU }), THU);            // already future
  assert.equal(previewDay({ ...base, current: WED }), '');             // «For today» already chosen
  assert.equal(previewDay({ ...base, history: [], current: undefined }), '');   // cycle not recorded
  assert.equal(previewDay({ ...base, supplier: free }), '');
  assert.equal(previewDay({ ...base, today: MON, current: undefined }), '');    // an order day
  assert.equal(previewDay({ ...base, historyLoaded: false, current: undefined }), '');
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
  assert.match(main, /function stampNow\([\s\S]*?stampFor\(\{[\s\S]*?historyLoaded: state\.loaded\.history/);
  const after = main.slice(main.indexOf('afterChange(supplierId)'), main.indexOf('onPlaced(supplierId)'));
  assert.match(after, /stampNow\(supplierId, state\.days\[supplierId\]\)/);
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
  assert.match(detail, /dayLine = buildDayLine\(next\.dayInfo\);\n\s*body\.appendChild\(dayLine\.node\);/);
  assert.match(detail, /node\.hidden = !now;/);
  assert.match(detail, /role: 'status', 'aria-live': 'polite'/);
});

test('wiring: the list row tag needs something typed', () => {
  const list = read('suppliers.js');
  assert.match(list, /filled \? forDay : ''/);
  assert.match(list, /filled \? data\.forDay\?\.\(supplier\.id\) \|\| '' : ''/);
});
