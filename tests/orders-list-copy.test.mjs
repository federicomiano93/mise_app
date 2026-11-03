// tests/orders-list-copy.test.mjs — the local copy of the supplier and ingredient lists that lets
// Orders draw its cards before Firestore answers, and the pins that keep it from ever being typed on.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LIST_COPY_KEY, ACTIVE_LOCATION_KEY, writeListCopy, readListCopy, bothLanded, shouldShowCopy, supplierToOpen,
  mayWriteCopy, activeLocation,
} from '../js/orders/list-copy.js';
import { KEEP_PREFIXES, keysToClear } from '../js/local-data.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
  };
}

const sup = [{ id: 's1', name: 'Cielo' }];
const ing = [{ id: 'i1', name: 'Flour' }];

// Everything mayWriteCopy asks for, answered yes: each test below changes one answer.
const canWrite = {
  loaded: { suppliers: true, ingredients: true },
  serverSeen: { suppliers: true, ingredients: true },
  listFailed: false,
  lid: 'v1',
  activeLocation: 'v1',
};

test('a copy written is read back for the same venue', () => {
  const s = fakeStorage();
  assert.equal(writeListCopy('v1', sup, ing, s), true);
  assert.deepEqual(readListCopy('v1', s), { suppliers: sup, ingredients: ing });
});

test('another venue, nothing stored, bad JSON and a wrong version all read as no copy', () => {
  const s = fakeStorage();
  assert.equal(readListCopy('v1', s), null);
  writeListCopy('v1', sup, ing, s);
  assert.equal(readListCopy('v2', s), null);
  assert.equal(readListCopy('', s), null);
  s.setItem(LIST_COPY_KEY, '{not json');
  assert.equal(readListCopy('v1', s), null);
  s.setItem(LIST_COPY_KEY, JSON.stringify({ v: 2, lid: 'v1', suppliers: sup, ingredients: ing }));
  assert.equal(readListCopy('v1', s), null);
  s.setItem(LIST_COPY_KEY, 'null');
  assert.equal(readListCopy('v1', s), null);
  assert.equal(readListCopy('v1', null), null);
});

test('lists that are not arrays are refused', () => {
  const s = fakeStorage({ [LIST_COPY_KEY]: JSON.stringify({ v: 1, lid: 'v1', suppliers: {}, ingredients: ing }) });
  assert.equal(readListCopy('v1', s), null);
  s.setItem(LIST_COPY_KEY, JSON.stringify({ v: 1, lid: 'v1', suppliers: sup, ingredients: 'x' }));
  assert.equal(readListCopy('v1', s), null);
});

test('items without a string id are dropped, the rest of the copy is kept', () => {
  const s = fakeStorage();
  writeListCopy('v1', [...sup, null, 4, { id: '' }, { id: 7 }, { name: 'no id' }], [{ id: 'i1' }, 'bad'], s);
  assert.deepEqual(readListCopy('v1', s), { suppliers: sup, ingredients: [{ id: 'i1' }] });
});

test('an empty supplier list never paints, even with ingredients', () => {
  const s = fakeStorage();
  writeListCopy('v1', [], ing, s);
  assert.equal(readListCopy('v1', s), null);
  writeListCopy('v1', [{ name: 'no id' }], ing, s);
  assert.equal(readListCopy('v1', s), null);
});

test('a quota error is swallowed and removes the earlier copy', () => {
  const s = fakeStorage();
  writeListCopy('v1', sup, ing, s);
  s.setItem = () => { throw new Error('QuotaExceededError'); };
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    assert.equal(writeListCopy('v1', sup, ing, s), false);
  } finally { console.warn = warn; }
  assert.equal(s.getItem(LIST_COPY_KEY), null);
  assert.equal(warnings.length, 1);
  assert.ok(!warnings[0].includes('Cielo'));
});

test('a value JSON cannot hold is swallowed too', () => {
  const s = fakeStorage();
  const circular = {}; circular.self = circular;
  const warn = console.warn;
  console.warn = () => {};
  try { assert.equal(writeListCopy('v1', [{ id: 'a', name: circular }], ing, s), false); } finally { console.warn = warn; }
  assert.equal(s.getItem(LIST_COPY_KEY), null);
});

test('only what a card reads is stored: no price, no contact, no allergen, no pack list', () => {
  const s = fakeStorage();
  writeListCopy('v1',
    [{ id: 's1', name: 'Cielo', shortName: 'C', category: 'Dairy', deliveryDays: [1], orderDays: [0], active: true, phone: '+39 333', email: 'a@b.c', notes: 'x' }],
    [{ id: 'i1', name: 'Flour', supplierId: 's1', active: true, kind: 'ingredient', pricePerUnit: 9, priceUnit: 'kg', vatRate: 4, packPrice: 3, allergens: ['gluten-wheat'], mayContain: ['soy'], nutrition: { kcal: 1 }, packIngredients: 'wheat', brand: 'B' }],
    s);
  assert.deepEqual(readListCopy('v1', s), {
    suppliers: [{ id: 's1', name: 'Cielo', shortName: 'C', category: 'Dairy', deliveryDays: [1], orderDays: [0], active: true }],
    ingredients: [{ id: 'i1', name: 'Flour', supplierId: 's1', active: true, kind: 'ingredient' }],
  });
});

test('storage that throws on read is no copy', () => {
  const s = { getItem() { throw new Error('blocked'); } };
  assert.equal(readListCopy('v1', s), null);
});

test('the key is wiped by a sign-out or a venue switch', () => {
  assert.ok(!KEEP_PREFIXES.some(prefix => LIST_COPY_KEY.startsWith(prefix)));
  assert.deepEqual(keysToClear([LIST_COPY_KEY, 'firebase:x']), [LIST_COPY_KEY]);
});

test('the copy is shown only before either live list landed, and never for the flat list', () => {
  const none = { suppliers: false, ingredients: false };
  assert.equal(shouldShowCopy({ loaded: none, view: 'suppliers' }), true);
  assert.equal(shouldShowCopy({ loaded: none, view: 'all' }), false);
  assert.equal(shouldShowCopy({ loaded: { suppliers: true, ingredients: false }, view: 'suppliers' }), false);
  assert.equal(shouldShowCopy({ loaded: { suppliers: false, ingredients: true }, view: 'suppliers' }), false);
  assert.equal(shouldShowCopy({ loaded: undefined, view: 'suppliers' }), false);
});

test('both lists must have landed, and a venue must be known, before the copy is written', () => {
  assert.equal(bothLanded({ suppliers: true, ingredients: true }), true);
  assert.equal(bothLanded({ suppliers: true, ingredients: false }), false);
  assert.equal(bothLanded(null), false);
  assert.equal(mayWriteCopy(canWrite), true);
  assert.equal(mayWriteCopy({ ...canWrite, loaded: { suppliers: true, ingredients: false } }), false);
  assert.equal(mayWriteCopy({ ...canWrite, lid: '' }), false);
});

// This phone's own database answers first and can hold a partial or old list: only the server's
// answer may become «the last good one».
test('the copy is not written until the SERVER has answered for both lists', () => {
  assert.equal(mayWriteCopy({ ...canWrite, serverSeen: { suppliers: false, ingredients: false } }), false);
  assert.equal(mayWriteCopy({ ...canWrite, serverSeen: { suppliers: true, ingredients: false } }), false);
  assert.equal(mayWriteCopy({ ...canWrite, serverSeen: { suppliers: false, ingredients: true } }), false);
  assert.equal(mayWriteCopy({ ...canWrite, serverSeen: undefined }), false);
});

test('the copy is not written once a list stream has failed', () => {
  assert.equal(mayWriteCopy({ ...canWrite, listFailed: true }), false);
});

// Another window on this device moved to another venue or signed out: it has wiped this device's
// data, and this page, still running, must not put the old venue's names back.
test('the copy is written only while this device still says this venue is the open one', () => {
  assert.equal(mayWriteCopy({ ...canWrite, activeLocation: 'v2' }), false);
  assert.equal(mayWriteCopy({ ...canWrite, activeLocation: null }), false);
  assert.equal(mayWriteCopy({ ...canWrite, activeLocation: '' }), false);
});

test('activeLocation reads the session\'s own key, and storage that fails is no venue', () => {
  assert.equal(activeLocation(fakeStorage({ 'active-location': 'v1' })), 'v1');
  assert.equal(activeLocation(fakeStorage()), null);
  assert.equal(activeLocation(null), null);
  assert.equal(activeLocation({ getItem() { throw new Error('blocked'); } }), null);
});

// The two files cannot share the constant (js/firebase.js loads the SDK), so they are compared. A
// venue always has the key before a list can land: enterLocation remembers it, then publishes.
test('the key is the session\'s, and the session writes it before a venue counts as open', () => {
  const firebase = read('js/firebase.js');
  assert.ok(firebase.includes(`const ACTIVE_LOCATION_KEY = '${ACTIVE_LOCATION_KEY}';`));
  const enter = firebase.slice(firebase.indexOf('async function enterLocation'));
  assert.ok(enter.indexOf('rememberLocation(locationId);') > 0);
  assert.ok(enter.indexOf('rememberLocation(locationId);') < enter.indexOf('markSessionReady('),
    'without the key the copy would never be written');
  assert.ok(KEEP_PREFIXES.some(prefix => ACTIVE_LOCATION_KEY.startsWith(prefix)),
    'the wipe must leave the key, or a venue switch would stop every later write');
});

test('orders-main: the write asks about the server, a failed stream and the open venue', () => {
  const src = read('js/orders/orders-main.js');
  const body = src.slice(src.indexOf('function scheduleCopyWrite'), src.indexOf('function showListCopy'));
  assert.ok(body.includes('serverSeen: copyServerSeen'));
  assert.ok(body.includes('listFailed: copyListFailed'));
  assert.ok(body.includes('activeLocation: activeLocation()'));
  // A bare mayWriteCopy(...) would still carry all three arguments and write regardless.
  const asked = body.indexOf('if (!mayWriteCopy(');
  assert.ok(asked !== -1, 'the answer must decide');
  const refused = body.indexOf('})) return;', asked);
  assert.ok(refused !== -1, 'a no must leave the timer');
  assert.ok(refused < body.indexOf('writeListCopy(lid'), 'and before the write');
});

test('orders-main: both lists report the server\'s answer, and it arms the write by itself', () => {
  const src = read('js/orders/orders-main.js');
  // A server answer identical to this phone's list changes no document, so no list listener calls
  // back: without this call a phone that is already up to date would never save a copy.
  for (const which of ['suppliers', 'ingredients']) {
    assert.ok(src.includes(`watchCollectionServerAnswer(COLLECTIONS.${which}, () => copyServerAnswered('${which}'));`), which);
  }
  const answered = src.slice(src.indexOf('function copyServerAnswered'), src.indexOf('function scheduleCopyWrite'));
  assert.ok(answered.includes('copyServerSeen[which] = true;'));
  assert.ok(answered.includes('scheduleCopyWrite();'));
  assert.equal(src.split('copyListFailed = true').length - 1, 1);
  assert.ok(src.includes("listLost(liveDataLost(() => t('orders.live.suppliers')))"));
  assert.ok(src.includes("listLost(liveDataLost(() => t('orders.live.ingredients')))"));
});

test('firebase-orders: the server\'s answer is heard, once, on the collection itself', () => {
  const src = read('js/orders/firebase-orders.js');
  const body = src.slice(src.indexOf('export async function watchCollectionServerAnswer'));
  assert.ok(body.slice(0, 500).includes('includeMetadataChanges: true'), 'without it an identical answer never calls back');
  assert.ok(body.slice(0, 500).includes('if (snap.metadata.fromCache) return;'));
  assert.ok(body.slice(0, 500).includes('stop();'));
  assert.ok(!body.slice(0, 500).includes('console.error'), 'one failed stream must not file a second error report');
});

test('the held supplier opens only if it still exists', () => {
  assert.equal(supplierToOpen('s1', id => id === 's1'), 's1');
  assert.equal(supplierToOpen('s1', () => false), null);
  assert.equal(supplierToOpen(null, () => true), null);
  assert.equal(supplierToOpen('', () => true), null);
});

test('orders-main: the copy never touches state.loaded and never stores prices', () => {
  const src = read('js/orders/orders-main.js');
  const body = src.slice(src.indexOf('function showListCopy'), src.indexOf('function showListCopy') + 900);
  assert.ok(body.includes('state.showingCopy = true'));
  assert.ok(!/state\.loaded\.\w+\s*=/.test(body), 'showListCopy must not assign state.loaded');
  assert.ok(/writeListCopy\(lid, state\.suppliers, state\.rawIngredients\)/.test(src));
  assert.ok(!/writeListCopy\([^)]*state\.ingredients\b/.test(src), 'prices must never be stored');
  assert.ok(src.includes('authReady.then(showListCopy)'));
});

test('orders-main: the render gate lets the copy through and draws only the cards', () => {
  const src = read('js/orders/orders-main.js');
  assert.ok(src.includes('if (!(state.loaded.suppliers && state.loaded.ingredients) && !state.showingCopy) return;'));
  const start = src.search(/if \(state\.showingCopy\) \{\s+const copySuppliers/);
  assert.ok(start > 0);
  const block = src.slice(start, src.indexOf('return;', start) + 8);
  assert.ok(block.includes('renderSupplierList(container, copySuppliers)'));
  assert.ok(!block.includes('renderFlatList') && !block.includes('renderIncoming'));
});

test('orders-main: a tap in copy mode is held, and live data opens it after the draw', () => {
  const src = read('js/orders/orders-main.js');
  assert.ok(src.includes('onOpen: openSupplier'));
  // Inside openSupplier itself: a road that calls it directly (the «order today» chips) cannot skip it.
  assert.match(src, /function openSupplier\(supplierId\) \{\s+if \(state\.showingCopy\) \{ holdSupplier\(supplierId\); return; \}/);
  const hold = src.slice(src.indexOf('function holdSupplier'), src.indexOf('function dropHeldSupplier'));
  assert.ok(hold.includes('heldSupplierId = supplierId'));
  assert.ok(src.includes("drawPart('held supplier', openHeldSupplier)"));
  assert.ok(read('orders.css').includes('.supplier-row--waiting'));
});

// The two callers ask for the venue inside a try/catch, so a missing import is a swallowed
// ReferenceError: no copy is ever written or shown, with every other test green. Found by
// driving the app on the tablet.
test('orders-main: the venue id the copy depends on is really imported', () => {
  const src = read('js/orders/orders-main.js');
  assert.match(src, /import \{[^}]*\bcurrentBakery\b[^}]*\} from '\.\/firebase-orders\.js';/);
});

// A copy can be days old: nothing that sends, records or edits may open from it.
test('orders-main: sending, recording and the editors stay shut on the copy', () => {
  const src = read('js/orders/orders-main.js');
  assert.match(src, /function whenLive\(action\) \{\s+return \(\.\.\.args\) => \{\s+if \(state\.showingCopy\) \{ sayWaitForLive\(\); return; \}\s+action\(\.\.\.args\);/);
  for (const wired of [
    'onView: whenLive(openSupplierItems)',
    'onSummary: whenLive(openSummary)',
    "addEventListener('click', whenLive(openRequestList))",
    "addEventListener('click', whenLive(openSendScreen))",
    "addEventListener('click', whenLive(openPlaceAllScreen))",
    "addEventListener('click', whenLive(openManagement))",
    "addEventListener('click', whenLive(openClearScreen))",
    "onClick: whenLive(() => setView(state.view === 'suppliers' ? 'all' : 'suppliers'))",
  ]) assert.ok(src.includes(wired), wired);
  // The ingredient card is the one screen that can overwrite a price: shut in itself too.
  assert.ok(src.includes('if (state.showingCopy || addingIngredient || !mayAddIngredient()) return;'));
});

test('orders-main: the re-order list and the alerts read nothing from the copy', () => {
  const src = read('js/orders/orders-main.js');
  assert.ok(src.includes('const ingredientsById = state.showingCopy ? {} : lensById();'));
  assert.ok(src.includes('if (state.showingCopy && !state.loaded.suppliers) return;'));
});

test('orders-main: a held tap is dropped once they move on', () => {
  const src = read('js/orders/orders-main.js');
  const tabs = src.slice(src.indexOf('function setupTabs'), src.indexOf('function setupTabs') + 600);
  assert.ok(tabs.includes('dropHeldSupplier();'));
  const held = src.slice(src.indexOf('function openHeldSupplier'), src.indexOf('function leaveCopyIfLive'));
  assert.ok(held.includes("dataset.ordersTab !== 'order'"));
  assert.ok(held.includes('aria-expanded'));
  assert.ok(held.includes(".missing-overlay"));
  assert.ok(held.includes('if (id) openSupplier(id);'), 'without it a held tap never opens anything');
  assert.ok(src.includes('onPainted: markWaitingRow'));
  assert.ok(read('js/orders/suppliers.js').includes('ctx.onPainted?.();'));
});

test('orders-main: leaving the copy, for live data or for a lost stream', () => {
  const src = read('js/orders/orders-main.js');
  const leave = src.slice(src.indexOf('function leaveCopyIfLive'), src.indexOf('function leaveCopyForGood'));
  assert.ok(leave.includes('if (!bothLanded(state.loaded)) return;'));
  assert.ok(leave.includes('state.showingCopy = false;'));
  assert.ok(leave.includes('scheduleCopyWrite();'), 'without it no copy is ever saved');
  assert.ok(leave.includes("clearStatusIf(t('orders.copy.wait'));"), 'the «a moment» line has no timer of its own');
  const lost = src.slice(src.indexOf('function liveDataLost'), src.indexOf('function liveDataLost') + 200);
  assert.ok(lost.includes('leaveCopyForGood();'));
  const good = src.slice(src.indexOf('function leaveCopyForGood'), src.indexOf('function scheduleCopyWrite'));
  // With the flag down every door is open again, so the old cards must not stay behind it.
  for (const part of ['state.showingCopy = false', 'heldSupplierId = null', 'state.suppliers = []',
    'state.rawIngredients = []', 'state.ingredients = []', 'dropListViews();', "container.textContent = ''",
    "clearStatusIf(t('orders.copy.wait'));", 'showAlerts();']) {
    assert.ok(good.includes(part), part);
  }
});

test('orders-main: both live listeners leave copy mode', () => {
  const src = read('js/orders/orders-main.js');
  assert.equal(src.split('leaveCopyIfLive();').length - 1, 2);
  for (const [start, end] of [['state.loaded.suppliers = true', 'showAlerts();'], ['state.loaded.ingredients = true', 'checkPendingOnce();']]) {
    const at = src.indexOf(start);
    assert.ok(at > 0 && src.slice(at, src.indexOf(end, at)).includes('leaveCopyIfLive();'), start);
  }
});
