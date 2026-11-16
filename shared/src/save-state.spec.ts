// Tests for the save-status line's rule (P15), ported from tests/save-state-view.test.mjs of `main` (v1.145.0).
//
// ADAPTED, NOT PAIRED: save-state.ts is the rule of js/orders/save-state-view.js with Mise 2's own keys (`ord.saveState.*`
// where the original says `orders.saveState.*`), and the original exists only on `main`, so parity.spec.ts cannot import
// it. When `main` is merged into the Mise 2 branch, add a describe.each over both files that compares `state` and maps the
// key (`orders.` ↔ `ord.`).
//
// PORTED: the two view tests. NOT PORTED: the painting test, because `paintSaveState` writes into a DOM node and the
// port leaves it out (the screen is React).

import { expect, test } from 'vitest';
import { saveStateView } from './save-state';

test('nothing before the first snapshot, online or not', () => {
  expect(saveStateView({ ready: false, saved: true }, true)).toStrictEqual({ state: '', key: '' });
  expect(saveStateView({ ready: false, saved: false }, false)).toStrictEqual({ state: '', key: '' });
  expect(saveStateView(undefined)).toStrictEqual({ state: '', key: '' });
});

test('saved only when nothing is waiting AND the device is online', () => {
  expect(saveStateView({ ready: true, saved: true }, true)).toStrictEqual({ state: 'saved', key: 'ord.saveState.saved' });
  expect(saveStateView({ ready: true, saved: false }, true)).toStrictEqual({ state: 'unsent', key: 'ord.saveState.unsent' });
  expect(saveStateView({ ready: true, saved: true }, false).state).toBe('unsent');
});

test('online is assumed when the screen does not say', () => {
  expect(saveStateView({ ready: true, saved: true }).state).toBe('saved');
});
