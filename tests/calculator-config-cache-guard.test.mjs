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
import { readFileSync } from 'node:fs';
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

test('the same document again (the server confirming the cache, going offline, coming back) draws nothing', async () => {
  // A repaint is a full rebuild of the Calculator — it closes the full-screen recipe and jumps
  // to the top — so the copies metadata changes resend must not cause one (code review).
  const { store, fake, painted } = await freshStore('same-doc-again');
  fake.answer(REAL, true);
  fake.answer({ ...REAL }, false);
  fake.answer({ ...REAL }, true);
  assert.equal(painted(), 1, 'one paint for one document');
  fake.answer({ clients: [{ id: 'c-other', name: 'Another phone added me', products: [] }] }, false);
  assert.equal(painted(), 2, 'a real change is still drawn');
  assert.equal(store.getConfig().clients[0].id, 'c-other');
});

test('going offline after the server answered neither locks saving nor wipes the copy on screen', async () => {
  const { store, fake, painted } = await freshStore('server-doc-then-cache-null');
  fake.answer(REAL, false);
  fake.answer(null, true);
  assert.equal(store.canSyncConfig(), true);
  assert.equal(store.getConfig().clients[0].id, 'c-real', 'the real clients stay');
  assert.equal(painted(), 1, 'a cached nothing draws nothing');
});

// ── The two halves that live in the data layer ───────────────────────────────
//
// The tests above replace ./firebase.js, so they cannot see it. Without its second argument the
// guard above never fires and the hole reopens; without includeMetadataChanges the server's own
// "no document" never arrives after a cached one, and a new venue sits on «Loading…» for ever.
// firebase.js loads the SDK from a CDN and cannot run under node, so its shape is pinned as text.


for (const file of ['js/firebase.js', 'js/firebase.example.js']) {
  test(`${file}: the config watch passes fromCache and asks for metadata changes`, () => {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const start = src.indexOf('export function watchCalculatorConfig(onChange) {');
    assert.ok(start >= 0, `${file}: watchCalculatorConfig is gone`);
    const body = src.slice(start, src.indexOf('\n}\n', start));
    assert.match(body, /doc\(db, pathFor\('config'\), 'calculator'\),\s*\{ includeMetadataChanges: true \},/);
    assert.match(body, /snap => onChange\(snap\.exists\(\) \? snap\.data\(\) : null, snap\.metadata\.fromCache\)/);
  });
}
