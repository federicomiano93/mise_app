// The iPad order of 14 Nov 2026: a quantity typed on the iPad was still in the 800 ms pause when iOS
// froze the page, and the phone that placed the order a moment later never had it. Nothing said so.
//
// Two answers, pinned here:
//   • leaving a quantity or stock box, closing a supplier's screen or switching the list sends what is
//     waiting AT ONCE (draft.js sendWaitingDraft) — one write, never one per keystroke;
//   • a save-status line says whether everything typed HERE has reached the server
//     (draft.js onDraftSaveState → js/orders/save-state-view.js).
// draft.js runs for real; the server is the recording stub (tests/helpers/load-draft.mjs). The wiring in
// the page is pinned as text, as elsewhere: a browser drive on the emulator is the owner's.

import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// A fresh draft.js, a page that watches it and a list of every save state it was told.
async function openPage({ snapshot = true } = {}) {
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const mod = await reopenDraft();
  const page = { entries: {}, days: {}, mod, told: [], reports: [] };
  mod.setDraftSaveReporter(ok => page.reports.push(ok));
  mod.onDraftSaveState(state => page.told.push(state));
  mod.watchDraft(view => { page.entries = view.entries; page.days = view.days; });
  if (snapshot) stub.emit(server());
  return page;
}
const now = page => page.told[page.told.length - 1];
function type(page, id, patch) {
  const entry = page.entries[id] || (page.entries[id] = { qty: 0, stock: 0 });
  Object.assign(entry, patch);
  page.mod.scheduleDraftSave(page.entries, page.days);
}

beforeEach(() => {
  stub.reset();
  globalThis.localStorage = fakeStorage();
  globalThis.console.error = () => {};   // a refused write is logged on purpose
});

// ── The save state ───────────────────────────────────────────────────────────

test('nothing is said before the first snapshot of the draft; then «saved»', async () => {
  const page = await openPage({ snapshot: false });
  assert.deepEqual(now(page), { ready: false, saved: true });
  stub.emit(server());
  assert.deepEqual(now(page), { ready: true, saved: true });
});

test('typed → waiting (not sent) → in the air (not sent) → answered (saved)', async () => {
  const page = await openPage();
  stub.holdSaves();
  type(page, 'flour', { qty: 3 });
  assert.deepEqual(now(page), { ready: true, saved: false }, 'waiting for the pause');

  mock.timers.tick(800);
  await settle();
  assert.equal(stub.calls.saveDoc.length, 1, 'the pause sent it');
  assert.deepEqual(now(page), { ready: true, saved: false }, 'in the air');

  stub.held[0].resolve();
  await settle();
  assert.deepEqual(now(page), { ready: true, saved: true });
});

test('a snapshot showing this device\'s own write never makes it «saved» while the write is in the air', async () => {
  const page = await openPage();
  stub.holdSaves();
  type(page, 'flour', { qty: 3 });
  mock.timers.tick(800);
  await settle();
  // Firestore shows the device's own write before the server answers.
  stub.emit(server({ flour: { qty: 3, stock: 0 } }));
  await settle();
  assert.deepEqual(now(page), { ready: true, saved: false });

  stub.held[0].resolve();
  await settle();
  assert.deepEqual(now(page), { ready: true, saved: true });
});

test('a refused write stays «not sent», the save error is reported, and a snapshot does not change that', async () => {
  const page = await openPage();
  stub.holdSaves();
  type(page, 'flour', { qty: 3 });
  mock.timers.tick(800);
  await settle();
  stub.held[0].reject(new Error('permission-denied'));
  await settle();
  assert.deepEqual(now(page), { ready: true, saved: false });
  assert.deepEqual(page.reports, [false], 'the existing save error shows');

  // Firestore takes the refused write back: the server never had the 3.
  stub.emit(server());
  await settle();
  assert.deepEqual(now(page), { ready: true, saved: false });
  assert.equal(page.entries.flour.qty, 3, 'and the 3 is still on screen');
});

test('the save state is told only when it changes', async () => {
  const page = await openPage();
  const before = page.told.length;
  type(page, 'flour', { qty: 3 });
  type(page, 'flour', { qty: 4 });
  type(page, 'flour', { qty: 5 });
  assert.equal(page.told.length, before + 1, 'three keystrokes, one change');
  mock.timers.tick(800);
  await settle();
  assert.deepEqual(now(page), { ready: true, saved: true });
  assert.equal(page.told.length, before + 2);
});

test('a watcher that throws never breaks the save', async () => {
  const page = await openPage();
  page.mod.onDraftSaveState(state => { if (!state.saved) throw new Error('boom'); });
  type(page, 'flour', { qty: 3 });
  mock.timers.tick(800);
  await settle();
  assert.equal(stub.calls.saveDoc.length, 1);
  assert.deepEqual(page.reports, [true], 'reported as saved, not as a failure');
});

test('a page reopened after iOS threw it away is NOT «saved» while the last page\'s quantity is only in the note', async () => {
  const first = await openPage();
  type(first, 'flour', { qty: 3 });
  // No pause: the page is gone before anything left it. Only this device's note holds the 3.

  const second = await openPage();
  assert.deepEqual(now(second), { ready: true, saved: false }, 'the note still has to come back');
  mock.timers.tick(800);
  await settle();
  assert.deepEqual(now(second), { ready: true, saved: false }, 'still waiting for the server');

  stub.emit(server());
  stub.answerFromServer(server());
  await settle();
  assert.equal(second.entries.flour.qty, 3, 'back on screen');
  assert.deepEqual(now(second), { ready: true, saved: false }, 'back, and waiting for the pause');
  mock.timers.tick(800);
  await settle();
  assert.equal(stub.calls.saveDoc.at(-1).data.entries.flour.qty, 3);
  assert.deepEqual(now(second), { ready: true, saved: true });
});

test('a note the server already holds settles to «saved» without a write', async () => {
  const first = await openPage();
  type(first, 'flour', { qty: 3 });
  const second = await openPage({ snapshot: false });
  stub.emit(server({ flour: { qty: 3, stock: 0 } }));
  assert.deepEqual(now(second), { ready: true, saved: false });
  stub.answerFromServer(server({ flour: { qty: 3, stock: 0 } }));
  await settle();
  assert.deepEqual(now(second), { ready: true, saved: true });
  assert.equal(stub.calls.saveDoc.length, 0);
});

// ── Sent at once on leaving a box ────────────────────────────────────────────

test('sendWaitingDraft sends what is waiting AT ONCE, one write, and the pause then sends nothing more', async () => {
  const page = await openPage();
  type(page, 'flour', { qty: 3 });
  assert.equal(stub.calls.saveDoc.length, 0, 'still in the 800 ms pause');

  page.mod.sendWaitingDraft();
  await settle();
  assert.equal(stub.calls.saveDoc.length, 1, 'sent without waiting for the pause');
  assert.equal(stub.calls.saveDoc[0].data.entries.flour.qty, 3);

  mock.timers.tick(800);
  await settle();
  assert.equal(stub.calls.saveDoc.length, 1, 'no second write');
  assert.deepEqual(now(page), { ready: true, saved: true });
});

test('sendWaitingDraft with nothing waiting writes nothing (leaving a box without typing costs no write)', async () => {
  const page = await openPage();
  await page.mod.sendWaitingDraft();
  type(page, 'flour', { qty: 3 });
  await page.mod.sendWaitingDraft();
  await page.mod.sendWaitingDraft();   // the next box left, nothing typed in between
  await settle();
  assert.equal(stub.calls.saveDoc.length, 1);
});

test('a refusal on leaving a box shows the same save error as every other one', async () => {
  const page = await openPage();
  stub.holdSaves();
  type(page, 'flour', { qty: 3 });
  const sent = page.mod.sendWaitingDraft();
  await settle();
  stub.held[0].reject(new Error('unavailable'));
  await sent;   // never rejects: there is no caller to hand it to
  assert.deepEqual(page.reports, [false]);
  assert.deepEqual(now(page), { ready: true, saved: false });
});

// ── The wiring in the page ───────────────────────────────────────────────────

test('the page sends at once on leaving a quantity or stock box, on closing a supplier and on switching the list', () => {
  const main = read('js/orders/orders-main.js');
  assert.match(main, /document\.addEventListener\('focusout', event => \{\n\s+if \(event\.target\?\.matches\?\.\('\.ing-qty, \.ing-stock'\)\) sendWaitingDraft\(\);/);
  const close = main.slice(main.indexOf('function closeSupplier() {'));
  assert.match(close.slice(0, close.indexOf('\n}\n')), /\n  sendWaitingDraft\(\);/);
  const setView = main.slice(main.indexOf('function setView(view) {'));
  const body = setView.slice(0, setView.indexOf('\n}\n'));
  assert.ok(body.indexOf('sendWaitingDraft();') > -1 && body.indexOf('sendWaitingDraft();') < body.indexOf('dropListViews();'),
    'sent before the boxes are removed');
  assert.match(main, /onDraftSaveState\(saveState => \{/);
});

test('both screens carry a polite status line, and both dictionaries say it', () => {
  assert.match(read('orders.html'), /<p class="draft-save-state" id="draft-save-state" role="status" aria-live="polite"><\/p>/);
  assert.match(read('js/orders/supplier-detail.js'),
    /el\('p', \{ class: 'draft-save-state', role: 'status', 'aria-live': 'polite' \}\)/);
  const i18n = read('js/i18n.js');
  assert.equal(i18n.match(/'orders\.saveState\.saved': /g)?.length, 2);
  assert.equal(i18n.match(/'orders\.saveState\.unsent': /g)?.length, 2);
  assert.match(i18n, /'orders\.saveState\.saved': 'Salvato ✓'/);
  assert.match(i18n, /'orders\.saveState\.unsent': 'Non ancora inviato'/);
});
