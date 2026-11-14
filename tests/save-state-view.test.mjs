// The save-status line's rule (js/orders/save-state-view.js): what draft.js says becomes «Saved ✓»,
// «Not sent yet» or nothing at all. See tests/draft-save-state.test.mjs for where the state comes from.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveStateView, paintSaveState } from '../js/orders/save-state-view.js';

const t = key => `<${key}>`;
const node = () => ({ dataset: {}, textContent: '' });

test('nothing before the first snapshot, online or not', () => {
  assert.deepEqual(saveStateView({ ready: false, saved: true }, true), { state: '', key: '' });
  assert.deepEqual(saveStateView({ ready: false, saved: false }, false), { state: '', key: '' });
  assert.deepEqual(saveStateView(undefined), { state: '', key: '' });
});

test('saved only when nothing is waiting AND the device is online', () => {
  assert.equal(saveStateView({ ready: true, saved: true }, true).state, 'saved');
  assert.equal(saveStateView({ ready: true, saved: false }, true).state, 'unsent');
  assert.equal(saveStateView({ ready: true, saved: true }, false).state, 'unsent', 'offline: nothing can be confirmed');
});

test('painting writes the state and the words, and leaves an unchanged line alone', () => {
  const line = node();
  paintSaveState(line, saveStateView({ ready: true, saved: false }), t);
  assert.deepEqual([line.dataset.state, line.textContent], ['unsent', '<orders.saveState.unsent>']);
  paintSaveState(line, saveStateView({ ready: true, saved: true }), t);
  assert.deepEqual([line.dataset.state, line.textContent], ['saved', '<orders.saveState.saved>']);
  paintSaveState(line, saveStateView({ ready: false }), t);
  assert.deepEqual([line.dataset.state, line.textContent], ['', '']);
  assert.doesNotThrow(() => paintSaveState(null, saveStateView({ ready: true, saved: true }), t));
});
