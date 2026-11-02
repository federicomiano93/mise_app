// A month can be closed only once it has arrived (js/inventory/inventory-model.js monthReady, withoutEmptyMaps;
// inventory-store.js closeMonth; inventory-main.js). P15.
//
// Driven on the emulator before this fix: a manager with no copy and no signal saw «the products have not arrived»,
// tapped «Close the month», got the NORMAL dialog, and when the signal came back the month was stamped closed with no
// names and no prices, its pack weights gone, and the next month's openings and pack weights gone too. An empty map in
// a merge REPLACES the stored one. The same empty maps wiped the next month in an ordinary close with signal, when
// nothing had been counted.
//
// Four parts, each EXECUTED rather than read: the real model, the real data layer against a fake SDK, the real store
// against a fake data layer, and the real page (inventory-main.js) in a fake DOM with the real store under it.
// ⚠️ No real SDK runs here. That a merge with an empty map wipes the stored map, and that getDocs answers from the copy
// with no signal, was seen driving the app on the emulator: algprobe/mise-drive/drive-suppliers-empty-flash.mjs,
// scenarios close-*, others-no-copy, carry-into-closed, purchases-offline.

import { test, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

// ── A DOM just complete enough for the page ──────────────────────────────────

class ClassList {
  constructor() { this.set = new Set(); }
  add(...names) { names.forEach(n => n && this.set.add(n)); }
  remove(...names) { names.forEach(n => this.set.delete(n)); }
  contains(name) { return this.set.has(name); }
  toggle(name, on) { if (on) this.add(name); else this.remove(name); return this.contains(name); }
}

class Node {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.classList = new ClassList();
    this._text = null;
  }

  get className() { return [...this.classList.set].join(' '); }
  set className(value) {
    this.classList = new ClassList();
    this.classList.add(...String(value).split(/\s+/));
  }

  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() {
    if (this._text !== null) return this._text;
    return this.children.map(c => c.textContent).join('');
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === 'value') this.value = String(value);
  }

  getAttribute(name) { return this.attributes[name]; }
  appendChild(child) { this.children.push(child); return child; }
  append(...nodes) { nodes.forEach(n => this.appendChild(n)); }
  replaceChildren(...nodes) { this.children = []; nodes.forEach(n => this.appendChild(n)); }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  fire(type, event = {}) { (this.listeners[type] || []).forEach(fn => fn({ target: this, ...event })); }
  focus() {}
}

class Text extends Node {
  constructor(text) { super('#text'); this._text = String(text); }
}

const IDS = ['invScreen', 'invTitle', 'invSub', 'invHome', 'invBack', 'invStrip', 'invMonth', 'invPrev', 'invNext',
  'invFooter', 'invCost', 'invClose', 'invToast'];
let elements = {};
globalThis.document = {
  createElement: tag => new Node(tag),
  createTextNode: text => new Text(text),
  activeElement: null,
  visibilityState: 'visible',
  addEventListener() {},
  getElementById: id => elements[id],
};
globalThis.window = { addEventListener() {}, dispatchEvent() {} };

// ── The modules that reach a database are stubbed ───────────────────────────

const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const STUBS = {
  'js/firebase.js': stub(`export const firebaseConfig = {};
    export const sessionReady = Promise.resolve();
    export const currentSession = () => ({ canManage: true });`),
  'js/location.js': stub(
    'export const currentLocationId = () => globalThis.__venue ?? null; export const pathFor = (name) => `locations/v1/${name}`; export const isValidLocationId = () => true;'),
  'js/inventory/confirm-dialog.js': stub(
    'export const confirmDialog = (o) => globalThis.__dialog(o); export const alertDialog = async () => {};'),
};
globalThis.__fakeFirestore = { getApps: () => [{}], getApp: () => ({}), collection: (_, path) => path };
function fakeSdk(specifier, parentURL) {
  const source = readFileSync(new URL(parentURL), 'utf8');
  const asked = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)]
    .filter(m => m[2] === specifier)
    .flatMap(m => m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0]).filter(Boolean));
  return stub([...new Set(asked)]
    .map(n => `export const ${n} = (...args) => globalThis.__fakeFirestore?.${n}?.(...args);`).join(' '));
}
const STORE_DATA_LAYER = stub([
  'watchMonth', 'watchIngredients', 'getMonthOnce', 'getOrdersInMonth', 'saveMonthFields',
].map(n => `export const ${n} = (...args) => globalThis.__inv.${n}(...args);`).join(' ')
  + ' export const authReady = { then: (...args) => globalThis.__inv.authReady.then(...args) };');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.includes('gstatic.com')) return { url: fakeSdk(specifier, context.parentURL), shortCircuit: true };
    if (specifier === './firebase-inventory.js' && context.parentURL?.includes('inventory-store.js')) {
      return { url: STORE_DATA_LAYER, shortCircuit: true };
    }
    const resolved = nextResolve(specifier, context);
    const hit = Object.keys(STUBS).find(key => resolved.url.endsWith(`/${key}`));
    if (hit) return { url: STUBS[hit], shortCircuit: true };
    // A page of its own gets a store of its own: both keep their state at module level.
    const page = context.parentURL?.match(/inventory-main\.js(\?page=\d+)$/);
    if (page && specifier === './inventory-store.js') return { ...resolved, url: resolved.url + page[1] };
    return resolved;
  },
});

const { setLanguage } = await import('../js/i18n.js');
const { monthReady, withoutEmptyMaps, LIST_STATUS } = await import('../js/inventory/inventory-model.js');
before(() => setLanguage('it'));

const settle = async () => { for (let i = 0; i < 4; i += 1) await new Promise(resolve => setImmediate(resolve)); };

// The store's 10 s stall timer and the page's toast, on the test's clock.
beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); });
afterEach(() => { mock.timers.reset(); });

// ── The model: what «ready» is, and what may go out ─────────────────────────

test('⚠️ an empty map never goes out in a write: in a merge it wipes the stored one', () => {
  assert.deepEqual(
    withoutEmptyMaps({ month: '2026-09', opening: {}, packKg: { a: 25 }, names: {}, unitPrice: {} }),
    { month: '2026-09', packKg: { a: 25 } },
  );
});

test('what is not an empty map goes out untouched: an empty string reopens a month, a removal is not empty', () => {
  class Sentinel { }
  const removal = new Sentinel();
  const kept = { closedAt: '', updatedAt: 'now', closing: { a: removal }, top: removal, nothing: null, zero: 0 };
  assert.deepEqual(withoutEmptyMaps(kept), kept);
});

const ready = (over) => monthReady({ status: LIST_STATUS.answered, closed: false, rows: 3, pricesAnswered: true, ...over });

test('⚠️ an open month is ready only with its own answer, the ingredients\' and the prices\'', () => {
  assert.equal(ready(), true);
  for (const status of [LIST_STATUS.starting, LIST_STATUS.waiting, LIST_STATUS.unreachable, LIST_STATUS.failed]) {
    assert.equal(ready({ status }), false, `status ${status}, with rows on screen`);
  }
  assert.equal(ready({ pricesAnswered: false }), false, 'a close would freeze no money');
  assert.equal(ready({ pricesAnswered: undefined }), false);
});

test('a venue that has really answered with nothing is ready: the month can still be closed', () => {
  assert.equal(ready({ rows: 0 }), true);
});

test('a closed month is ready on its own rows, whatever the ingredients are doing; with none it needs the answer', () => {
  assert.equal(ready({ closed: true, status: LIST_STATUS.waiting, pricesAnswered: false }), true);
  assert.equal(ready({ closed: true, status: LIST_STATUS.waiting, rows: 0 }), false);
  assert.equal(ready({ closed: true, rows: 0 }), true);
});

// ── The data layer: the real firebase-inventory.js against a fake SDK ───────

const { saveMonthFields, getOrdersInMonth, watchIngredients, watchMonth } = await import('../js/inventory/firebase-inventory.js');

test('⚠️ saveMonthFields sends no empty map, and a merge', async () => {
  globalThis.__venue = 'v1';
  const sent = [];
  Object.assign(globalThis.__fakeFirestore, {
    doc: (_, id) => id,
    setDoc: async (ref, data, options) => { sent.push({ ref, data, options }); },
  });
  await saveMonthFields('2026-10', { month: '2026-10', opening: {}, packKg: {} });
  assert.deepEqual(sent, [{
    ref: '2026-10', data: { month: '2026-10', bakery: 'v1' }, options: { merge: true },
  }]);
});

test('saveMonthFields still empties a box by name', async () => {
  globalThis.__venue = 'v1';
  const sent = [];
  const removal = Symbol('deleteField');
  Object.assign(globalThis.__fakeFirestore, {
    doc: (_, id) => id,
    deleteField: () => removal,
    setDoc: async (ref, data) => { sent.push(data); },
  });
  await saveMonthFields('2026-10', { month: '2026-10', closing: {} }, { closing: { flour: true } });
  assert.deepEqual(sent[0].closing, { flour: removal });
});

test('⚠️ orders that are only on this device are a failed read, never «no orders»', async () => {
  const docs = [{ id: 'o1', data: () => ({ date: '2026-10-05' }) }];
  globalThis.__fakeFirestore.getDocs = async () => ({ docs: [], metadata: { fromCache: true } });
  await assert.rejects(getOrdersInMonth('2026-10-01', '2026-11-01'));
  globalThis.__fakeFirestore.getDocs = async () => ({ docs, metadata: { fromCache: true } });
  await assert.rejects(getOrdersInMonth('2026-10-01', '2026-11-01'), 'a part of them must not replace the month');
  globalThis.__fakeFirestore.getDocs = async () => ({ docs, metadata: { fromCache: false } });
  assert.deepEqual(await getOrdersInMonth('2026-10-01', '2026-11-01'), [{ id: 'o1', date: '2026-10-05' }]);
});

const ingredientSnap = ids => ({
  docs: ids.map(id => ({ id, data: () => ({ name: id }) })),
  empty: !ids.length,
  metadata: { fromCache: false },
  docChanges: () => ids,
});
const priceSnap = (entries, { fromCache = false, changes = 0 } = {}) => ({
  empty: !Object.keys(entries).length,
  metadata: { fromCache },
  docChanges: () => Array(changes).fill({}),
  forEach: fn => Object.entries(entries).forEach(([id, data]) => fn({ id, data: () => data })),
});

async function listen() {
  const calls = {};
  globalThis.__fakeFirestore.onSnapshot = (ref, options, next, error) => {
    calls[ref.split('/').pop()] = { options, next, error };
    return () => {};
  };
  const told = [];
  await watchIngredients((list, fromCache, pricesAnswered) => told.push(pricesAnswered), () => {});
  return { told, ingredients: calls.ingredients, prices: calls['ingredient-prices'] };
}

test('⚠️ an empty copy of the prices is not an answer; the server\'s «none» is, and it arrives', async () => {
  const { told, ingredients, prices } = await listen();
  assert.equal(prices.options?.includeMetadataChanges, true,
    'without it the server confirming an empty copy changes no document and never calls back');
  ingredients.next(ingredientSnap(['a']));
  assert.deepEqual(told, [false]);
  prices.next(priceSnap({}, { fromCache: true }));
  assert.deepEqual(told, [false], 'nothing new to tell');
  prices.next(priceSnap({}, { fromCache: false }));
  assert.deepEqual(told, [false, true]);
});

test('prices from the phone\'s copy are an answer, and the server confirming them is not told twice', async () => {
  const { told, ingredients, prices } = await listen();
  ingredients.next(ingredientSnap(['a']));
  prices.next(priceSnap({ a: { price: 2 } }, { fromCache: true, changes: 1 }));
  prices.next(priceSnap({ a: { price: 2 } }, { fromCache: false }));
  assert.deepEqual(told, [false, true]);
});

test('a refused price read counts as answered: that account will never get more', async () => {
  const { told, ingredients, prices } = await listen();
  ingredients.next(ingredientSnap(['a']));
  prices.error({ code: 'permission-denied' });
  assert.deepEqual(told, [false, true]);
});

test('⚠️ any other price failure does not: a month closed on it would freeze no money, with no warning', async () => {
  const { told, ingredients, prices } = await listen();
  ingredients.next(ingredientSnap(['a']));
  prices.error({ code: 'resource-exhausted' });
  assert.deepEqual(told, [false, false]);
});

test('the month\'s listener says whether the snapshot carries this phone\'s own writes', async () => {
  let next;
  Object.assign(globalThis.__fakeFirestore, {
    doc: (_, id) => id,
    onSnapshot: (ref, options, onNext) => { next = onNext; return () => {}; },
  });
  const told = [];
  await watchMonth('2026-10', (remote, meta) => told.push(meta), () => {});
  next({ exists: () => true, id: '2026-10', data: () => ({}), metadata: { fromCache: true, hasPendingWrites: true } });
  assert.deepEqual(told, [{ fromServer: false, hasPendingWrites: true }]);
});

// ── The store and the page, on a fake data layer ────────────────────────────

let pageNumber = 0;

function dataLayer() {
  const voice = { writes: [], orderReads: 0, orders: [] };
  globalThis.__venue = 'v1';
  const stored = new Map();
  globalThis.localStorage = {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: key => stored.delete(key),
  };
  globalThis.__inv = {
    authReady: Promise.resolve(),
    watchMonth: (id, onChange, onError) => { voice.month = onChange; voice.monthError = onError; return Promise.resolve(); },
    watchIngredients: (onChange, onError) => { voice.ingredients = onChange; voice.ingredientsError = onError; return Promise.resolve(); },
    getMonthOnce: async () => ({ id: '2026-09', closing: { a: 5 } }),
    getOrdersInMonth: async () => { voice.orderReads += 1; return voice.orders; },
    saveMonthFields: async (id, patch, clear) => { voice.writes.push({ id, patch, clear }); },
  };
  return voice;
}

const flour = { id: 'a', name: 'Farina', weight: '25kg', active: true };
const answerAll = (voice, month = { id: '2026-10', month: '2026-10', closing: { a: 3 }, opening: { a: 5 } }) => {
  voice.month(month, { fromServer: true });
  voice.ingredients([flour], false, true);
};

async function openStore() {
  const voice = dataLayer();
  const store = await import(`../js/inventory/inventory-store.js?page=${++pageNumber}`);
  store.initInventory('2026-10', () => {}, () => {});
  await settle();
  return { store, voice };
}

test('⚠️ closeMonth writes nothing and says false while nothing has been heard', async () => {
  const { store, voice } = await openStore();
  assert.equal(store.isMonthReady(), false);
  assert.equal(await store.closeMonth({ names: {}, unitPrice: {}, packKg: {} }), false);
  assert.deepEqual(voice.writes, []);
  assert.equal(store.getMonth().closedAt, '', 'and the screen is not told it is closed');
});

test('⚠️ rows from the phone\'s copy with the month never read: not ready, nothing written', async () => {
  const { store, voice } = await openStore();
  voice.month(null, { fromServer: false });
  voice.ingredients([flour], true, true);
  assert.equal(store.isMonthReady(), false);
  assert.equal(await store.closeMonth({ names: { a: 'Farina' } }), false);
  assert.deepEqual(voice.writes, []);
});

test('the month from the copy but no ingredients: not ready, nothing written', async () => {
  const { store, voice } = await openStore();
  voice.month({ id: '2026-10', month: '2026-10', closing: { a: 3 } }, { fromServer: false });
  voice.ingredients([], true, false);
  assert.equal(store.isMonthReady(), false);
  assert.equal(await store.closeMonth({}), false);
  assert.deepEqual(voice.writes, []);
});

test('⚠️⚠️ one count typed into a month never read here is this phone\'s own write: it proves nothing', async () => {
  const { store, voice } = await openStore();
  voice.ingredients([flour], true, true);
  voice.month(null, { fromServer: false });
  store.setCount('closing', 'a', '3');
  voice.month({ id: '2026-10', month: '2026-10', closing: { a: 3 } }, { fromServer: false, hasPendingWrites: true });
  assert.equal(store.isMonthReady(), false);
  assert.equal(await store.closeMonth({ names: { a: 'Farina' } }), false);
  assert.deepEqual(voice.writes.filter(w => w.patch.closedAt), [], 'no close goes out');
});

test('that month gets its answer from the server, its own writes or not', async () => {
  const { store, voice } = await openStore();
  voice.ingredients([flour], true, true);
  voice.month({ id: '2026-10', month: '2026-10', closing: { a: 3 } }, { fromServer: false, hasPendingWrites: true });
  assert.equal(store.isMonthReady(), false);
  voice.month({ id: '2026-10', month: '2026-10', closing: { a: 3 } }, { fromServer: true, hasPendingWrites: true });
  assert.equal(store.isMonthReady(), true);
});

test('⚠️ the storeroom: a month read here before, counted offline and reloaded offline, can still be closed', async () => {
  const first = await openStore();
  first.voice.month({ id: '2026-10', month: '2026-10', opening: { a: 5 } }, { fromServer: false, hasPendingWrites: false });
  // The same phone, the page reloaded: its counts are still waiting for a signal.
  const storedBefore = globalThis.localStorage;
  const store = await import(`../js/inventory/inventory-store.js?page=${++pageNumber}`);
  const voice = dataLayer();
  globalThis.localStorage = storedBefore;
  store.initInventory('2026-10', () => {}, () => {});
  await settle();
  voice.ingredients([flour], true, true);
  voice.month({ id: '2026-10', month: '2026-10', opening: { a: 5 }, closing: { a: 3 } }, { fromServer: false, hasPendingWrites: true });
  assert.equal(store.isMonthReady(), true);
});

test('what this phone wrote down for one month says nothing about another, and needs a document', async () => {
  const { store, voice } = await openStore();
  globalThis.localStorage.setItem('inventory-seen-v1-2026-09', 'true');
  voice.ingredients([flour], true, true);
  voice.month({ id: '2026-10', month: '2026-10' }, { fromServer: false, hasPendingWrites: true });
  assert.equal(store.isMonthReady(), false, 'another month');
  globalThis.localStorage.setItem('inventory-seen-v1-2026-10', 'true');
  voice.month(null, { fromServer: false });
  assert.equal(store.isMonthReady(), false, 'no document');
});

test('both answered and the prices still out: not ready, then ready when they land', async () => {
  const { store, voice } = await openStore();
  voice.month({ id: '2026-10', month: '2026-10' }, { fromServer: true });
  voice.ingredients([flour], false, false);
  assert.equal(store.isMonthReady(), false);
  voice.ingredients([flour], false, true);
  assert.equal(store.isMonthReady(), true);
});

test('the offline storeroom: a month and a list from the phone\'s copy are ready, and it closes', async () => {
  const { store, voice } = await openStore();
  voice.month({ id: '2026-10', month: '2026-10', closing: { a: 3 } }, { fromServer: false });
  voice.ingredients([flour], true, true);
  assert.equal(store.isMonthReady(), true);
  assert.equal(await store.closeMonth({ names: { a: 'Farina' }, unitPrice: {}, packKg: {} }), '2026-11');
  assert.deepEqual(voice.writes.map(w => w.id), ['2026-11', '2026-10'], 'the next month first');
});

test('⚠️ a month already closed is not closed twice: today\'s prices would replace the frozen ones', async () => {
  const { store, voice } = await openStore();
  answerAll(voice, { id: '2026-10', month: '2026-10', closedAt: 'x', names: { a: 'Farina' } });
  assert.equal(await store.closeMonth({ names: { a: 'Nuova' } }), false);
  assert.deepEqual(voice.writes, []);
});

// ── The page: the real inventory-main.js in a fake DOM ──────────────────────

async function openPage() {
  elements = Object.fromEntries(IDS.map(id => [id, new Node('div')]));
  globalThis.location = { search: '?month=2026-10', href: '' };
  const voice = dataLayer();
  const page = { voice, dialogs: [], answer: null };
  globalThis.__dialog = (options) => new Promise(resolve => {
    page.dialogs.push(options);
    page.answer = async (yes) => { resolve(yes); await settle(); };
  });
  await import(`../js/inventory/inventory-main.js?page=${++pageNumber}`);
  await settle();
  page.close = elements.invClose;
  page.cost = elements.invCost;
  page.toast = () => elements.invToast.textContent;
  page.tap = async (node) => { node.fire('click'); await settle(); };
  page.action = (label) => {
    const walk = (node) => (node.classList.contains('inv-action') && node.textContent === label
      ? node : node.children.map(walk).find(Boolean));
    return walk(elements.invScreen);
  };
  return page;
}

const NOT_READY = /^Non ancora/;

test('⚠️ THE DEFECT: no list and no signal, Close offers no dialog and writes nothing; the tap says why', async () => {
  const page = await openPage();
  page.voice.month(null, { fromServer: false });
  page.voice.ingredients([], true, false);
  assert.equal(page.close.getAttribute('aria-disabled'), 'true');
  assert.equal(page.close.hidden, false, 'it stays where it is, the bar does not jump');
  await page.tap(page.close);
  assert.deepEqual(page.dialogs, []);
  assert.deepEqual(page.voice.writes, []);
  assert.match(page.toast(), NOT_READY);
});

test('the button comes alive by itself when the answers land, and a normal close freezes names and prices', async () => {
  const page = await openPage();
  assert.equal(page.close.getAttribute('aria-disabled'), 'true');
  answerAll(page.voice);
  await settle();
  assert.equal(page.close.getAttribute('aria-disabled'), 'false');
  assert.equal(page.cost.getAttribute('aria-disabled'), 'false');

  await page.tap(page.close);
  assert.equal(page.dialogs.length, 1);
  await page.answer(true);
  const [next, closed] = page.voice.writes;
  assert.equal(next.id, '2026-11');
  assert.equal(closed.id, '2026-10');
  assert.ok(closed.patch.closedAt);
  assert.equal(closed.patch.names.a, 'Farina 25kg');
  assert.match(page.toast(), /Mese chiuso/);
});

test('⚠️ the dialog is open and another phone closes the month: confirming writes nothing and says so', async () => {
  const page = await openPage();
  answerAll(page.voice);
  await settle();
  await page.tap(page.close);
  assert.equal(page.dialogs.length, 1);
  page.voice.month({ id: '2026-10', month: '2026-10', closedAt: 'x', names: { a: 'Farina' } }, { fromServer: true });
  await page.answer(true);
  assert.deepEqual(page.voice.writes, []);
  assert.match(page.toast(), /appena stato chiuso/);
});

test('what is frozen is read after the answer, not when the dialog opened', async () => {
  const page = await openPage();
  answerAll(page.voice);
  await settle();
  await page.tap(page.close);
  page.voice.ingredients([flour, { id: 'b', name: 'Sale', active: true }], false, true);
  await page.answer(true);
  const closed = page.voice.writes.find(w => w.id === '2026-10');
  assert.deepEqual(Object.keys(closed.patch.names).sort(), ['a', 'b']);
});

test('saying no writes nothing', async () => {
  const page = await openPage();
  answerAll(page.voice);
  await settle();
  await page.tap(page.close);
  await page.answer(false);
  assert.deepEqual(page.voice.writes, []);
});

test('⚠️ «what it cost» stays on the list while nothing has arrived: no invented zero', async () => {
  const page = await openPage();
  assert.equal(page.cost.getAttribute('aria-disabled'), 'true');
  await page.tap(page.cost);
  assert.equal(elements.invBack.hidden, true, 'still on the list');
  assert.match(page.toast(), NOT_READY);
  answerAll(page.voice);
  await settle();
  await page.tap(page.cost);
  assert.equal(elements.invBack.hidden, false, 'the cost screen opens once it has arrived');
});

test('⚠️ «carry forward» offers nothing into a month that has not answered, so nothing lands in a closed one', async () => {
  const page = await openPage();
  page.voice.month(null, { fromServer: false });
  page.voice.ingredients([flour], true, true);
  const carry = page.action('Porta avanti');
  assert.equal(carry.getAttribute('aria-disabled'), 'true');
  await page.tap(carry);
  assert.deepEqual(page.dialogs, []);
  mock.timers.tick(1000);
  await settle();
  assert.deepEqual(page.voice.writes, []);
  assert.match(page.toast(), NOT_READY);
});

test('«carry forward» works once the month has answered, and stops if it closes under the dialog', async () => {
  const page = await openPage();
  answerAll(page.voice);
  await settle();
  const carry = page.action('Porta avanti');
  assert.equal(carry.getAttribute('aria-disabled'), 'false');
  await page.tap(carry);
  assert.equal(page.dialogs.length, 1);
  page.voice.month({ id: '2026-10', month: '2026-10', closedAt: 'x' }, { fromServer: true });
  await page.answer(true);
  mock.timers.tick(1000);
  await settle();
  assert.deepEqual(page.voice.writes, []);
  assert.match(page.toast(), /appena stato chiuso/);
});

test('⚠️ «from the orders» does not look while the list is out: never «no orders», no totals without the cards', async () => {
  const page = await openPage();
  const orders = page.action('Dagli ordini');
  assert.equal(orders.getAttribute('aria-disabled'), 'true');
  await page.tap(orders);
  assert.equal(page.voice.orderReads, 0);
  assert.deepEqual(page.dialogs, []);
  assert.match(page.toast(), NOT_READY);
});

test('«from the orders» that could not read says so, and fills in nothing', async () => {
  const page = await openPage();
  answerAll(page.voice);
  await settle();
  globalThis.__inv.getOrdersInMonth = async () => { throw new Error('The orders are only on this device.'); };
  await page.tap(page.action('Dagli ordini'));
  assert.match(page.toast(), /Non riesco a leggere gli ordini/);
  assert.deepEqual(page.dialogs, []);
});

test('a closed month: Reopen is alive whatever has arrived, and its cost reads its own rows', async () => {
  const page = await openPage();
  page.voice.month({ id: '2026-10', month: '2026-10', closedAt: 'x', names: { a: 'Farina' }, closing: { a: 3 } }, { fromServer: false });
  await settle();
  assert.equal(page.close.getAttribute('aria-disabled'), 'false');
  assert.equal(page.cost.getAttribute('aria-disabled'), 'false');
  await page.tap(page.close);
  assert.equal(page.dialogs.length, 1, 'the reopen question');
  await page.answer(false);
});
