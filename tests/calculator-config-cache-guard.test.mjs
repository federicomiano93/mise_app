// The Calculator's address book is never saved over on the word of Firestore's offline copy.
//
// Found by the audit of 25 Oct 2026: offline, Firestore answers a document it has never fetched
// on this phone with "does not exist", FROM ITS CACHE — and entering a location wipes that cache.
// The store took that answer as the server's, unlocked saving while DEFAULT_CONFIG's sample
// clients sat on screen, and the next Save would have written them over the real clients and
// products (the transaction rescues only cat-* recipes).
//
// These tests EXECUTE the real js/calculator-config-store.js under node, with its data layer
// (./firebase.js), its dialog and its menu publisher replaced by stand-ins a test drives by hand.
// What they cannot show is a real phone going offline: that was driven on the emulator (the PR
// says how).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { calculatorEmptyReason } from '../js/calculator-config.js';

const STORE = new URL('../js/calculator-config-store.js', import.meta.url).href;

// Each stand-in reaches the test through globalThis.__calcFake, read at call time, so one case's
// fake is the one its own (freshly loaded) store talks to.
const STAND_INS = {
  './firebase.js': `
    export function watchCalculatorConfig(onChange) { globalThis.__calcFake.answer = onChange; }
    export function saveCalculatorConfig(config) {
      globalThis.__calcFake.saved.push(config);
      return Promise.resolve();
    }`,
  './confirm-dialog.js': `
    export function alertDialog(text) { globalThis.__calcFake.alerts.push(text); return Promise.resolve(); }`,
  './client-orders-data.js': `
    export function publishMenus() { return Promise.resolve(); }`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || '';
    if (parent.startsWith(`${STORE}?case=`) && STAND_INS[specifier]) {
      return { url: `data:text/javascript,${encodeURIComponent(STAND_INS[specifier])}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

// A fresh store (its module state is the thing under test) wired to a fresh fake.
async function freshStore(name) {
  const fake = { answer: null, saved: [], alerts: [] };
  globalThis.__calcFake = fake;
  const store = await import(`${STORE}?case=${encodeURIComponent(name)}`);
  let painted = 0;
  store.initConfig(() => { painted += 1; });
  assert.equal(typeof fake.answer, 'function', 'the store did not start watching');
  return { store, fake, painted: () => painted };
}

const quietly = async (fn) => {
  const { warn } = console;
  console.warn = () => {};
  try { return await fn(); } finally { console.warn = warn; }
};

const REAL = {
  clients: [{ id: 'c-real', name: 'Real client', products: [] }],
};

test('a cached "no document" is not an answer: saving stays local, the screen keeps loading', async () => {
  const { store, fake, painted } = await freshStore('cache-null');
  fake.answer(null, true);
  assert.equal(store.canSyncConfig(), false, 'the offline copy must not unlock saving');
  assert.equal(painted(), 0, 'nothing new to draw: the screen stays on «Loading…»');
  assert.equal(calculatorEmptyReason(store.getConfig(), store.canSyncConfig()) === 'no-recipes', false,
    'an empty Calculator must not claim «no recipes yet» on the offline copy\'s word');

  const result = await quietly(() => store.saveConfig(store.getConfig()));
  assert.deepEqual(result, { synced: false, reason: 'no-server-answer' });
  assert.equal(fake.saved.length, 0, 'the sample clients must never reach Firestore');
  assert.equal(fake.alerts.length, 1, 'the person is told the change stayed on this phone');
});

test('the server then saying "no document" IS an answer: a brand-new location can save', async () => {
  const { store, fake, painted } = await freshStore('cache-then-server-null');
  fake.answer(null, true);
  fake.answer(null, false);
  assert.equal(store.canSyncConfig(), true);
  assert.equal(painted(), 1, 'the screen hears the answer once, so it can leave «Loading…»');
  const result = await store.saveConfig(store.getConfig());
  assert.deepEqual(result, { synced: true });
  assert.equal(fake.saved.length, 1);
});

test('the server saying "no document" first time round is an answer too (unchanged)', async () => {
  const { store, fake } = await freshStore('server-null');
  fake.answer(null, false);
  assert.equal(store.canSyncConfig(), true);
});

test('a cached document that exists is believed: working offline is untouched', async () => {
  const { store, fake, painted } = await freshStore('cache-doc');
  fake.answer(REAL, true);
  assert.equal(store.canSyncConfig(), true);
  assert.equal(painted(), 1);
  assert.equal(store.getConfig().clients[0].id, 'c-real');
  const result = await store.saveConfig(store.getConfig());
  assert.deepEqual(result, { synced: true });
  assert.equal(fake.saved.length, 1);
});

test('going offline after the server answered neither locks saving nor wipes the copy on screen', async () => {
  const { store, fake, painted } = await freshStore('server-doc-then-cache-null');
  fake.answer(REAL, false);
  fake.answer(null, true);
  assert.equal(store.canSyncConfig(), true);
  assert.equal(store.getConfig().clients[0].id, 'c-real', 'the real clients stay');
  assert.equal(painted(), 1, 'a cached nothing draws nothing');
});
