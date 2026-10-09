// js/usage-model.js — the pure half of the usage record: the accumulator, its caps, the id and
// the exact line the rules accept (firestore.rules, match /usage/{id}).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  newAcc, mergeAcc, cleanAcc, isEmptyAcc, addScreen, addRoute, addSeconds, addTap, addAction,
  addLoad, addOffline, touchMinute, dayKeyOf, docId, payloadOf, CAPS, OTHER,
} from '../js/usage-model.js';

const DEVICE = 'AbCdEfGhIjKlMnOpQrSt';
const WHO = { deviceId: DEVICE, dayKey: '20261009', kind: 'phone', appVersion: '649' };

test('a screen is counted by its name; names the rules would not like are ignored', () => {
  const acc = newAcc();
  addScreen(acc, 'orders');
  addScreen(acc, 'orders');
  addScreen(acc, 'orders:supplier');
  addScreen(acc, 'Orders');
  addScreen(acc, '');
  addScreen(acc, 'a'.repeat(41));
  addScreen(acc, 'has space');
  addScreen(acc, 42);
  assert.deepEqual(acc.screens, { orders: 2, 'orders:supplier': 1 });
});

test('a route needs two different, named screens', () => {
  const acc = newAcc();
  addRoute(acc, 'index', 'orders');
  addRoute(acc, 'index', 'orders');
  addRoute(acc, 'orders', 'orders');
  addRoute(acc, '', 'orders');
  addRoute(acc, 'orders', '');
  addRoute(acc, 'Bad Name', 'orders');
  assert.deepEqual(acc.routes, { 'index>orders': 2 });
});

test('seconds and taps go to a screen; seconds are whole and never negative or NaN', () => {
  const acc = newAcc();
  addSeconds(acc, 'orders', 15);
  addSeconds(acc, 'orders', 14.6);
  addSeconds(acc, 'orders', -5);
  addSeconds(acc, 'orders', NaN);
  addSeconds(acc, 'bad name', 9);
  addTap(acc, 'orders');
  addTap(acc, 'orders');
  addTap(acc, 'bad name');
  assert.deepEqual(acc.seconds, { orders: 30 });
  assert.deepEqual(acc.taps, { orders: 2 });
});

test('an action name is lower-case words with hyphens, 40 characters at most', () => {
  const acc = newAcc();
  addAction(acc, 'order-sent');
  addAction(acc, 'order-sent');
  addAction(acc, 'Order-Sent');
  addAction(acc, '1st');
  addAction(acc, 'has space');
  addAction(acc, 'a'.repeat(41));
  addAction(acc, 'a'.repeat(40));
  assert.deepEqual(acc.actions, { 'order-sent': 2, ['a'.repeat(40)]: 1 });
});

test('a load time is clamped to 0..60000 ms and counted once per call', () => {
  const acc = newAcc();
  addLoad(acc, 'orders', 1200.4);
  addLoad(acc, 'orders', 999999);
  addLoad(acc, 'orders', -50);
  addLoad(acc, 'orders', NaN);
  assert.equal(acc.loads.orders, 4);
  assert.equal(acc.loadMs.orders, 1200 + 60000);
});

test('offline seconds add up and stop at a day', () => {
  const acc = newAcc();
  addOffline(acc, 30.4);
  addOffline(acc, -1);
  assert.equal(acc.offlineSeconds, 30);
  addOffline(acc, 999999);
  assert.equal(acc.offlineSeconds, 86400);
});

test('first and last minute are local minutes of the day', () => {
  const acc = newAcc();
  touchMinute(acc, new Date(2026, 9, 9, 10, 30));
  touchMinute(acc, new Date(2026, 9, 9, 7, 5));
  touchMinute(acc, new Date(2026, 9, 9, 23, 59));
  touchMinute(acc, new Date('nope'));
  touchMinute(acc, null);
  assert.equal(acc.firstMinute, 7 * 60 + 5);
  assert.equal(acc.lastMinute, 23 * 60 + 59);
});

test('the day key and the document id have the shape the rules ask for', () => {
  assert.equal(dayKeyOf(new Date(2026, 0, 5, 23, 59)), '20260105');
  assert.equal(docId(DEVICE, '20261009', 'u1'), `${DEVICE}_20261009_u1`);
  assert.equal(docId('short', '20261009', 'u1'), null);
  assert.equal(docId(DEVICE, '2026-10-09', 'u1'), null);
  assert.equal(docId(DEVICE, '20261009', ''), null);
  assert.equal(docId(DEVICE, '20261009', 'a/b'), null);
});

test('⚠️ a full map sends new keys to one «other» key and never passes its cap', () => {
  const acc = newAcc();
  for (let i = 0; i < 500; i += 1) addRoute(acc, `s${i}`, `t${i}`);
  assert.equal(Object.keys(acc.routes).length, CAPS.routes);
  assert.equal(acc.routes[OTHER], 500 - (CAPS.routes - 1));
  // A key already there still counts on its own.
  addRoute(acc, 's0', 't0');
  assert.equal(acc.routes['s0>t0'], 2);
  for (let i = 0; i < 200; i += 1) addScreen(acc, `p${i}`);
  assert.equal(Object.keys(acc.screens).length, CAPS.screens);
  for (let i = 0; i < 60; i += 1) addAction(acc, `act-${i}`);
  assert.equal(Object.keys(acc.actions).length, CAPS.actions);
  for (let i = 0; i < 40; i += 1) addLoad(acc, `pg${i}`, 100);
  assert.equal(Object.keys(acc.loads).length, CAPS.loads);
  assert.equal(Object.keys(acc.loadMs).length, CAPS.loadMs);
});

test('merging adds the counts, widens the minutes, and drops anything unsafe from storage', () => {
  const base = newAcc();
  addScreen(base, 'orders');
  addRoute(base, 'index', 'orders');
  touchMinute(base, new Date(2026, 9, 9, 9, 0));
  const extra = newAcc();
  addScreen(extra, 'orders');
  addScreen(extra, 'index');
  touchMinute(extra, new Date(2026, 9, 9, 8, 0));
  touchMinute(extra, new Date(2026, 9, 9, 17, 0));
  addOffline(extra, 20);
  mergeAcc(base, extra);
  assert.deepEqual(base.screens, { orders: 2, index: 1 });
  assert.equal(base.firstMinute, 480);
  assert.equal(base.lastMinute, 1020);
  assert.equal(base.offlineSeconds, 20);

  const dirty = cleanAcc({
    screens: { ok: 3, 'BAD KEY': 5, neg: -2, nan: 'x', frac: 2.6 },
    routes: { 'a>b': 1, nothing: 4, other: 2 },
    actions: { 'good-one': 1, Bad: 2 },
    firstMinute: 1440, lastMinute: -3, offlineSeconds: 'lots',
    extra: { whatever: 1 },
  });
  assert.deepEqual(dirty.screens, { ok: 3, frac: 3 });
  assert.deepEqual(dirty.routes, { 'a>b': 1, other: 2 });
  assert.deepEqual(dirty.actions, { 'good-one': 1 });
  assert.equal(dirty.firstMinute, null);
  assert.equal(dirty.lastMinute, null);
  assert.equal(dirty.offlineSeconds, 0);
  assert.equal(isEmptyAcc(cleanAcc(null)), true);
  assert.equal(isEmptyAcc(cleanAcc('junk')), true);
  assert.equal(isEmptyAcc(base), false);
});

test('the line has only keys the rules allow, whole numbers, and none of the data layer\'s own', () => {
  const acc = newAcc();
  addScreen(acc, 'orders');
  addRoute(acc, 'index', 'orders');
  addSeconds(acc, 'orders', 45);
  addTap(acc, 'orders');
  addAction(acc, 'order-sent');
  addLoad(acc, 'orders', 800);
  touchMinute(acc, new Date(2026, 9, 9, 9, 30));
  const p = payloadOf(acc, WHO);
  const allowed = ['bakery', 'uid', 'deviceId', 'dayKey', 'kind', 'appVersion', 'screens', 'seconds', 'taps',
    'routes', 'actions', 'loads', 'loadMs', 'firstMinute', 'lastMinute', 'offlineSeconds', 'updatedAt'];
  for (const key of Object.keys(p)) assert.ok(allowed.includes(key), `${key} is not in the rules' whitelist`);
  for (const key of ['bakery', 'uid', 'updatedAt']) assert.ok(!(key in p), `${key} is the data layer's`);
  for (const key of ['deviceId', 'dayKey', 'kind']) assert.ok(key in p);
  assert.equal(p.firstMinute, 570);
  assert.equal(p.lastMinute, 570);
  assert.equal(p.offlineSeconds, 0);
  assert.equal(p.appVersion, '649');
  assert.equal(Number.isInteger(p.loadMs.orders), true);
});

test('an empty day still makes a valid line, with no minutes', () => {
  const p = payloadOf(newAcc(), WHO);
  assert.ok(p);
  assert.ok(!('firstMinute' in p) && !('lastMinute' in p));
  assert.deepEqual(p.screens, {});
});

test('a line the rules would refuse is not made: bad device id, day or kind', () => {
  assert.equal(payloadOf(newAcc(), { ...WHO, deviceId: 'x' }), null);
  assert.equal(payloadOf(newAcc(), { ...WHO, dayKey: '2026-10-09' }), null);
  assert.equal(payloadOf(newAcc(), { ...WHO, kind: 'watch' }), null);
  assert.equal(payloadOf(null, WHO), null);
});

test('the version is null when missing or longer than 12 characters', () => {
  assert.equal(payloadOf(newAcc(), { ...WHO, appVersion: null }).appVersion, null);
  assert.equal(payloadOf(newAcc(), { ...WHO, appVersion: '1234567890123' }).appVersion, null);
  assert.equal(payloadOf(newAcc(), { ...WHO, appVersion: '' }).appVersion, null);
});

test('the module imports nothing (the tests and the owner script run it without a browser)', () => {
  const src = readFileSync(new URL('../js/usage-model.js', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\s/m.test(src));
});
