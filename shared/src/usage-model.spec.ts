// Unit tests for the usage record (P15), run against BOTH implementations: the TypeScript port in
// shared/ and the js/ file the live app uses today. Ported from tests/usage-model.test.mjs; the
// two must stay equal until the switch to Mise 2.
//
// The pure half of the usage record: the accumulator, its caps, the id and the exact line the
// rules accept (firestore.rules, match /usage/{id}). The test that the module imports nothing is
// NOT ported: it reads the source file as text, and this package has no file access.

import { describe, expect, test, vi } from 'vitest';
import * as ported from './usage-model';
import * as legacyJs from '../../js/usage-model.js';

const legacy = legacyJs as unknown as typeof ported;

const DEVICE = 'AbCdEfGhIjKlMnOpQrSt';
const WHO = { deviceId: DEVICE, dayKey: '20261009', kind: 'phone', appVersion: '649' };

// A result that may be null, asserted present and handed back typed.
function made<T>(value: T | null): T {
  expect(value).not.toBeNull();
  return value as T;
}

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('a screen is counted by its name; names the rules would not like are ignored', () => {
    const acc = m.newAcc();
    m.addScreen(acc, 'orders');
    m.addScreen(acc, 'orders');
    m.addScreen(acc, 'orders:supplier');
    m.addScreen(acc, 'Orders');
    m.addScreen(acc, '');
    m.addScreen(acc, 'a'.repeat(41));
    m.addScreen(acc, 'has space');
    m.addScreen(acc, 42);
    expect(acc.screens).toStrictEqual({ orders: 2, 'orders:supplier': 1 });
  });

  test('a route needs two different, named screens', () => {
    const acc = m.newAcc();
    m.addRoute(acc, 'index', 'orders');
    m.addRoute(acc, 'index', 'orders');
    m.addRoute(acc, 'orders', 'orders');
    m.addRoute(acc, '', 'orders');
    m.addRoute(acc, 'orders', '');
    m.addRoute(acc, 'Bad Name', 'orders');
    expect(acc.routes).toStrictEqual({ 'index>orders': 2 });
  });

  test('seconds and taps go to a screen; seconds are whole and never negative or NaN', () => {
    const acc = m.newAcc();
    m.addSeconds(acc, 'orders', 15);
    m.addSeconds(acc, 'orders', 14.6);
    m.addSeconds(acc, 'orders', -5);
    m.addSeconds(acc, 'orders', NaN);
    m.addSeconds(acc, 'bad name', 9);
    m.addTap(acc, 'orders');
    m.addTap(acc, 'orders');
    m.addTap(acc, 'bad name');
    expect(acc.seconds).toStrictEqual({ orders: 30 });
    expect(acc.taps).toStrictEqual({ orders: 2 });
  });

  test('an action name is lower-case words with hyphens, 40 characters at most', () => {
    const acc = m.newAcc();
    m.addAction(acc, 'order-sent');
    m.addAction(acc, 'order-sent');
    m.addAction(acc, 'Order-Sent');
    m.addAction(acc, '1st');
    m.addAction(acc, 'has space');
    m.addAction(acc, 'a'.repeat(41));
    m.addAction(acc, 'a'.repeat(40));
    expect(acc.actions).toStrictEqual({ 'order-sent': 2, ['a'.repeat(40)]: 1 });
  });

  test('a load time is clamped to 0..60000 ms and counted once per call', () => {
    const acc = m.newAcc();
    m.addLoad(acc, 'orders', 1200.4);
    m.addLoad(acc, 'orders', 999999);
    m.addLoad(acc, 'orders', -50);
    m.addLoad(acc, 'orders', NaN);
    expect(acc.loads.orders).toBe(4);
    expect(acc.loadMs.orders).toBe(1200 + 60000);
  });

  test('offline seconds add up and stop at a day', () => {
    const acc = m.newAcc();
    m.addOffline(acc, 30.4);
    m.addOffline(acc, -1);
    expect(acc.offlineSeconds).toBe(30);
    m.addOffline(acc, 999999);
    expect(acc.offlineSeconds).toBe(86400);
  });

  test('first and last minute are local minutes of the day', () => {
    const acc = m.newAcc();
    m.touchMinute(acc, new Date(2026, 9, 9, 10, 30));
    m.touchMinute(acc, new Date(2026, 9, 9, 7, 5));
    m.touchMinute(acc, new Date(2026, 9, 9, 23, 59));
    m.touchMinute(acc, new Date('nope'));
    m.touchMinute(acc, null);
    expect(acc.firstMinute).toBe(7 * 60 + 5);
    expect(acc.lastMinute).toBe(23 * 60 + 59);
  });

  test('the day key and the document id have the shape the rules ask for', () => {
    expect(m.dayKeyOf(new Date(2026, 0, 5, 23, 59))).toBe('20260105');
    expect(m.docId(DEVICE, '20261009', 'u1')).toBe(`${DEVICE}_20261009_u1`);
    expect(m.docId('short', '20261009', 'u1')).toBe(null);
    expect(m.docId(DEVICE, '2026-10-09', 'u1')).toBe(null);
    expect(m.docId(DEVICE, '20261009', '')).toBe(null);
    expect(m.docId(DEVICE, '20261009', 'a/b')).toBe(null);
  });

  // Added: the default is the clock. Tried with a fixed one a minute before midnight, so a day key
  // taken from UTC instead of local time (or from yesterday) would show.
  test('with no date the day key is today, by the local clock', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 9, 9, 23, 59, 30));
      expect(m.dayKeyOf()).toBe('20261009');
    } finally {
      vi.useRealTimers();
    }
  });

  test('⚠️ a full map sends new keys to one «other» key and never passes its cap', () => {
    const acc = m.newAcc();
    for (let i = 0; i < 500; i += 1) m.addRoute(acc, `s${i}`, `t${i}`);
    expect(Object.keys(acc.routes).length).toBe(m.CAPS.routes);
    expect(acc.routes[m.OTHER]).toBe(500 - (m.CAPS.routes - 1));
    // A key already there still counts on its own.
    m.addRoute(acc, 's0', 't0');
    expect(acc.routes['s0>t0']).toBe(2);
    for (let i = 0; i < 200; i += 1) m.addScreen(acc, `p${i}`);
    expect(Object.keys(acc.screens).length).toBe(m.CAPS.screens);
    for (let i = 0; i < 60; i += 1) m.addAction(acc, `act-${i}`);
    expect(Object.keys(acc.actions).length).toBe(m.CAPS.actions);
    for (let i = 0; i < 40; i += 1) m.addLoad(acc, `pg${i}`, 100);
    expect(Object.keys(acc.loads).length).toBe(m.CAPS.loads);
    expect(Object.keys(acc.loadMs).length).toBe(m.CAPS.loadMs);
  });

  test('merging adds the counts, widens the minutes, and drops anything unsafe from storage', () => {
    const base = m.newAcc();
    m.addScreen(base, 'orders');
    m.addRoute(base, 'index', 'orders');
    m.touchMinute(base, new Date(2026, 9, 9, 9, 0));
    const extra = m.newAcc();
    m.addScreen(extra, 'orders');
    m.addScreen(extra, 'index');
    m.touchMinute(extra, new Date(2026, 9, 9, 8, 0));
    m.touchMinute(extra, new Date(2026, 9, 9, 17, 0));
    m.addOffline(extra, 20);
    m.mergeAcc(base, extra);
    expect(base.screens).toStrictEqual({ orders: 2, index: 1 });
    expect(base.firstMinute).toBe(480);
    expect(base.lastMinute).toBe(1020);
    expect(base.offlineSeconds).toBe(20);

    const dirty = m.cleanAcc({
      screens: { ok: 3, 'BAD KEY': 5, neg: -2, nan: 'x', frac: 2.6 },
      routes: { 'a>b': 1, nothing: 4, other: 2 },
      actions: { 'good-one': 1, Bad: 2 },
      firstMinute: 1440, lastMinute: -3, offlineSeconds: 'lots',
      extra: { whatever: 1 },
    });
    expect(dirty.screens).toStrictEqual({ ok: 3, frac: 3 });
    expect(dirty.routes).toStrictEqual({ 'a>b': 1, other: 2 });
    expect(dirty.actions).toStrictEqual({ 'good-one': 1 });
    expect(dirty.firstMinute).toBe(null);
    expect(dirty.lastMinute).toBe(null);
    expect(dirty.offlineSeconds).toBe(0);
    expect(m.isEmptyAcc(m.cleanAcc(null))).toBe(true);
    expect(m.isEmptyAcc(m.cleanAcc('junk'))).toBe(true);
    expect(m.isEmptyAcc(base)).toBe(false);
  });

  test('the line has only keys the rules allow, whole numbers, and none of the data layer\'s own', () => {
    const acc = m.newAcc();
    m.addScreen(acc, 'orders');
    m.addRoute(acc, 'index', 'orders');
    m.addSeconds(acc, 'orders', 45);
    m.addTap(acc, 'orders');
    m.addAction(acc, 'order-sent');
    m.addLoad(acc, 'orders', 800);
    m.touchMinute(acc, new Date(2026, 9, 9, 9, 30));
    const p = made(m.payloadOf(acc, WHO));
    const allowed = ['bakery', 'uid', 'deviceId', 'dayKey', 'kind', 'appVersion', 'screens', 'seconds', 'taps',
      'routes', 'actions', 'loads', 'loadMs', 'firstMinute', 'lastMinute', 'offlineSeconds', 'updatedAt'];
    for (const key of Object.keys(p)) expect(allowed.includes(key), `${key} is not in the rules' whitelist`).toBe(true);
    for (const key of ['bakery', 'uid', 'updatedAt']) expect(key in p, `${key} is the data layer's`).toBe(false);
    for (const key of ['deviceId', 'dayKey', 'kind']) expect(key in p).toBe(true);
    expect(p.firstMinute).toBe(570);
    expect(p.lastMinute).toBe(570);
    expect(p.offlineSeconds).toBe(0);
    expect(p.appVersion).toBe('649');
    expect(Number.isInteger(p.loadMs.orders)).toBe(true);
  });

  test('an empty day still makes a valid line, with no minutes', () => {
    const p = made(m.payloadOf(m.newAcc(), WHO));
    expect(p).toBeTruthy();
    expect('firstMinute' in p || 'lastMinute' in p).toBe(false);
    expect(p.screens).toStrictEqual({});
  });

  test('a line the rules would refuse is not made: bad device id, day or kind', () => {
    expect(m.payloadOf(m.newAcc(), { ...WHO, deviceId: 'x' })).toBe(null);
    expect(m.payloadOf(m.newAcc(), { ...WHO, dayKey: '2026-10-09' })).toBe(null);
    expect(m.payloadOf(m.newAcc(), { ...WHO, kind: 'watch' })).toBe(null);
    expect(m.payloadOf(null, WHO)).toBe(null);
  });

  test('the version is null when missing or longer than 12 characters', () => {
    expect(made(m.payloadOf(m.newAcc(), { ...WHO, appVersion: null })).appVersion).toBe(null);
    expect(made(m.payloadOf(m.newAcc(), { ...WHO, appVersion: '1234567890123' })).appVersion).toBe(null);
    expect(made(m.payloadOf(m.newAcc(), { ...WHO, appVersion: '' })).appVersion).toBe(null);
  });
});
