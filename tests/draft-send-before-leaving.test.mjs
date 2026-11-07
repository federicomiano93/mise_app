// Back to the recipe right after typing a quantity (a recipe row's «Order», 7 Nov 2026).
//
// Orders opened for one ingredient goes back to the recipe. Without a wait, a quantity typed a moment
// before was still in the 800 ms pause or in the air: only this device's note held it, sent the next
// time ORDERS opens here. sendBeforeLeaving sends what is waiting at once and resolves when the SERVER
// has answered every write — a snapshot showing it is not enough (Orders went into the back-forward
// cache frozen with its queue, measured on the emulator) — «refused» when something typed is still unsent once every write is answered (the page asks before it goes), «late» on the time limit.
// draft.js runs for real; the server is the recording stub (tests/helpers/load-draft.mjs).

import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { stub, reopenDraft } from './helpers/load-draft.mjs';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
  };
}

mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
const settle = () => new Promise(resolve => setImmediate(resolve));
const server = (entries = {}, days = {}) => ({ entries, days, updatedAt: 'x' });

async function openPage(serverDoc) {
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const mod = await reopenDraft();
  const page = { entries: {}, days: {}, mod };
  mod.watchDraft(view => { page.entries = view.entries; page.days = view.days; });
  stub.emit(structuredClone(serverDoc));
  return page;
}
function type(page, id, patch) {
  const entry = page.entries[id] || (page.entries[id] = { qty: 0, stock: 0 });
  Object.assign(entry, patch);
  page.mod.scheduleDraftSave(page.entries, page.days);
}
// Watches a promise without awaiting it, so the test can tell «still waiting» from «answered».
function watch(promise) {
  const seen = { done: false, value: undefined };
  promise.then(value => { seen.done = true; seen.value = value; });
  return seen;
}

beforeEach(() => {
  stub.reset();
  globalThis.localStorage = fakeStorage();
});

test('nothing typed: leaving does not wait', async () => {
  const page = await openPage(server());
  const seen = watch(page.mod.sendBeforeLeaving());
  await settle();
  assert.deepEqual(seen, { done: true, value: 'saved' });
  assert.equal(stub.calls.saveDoc.length, 0, 'nothing to send');
});

test('a quantity still in the pause is sent AT ONCE, and leaving waits for the server', async () => {
  const page = await openPage(server());
  stub.holdSaves();
  type(page, 'flour', { qty: 3 });
  assert.equal(stub.calls.saveDoc.length, 0, 'still in the 800 ms pause');

  const seen = watch(page.mod.sendBeforeLeaving());
  await settle();
  assert.equal(stub.calls.saveDoc.length, 1, 'sent without waiting for the pause');
  assert.equal(stub.calls.saveDoc[0].data.entries.flour.qty, 3);
  assert.equal(seen.done, false, 'not yet: the server has not answered');

  stub.held[0].resolve();
  await settle();
  assert.deepEqual(seen, { done: true, value: 'saved' });
});

test('a snapshot showing the write is NOT enough: only the server\'s answer lets the page go', async () => {
  const page = await openPage(server());
  stub.holdSaves();
  type(page, 'flour', { qty: 3 });
  const seen = watch(page.mod.sendBeforeLeaving());
  await settle();
  // Firestore shows the device's own write before the server answers.
  stub.emit(server({ flour: { qty: 3, stock: 0 } }));
  await settle();
  assert.equal(seen.done, false);
  stub.held[0].resolve();
  await settle();
  assert.deepEqual(seen, { done: true, value: 'saved' });
});

test('a refused write answers «refused» and shows the save error, so the page can stay', async () => {
  const page = await openPage(server());
  const reports = [];
  page.mod.setDraftSaveReporter(ok => reports.push(ok));
  const quiet = mock.method(console, 'error', () => {});
  stub.holdSaves();
  type(page, 'flour', { qty: 3 });
  const seen = watch(page.mod.sendBeforeLeaving());
  await settle();
  stub.held[0].reject(new Error('permission-denied'));
  await settle();
  quiet.mock.restore();
  assert.deepEqual(seen, { done: true, value: 'refused' });
  assert.deepEqual(reports, [false], 'the same save error as any refused autosave');
});

test('never longer than the limit (8 s by default): «late»', async () => {
  const page = await openPage(server());
  stub.holdSaves();
  type(page, 'flour', { qty: 3 });
  const seen = watch(page.mod.sendBeforeLeaving());
  await settle();
  mock.timers.tick(7999);
  await settle();
  assert.equal(seen.done, false);
  mock.timers.tick(1);
  await settle();
  assert.deepEqual(seen, { done: true, value: 'late' });
});

test('a write already in the air (the pause is over) is waited for too, not sent twice', async () => {
  const page = await openPage(server());
  stub.holdSaves();
  type(page, 'flour', { qty: 3 });
  mock.timers.tick(800);
  await settle();
  assert.equal(stub.calls.saveDoc.length, 1, 'the autosave went');

  const seen = watch(page.mod.sendBeforeLeaving());
  await settle();
  assert.equal(stub.calls.saveDoc.length, 1, 'nothing new to send');
  assert.equal(seen.done, false);
  stub.held[0].resolve();
  await settle();
  assert.deepEqual(seen, { done: true, value: 'saved' });
});

test('after a refusal, Back again RE-SENDS the value (it is not stuck at «refused»)', async () => {
  const page = await openPage(server());
  const quiet = mock.method(console, 'error', () => {});
  stub.holdSaves();
  type(page, 'flour', { qty: 3 });
  const first = watch(page.mod.sendBeforeLeaving());
  await settle();
  stub.held[0].reject(new Error('permission-denied'));
  await settle();
  assert.deepEqual(first, { done: true, value: 'refused' });

  // Nothing typed since: the refused 3 is only in `pending`, and nothing re-armed a save.
  const second = watch(page.mod.sendBeforeLeaving());
  await settle();
  assert.equal(stub.calls.saveDoc.length, 2, 'the refused value is sent again');
  assert.equal(stub.calls.saveDoc[1].data.entries.flour.qty, 3);
  assert.equal(second.done, false);
  stub.held[1].resolve();
  await settle();
  quiet.mock.restore();
  assert.deepEqual(second, { done: true, value: 'saved' });
});

test('a refused write is NOT hidden by a later write that succeeds without its fields', async () => {
  const page = await openPage(server());
  const quiet = mock.method(console, 'error', () => {});
  stub.holdSaves();
  type(page, 'flour', { qty: 3 });
  mock.timers.tick(800);
  await settle();
  assert.equal(stub.calls.saveDoc.length, 1, 'write A (flour) in the air');
  type(page, 'salt', { qty: 2 });
  const seen = watch(page.mod.sendBeforeLeaving());
  await settle();
  assert.equal(stub.calls.saveDoc.length, 2, 'write B goes at once');
  assert.equal(stub.calls.saveDoc[1].data.entries.flour, undefined, 'B leaves out what A carries');
  stub.held[0].reject(new Error('permission-denied'));
  stub.held[1].resolve();
  await settle();
  quiet.mock.restore();
  assert.deepEqual(seen, { done: true, value: 'refused' }, 'the flour 3 is still unsent');
});

test('a keystroke during the wait that sends nothing new does not hold the page for 8 s', async () => {
  const page = await openPage(server());
  stub.holdSaves();
  type(page, 'flour', { qty: 3 });
  const seen = watch(page.mod.sendBeforeLeaving());
  await settle();
  type(page, 'flour', { qty: 3 });   // the same value again: the debounce re-arms
  stub.held[0].resolve();
  await settle();
  mock.timers.tick(800);             // the debounce fires and finds nothing to send
  await settle();
  mock.timers.tick(200);             // the poll sees it settled
  await settle();
  assert.equal(stub.calls.saveDoc.length, 1);
  assert.deepEqual(seen, { done: true, value: 'saved' });
});
