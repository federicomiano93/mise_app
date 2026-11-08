// «Nessun ingrediente» on Fornitori only when it is true (js/orders/registry.js, registry-main.js,
// firebase-orders.js). P15. On every open the page painted before the listeners had answered, so a venue
// with 302 ingredients was told for 2 to 4 s (lab tablet, 1 Nov 2026) that it had none.
//
// Three halves, each EXECUTED rather than read: the real watchCollection against a fake onSnapshot, the
// real listStatus, and the real screen in a fake DOM. registry-main.js joins them and only its wiring is
// read as text. ⚠️ It proves what the screen decides, not how it looks, and no real SDK runs here: that the
// SDK answers like the fake does was seen driving the app on the emulator.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

// ── A DOM just complete enough for registry.js ───────────────────────────────

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
    this.parentNode = null;
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.classList = new ClassList();
    this._text = null;
  }

  get className() { return [...this.classList.set].join(' '); }
  set className(value) { this.classList = new ClassList(); this.classList.add(...String(value).split(/\s+/)); }
  get dataset() { return {}; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text !== null ? this._text : this.children.map(c => c.textContent).join(''); }
  set innerHTML(value) { this._text = ''; }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  removeAttribute(name) { delete this.attributes[name]; }
  appendChild(child) { child.parentNode = this; this._text = null; this.children.push(child); return child; }
  prepend(child) { child.parentNode = this; this.children.unshift(child); }
  replaceChildren(...kids) { this.children = []; this._text = null; kids.forEach(k => this.appendChild(k)); }
  contains(node) { for (let n = node; n; n = n.parentNode) if (n === this) return true; return false; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
}

class Text extends Node {
  constructor(text) { super('#text'); this._text = String(text); }
}

const walk = (node, out = []) => { out.push(node); node.children.forEach(c => walk(c, out)); return out; };

const body = new Node('body');
globalThis.document = {
  createElement: tag => new Node(tag),
  createTextNode: text => new Text(text),
  getElementById: () => null,
  body,
  activeElement: body,
};
globalThis.window = {
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  dispatchEvent() {},
};
globalThis.requestAnimationFrame = fn => fn();

// ── The modules that reach a database or draw other screens are stubbed ─────

const stub = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const STUBS = {
  'js/orders/firebase-features.js': stub('export const ingredientPanels = () => ({ allergens: false }); export const setIngredientPanel = async () => {}; export const setPackPhoto = async () => {};'),
  'js/orders/photo-capture.js': stub('export const renderPackPhotoCapture = () => ({ root: null, dispose() {} });'),
  'js/orders/ingredient-merge-screen.js': stub('export const buildMergeChooser = () => null; export const runMergeFlow = async () => null;'),
  'js/orders/registry-settings.js': stub('export const buildRegistrySettings = () => null;'),
  'js/orders/suppliers.js': stub('export const dayShort = (d) => d;'),
  'js/supplier-record-form.js': stub('export const buildSupplierForm = () => null;'),
  'js/ingredient-record-form.js': stub('export const buildIngredientForm = () => null;'),
  'js/orders/mgmt-ui.js': stub('export const BACK_ICON = ""; export const mgmtRow = () => null; export const reportFailure = async () => {};'),
  'js/firebase.js': stub(
    'export const firebaseConfig = {}; export const sessionReady = Promise.resolve(); export const onSession = () => {}; export const currentSession = () => ({}); export const app = {}; export const auth = {};'),
  'js/location.js': stub('export const currentLocationId = () => "v1"; export const pathFor = (name) => `locations/v1/${name}`; export const isValidLocationId = () => true;'),
};
// The real watchCollection, a fake Firestore: every name a file asks the SDK for is a function that does
// nothing, except what `globalThis.__fakeFirestore` plays.
globalThis.__fakeFirestore = { getApps: () => [{}], getApp: () => ({}), collection: (_, path) => path };
function fakeSdk(specifier, parentURL) {
  const source = readFileSync(new URL(parentURL), 'utf8');
  const asked = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)]
    .filter(m => m[2] === specifier)
    .flatMap(m => m[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0]).filter(Boolean));
  return stub([...new Set(asked)]
    .map(n => `export const ${n} = (...args) => globalThis.__fakeFirestore?.${n}?.(...args);`).join(' '));
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.includes('gstatic.com')) return { url: fakeSdk(specifier, context.parentURL), shortCircuit: true };
    const resolved = nextResolve(specifier, context);
    const hit = Object.keys(STUBS).find(key => resolved.url.endsWith(`/${key}`));
    return hit ? { url: STUBS[hit], shortCircuit: true } : resolved;
  },
});

const { setLanguage, t } = await import('../js/i18n.js');
const { buildRegistry, listStatus, LIST_STATUS } = await import('../js/orders/registry.js');
before(() => setLanguage('it'));

// ── The screen ───────────────────────────────────────────────────────────────

function screen(status, { ingredients = [], suppliers = [], hash = '' } = {}) {
  globalThis.location = { hash, href: '' };
  const data = {
    suppliers: () => suppliers,
    favouriteSuppliers: () => [],
    ingredients: () => ingredients,
  };
  if (status !== undefined) data.listStatus = status;
  const reg = buildRegistry(data, {});
  const tabs = () => walk(reg.node).filter(n => n.classList.contains('view-switch-btn'));
  return {
    reg,
    text: () => reg.node.children[1].textContent,
    found: (cls) => walk(reg.node.children[1]).some(n => n.classList.contains(cls)),
    openTab: (label) => tabs().find(b => b.textContent === label).listeners.click.forEach(fn => fn({})),
    addButton: () => walk(reg.node.children[1]).find(n => n.classList.contains('empty-action')),
  };
}

const always = (status) => () => status;

test('⚠️ while the listener has not answered the list says it is loading, never that there is nothing', () => {
  const s = screen(always(LIST_STATUS.waiting));
  assert.equal(s.text(), t('orders.loading'));
  assert.ok(!s.found('empty-state'), 'the empty message must wait for the answer');
  assert.ok(!s.addButton(), 'an invitation to add the first ingredient must wait for it too');
});

test('a venue that really has no ingredients still gets the message and its add button', () => {
  const s = screen(always(LIST_STATUS.answered));
  assert.ok(s.text().includes(t('orders.empty.ingredients.title')));
  assert.equal(s.addButton().textContent, t('orders.add.ingredient'));
});

test('the same goes for the other two lists, each asking its own listener', () => {
  const asked = [];
  const s = screen((list) => { asked.push(list); return list === 'suppliers' ? LIST_STATUS.answered : LIST_STATUS.waiting; });
  s.openTab(t('orders.tab.suppliers'));
  assert.equal(asked.at(-1), 'suppliers');
  assert.ok(s.text().includes(t('orders.empty.suppliers.title')));
  s.openTab(t('orders.tab.packaging'));
  assert.equal(asked.at(-1), 'ingredients', 'packaging lives in the ingredients collection');
  assert.equal(s.text(), t('orders.loading'));
});

test('no connection and no copy: the list says so, and offers no add button of its own', () => {
  const s = screen(always(LIST_STATUS.unreachable));
  assert.ok(s.text().includes(t('orders.registry.notArrived.title')));
  assert.ok(s.text().includes(t('orders.registry.notArrived.sub')));
  assert.ok(!s.addButton());
});

test('a dead listener leaves the list blank: the error line above it says so', () => {
  assert.equal(screen(always(LIST_STATUS.failed)).text(), '');
});

test('rows that have arrived are drawn whatever the status says', () => {
  const s = screen(always(LIST_STATUS.waiting), {
    ingredients: [{ id: 'a', name: 'Burro', supplierId: 'S1', unit: 'kg', kind: 'ingredient', active: true, supplierCode: 'X' }],
  });
  assert.ok(s.text().includes('Burro'));
  assert.ok(!s.text().includes(t('orders.loading')));
});

test('an answer that arrives later reaches the screen on its repaint', () => {
  let status = LIST_STATUS.waiting;
  const s = screen(() => status);
  status = LIST_STATUS.answered;
  s.reg.refresh();
  assert.ok(s.text().includes(t('orders.empty.ingredients.title')));
});

// ── What a listener's silence means ──────────────────────────────────────────

const base = { venueOpen: true, loaded: false, failed: false, emptyCopy: false, stalled: false, online: true };

test('⚠️ no venue open yet: no word at all, it would be in the wrong language', () => {
  assert.equal(listStatus({ ...base, venueOpen: false }), LIST_STATUS.starting);
  assert.equal(listStatus({ ...base, venueOpen: false, stalled: true, online: false }), LIST_STATUS.starting,
    'with no session the sign-in gate is what speaks');
  assert.equal(screen(always(LIST_STATUS.starting)).text(), '');
});

test('nothing heard yet is waiting', () => {
  assert.equal(listStatus(base), LIST_STATUS.waiting);
});

test('⚠️ an empty copy while online is still waiting: a venue with no rows gets it a moment before the server', () => {
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

test('a list that has answered stays answered, and a dead listener is told apart', () => {
  assert.equal(listStatus({ ...base, loaded: true, emptyCopy: true, stalled: true, online: false }), LIST_STATUS.answered);
  assert.equal(listStatus({ ...base, failed: true, stalled: true }), LIST_STATUS.failed);
});

// ── The listener: the real watchCollection against a fake SDK ───────────────

const snapshot = (docs, { fromCache, changes = 0 }) => ({
  docs: docs.map(id => ({ id, data: () => ({ name: id }) })),
  empty: docs.length === 0,
  metadata: { fromCache },
  docChanges: () => Array(changes).fill({}),
});

// Opens the listener and returns what the screen was told, and the SDK's voice.
async function listen(options) {
  let answer;
  let opts;
  globalThis.__fakeFirestore.onSnapshot = (ref, second, third) => {
    opts = typeof second === 'function' ? undefined : second;
    answer = typeof second === 'function' ? second : third;
    return () => {};
  };
  const { watchCollection } = await import('../js/orders/firebase-orders.js');
  const told = [];
  await watchCollection('ingredients', (list, fromCache) => told.push({ n: list.length, fromCache }), () => {}, options);
  return { told, answer, opts };
}

test('⚠️ the server confirming an EMPTY copy reaches the screen, or it would wait for ever', async () => {
  const { told, answer, opts } = await listen({ sayFromCache: true });
  assert.equal(opts?.includeMetadataChanges, true,
    'without it the confirmation changes no document and Firestore never calls back');
  answer(snapshot([], { fromCache: true }));
  answer(snapshot([], { fromCache: false }));
  assert.deepEqual(told, [{ n: 0, fromCache: true }, { n: 0, fromCache: false }]);
});

test('⚠️ the server confirming a FULL copy does not: it would rebuild every row to show the same ones', async () => {
  const { told, answer } = await listen({ sayFromCache: true });
  answer(snapshot(['a', 'b'], { fromCache: true, changes: 2 }));
  answer(snapshot(['a', 'b'], { fromCache: false }));
  assert.deepEqual(told, [{ n: 2, fromCache: true }]);
});

test('a real change always reaches the screen, and so do rows after an empty copy', async () => {
  const { told, answer } = await listen({ sayFromCache: true });
  answer(snapshot([], { fromCache: true }));
  answer(snapshot(['a'], { fromCache: false, changes: 1 }));
  answer(snapshot(['a', 'b'], { fromCache: false, changes: 1 }));
  assert.deepEqual(told.map(x => x.n), [0, 1, 2]);
});

test('every other caller of watchCollection keeps the plain listener', async () => {
  const { told, answer, opts } = await listen(undefined);
  assert.equal(opts, undefined);
  answer(snapshot(['a'], { fromCache: true, changes: 1 }));
  assert.deepEqual(told, [{ n: 1, fromCache: undefined }]);
});

// ── The wiring, which only driving the page can execute ─────────────────────

const MAIN = readFileSync(new URL('../js/orders/registry-main.js', import.meta.url), 'utf8');

test('the list repaints when the language arrives, and a list still waiting when the venue opens', () => {
  assert.match(readFileSync(new URL('../js/orders/registry.js', import.meta.url), 'utf8'), /onLanguageChange\(paintList\)/);
  assert.match(MAIN, /onSession\(\(\) => \{\s*watchForStall\(\);\s*(\/\/.*\s*)*if \(!state\.loaded\.ingredients\) screen\.refresh\(\);/);
});

test('registry-main.js tells the screen, and asks for the answer about both lists', () => {
  assert.match(MAIN, /listStatus: \(list\) => listStatus\(/);
  assert.match(MAIN, /watchCollection\(COLLECTIONS\.suppliers,[\s\S]*?liveDataLost\('suppliers'\), \{ sayFromCache: true \}\)/);
  assert.match(MAIN, /watchCollection\(COLLECTIONS\.ingredients,[\s\S]*?liveDataLost\('ingredients'\), \{ sayFromCache: true \}\)/);
});

test('⚠️ `loaded` is set only by an answer that proves it, so the invoice import cannot plan on an empty copy', () => {
  assert.match(MAIN, /state\.emptyCopy\[what\] = list\.length === 0 && fromCache;\s*if \(!state\.emptyCopy\[what\]\) state\.loaded\[what\] = true;/);
  assert.ok(!/state\.loaded\.(ingredients|suppliers) = true/.test(MAIN), 'nothing else may set them');
});

test('⚠️ the wait has an end, counted from the venue opening: no timer and a bad signal says «loading» for ever', () => {
  assert.match(MAIN, /onSession\(\(\) => \{\s*watchForStall\(\);/);
  assert.match(MAIN, /function watchForStall\(\) \{\s*if \(state\.stallWatched \|\| !currentLocationId\(\)\) return;[\s\S]*?setTimeout\(\(\) => \{\s*state\.stalled = true;[\s\S]*?screen\.refresh\(\);[\s\S]*?\}, 10000\);/);
});

test('a dead listener and every fact the status needs reach the screen', () => {
  assert.match(MAIN, /function liveDataLost\(what\) \{[\s\S]*?state\.failed\[what\] = true;\s*screen\.refresh\(\);/);
  assert.match(MAIN, /listStatus: \(list\) => listStatus\(\{\s*venueOpen: Boolean\(currentLocationId\(\)\), loaded: state\.loaded\[list\], failed: state\.failed\[list\], emptyCopy: state\.emptyCopy\[list\],\s*stalled: state\.stalled, online: globalThis\.navigator\?\.onLine,/);
});
