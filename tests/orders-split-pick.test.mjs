// Unit tests for js/orders/split-pick.js (P15).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextMatchingDay } from '../js/orders/split-pick.js';

// 30 Sep 2026 is a Wednesday.
const WEDNESDAY = new Date('2026-09-30T09:00:00');

test('today is a match: isToday true, weekdayIndex is today\'s', () => {
  assert.deepEqual(nextMatchingDay(['Wednesday'], WEDNESDAY), { isToday: true, weekdayIndex: 3 });
});

test('not today: the NEXT matching weekday forward, not the closest by name', () => {
  // Friday (5) is the next Wednesday-forward match, not Monday (1) — which is
  // BEHIND today from a forward count and must not be picked instead.
  assert.deepEqual(nextMatchingDay(['Monday', 'Friday'], WEDNESDAY), { isToday: false, weekdayIndex: 5 });
});

test('wraps around the week: only a day EARLIER than today is left, still found', () => {
  // Only Monday (1) is listed — behind Wednesday — so the next occurrence is
  // NEXT Monday, six days forward, still within the 7-day search window.
  assert.deepEqual(nextMatchingDay(['Monday'], WEDNESDAY), { isToday: false, weekdayIndex: 1 });
});

test('no days at all -> null, never throws', () => {
  assert.equal(nextMatchingDay([], WEDNESDAY), null);
  assert.equal(nextMatchingDay(undefined, WEDNESDAY), null);
  assert.equal(nextMatchingDay(null, WEDNESDAY), null);
});

test('every day of the week -> always today', () => {
  const all = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  assert.deepEqual(nextMatchingDay(all, WEDNESDAY), { isToday: true, weekdayIndex: 3 });
});
