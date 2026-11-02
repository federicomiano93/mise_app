// «No products yet» on Magazzino only when it is true (js/inventory/inventory-model.js listStatus,
// inventory-store.js, inventory-list.js, firebase-inventory.js). P15. On every open the page painted before
// anything had arrived, so a venue with products was told for about 1.5 s that it had none (first in English,
// then in Italian), with a summary «0 of 0»; offline with the list never read on this device it stayed on that
// false message until the signal came back.
//
// Four parts, each EXECUTED rather than read: the real listStatus, the real screen in a fake DOM, the real
// watchIngredients against a fake onSnapshot, and the real store against a fake data layer.
// ⚠️ It proves what the screen decides, not how it looks, and no real SDK runs here: that the SDK answers like
// the fake does (an empty copy first, the server's confirmation after) was seen driving the app on the emulator.

import { test, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

// ── A DOM just complete enough for the list ──────────────────────────────────

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

  get role() { return this.attributes.role; }

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
}

class Text extends Node {
  constructor(text) { super('#text'); this._text = String(text); }
}

globalThis.document = {
  createElement: tag => new Node(tag),
  createTextNode: text => new Text(text),
  activeElement: null,
};

// ── The modules that reach a database are stubbed ───────────────────────────

const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const STUBS = {
  'js/firebase.js': stub('export const firebaseConfig = {}; export const sessionReady = Promise.resolve();'),
  // ⚠️ Switchable, so «no venue open yet» can be tested: the store asks this on every call.
  'js/location.js': stub(
    'export const currentLocationId = () => globalThis.__venue ?? null; export const pathFor = (name) => `locations/v1/${name}`; export const isValidLocationId = () => true;'),
};
// The real firebase-inventory.js asks the SDK for names; each is a function that does what
// `globalThis.__fakeFirestore` plays, or nothing.
globalThis.__fakeFirestore = { getApps: () => [{}], getApp: () => ({}), collection: (_, path) => path };
function fakeSdk(specifier, parentURL) {
  const source = readFileSync(new URL(parentURL), 'utf8');
  const asked = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)]
    .filter(m => m[2] === specifier)
    .flatMap(m => m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0]).filter(Boolean));
  return stub([...new Set(asked)]
    .map(n => `export const ${n} = (...args) => globalThis.__fakeFirestore?.${n}?.(...args);`).join(' '));
}
// The data layer as the STORE sees it: every call goes to `globalThis.__inv`, which each scenario sets.
const STORE_DATA_LAYER = stub([
  'watchMonth', 'watchIngredients', 'getMonthOnce', 'getOrdersInMonth', 'saveMonthFields',
].map(n => `export const ${n} = (...args) => globalThis.__inv.${n}(...args);`).join(' ')
  + ' export const authReady = { then: (...args) => globalThis.__inv.authReady.then(...args) };');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.includes('gstatic.com')) return { url: fakeSdk(specifier, context.parentURL), shortCircuit: true };
    // Only the store gets the fake data layer: part 3 imports the real firebase-inventory.js.
    if (specifier === './firebase-inventory.js' && context.parentURL?.includes('inventory-store.js')) {
      return { url: STORE_DATA_LAYER, shortCircuit: true };
    }
    const resolved = nextResolve(specifier, context);
    const hit = Object.keys(STUBS).find(key => resolved.url.endsWith(`/${key}`));
    return hit ? { url: STUBS[hit], shortCircuit: true } : resolved;
  },
});

const { setLanguage, t } = await import('../js/i18n.js');
const { renderList } = await import('../js/inventory/inventory-list.js');
const {
  listStatus, LIST_STATUS, normalizeMonth, productsOfMonth,
} = await import('../js/inventory/inventory-model.js');
before(() => setLanguage('it'));

// ── What a listener's silence means (the real listStatus) ───────────────────

const base = {
  venueOpen: true, monthAnswered: false, ingredientsAnswered: false, failed: false,
  emptyCopy: false, stalled: false, online: true,
};

test('⚠️ «no products» needs BOTH answers: a closed month reads its rows from the month, not the ingredients', () => {
  assert.equal(listStatus({ ...base, monthAnswered: true, ingredientsAnswered: true }), LIST_STATUS.answered);
  assert.equal(listStatus({ ...base, ingredientsAnswered: true }), LIST_STATUS.waiting, 'the month has not spoken');
  assert.equal(listStatus({ ...base, monthAnswered: true }), LIST_STATUS.waiting, 'the ingredients have not spoken');
});

test('⚠️ no venue open yet: no word at all, it would be in the wrong language', () => {
  const closed = { ...base, venueOpen: false };
  assert.equal(listStatus(closed), LIST_STATUS.starting);
  assert.equal(listStatus({ ...closed, stalled: true, online: false, failed: true, emptyCopy: true }), LIST_STATUS.starting,
    'with no session the sign-in gate is what speaks');
});

test('⚠️ an empty copy while online is still waiting: a venue with no products gets it a moment before the server', () => {
  assert.equal(listStatus({ ...base, emptyCopy: true }), LIST_STATUS.waiting);
});

test('an empty copy with the browser offline is unreachable, at once', () => {
  assert.equal(listStatus({ ...base, emptyCopy: true, online: false }), LIST_STATUS.unreachable);
});

test('offline with nothing heard is still waiting: a full copy may be a moment away', () => {
  assert.equal(listStatus({ ...base, online: false }), LIST_STATUS.waiting);
});

test('too long without an answer is unreachable, whatever the browser believes', () => {
  assert.equal(listStatus({ ...base, stalled: true }), LIST_STATUS.unreachable);
});

test('a dead listener is told apart, and an answer wins over everything', () => {
  assert.equal(listStatus({ ...base, failed: true }), LIST_STATUS.failed);
  assert.equal(listStatus({ ...base, failed: true, stalled: true, online: false }), LIST_STATUS.failed);
  assert.equal(listStatus({
    ...base, monthAnswered: true, ingredientsAnswered: true, failed: true, emptyCopy: true, stalled: true, online: false,
  }), LIST_STATUS.answered);
});

// ── The screen (the real renderList in a fake DOM) ──────────────────────────

function walk(node, out = []) {
  out.push(node);
  node.children.forEach(child => walk(child, out));
  return out;
}
const withClass = (root, name) => walk(root).filter(n => n.classList.contains(name));
const product = (id) => ({ id, name: id, weight: '1kg', category: 'Dry' });
const THREE = [product('flour'), product('salt'), product('sugar')];
const openMonth = (extra = {}) => normalizeMonth({ month: '2026-09', opening: { flour: 10, salt: 10, sugar: 10 }, ...extra });

function screen(initial, { ingredients = [], month = openMonth(), readOnly = false, withGetter = true } = {}) {
  const state = { status: initial };
  const options = {
    month, ingredients, locale: 'it-IT', readOnly,
    onOpen: () => {}, onCount: () => {}, onCarry: () => {}, onPurchases: () => {},
  };
  if (withGetter) options.listStatus = () => state.status;
  const list = renderList(options);
  const rows = () => withClass(list.root, 'inv-list')[0];
  return {
    list,
    state,
    text: () => rows().textContent,
    rowCount: () => withClass(list.root, 'inv-row').length,
    summary: () => withClass(list.root, 'inv-summary')[0],
    summaryValue: () => withClass(list.root, 'inv-summary-value')[0].textContent,
    roles: () => walk(rows()).map(n => n.role).filter(Boolean),
    refresh: (nextIngredients, nextMonth = month) => list.refresh(nextMonth, nextIngredients),
    search: (value) => withClass(list.root, 'inv-search')[0].fire('input', { target: { value } }),
  };
}

test('⚠️ while the listeners have not answered the list says it is loading, never that there are no products', () => {
  const s = screen(LIST_STATUS.waiting);
  assert.equal(s.text(), t('inv.loading'));
  assert.deepEqual(s.roles(), ['status']);
  assert.equal(withClass(s.list.root, 'empty-state').length, 0, 'the empty message must wait for the answer');
  assert.equal(s.summary().hidden, true, 'no «0 of 0» and no note about boxes while there are no boxes');
});

test('a venue that really has no products still gets the message, and its summary as before', () => {
  const s = screen(LIST_STATUS.answered);
  assert.ok(s.text().includes(t('inv.empty.title')));
  assert.ok(s.text().includes(t('inv.empty.sub')));
  assert.equal(s.summary().hidden, false);
});

test('no connection and no copy: the list says so, politely and in words', () => {
  const s = screen(LIST_STATUS.unreachable);
  assert.ok(s.text().includes(t('inv.notArrived.title')));
  assert.ok(s.text().includes(t('inv.notArrived.sub')));
  assert.ok(!s.text().includes(t('inv.empty.title')));
  assert.deepEqual(s.roles(), ['status']);
  assert.equal(s.summary().hidden, true);
});

test('a dead listener says it could not load, as an alert', () => {
  const s = screen(LIST_STATUS.failed);
  assert.equal(s.text(), t('inv.loadFailed'));
  assert.deepEqual(s.roles(), ['alert']);
});

test('before a venue is open the list says nothing at all', () => {
  const s = screen(LIST_STATUS.starting);
  assert.equal(s.text(), '');
  assert.equal(s.rowCount(), 0);
});

test('rows that have arrived are drawn whatever the status says, with the summary and the right «x of y»', () => {
  for (const status of Object.values(LIST_STATUS)) {
    const s = screen(status, { ingredients: THREE, month: openMonth({ closing: { flour: 4 } }) });
    assert.equal(s.rowCount(), 3, status);
    assert.equal(s.summary().hidden, false, status);
    assert.match(s.summaryValue(), /1 su 3/, status);
  }
});

test('an answer that arrives later reaches the screen on its repaint', () => {
  const s = screen(LIST_STATUS.waiting);
  s.state.status = LIST_STATUS.answered;
  s.refresh([]);
  assert.ok(s.text().includes(t('inv.empty.title')));
  assert.equal(s.summary().hidden, false);

  const u = screen(LIST_STATUS.waiting);
  u.state.status = LIST_STATUS.unreachable;
  u.refresh([]);
  assert.ok(u.text().includes(t('inv.notArrived.title')));
});

test('products arriving while the list was waiting draw their rows', () => {
  const s = screen(LIST_STATUS.waiting);
  s.state.status = LIST_STATUS.answered;
  s.refresh(THREE);
  assert.equal(s.rowCount(), 3);
  assert.equal(s.summary().hidden, false);
});

test('⚠️ a search typed while waiting does NOT say nothing matches; after the answer it does', () => {
  const s = screen(LIST_STATUS.waiting);
  s.search('zzz');
  assert.equal(s.text(), t('inv.loading'));
  assert.ok(!s.text().includes(t('inv.nothingMatches')));

  s.state.status = LIST_STATUS.answered;
  s.search('zzz');
  assert.equal(s.text(), t('inv.nothingMatches'));
});

test('without a status getter the list behaves as it always did: answered', () => {
  const s = screen(undefined, { withGetter: false });
  assert.ok(s.text().includes(t('inv.empty.title')));
  assert.equal(s.summary().hidden, false);
});

test('⚠️ a closed month whose frozen names give rows draws them at once, while the ingredients are still on their way', () => {
  const closed = openMonth({ closedAt: '2026-10-01T00:00:00Z', names: { flour: 'Flour 1kg', salt: 'Salt 1kg' }, closing: { flour: 2 } });
  const rows = productsOfMonth(closed, []);
  assert.equal(rows.length, 3, 'the frozen names and the counts name the rows, whatever the ingredients say');
  const s = screen(LIST_STATUS.waiting, { ingredients: rows, month: closed, readOnly: true });
  assert.equal(s.rowCount(), 3);
  assert.ok(!s.text().includes(t('inv.loading')));
  assert.equal(s.summary().hidden, false);
});

test('a closed month with nothing recorded and no ingredients yet keeps waiting', () => {
  const closed = normalizeMonth({ month: '2026-09', closedAt: '2026-10-01T00:00:00Z' });
  const s = screen(LIST_STATUS.waiting, { ingredients: productsOfMonth(closed, []), month: closed, readOnly: true });
  assert.equal(s.rowCount(), 0);
  assert.equal(s.text(), t('inv.loading'));
  assert.equal(s.summary().hidden, true);
});

// ── The listener: the real watchIngredients against a fake SDK ──────────────

const snapshot = (ids, { fromCache, changes = 0 }) => ({
  docs: ids.map(id => ({ id, data: () => ({ name: id }) })),
  empty: ids.length === 0,
  metadata: { fromCache },
  docChanges: () => Array(changes).fill({}),
});
const priceSnapshot = (entries) => ({ empty: false, metadata: { fromCache: false }, docChanges: () => [{}],
  forEach: fn => Object.entries(entries).forEach(([id, data]) => fn({ id, data: () => data })),
});

// Opens the listener and returns what the screen was told, and the SDK's two voices.
async function listen() {
  const calls = [];
  globalThis.__fakeFirestore.onSnapshot = (ref, second, third, fourth) => {
    const withOptions = typeof second !== 'function';
    calls.push({
      path: ref,
      options: withOptions ? second : undefined,
      next: withOptions ? third : second,
      error: withOptions ? fourth : third,
    });
    return () => {};
  };
  const { watchIngredients } = await import('../js/inventory/firebase-inventory.js');
  const told = [];
  await watchIngredients((list, fromCache) => told.push({ n: list.length, fromCache }), () => {});
  const call = (suffix) => calls.find(c => c.path.endsWith(suffix));
  return { told, ingredients: call('/ingredients'), prices: call('/ingredient-prices') };
}

test('⚠️ the server confirming an EMPTY copy reaches the screen, or it would wait for ever', async () => {
  const { told, ingredients, prices } = await listen();
  assert.equal(ingredients.options?.includeMetadataChanges, true,
    'without it the confirmation changes no document and Firestore never calls back');
  assert.equal(prices.options?.includeMetadataChanges, true, 'the prices too: inventory-close-month.test.mjs');
  ingredients.next(snapshot([], { fromCache: true }));
  ingredients.next(snapshot([], { fromCache: false }));
  assert.deepEqual(told, [{ n: 0, fromCache: true }, { n: 0, fromCache: false }]);
});

test('⚠️ the server confirming a FULL copy does not: the same rows would be worked out again for nothing', async () => {
  const { told, ingredients } = await listen();
  ingredients.next(snapshot(['a', 'b'], { fromCache: true, changes: 2 }));
  ingredients.next(snapshot(['a', 'b'], { fromCache: false }));
  assert.deepEqual(told, [{ n: 2, fromCache: true }]);
});

test('a real change always reaches the screen, and so do rows after an empty copy', async () => {
  const { told, ingredients } = await listen();
  ingredients.next(snapshot([], { fromCache: true }));
  ingredients.next(snapshot(['a'], { fromCache: false, changes: 1 }));
  ingredients.next(snapshot(['a', 'b'], { fromCache: false, changes: 1 }));
  assert.deepEqual(told, [
    { n: 0, fromCache: true }, { n: 1, fromCache: false }, { n: 2, fromCache: false },
  ]);
});

test('a price answer after the ingredients still emits, and nothing is emitted before them', async () => {
  const { told, ingredients, prices } = await listen();
  prices.next(priceSnapshot({ a: { price: 2 } }));
  assert.deepEqual(told, [], 'an empty list must not be painted for a frame');
  ingredients.next(snapshot(['a'], { fromCache: false, changes: 1 }));
  prices.next(priceSnapshot({ a: { price: 3 } }));
  assert.deepEqual(told, [{ n: 1, fromCache: false }, { n: 1, fromCache: false }]);
});

// ── The store: the real inventory-store.js against a fake data layer ────────
//
// The store keeps its state at module level, so each scenario imports its own copy through a query string
// (`?scenario=N`). The production code exports no hook for tests.

let scenarioNumber = 0;
const settle = () => new Promise(resolve => setImmediate(resolve));

// The store's 10 s stall timer, on the test's clock: a real one would hold the run open for ten seconds.
beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); });
afterEach(() => { mock.timers.reset(); });

async function openStore({ venue = 'v1', monthRejects = false } = {}) {
  globalThis.__venue = venue;
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  let openVenue;
  const voice = { announced: 0, errors: 0 };
  globalThis.__inv = {
    authReady: new Promise(resolve => { openVenue = resolve; }),
    watchMonth: (id, onChange, onError) => {
      voice.month = onChange;
      voice.monthError = onError;
      return monthRejects ? Promise.reject(new Error('refused')) : Promise.resolve();
    },
    watchIngredients: (onChange, onError) => {
      voice.ingredients = onChange;
      voice.ingredientsError = onError;
      return Promise.resolve();
    },
    getMonthOnce: async () => null,
    getOrdersInMonth: async () => [],
    saveMonthFields: async () => {},
  };
  const store = await import(`../js/inventory/inventory-store.js?scenario=${++scenarioNumber}`);
  store.initInventory('2026-09', () => { voice.announced += 1; }, () => { voice.errors += 1; });
  await settle();
  return { store, voice, open: async () => { openVenue(); await settle(); } };
}

const withNavigator = async (onLine, fn) => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true, writable: true });
  try { await fn(); } finally {
    if (saved) Object.defineProperty(globalThis, 'navigator', saved); else delete globalThis.navigator;
  }
};

test('before a venue is open the store has no word, and a venue with nothing at all ends answered', async () => {
  const closed = await openStore({ venue: null });
  assert.equal(closed.store.getListStatus(), LIST_STATUS.starting);

  const { store, voice, open } = await openStore();
  await open();
  assert.equal(store.getListStatus(), LIST_STATUS.waiting, 'the venue is open and nothing has been heard');
  voice.month(null, { fromServer: false });
  voice.ingredients([], true);
  assert.equal(store.getListStatus(), LIST_STATUS.waiting, 'two empty copies prove nothing');
  voice.month(null, { fromServer: true });
  assert.equal(store.getListStatus(), LIST_STATUS.waiting, 'the ingredients are still only a copy');
  voice.ingredients([], false);
  assert.equal(store.getListStatus(), LIST_STATUS.answered);
});

test('⚠️ a missing month from the phone\'s own copy does not count; the server\'s word does; so does a document', async () => {
  const fromCopy = await openStore();
  fromCopy.voice.ingredients([{ id: 'a' }], false);
  fromCopy.voice.month(null, { fromServer: false });
  assert.equal(fromCopy.store.getListStatus(), LIST_STATUS.waiting, 'it could be a closed month never read here');

  const fromServer = await openStore();
  fromServer.voice.ingredients([{ id: 'a' }], false);
  fromServer.voice.month(null, { fromServer: true });
  assert.equal(fromServer.store.getListStatus(), LIST_STATUS.answered);

  const document = await openStore();
  document.voice.ingredients([{ id: 'a' }], true);
  document.voice.month({ id: '2026-09', month: '2026-09' }, { fromServer: false });
  assert.equal(document.store.getListStatus(), LIST_STATUS.answered, 'a month document from the cache is a month');
});

test('⚠️ an empty list from the cache while offline is unreachable, and rows from the server end it', async () => {
  await withNavigator(false, async () => {
    const { store, voice, open } = await openStore();
    await open();
    voice.ingredients([], true);
    assert.equal(store.getListStatus(), LIST_STATUS.unreachable);
    assert.deepEqual(store.getIngredients(), []);

    voice.month(null, { fromServer: true });
    voice.ingredients([{ id: 'flour', name: 'Flour' }], false);
    assert.equal(store.getListStatus(), LIST_STATUS.answered);
    assert.deepEqual(store.getIngredients().map(i => i.id), ['flour']);
  });
});

test('a list that has answered stays answered when its last row goes with no signal', async () => {
  const { store, voice } = await openStore();
  voice.month(null, { fromServer: true });
  voice.ingredients([{ id: 'a' }], false);
  voice.ingredients([], true);
  assert.equal(store.getListStatus(), LIST_STATUS.answered, 'an empty list from the cache is true that time');
});

test('⚠️ the wait has an end: ten seconds after the venue opens, still unheard, the list says it has not arrived', async () => {
  const { store, voice, open } = await openStore();
  await open();
  const before = voice.announced;
  mock.timers.tick(9999);
  assert.equal(store.getListStatus(), LIST_STATUS.waiting);
  mock.timers.tick(1);
  assert.equal(store.getListStatus(), LIST_STATUS.unreachable);
  assert.equal(voice.announced, before + 1, 'the screen is told, or the words would not change');
});

test('the timer does not announce when both listeners have answered, and does not run without a venue', async () => {
  const answered = await openStore();
  await answered.open();
  answered.voice.month(null, { fromServer: true });
  answered.voice.ingredients([{ id: 'a' }], false);
  const before = answered.voice.announced;
  mock.timers.tick(10000);
  assert.equal(answered.voice.announced, before);
  assert.equal(answered.store.getListStatus(), LIST_STATUS.answered);

  const noVenue = await openStore({ venue: null });
  await noVenue.open();
  const beforeTick = noVenue.voice.announced;
  mock.timers.tick(20000);
  assert.equal(noVenue.store.getListStatus(), LIST_STATUS.starting);
  assert.equal(noVenue.voice.announced, beforeTick, 'no timer ran, nothing to repaint');
});

test('a dead listener is told apart and announced, from either listener and from a start that failed', async () => {
  const ingredients = await openStore();
  await ingredients.open();
  const before = ingredients.voice.announced;
  ingredients.voice.ingredientsError(new Error('denied'));
  assert.equal(ingredients.store.getListStatus(), LIST_STATUS.failed);
  assert.ok(ingredients.voice.announced > before);

  const month = await openStore();
  await month.open();
  const beforeMonth = month.voice.announced;
  month.voice.monthError(new Error('denied'));
  assert.equal(month.store.getListStatus(), LIST_STATUS.failed);
  assert.equal(month.voice.errors, 1, 'the existing error handler still hears it');
  assert.ok(month.voice.announced > beforeMonth);

  const quiet = console.error;
  console.error = () => {};
  try {
    const refused = await openStore({ monthRejects: true });
    assert.equal(refused.store.getListStatus(), LIST_STATUS.failed);
    assert.ok(refused.voice.announced > 0);
    assert.equal(refused.voice.errors, 1);
  } finally {
    console.error = quiet;
  }
});

test('the venue opening announces, so a list still waiting finds its words', async () => {
  const { voice, open } = await openStore();
  const before = voice.announced;
  await open();
  assert.ok(voice.announced > before);
});

// ── The wiring, which only driving the page can execute ─────────────────────

test('⚠️ the screen is handed the store\'s answer: without it the list believes everything has answered', () => {
  const main = readFileSync(new URL('../js/inventory/inventory-main.js', import.meta.url), 'utf8');
  const showList = main.slice(main.indexOf('function showList()'), main.indexOf('function openIngredient('));
  assert.match(showList, /renderList\(\{[\s\S]*?\blistStatus: getListStatus,[\s\S]*?\}\)/);
  assert.match(main, /import \{[^}]*\bgetListStatus\b[^}]*\} from '\.\/inventory-store\.js'/);
});
