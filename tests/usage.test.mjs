// js/usage.js — the flow with every collaborator replaced; and the placement pins that must
// hold even if the flow is rewritten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createTracker, pageName, storeKey, parseStoreKey, LAST_KEY, SEND_EVERY_MS, SEND_ON_HIDE_MS,
  IDLE_MS, ROUTE_WINDOW_MS, KEEP_DAYS,
} from '../js/usage.js';
import { KEEP_PREFIXES, keysToClear } from '../js/local-data.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

const DEVICE = 'AbCdEfGhIjKlMnOpQrSt';
const READY = { status: 'ready', locationId: 'bakery', user: { uid: 'u1' } };
const MIN = 60 * 1000;

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
    data,
  };
}

function setup(over = {}) {
  const clock = { t: new Date(2026, 9, 9, 10, 0, 0).getTime() };
  const storage = over.storage || memoryStorage();
  const sent = [];
  const state = { visible: true, online: true, session: READY };
  const deps = {
    storage,
    now: () => new Date(clock.t),
    keys: () => Object.keys(storage.data).filter(k => k.startsWith('usage-')),
    visible: () => state.visible,
    online: () => state.online,
    navigationMs: () => 900,
    deviceId: () => DEVICE,
    kind: () => 'phone',
    version: async () => '649',
    currentSession: () => state.session,
    send: async (payload, id) => { sent.push({ payload, id }); },
    ...over.deps,
  };
  const tracker = createTracker(deps);
  return { tracker, clock, storage, sent, state };
}

const todayKey = () => storeKey('bakery', 'u1', '20261009');
const stored = (storage, key = todayKey()) => JSON.parse(storage.data[key]);

test('the page name comes from the file, «index» for the root', () => {
  assert.equal(pageName('/mise_app/orders.html'), 'orders');
  assert.equal(pageName('/mise_app/'), 'index');
  assert.equal(pageName('/'), 'index');
  assert.equal(pageName('/Foo Bar.html'), 'other');
});

test('the storage key round-trips, even for a venue id with hyphens', () => {
  const key = storeKey('loc-e015733e55e7', 'uidABC', '20261009');
  assert.deepEqual(parseStoreKey(key), { lid: 'loc-e015733e55e7', uid: 'uidABC', dayKey: '20261009' });
  assert.equal(parseStoreKey(LAST_KEY), null);
  assert.equal(parseStoreKey('usage-nonsense'), null);
});

test('opening a page counts it; its load time is recorded once, after the page has loaded', () => {
  const { tracker } = setup();
  tracker.begin('orders');
  assert.deepEqual(tracker.pending().screens, { orders: 1 });
  assert.deepEqual(tracker.pending().loads, {}, 'loadEventEnd is not known yet at begin()');
  tracker.recordLoad();
  tracker.recordLoad();
  assert.deepEqual(tracker.pending().loads, { orders: 1 });
  assert.deepEqual(tracker.pending().loadMs, { orders: 900 });
  assert.equal(tracker.current(), 'orders');
});

test('a load time that is not available yet is tried again, not lost', () => {
  let ready = null;
  const { tracker } = setup({ deps: { navigationMs: () => ready } });
  tracker.begin('orders');
  tracker.recordLoad();
  assert.deepEqual(tracker.pending().loads, {});
  ready = 700;
  tracker.recordLoad();
  assert.deepEqual(tracker.pending().loadMs, { orders: 700 });
});

test('a page opened right after another one adds the route; an old or same-page one does not', () => {
  const fresh = setup();
  fresh.storage.setItem(LAST_KEY, JSON.stringify({ screen: 'index', at: fresh.clock.t - 5 * MIN }));
  fresh.tracker.begin('orders');
  assert.deepEqual(fresh.tracker.pending().routes, { 'index>orders': 1 });

  const old = setup();
  old.storage.setItem(LAST_KEY, JSON.stringify({ screen: 'index', at: old.clock.t - ROUTE_WINDOW_MS - 1 }));
  old.tracker.begin('orders');
  assert.deepEqual(old.tracker.pending().routes, {});

  const same = setup();
  same.storage.setItem(LAST_KEY, JSON.stringify({ screen: 'orders', at: same.clock.t - MIN }));
  same.tracker.begin('orders');
  assert.deepEqual(same.tracker.pending().routes, {});

  const junk = setup();
  junk.storage.setItem(LAST_KEY, '{not json');
  junk.tracker.begin('orders');
  assert.deepEqual(junk.tracker.pending().routes, {});
});

test('the last screen is remembered on every change, for the next page', () => {
  const { tracker, storage, clock } = setup();
  tracker.begin('orders');
  tracker.view('orders', 'supplier');
  assert.deepEqual(JSON.parse(storage.data[LAST_KEY]), { screen: 'orders:supplier', at: clock.t });
});

test('a view inside the page is a screen of its own, and the empty view is the page again', () => {
  const { tracker } = setup();
  tracker.begin('orders');
  tracker.view('orders', 'supplier');
  tracker.view('orders', 'supplier');
  tracker.view('orders', '');
  tracker.view('orders', 'history');
  tracker.view('orders', 42);
  tracker.view('orders', 'Bad View');
  const p = tracker.pending();
  assert.deepEqual(p.screens, { orders: 2, 'orders:supplier': 1, 'orders:history': 1 });
  assert.deepEqual(p.routes, { 'orders>orders:supplier': 1, 'orders:supplier>orders': 1, 'orders>orders:history': 1 });
});

test('actions are counted by name; a bad name is ignored', () => {
  const { tracker } = setup();
  tracker.begin('orders');
  tracker.action('order-sent');
  tracker.action('order-sent');
  tracker.action('Bad Name');
  tracker.action(undefined);
  assert.deepEqual(tracker.pending().actions, { 'order-sent': 2 });
});

test('a tap counts for the current screen and records nothing else', () => {
  const { tracker } = setup();
  tracker.begin('orders');
  tracker.tap();
  tracker.view('orders', 'supplier');
  tracker.tap();
  tracker.tap();
  assert.deepEqual(tracker.pending().taps, { orders: 1, 'orders:supplier': 2 });
});

test('active seconds count only while visible and after a recent input', () => {
  const { tracker, clock, state } = setup();
  tracker.begin('orders');
  clock.t += 15000;
  tracker.tick();
  assert.equal(tracker.pending().seconds.orders, 15);
  // Two minutes of nothing: still on screen, but nobody is there.
  clock.t += IDLE_MS + 1000;
  tracker.tick();
  assert.equal(tracker.pending().seconds.orders, 15, 'idle: nothing added');
  tracker.input();
  clock.t += 15000;
  tracker.tick();
  assert.equal(tracker.pending().seconds.orders, 30);
  // Hidden page: nothing, however recent the input.
  state.visible = false;
  tracker.input();
  clock.t += 15000;
  tracker.tick();
  assert.equal(tracker.pending().seconds.orders, 30);
});

test('offline seconds count while the page is visible and the network is down', () => {
  const { tracker, clock, state } = setup();
  tracker.begin('orders');
  state.online = false;
  clock.t += 15000;
  tracker.tick();
  assert.equal(tracker.pending().offlineSeconds, 15);
  state.visible = false;
  clock.t += 15000;
  tracker.tick();
  assert.equal(tracker.pending().offlineSeconds, 15);
});

test('before a venue is open everything waits in memory; once ready it joins the day record', () => {
  const { tracker, storage } = setup();
  tracker.begin('orders');
  tracker.action('order-sent');
  tracker.commit();
  assert.equal(Object.keys(storage.data).filter(k => k !== LAST_KEY).length, 0);
  tracker.setSession(READY);
  const rec = stored(storage);
  assert.equal(rec.dirty, true);
  assert.equal(rec.acc.screens.orders, 1);
  assert.equal(rec.acc.actions['order-sent'], 1);
  assert.deepEqual(tracker.pending().screens, {}, 'memory is emptied once stored');
});

test('later pages add to the same day record instead of replacing it', () => {
  const a = setup();
  a.tracker.begin('orders');
  a.tracker.setSession(READY);
  const b = setup({ storage: a.storage });
  b.tracker.begin('orders');
  b.tracker.setSession(READY);
  assert.equal(stored(a.storage).acc.screens.orders, 2);
});

test('whatever was counted before a person left belongs to them, not to the next one', () => {
  const { tracker, storage } = setup();
  tracker.setSession(READY);
  tracker.begin('orders');
  tracker.setSession({ status: 'signed-out' });
  tracker.action('order-sent');
  tracker.setSession({ status: 'ready', locationId: 'bakery', user: { uid: 'u2' } });
  assert.equal(stored(storage).acc.screens.orders, 1);
  assert.equal(stored(storage).acc.actions['order-sent'], undefined);
  assert.equal(stored(storage, storeKey('bakery', 'u2', '20261009')).acc.actions['order-sent'], 1);
});

test('a flush before ten minutes sends nothing; at ten minutes it sends the whole day', async () => {
  const { tracker, clock, sent } = setup();
  tracker.setSession(READY);
  tracker.begin('orders');
  tracker.setSession(READY);
  clock.t += SEND_EVERY_MS - 1000;
  assert.equal(await tracker.flush('timer'), 'nothing');
  assert.equal(sent.length, 0);
  clock.t += 2000;
  assert.equal(await tracker.flush('timer'), 'sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, `${DEVICE}_20261009_u1`);
  assert.equal(sent[0].payload.dayKey, '20261009');
  assert.equal(sent[0].payload.kind, 'phone');
  assert.equal(sent[0].payload.appVersion, '649');
  assert.equal(sent[0].payload.screens.orders, 1);
  assert.ok(!('uid' in sent[0].payload) && !('bakery' in sent[0].payload), 'the data layer adds those');
});

test('a clean day is not sent again; a change makes it due once ten more minutes pass', async () => {
  const { tracker, clock, sent } = setup();
  tracker.setSession(READY);
  tracker.begin('orders');
  tracker.setSession(READY);
  clock.t += SEND_EVERY_MS + 1000;
  await tracker.flush('timer');
  clock.t += SEND_EVERY_MS + 1000;
  assert.equal(await tracker.flush('timer'), 'nothing', 'nothing changed');
  tracker.action('order-sent');
  assert.equal(await tracker.flush('timer'), 'sent');
  assert.equal(sent.length, 2);
  assert.equal(sent[1].payload.actions['order-sent'], 1);
  tracker.action('order-sent');
  clock.t += MIN;
  assert.equal(await tracker.flush('timer'), 'nothing', 'one minute after the last send is too soon');
});

test('hiding the page sends after three minutes, not before', async () => {
  const { tracker, clock, sent } = setup();
  tracker.setSession(READY);
  tracker.begin('orders');
  tracker.setSession(READY);
  clock.t += SEND_ON_HIDE_MS - 1000;
  assert.equal(await tracker.flush('hidden'), 'nothing');
  clock.t += 2000;
  assert.equal(await tracker.flush('hidden'), 'sent');
  assert.equal(sent.length, 1);
});

test('⚠️ a send that never settles leaves the record dirty; it is tried again only after ten more minutes', async () => {
  const { tracker, clock, sent, storage } = setup({
    deps: { send: () => new Promise(() => {}) },
  });
  tracker.setSession(READY);
  tracker.begin('orders');
  tracker.setSession(READY);
  clock.t += SEND_EVERY_MS + 1000;
  assert.equal(await tracker.flush('timer'), 'sent');
  assert.equal(stored(storage).dirty, true, 'nothing answered, so nothing is confirmed');
  assert.equal(stored(storage).lastSentAt, clock.t, 'lastSentAt is the time of the attempt');
  assert.equal(await tracker.flush('timer'), 'nothing');
  clock.t += SEND_EVERY_MS + 1000;
  assert.equal(await tracker.flush('timer'), 'sent');
  assert.equal(sent.length, 0);
});

test('⚠️ the record is clean only once the server answered', async () => {
  let answer;
  const { tracker, clock, storage } = setup({
    deps: { send: () => new Promise(resolve => { answer = resolve; }) },
  });
  tracker.setSession(READY);
  tracker.begin('orders');
  tracker.setSession(READY);
  clock.t += SEND_EVERY_MS + 1000;
  await tracker.flush('timer');
  assert.equal(stored(storage).dirty, true);
  answer();
  await new Promise(r => setImmediate(r));
  assert.equal(stored(storage).dirty, false);
});

test('⚠️ an answer for an older version does not clean what was added meanwhile', async () => {
  let answer;
  const { tracker, clock, storage } = setup({
    deps: { send: () => new Promise(resolve => { answer = resolve; }) },
  });
  tracker.setSession(READY);
  tracker.begin('orders');
  tracker.setSession(READY);
  const before = stored(storage).rev;
  clock.t += SEND_EVERY_MS + 1000;
  await tracker.flush('timer');
  tracker.action('order-sent');
  tracker.commit();
  assert.equal(stored(storage).rev, before + 1);
  answer();
  await new Promise(r => setImmediate(r));
  assert.equal(stored(storage).dirty, true);
  assert.equal(stored(storage).acc.actions['order-sent'], 1);
});

test('⚠️ on hide the write is handed over at once, with nothing awaited, and only for today', async () => {
  const storage = memoryStorage();
  const old = storeKey('bakery', 'u1', '20261008');
  storage.setItem(old, JSON.stringify({ acc: { screens: { orders: 3 } }, dirty: true, lastSentAt: 0, rev: 1 }));
  const { tracker, clock, sent } = setup({ storage });
  tracker.setSession(READY);
  await new Promise(r => setImmediate(r));
  tracker.begin('orders');
  tracker.setSession(READY);
  clock.t += SEND_ON_HIDE_MS + 1000;
  const pending = tracker.flush('hidden');
  await Promise.resolve();
  assert.equal(sent.length, 1, 'handed over before the first await finished');
  assert.equal(sent[0].payload.dayKey, '20261009');
  assert.equal(sent[0].payload.appVersion, '649', 'the release cached in memory');
  await pending;
  assert.equal(old in storage.data, true, 'a past day waits for a load or a timer check');
  assert.equal(JSON.parse(storage.data[old]).dirty, true);
});

test('the timer check sends a past day too, and deletes it only after the answer', async () => {
  const storage = memoryStorage();
  const old = storeKey('bakery', 'u1', '20261008');
  storage.setItem(old, JSON.stringify({ acc: { screens: { orders: 3 } }, dirty: true, lastSentAt: 0, rev: 1 }));
  let answer;
  const { tracker, sent } = setup({ storage, deps: { send: (payload, id) => { sent2.push(id); return new Promise(r => { answer = r; }); } } });
  const sent2 = [];
  void sent;
  tracker.setSession(READY);
  assert.equal(await tracker.flush('timer'), 'sent');
  assert.equal(sent2[0], `${DEVICE}_20261008_u1`);
  assert.equal(old in storage.data, true, 'not deleted at the handover');
  answer();
  await new Promise(r => setImmediate(r));
  assert.equal(old in storage.data, false);
});

test('counts made before midnight are filed under the day they were made', () => {
  const { tracker, clock, storage } = setup();
  tracker.setSession(READY);
  clock.t = new Date(2026, 9, 9, 23, 59, 50).getTime();
  tracker.begin('orders');
  tracker.action('order-sent');
  clock.t = new Date(2026, 9, 10, 0, 0, 5).getTime();
  tracker.input();
  tracker.tick();
  assert.equal(stored(storage, storeKey('bakery', 'u1', '20261009')).acc.actions['order-sent'], 1);
  assert.equal(stored(storage, storeKey('bakery', 'u1', '20261009')).acc.screens.orders, 1);
  assert.equal(storeKey('bakery', 'u1', '20261010') in storage.data, true);
  assert.equal(stored(storage, storeKey('bakery', 'u1', '20261010')).acc.actions['order-sent'], undefined);
});

test('a passing failure makes the day dirty again; a refusal by the rules does not', async () => {
  const transient = setup({ deps: { send: async () => { throw Object.assign(new Error('x'), { code: 'unavailable' }); } } });
  transient.tracker.setSession(READY);
  transient.tracker.begin('orders');
  transient.tracker.setSession(READY);
  transient.clock.t += SEND_EVERY_MS + 1000;
  await transient.tracker.flush('timer');
  await new Promise(r => setImmediate(r));
  assert.equal(stored(transient.storage).dirty, true);

  const refused = setup({ deps: { send: async () => { throw Object.assign(new Error('x'), { code: 'permission-denied' }); } } });
  refused.tracker.setSession(READY);
  refused.tracker.begin('orders');
  refused.tracker.setSession(READY);
  refused.clock.t += SEND_EVERY_MS + 1000;
  await refused.tracker.flush('timer');
  await new Promise(r => setImmediate(r));
  assert.equal(stored(refused.storage).dirty, false, 'retrying would only repeat the refusal');
});

test('a failure of the send function itself is a console line, never a throw', async () => {
  const warns = [];
  const original = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    const { tracker, clock } = setup({ deps: { send: () => { throw Object.assign(new Error('boom'), { code: 'internal' }); } } });
    tracker.setSession(READY);
    tracker.begin('orders');
    tracker.setSession(READY);
    clock.t += SEND_EVERY_MS + 1000;
    await tracker.flush('timer');
    await new Promise(r => setImmediate(r));
  } finally {
    console.warn = original;
  }
  assert.ok(warns.some(w => /Usage not sent: internal/.test(w)));
  assert.ok(warns.every(w => !/boom/.test(w)), 'only the code is logged');
});

test('⚠️ nothing is sent for somebody who is no longer signed in', async () => {
  const { tracker, clock, sent, state } = setup();
  tracker.setSession(READY);
  tracker.begin('orders');
  tracker.setSession(READY);
  clock.t += SEND_EVERY_MS + 1000;
  state.session = { status: 'ready', locationId: 'bakery', user: { uid: 'u2' } };
  assert.equal(await tracker.flush('timer'), 'skipped');
  state.session = { status: 'signed-out' };
  assert.equal(await tracker.flush('timer'), 'skipped');
  assert.equal(sent.length, 0);
});

test('without a device id nothing is sent', async () => {
  const { tracker, clock, sent } = setup({ deps: { deviceId: () => null } });
  tracker.setSession(READY);
  tracker.begin('orders');
  tracker.setSession(READY);
  clock.t += SEND_EVERY_MS + 1000;
  assert.equal(await tracker.flush('timer'), 'no-device');
  assert.equal(sent.length, 0);
});

test('without storage nothing is kept and nothing is sent', async () => {
  const { tracker, sent } = setup({ deps: { storage: null } });
  tracker.begin('orders');
  tracker.setSession(READY);
  assert.equal(await tracker.flush('timer'), 'skipped');
  assert.equal(sent.length, 0);
});

test('a storage that throws never breaks a page', async () => {
  const broken = {
    getItem: () => { throw new Error('no'); },
    setItem: () => { throw new Error('no'); },
    removeItem: () => { throw new Error('no'); },
  };
  const { tracker } = setup({ deps: { storage: broken, keys: () => [] } });
  assert.doesNotThrow(() => {
    tracker.begin('orders');
    tracker.tick();
    tracker.setSession(READY);
    tracker.commit();
    tracker.prune();
  });
  assert.equal(await tracker.flush('timer'), 'nothing');
});

test('a past day still dirty is sent at once, and its record is deleted when handed over', async () => {
  const storage = memoryStorage();
  const old = storeKey('bakery', 'u1', '20261008');
  storage.setItem(old, JSON.stringify({ acc: { screens: { orders: 3 } }, dirty: true, lastSentAt: 0 }));
  const { tracker, sent } = setup({ storage });
  tracker.setSession(READY);
  assert.equal(await tracker.flush('load'), 'sent');
  assert.equal(sent[0].id, `${DEVICE}_20261008_u1`);
  assert.equal(sent[0].payload.dayKey, '20261008');
  assert.equal(sent[0].payload.screens.orders, 3);
  assert.equal(old in storage.data, false);
});

test('a past day that was already sent is simply deleted; another person\'s past day is left alone', async () => {
  const storage = memoryStorage();
  const sentDay = storeKey('bakery', 'u1', '20261007');
  const other = storeKey('bakery', 'u2', '20261007');
  storage.setItem(sentDay, JSON.stringify({ acc: {}, dirty: false, lastSentAt: 1 }));
  storage.setItem(other, JSON.stringify({ acc: { screens: { orders: 1 } }, dirty: true, lastSentAt: 0 }));
  const { tracker, sent } = setup({ storage });
  tracker.setSession(READY);
  await tracker.flush('load');
  assert.equal(sentDay in storage.data, false);
  assert.equal(other in storage.data, true);
  assert.equal(sent.length, 0);
});

test('a past day that fails passingly is put back for the next try', async () => {
  const storage = memoryStorage();
  const old = storeKey('bakery', 'u1', '20261008');
  storage.setItem(old, JSON.stringify({ acc: { screens: { orders: 3 } }, dirty: true, lastSentAt: 0 }));
  const { tracker } = setup({
    storage,
    deps: { send: async () => { throw Object.assign(new Error('x'), { code: 'unavailable' }); } },
  });
  tracker.setSession(READY);
  await tracker.flush('load');
  await new Promise(r => setImmediate(r));
  assert.equal(JSON.parse(storage.data[old]).dirty, true);
  assert.equal(JSON.parse(storage.data[old]).acc.screens.orders, 3);
});

test('only a week of days is kept, whoever they belong to; the last-screen key stays', () => {
  const storage = memoryStorage();
  const fresh = storeKey('bakery', 'u2', '20261005');
  const stale = storeKey('bakery', 'u2', '20261001');
  storage.setItem(fresh, '{}');
  storage.setItem(stale, '{}');
  storage.setItem(LAST_KEY, '{}');
  const { tracker } = setup({ storage });
  tracker.prune();
  assert.equal(fresh in storage.data, true);
  assert.equal(stale in storage.data, false);
  assert.equal(LAST_KEY in storage.data, true);
  assert.equal(KEEP_DAYS, 7);
});

test('a damaged record in storage is made safe before it can reach the rules', async () => {
  const storage = memoryStorage();
  storage.setItem(todayKey(), JSON.stringify({
    acc: { screens: { 'BAD NAME': 4, orders: 'x', ok: 2 }, firstMinute: 99999 }, dirty: true, lastSentAt: 0,
  }));
  const { tracker, clock, sent } = setup({ storage });
  tracker.setSession(READY);
  clock.t += SEND_EVERY_MS + 1000;
  await tracker.flush('timer');
  assert.deepEqual(sent[0].payload.screens, { ok: 2 });
  assert.ok(!('firstMinute' in sent[0].payload));
});

// ── Placement pins ───────────────────────────────────────────────────────────

const code = rel => read(rel).split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n');

test('the staff door starts it; the client ordering page and the password page do not', () => {
  assert.match(read('js/auth-gate.js'), /^import '\.\/usage\.js';$/m);
  for (const page of ['order.html', 'reset-password.html']) {
    const html = read(page).replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!/usage/.test(html), `${page} must not load usage`);
    assert.ok(!/auth-gate\.js/.test(html), `${page} must not load the gate`);
  }
});

test('it starts itself at load, wired to the session, and sends through saveUsage', () => {
  const src = code('js/usage.js');
  assert.match(src, /if \(typeof window !== 'undefined' && typeof document !== 'undefined'\) start\(\);/);
  const fn = src.slice(src.indexOf('function start()'), src.indexOf("if (typeof window"));
  assert.match(fn, /tracker\.begin\(page\)/);
  assert.match(fn, /onSession\(/);
  assert.match(fn, /tracker\.setSession\(session\)/);
  assert.match(fn, /setTimeout\(/);
  assert.match(fn, /sameSession\(session, currentSession\(\)\)/);
  assert.match(fn, /tracker\.flush\('load'\)/);
  assert.match(fn, /pointerdown/);
  assert.match(fn, /'mise:screen'/);
  assert.match(fn, /'mise:action'/);
  assert.match(fn, /visibilitychange/);
  assert.match(fn, /pagehide/);
  assert.match(fn, /setInterval\(\(\) => tracker\.tick\(\), TICK_MS\)/);
  assert.match(fn, /setInterval\(\(\) => tracker\.flush\('timer'\), FLUSH_CHECK_MS\)/);
  assert.match(fn, /addEventListener\('load', noteLoad/);
  assert.match(fn, /recordLoad\(\)/);
  assert.match(src, /m\.saveUsage\(payload, id\)/);
  assert.match(src, /import\('\.\/firebase\.js'\)/);
  assert.ok(!/^import .*firebase\.js/m.test(src), 'firebase.js is loaded at run time, so tests can read this file');
});

test('start() cannot throw: its whole body is in a try, because the gate imports it statically', () => {
  const src = code('js/usage.js');
  const fn = src.slice(src.indexOf('function start()'), src.indexOf("if (typeof window"));
  assert.match(fn, /^function start\(\) \{\s*try \{/);
  assert.match(fn, /\} catch \(err\) \{\s*try \{ console\.warn\('Usage not started:'/);
});

test('it never reads what was tapped, only which screen it was on', () => {
  const src = code('js/usage.js');
  assert.ok(!/event\.target|\.target\b|innerText|textContent|\.value\b/.test(src));
});

test('the keys survive a sign-out and a venue switch', () => {
  assert.ok(KEEP_PREFIXES.includes('usage-'));
  assert.deepEqual(keysToClear([storeKey('bakery', 'u1', '20261009'), LAST_KEY, 'recipes-cache']), ['recipes-cache']);
});

test('saveUsage writes the whole line under the signed-in uid with the server clock, here and in the example', () => {
  const firebase = read('js/firebase.js');
  const start = firebase.indexOf('export function saveUsage');
  const fn = firebase.slice(start, firebase.indexOf('\n}\n', start));
  assert.match(fn, /doc\(db, pathFor\('usage'\), id\)/);
  assert.match(fn, /\.\.\.payload,\s*bakery: currentLocationId\(\),\s*uid: auth\.currentUser\.uid,\s*updatedAt: serverTimestamp\(\)/);
  assert.match(fn, /code: 'unauthenticated'/);
  assert.ok(!/merge/.test(fn));
  const example = read('js/firebase.example.js');
  assert.match(example, /export function saveUsage\(payload, id\)/);
  const estart = example.indexOf('export function saveUsage');
  assert.equal(example.slice(estart, example.indexOf('\n}\n', estart)), fn);
});

test('both files are precached', () => {
  const sw = read('sw.js');
  assert.match(sw, /'\.\/js\/usage\.js'/);
  assert.match(sw, /'\.\/js\/usage-model\.js'/);
});
