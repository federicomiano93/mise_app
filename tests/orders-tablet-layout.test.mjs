// Unit tests for the pure rules in js/orders/tablet-layout.js (P15).
//
// The DOM-touching halves (moveIn/moveOut, the MutationObserver, the panel's
// open/close behaviour) have no jsdom in this project to run them against —
// see the long note at the top of the source file on why the counting rule is
// split into a pure half tested here and a thin DOM wrapper that is not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TABLET_QUERY, TABLET_HOSTS, NOTICE_CLASSES, countNoticeClassNames,
} from '../js/orders/tablet-layout.js';

test('TABLET_QUERY is the exact text tokens.css and orders.css already carry', () => {
  // tests/tablet-width.test.mjs pins the CSS side of this; this only pins that
  // the JS side matches it, so the two can never drift apart in silence.
  assert.equal(TABLET_QUERY, '(min-width: 900px) and (min-height: 600px)');
});

test('every host names a real slot, and no host is listed twice', () => {
  const slots = new Set(['orders-tablet-strip', 'orders-alerts-panel']);
  const ids = TABLET_HOSTS.map((h) => h.id);
  assert.equal(new Set(ids).size, ids.length, 'a host id is listed more than once');
  for (const { id, slot } of TABLET_HOSTS) {
    assert.ok(slots.has(slot), `${id} points at an unknown slot "${slot}"`);
  }
});

test('the top strip is today, then the debt — today first', () => {
  const strip = TABLET_HOSTS.filter((h) => h.slot === 'orders-tablet-strip').map((h) => h.id);
  assert.deepEqual(strip, ['orders-today', 'orders-owed']);
});

test('the alerts panel is pending, untold, reorder, then the calendar notices', () => {
  const panel = TABLET_HOSTS.filter((h) => h.slot === 'orders-alerts-panel').map((h) => h.id);
  assert.deepEqual(panel, ['orders-pending', 'orders-untold', 'orders-reorder', 'orders-alerts']);
});

test('countNoticeClassNames counts one notice per matching class name', () => {
  const classNames = [
    'orders-alerts-panel',          // the panel itself — not a notice
    'pending-banner',
    'today-banner untold-banner',   // a real element carries more than one class
    'untold-ordered',
    'today-banner reorder-banner',
    'alert-banner order',
    'alert-banner holiday',
    'some-other-thing',
  ];
  assert.equal(countNoticeClassNames(classNames), 6);
});

test('the "show the notices again" pill never counts as a notice', () => {
  assert.equal(countNoticeClassNames(['alert-pill']), 0);
  assert.ok(!NOTICE_CLASSES.includes('alert-pill'));
});

test('countNoticeClassNames is 0 for nothing, or for garbage input', () => {
  assert.equal(countNoticeClassNames([]), 0);
  assert.equal(countNoticeClassNames(undefined), 0);
  assert.equal(countNoticeClassNames(null), 0);
});
