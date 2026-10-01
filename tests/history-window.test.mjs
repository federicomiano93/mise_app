// The Orders screen reads only the last HISTORY_LIVE_MONTHS months live; older orders come
// on demand. These tests pin the pure parts: where the window starts, how the loaded pages
// join the live list, and what the foot of the History list shows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORY_LIVE_MONTHS, liveHistoryStart, mergeHistory, olderFooterState, historyEmptyKind,
} from '../js/orders/history-window.js';

test('the live window is four calendar months', () => {
  assert.equal(HISTORY_LIVE_MONTHS, 4);
});

test('liveHistoryStart: four calendar months back, day clamped to the month', () => {
  assert.equal(liveHistoryStart(new Date(2026, 6, 31)), '2026-03-31');
  assert.equal(liveHistoryStart(new Date(2026, 5, 30)), '2026-02-28');
  assert.equal(liveHistoryStart(new Date(2028, 5, 30)), '2028-02-29');
  assert.equal(liveHistoryStart(new Date(2027, 0, 15)), '2026-09-15');
  assert.equal(liveHistoryStart(new Date(2026, 9, 1)), '2026-06-01');
});

test('liveHistoryStart: a clock-change day does not shift the date', () => {
  // UK clocks went forward on 29 Mar 2026 and back on 25 Oct 2026.
  assert.equal(liveHistoryStart(new Date(2026, 6, 29, 0, 30)), '2026-03-29');
  assert.equal(liveHistoryStart(new Date(2026, 9, 25, 1, 30)), '2026-06-25');
});

test('liveHistoryStart reads the LOCAL date, not the UTC one', () => {
  // 23:30 local on the 31st is already the next day in UTC for any zone east of Greenwich.
  assert.equal(liveHistoryStart(new Date(2026, 6, 31, 23, 30)), '2026-03-31');
  // 00:30 local on the 1st is still the previous day in UTC for any zone west of it.
  assert.equal(liveHistoryStart(new Date(2026, 7, 1, 0, 30)), '2026-04-01');
});

test('mergeHistory: union by id, the live copy wins, inputs untouched', () => {
  const live = [{ id: 'a', v: 'live' }, { id: 'b', v: 'live' }];
  const older = [{ id: 'b', v: 'older' }, { id: 'c', v: 'older' }];
  const liveCopy = JSON.parse(JSON.stringify(live));
  const olderCopy = JSON.parse(JSON.stringify(older));

  const merged = mergeHistory(live, older);

  assert.deepEqual(merged.map(r => r.id), ['a', 'b', 'c']);
  assert.equal(merged.find(r => r.id === 'b').v, 'live');
  assert.deepEqual(live, liveCopy);
  assert.deepEqual(older, olderCopy);
  assert.notEqual(merged, live);
});

test('mergeHistory copes with missing lists', () => {
  assert.deepEqual(mergeHistory(undefined, [{ id: 'x' }]), [{ id: 'x' }]);
  assert.deepEqual(mergeHistory([{ id: 'x' }], null), [{ id: 'x' }]);
  assert.deepEqual(mergeHistory(), []);
});

test('olderFooterState: button while not done, disabled while loading, retry after a failure', () => {
  assert.deepEqual(olderFooterState({ loading: false, done: false, error: false }),
    { visible: true, disabled: false, failed: false });
  assert.deepEqual(olderFooterState({ loading: true, done: false, error: false }),
    { visible: true, disabled: true, failed: false });
  assert.deepEqual(olderFooterState({ loading: false, done: false, error: true }),
    { visible: true, disabled: false, failed: true });
  // A retry in flight is «Loading…», not an error.
  assert.equal(olderFooterState({ loading: true, done: false, error: true }).failed, false);
  assert.equal(olderFooterState({ loading: false, done: true, error: false }).visible, false);
});

test('historyEmptyKind: "no past orders" only once everything older was looked at', () => {
  assert.equal(historyEmptyKind(true, { done: false }), null);
  assert.equal(historyEmptyKind(false, { done: false }), 'recent');
  assert.equal(historyEmptyKind(false, { done: true }), 'none');
});
