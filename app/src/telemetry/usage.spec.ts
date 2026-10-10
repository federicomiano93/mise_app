// usage.ts — the flow with every collaborator replaced. Ported from the current app's
// tests/usage.test.mjs, test for test.
//
// The tracker takes the page name as a parameter, so the original's tests use «orders» as the
// page and run unchanged against createTracker. What is specific to Mise 2 — ONE page, always
// «m2», and the views coming from `mise:screen` events (announceScreen) — is in the second half,
// «Mise 2: one page, many views».
//
// NOT PORTED (they read source files as text, or belong to the current app's pages):
//   · «the staff door starts it; the client ordering page and the password page do not» (reads
//     js/auth-gate.js and the HTML pages) — Mise 2 has one page and no client ordering page;
//   · «it starts itself at load, wired to the session, and sends through saveUsage» and
//     «start() cannot throw: its whole body is in a try» (read js/usage.js) — replaced by the
//     startUsage specs, which run the same wiring;
//   · «it never reads what was tapped, only which screen it was on» (greps the source) — replaced
//     by a spec that taps an element full of text and shows none of it reaches storage;
//   · «saveUsage writes the whole line under the signed-in uid with the server clock» (reads
//     js/firebase.js and firebase.example.js) — sinks.ts is Mise 2's writer;
//   · «both files are precached» (the current app's sw.js ASSETS list);
//   · all of tests/usage-events.test.mjs: it scans the current app's js/ folder for the literal
//     `mise:screen` / `mise:action` announcements. Mise 2 announces from one place
//     (announceScreen / announceAction), specced below.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { KEEP_PREFIXES, keysToClear } from '@mise/shared/local-data';
import type { UsagePayload } from '@mise/shared/usage-model';
import {
  createTracker, pageName, storeKey, parseStoreKey, startUsage, announceScreen, announceAction, browserUsageDeps,
  LAST_KEY, SEND_EVERY_MS, SEND_ON_HIDE_MS, IDLE_MS, ROUTE_WINDOW_MS, KEEP_DAYS, TICK_MS, FLUSH_CHECK_MS,
  START_DELAY_MS, STORE_PREFIX, MISE2_PAGE, type UsageDeps,
} from './usage';
import type { KeyValueStorage } from '../session/backend';
import type { TelemetrySession } from './common';
import { fakeSessionSource } from '../testing/fakeSessionSource';
import { MISE2_VERSION } from './version';

const DEVICE = 'AbCdEfGhIjKlMnOpQrSt';
const READY: TelemetrySession = { status: 'ready', locationId: 'bakery', user: { uid: 'u1' } };
const MIN = 60 * 1000;

interface MemoryStorage extends KeyValueStorage {
  data: Record<string, string>;
}

function memoryStorage(initial: Record<string, string> = {}): MemoryStorage {
  const data: Record<string, string> = { ...initial };
  return {
    getItem: k => (k in data ? (data[k] as string) : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
    data,
  };
}

interface Sent { payload: UsagePayload; id: string }

function setup(over: { storage?: MemoryStorage; deps?: Partial<UsageDeps> } = {}) {
  const clock = { t: new Date(2026, 9, 9, 10, 0, 0).getTime() };
  const storage = over.storage || memoryStorage();
  const sent: Sent[] = [];
  const state: { visible: boolean; online: boolean; session: TelemetrySession } = { visible: true, online: true, session: READY };
  const deps: UsageDeps = {
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

// What the tracker keeps in storage for one person and one day.
interface Stored {
  acc: Record<'screens' | 'seconds' | 'taps' | 'routes' | 'actions' | 'loads' | 'loadMs', Record<string, number>>;
  dirty: boolean;
  lastSentAt: number;
  rev: number;
}
const stored = (storage: MemoryStorage, key = todayKey()): Stored => JSON.parse(storage.data[key] as string) as Stored;

const nextMacrotask = () => new Promise<void>(r => setTimeout(r, 0));

describe('createTracker', () => {
  test('the page name comes from the file, «index» for the root', () => {
    // Kept for parity with the current app: Mise 2's own page is always «m2» (see below).
    expect(pageName('/mise_app/orders.html')).toBe('orders');
    expect(pageName('/mise_app/')).toBe('index');
    expect(pageName('/')).toBe('index');
    expect(pageName('/Foo Bar.html')).toBe('other');
  });

  test('the storage key round-trips, even for a venue id with hyphens', () => {
    const key = storeKey('loc-e015733e55e7', 'uidABC', '20261009');
    expect(parseStoreKey(key)).toEqual({ lid: 'loc-e015733e55e7', uid: 'uidABC', dayKey: '20261009' });
    expect(parseStoreKey(LAST_KEY)).toBeNull();
    expect(parseStoreKey('usage-nonsense')).toBeNull();
  });

  test('opening a page counts it; its load time is recorded once, after the page has loaded', () => {
    const { tracker } = setup();
    tracker.begin('orders');
    expect(tracker.pending().screens).toEqual({ orders: 1 });
    expect(tracker.pending().loads, 'loadEventEnd is not known yet at begin()').toEqual({});
    tracker.recordLoad();
    tracker.recordLoad();
    expect(tracker.pending().loads).toEqual({ orders: 1 });
    expect(tracker.pending().loadMs).toEqual({ orders: 900 });
    expect(tracker.current()).toBe('orders');
  });

  test('a load time that is not available yet is tried again, not lost', () => {
    let ready: number | null = null;
    const { tracker } = setup({ deps: { navigationMs: () => ready } });
    tracker.begin('orders');
    tracker.recordLoad();
    expect(tracker.pending().loads).toEqual({});
    ready = 700;
    tracker.recordLoad();
    expect(tracker.pending().loadMs).toEqual({ orders: 700 });
  });

  test('a page opened right after another one adds the route; an old or same-page one does not', () => {
    const fresh = setup();
    fresh.storage.setItem(LAST_KEY, JSON.stringify({ screen: 'index', at: fresh.clock.t - 5 * MIN }));
    fresh.tracker.begin('orders');
    expect(fresh.tracker.pending().routes).toEqual({ 'index>orders': 1 });

    const old = setup();
    old.storage.setItem(LAST_KEY, JSON.stringify({ screen: 'index', at: old.clock.t - ROUTE_WINDOW_MS - 1 }));
    old.tracker.begin('orders');
    expect(old.tracker.pending().routes).toEqual({});

    const same = setup();
    same.storage.setItem(LAST_KEY, JSON.stringify({ screen: 'orders', at: same.clock.t - MIN }));
    same.tracker.begin('orders');
    expect(same.tracker.pending().routes).toEqual({});

    const junk = setup();
    junk.storage.setItem(LAST_KEY, '{not json');
    junk.tracker.begin('orders');
    expect(junk.tracker.pending().routes).toEqual({});
  });

  test('the last screen is remembered on every change, for the next page', () => {
    const { tracker, storage, clock } = setup();
    tracker.begin('orders');
    tracker.view('orders', 'supplier');
    expect(JSON.parse(storage.data[LAST_KEY] as string)).toEqual({ screen: 'orders:supplier', at: clock.t });
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
    expect(p.screens).toEqual({ orders: 2, 'orders:supplier': 1, 'orders:history': 1 });
    expect(p.routes).toEqual({ 'orders>orders:supplier': 1, 'orders:supplier>orders': 1, 'orders>orders:history': 1 });
  });

  test('actions are counted by name; a bad name is ignored', () => {
    const { tracker } = setup();
    tracker.begin('orders');
    tracker.action('order-sent');
    tracker.action('order-sent');
    tracker.action('Bad Name');
    tracker.action(undefined);
    expect(tracker.pending().actions).toEqual({ 'order-sent': 2 });
  });

  test('a tap counts for the current screen and records nothing else', () => {
    const { tracker } = setup();
    tracker.begin('orders');
    tracker.tap();
    tracker.view('orders', 'supplier');
    tracker.tap();
    tracker.tap();
    expect(tracker.pending().taps).toEqual({ orders: 1, 'orders:supplier': 2 });
  });

  test('active seconds count only while visible and after a recent input', () => {
    const { tracker, clock, state } = setup();
    tracker.begin('orders');
    clock.t += 15000;
    tracker.tick();
    expect(tracker.pending().seconds.orders).toBe(15);
    // Two minutes of nothing: still on screen, but nobody is there.
    clock.t += IDLE_MS + 1000;
    tracker.tick();
    expect(tracker.pending().seconds.orders, 'idle: nothing added').toBe(15);
    tracker.input();
    clock.t += 15000;
    tracker.tick();
    expect(tracker.pending().seconds.orders).toBe(30);
    // Hidden page: nothing, however recent the input.
    state.visible = false;
    tracker.input();
    clock.t += 15000;
    tracker.tick();
    expect(tracker.pending().seconds.orders).toBe(30);
  });

  test('offline seconds count while the page is visible and the network is down', () => {
    const { tracker, clock, state } = setup();
    tracker.begin('orders');
    state.online = false;
    clock.t += 15000;
    tracker.tick();
    expect(tracker.pending().offlineSeconds).toBe(15);
    state.visible = false;
    clock.t += 15000;
    tracker.tick();
    expect(tracker.pending().offlineSeconds).toBe(15);
  });

  test('before a venue is open everything waits in memory; once ready it joins the day record', () => {
    const { tracker, storage } = setup();
    tracker.begin('orders');
    tracker.action('order-sent');
    tracker.commit();
    expect(Object.keys(storage.data).filter(k => k !== LAST_KEY)).toHaveLength(0);
    tracker.setSession(READY);
    const rec = stored(storage);
    expect(rec.dirty).toBe(true);
    expect(rec.acc.screens.orders).toBe(1);
    expect(rec.acc.actions['order-sent']).toBe(1);
    expect(tracker.pending().screens, 'memory is emptied once stored').toEqual({});
  });

  test('later pages add to the same day record instead of replacing it', () => {
    const a = setup();
    a.tracker.begin('orders');
    a.tracker.setSession(READY);
    const b = setup({ storage: a.storage });
    b.tracker.begin('orders');
    b.tracker.setSession(READY);
    expect(stored(a.storage).acc.screens.orders).toBe(2);
  });

  test('whatever was counted before a person left belongs to them, not to the next one', () => {
    const { tracker, storage } = setup();
    tracker.setSession(READY);
    tracker.begin('orders');
    tracker.setSession({ status: 'signed-out' });
    tracker.action('order-sent');
    tracker.setSession({ status: 'ready', locationId: 'bakery', user: { uid: 'u2' } });
    expect(stored(storage).acc.screens.orders).toBe(1);
    expect(stored(storage).acc.actions['order-sent']).toBeUndefined();
    expect(stored(storage, storeKey('bakery', 'u2', '20261009')).acc.actions['order-sent']).toBe(1);
  });

  test('a flush before ten minutes sends nothing; at ten minutes it sends the whole day', async () => {
    const { tracker, clock, sent } = setup();
    tracker.setSession(READY);
    tracker.begin('orders');
    tracker.setSession(READY);
    clock.t += SEND_EVERY_MS - 1000;
    expect(await tracker.flush('timer')).toBe('nothing');
    expect(sent).toHaveLength(0);
    clock.t += 2000;
    expect(await tracker.flush('timer')).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.id).toBe(`${DEVICE}_20261009_u1`);
    expect(sent[0]?.payload.dayKey).toBe('20261009');
    expect(sent[0]?.payload.kind).toBe('phone');
    expect(sent[0]?.payload.appVersion).toBe('649');
    expect(sent[0]?.payload.screens.orders).toBe(1);
    expect(sent[0]?.payload && ('uid' in sent[0].payload || 'bakery' in sent[0].payload), 'the data layer adds those').toBe(false);
  });

  test('a clean day is not sent again; a change makes it due once ten more minutes pass', async () => {
    const { tracker, clock, sent } = setup();
    tracker.setSession(READY);
    tracker.begin('orders');
    tracker.setSession(READY);
    clock.t += SEND_EVERY_MS + 1000;
    await tracker.flush('timer');
    clock.t += SEND_EVERY_MS + 1000;
    expect(await tracker.flush('timer'), 'nothing changed').toBe('nothing');
    tracker.action('order-sent');
    expect(await tracker.flush('timer')).toBe('sent');
    expect(sent).toHaveLength(2);
    expect(sent[1]?.payload.actions['order-sent']).toBe(1);
    tracker.action('order-sent');
    clock.t += MIN;
    expect(await tracker.flush('timer'), 'one minute after the last send is too soon').toBe('nothing');
  });

  test('hiding the page sends after three minutes, not before', async () => {
    const { tracker, clock, sent } = setup();
    tracker.setSession(READY);
    tracker.begin('orders');
    tracker.setSession(READY);
    clock.t += SEND_ON_HIDE_MS - 1000;
    expect(await tracker.flush('hidden')).toBe('nothing');
    clock.t += 2000;
    expect(await tracker.flush('hidden')).toBe('sent');
    expect(sent).toHaveLength(1);
  });

  test('⚠️ a send that never settles leaves the record dirty; it is tried again only after ten more minutes', async () => {
    const { tracker, clock, sent, storage } = setup({
      deps: { send: () => new Promise(() => {}) },
    });
    tracker.setSession(READY);
    tracker.begin('orders');
    tracker.setSession(READY);
    clock.t += SEND_EVERY_MS + 1000;
    expect(await tracker.flush('timer')).toBe('sent');
    expect(stored(storage).dirty, 'nothing answered, so nothing is confirmed').toBe(true);
    expect(stored(storage).lastSentAt, 'lastSentAt is the time of the attempt').toBe(clock.t);
    expect(await tracker.flush('timer')).toBe('nothing');
    clock.t += SEND_EVERY_MS + 1000;
    expect(await tracker.flush('timer')).toBe('sent');
    expect(sent).toHaveLength(0);
  });

  test('⚠️ the record is clean only once the server answered', async () => {
    let answer: () => void = () => {};
    const { tracker, clock, storage } = setup({
      deps: { send: () => new Promise<void>(resolve => { answer = resolve; }) },
    });
    tracker.setSession(READY);
    tracker.begin('orders');
    tracker.setSession(READY);
    clock.t += SEND_EVERY_MS + 1000;
    await tracker.flush('timer');
    expect(stored(storage).dirty).toBe(true);
    answer();
    await nextMacrotask();
    expect(stored(storage).dirty).toBe(false);
  });

  test('⚠️ an answer for an older version does not clean what was added meanwhile', async () => {
    let answer: () => void = () => {};
    const { tracker, clock, storage } = setup({
      deps: { send: () => new Promise<void>(resolve => { answer = resolve; }) },
    });
    tracker.setSession(READY);
    tracker.begin('orders');
    tracker.setSession(READY);
    const before = stored(storage).rev;
    clock.t += SEND_EVERY_MS + 1000;
    await tracker.flush('timer');
    tracker.action('order-sent');
    tracker.commit();
    expect(stored(storage).rev).toBe(before + 1);
    answer();
    await nextMacrotask();
    expect(stored(storage).dirty).toBe(true);
    expect(stored(storage).acc.actions['order-sent']).toBe(1);
  });

  test('⚠️ on hide the write is handed over at once, with nothing awaited, and only for today', async () => {
    const storage = memoryStorage();
    const old = storeKey('bakery', 'u1', '20261008');
    storage.setItem(old, JSON.stringify({ acc: { screens: { orders: 3 } }, dirty: true, lastSentAt: 0, rev: 1 }));
    const { tracker, clock, sent } = setup({ storage });
    tracker.setSession(READY);
    await nextMacrotask();
    tracker.begin('orders');
    tracker.setSession(READY);
    clock.t += SEND_ON_HIDE_MS + 1000;
    const pending = tracker.flush('hidden');
    await Promise.resolve();
    expect(sent, 'handed over before the first await finished').toHaveLength(1);
    expect(sent[0]?.payload.dayKey).toBe('20261009');
    expect(sent[0]?.payload.appVersion, 'the release cached in memory').toBe('649');
    await pending;
    expect(old in storage.data, 'a past day waits for a load or a timer check').toBe(true);
    expect(JSON.parse(storage.data[old] as string).dirty).toBe(true);
  });

  test('the timer check sends a past day too, and deletes it only after the answer', async () => {
    const storage = memoryStorage();
    const old = storeKey('bakery', 'u1', '20261008');
    storage.setItem(old, JSON.stringify({ acc: { screens: { orders: 3 } }, dirty: true, lastSentAt: 0, rev: 1 }));
    let answer: () => void = () => {};
    const ids: string[] = [];
    const { tracker } = setup({
      storage,
      deps: { send: (_payload, id) => { ids.push(id); return new Promise<void>(r => { answer = r; }); } },
    });
    tracker.setSession(READY);
    expect(await tracker.flush('timer')).toBe('sent');
    expect(ids[0]).toBe(`${DEVICE}_20261008_u1`);
    expect(old in storage.data, 'not deleted at the handover').toBe(true);
    answer();
    await nextMacrotask();
    expect(old in storage.data).toBe(false);
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
    expect(stored(storage, storeKey('bakery', 'u1', '20261009')).acc.actions['order-sent']).toBe(1);
    expect(stored(storage, storeKey('bakery', 'u1', '20261009')).acc.screens.orders).toBe(1);
    expect(storeKey('bakery', 'u1', '20261010') in storage.data).toBe(true);
    expect(stored(storage, storeKey('bakery', 'u1', '20261010')).acc.actions['order-sent']).toBeUndefined();
  });

  test('a passing failure makes the day dirty again; a refusal by the rules does not', async () => {
    const transient = setup({ deps: { send: async () => { throw Object.assign(new Error('x'), { code: 'unavailable' }); } } });
    transient.tracker.setSession(READY);
    transient.tracker.begin('orders');
    transient.tracker.setSession(READY);
    transient.clock.t += SEND_EVERY_MS + 1000;
    await transient.tracker.flush('timer');
    await nextMacrotask();
    expect(stored(transient.storage).dirty).toBe(true);

    const refused = setup({ deps: { send: async () => { throw Object.assign(new Error('x'), { code: 'permission-denied' }); } } });
    refused.tracker.setSession(READY);
    refused.tracker.begin('orders');
    refused.tracker.setSession(READY);
    refused.clock.t += SEND_EVERY_MS + 1000;
    await refused.tracker.flush('timer');
    await nextMacrotask();
    expect(stored(refused.storage).dirty, 'retrying would only repeat the refusal').toBe(false);
  });

  test('a failure of the send function itself is a console line, never a throw', async () => {
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (...a: unknown[]) => { warns.push(a.join(' ')); };
    try {
      const { tracker, clock } = setup({ deps: { send: () => { throw Object.assign(new Error('boom'), { code: 'internal' }); } } });
      tracker.setSession(READY);
      tracker.begin('orders');
      tracker.setSession(READY);
      clock.t += SEND_EVERY_MS + 1000;
      await tracker.flush('timer');
      await nextMacrotask();
    } finally {
      console.warn = original;
    }
    expect(warns.some(w => /Usage not sent: internal/.test(w))).toBe(true);
    expect(warns.every(w => !/boom/.test(w)), 'only the code is logged').toBe(true);
  });

  test('⚠️ nothing is sent for somebody who is no longer signed in', async () => {
    const { tracker, clock, sent, state } = setup();
    tracker.setSession(READY);
    tracker.begin('orders');
    tracker.setSession(READY);
    clock.t += SEND_EVERY_MS + 1000;
    state.session = { status: 'ready', locationId: 'bakery', user: { uid: 'u2' } };
    expect(await tracker.flush('timer')).toBe('skipped');
    state.session = { status: 'signed-out' };
    expect(await tracker.flush('timer')).toBe('skipped');
    expect(sent).toHaveLength(0);
  });

  test('⚠️ nor when the tracker itself has moved to somebody else while the release was being asked for', async () => {
    // The records collected are the first person's; the check must be about THEM, not about whoever
    // the tracker follows by the time the answer arrives.
    let release: (v: string) => void = () => {};
    const { tracker, clock, sent, state } = setup({
      deps: { version: () => new Promise<string>(resolve => { release = resolve; }) },
    });
    tracker.setSession(READY);
    tracker.begin('orders');
    tracker.setSession(READY);
    clock.t += SEND_EVERY_MS + 1000;
    const flushing = tracker.flush('timer');
    // Let the question about the release reach the (pretend) service worker.
    await nextMacrotask();
    const second: TelemetrySession = { status: 'ready', locationId: 'bakery', user: { uid: 'u2' } };
    tracker.setSession(second);
    state.session = second;
    release('649');
    expect(await flushing).toBe('skipped');
    expect(sent).toHaveLength(0);
  });

  test('without a device id nothing is sent', async () => {
    const { tracker, clock, sent } = setup({ deps: { deviceId: () => null } });
    tracker.setSession(READY);
    tracker.begin('orders');
    tracker.setSession(READY);
    clock.t += SEND_EVERY_MS + 1000;
    expect(await tracker.flush('timer')).toBe('no-device');
    expect(sent).toHaveLength(0);
  });

  test('without storage nothing is kept and nothing is sent', async () => {
    const { tracker, sent } = setup({ deps: { storage: null } });
    tracker.begin('orders');
    tracker.setSession(READY);
    expect(await tracker.flush('timer')).toBe('skipped');
    expect(sent).toHaveLength(0);
  });

  test('a storage that throws never breaks a page', async () => {
    const broken: KeyValueStorage = {
      getItem: () => { throw new Error('no'); },
      setItem: () => { throw new Error('no'); },
      removeItem: () => { throw new Error('no'); },
    };
    const { tracker } = setup({ deps: { storage: broken, keys: () => [] } });
    expect(() => {
      tracker.begin('orders');
      tracker.tick();
      tracker.setSession(READY);
      tracker.commit();
      tracker.prune();
    }).not.toThrow();
    expect(await tracker.flush('timer')).toBe('nothing');
  });

  test('a past day still dirty is sent at once, and its record is deleted when handed over', async () => {
    const storage = memoryStorage();
    const old = storeKey('bakery', 'u1', '20261008');
    storage.setItem(old, JSON.stringify({ acc: { screens: { orders: 3 } }, dirty: true, lastSentAt: 0 }));
    const { tracker, sent } = setup({ storage });
    tracker.setSession(READY);
    expect(await tracker.flush('load')).toBe('sent');
    await nextMacrotask();
    expect(sent[0]?.id).toBe(`${DEVICE}_20261008_u1`);
    expect(sent[0]?.payload.dayKey).toBe('20261008');
    expect(sent[0]?.payload.screens.orders).toBe(3);
    expect(old in storage.data).toBe(false);
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
    expect(sentDay in storage.data).toBe(false);
    expect(other in storage.data).toBe(true);
    expect(sent).toHaveLength(0);
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
    await nextMacrotask();
    expect(JSON.parse(storage.data[old] as string).dirty).toBe(true);
    expect(JSON.parse(storage.data[old] as string).acc.screens.orders).toBe(3);
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
    expect(fresh in storage.data).toBe(true);
    expect(stale in storage.data).toBe(false);
    expect(LAST_KEY in storage.data).toBe(true);
    expect(KEEP_DAYS).toBe(7);
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
    expect(sent[0]?.payload.screens).toEqual({ ok: 2 });
    expect(sent[0]?.payload && 'firstMinute' in sent[0].payload).toBe(false);
  });

  test('a stored record whose numbers are damaged starts again from safe ones', async () => {
    const storage = memoryStorage();
    storage.setItem(todayKey(), JSON.stringify({ acc: { screens: { ok: 2 } }, dirty: true, lastSentAt: 'yesterday', rev: 'x' }));
    const { tracker, clock } = setup({ storage });
    tracker.begin('orders');
    tracker.setSession(READY);
    const rec = stored(storage);
    expect(rec.rev).toBe(1);
    expect(rec.lastSentAt, 'a damaged clock starts now, so a short visit does not write').toBe(clock.t);
  });
});

describe('the keys', () => {
  test('the keys survive a sign-out and a venue switch', () => {
    expect(KEEP_PREFIXES).toContain('usage-');
    expect(keysToClear([storeKey('bakery', 'u1', '20261009'), LAST_KEY, 'recipes-cache'])).toEqual(['recipes-cache']);
  });

  test('the prefix the tracker writes under is the one the sign-out keeps', () => {
    expect(STORE_PREFIX).toBe('usage-');
    expect(LAST_KEY.startsWith(STORE_PREFIX)).toBe(true);
    expect(storeKey('bakery', 'u1', '20261009').startsWith(STORE_PREFIX)).toBe(true);
  });
});

// ── Mise 2: one page, many views ────────────────────────────────────────────────────────────
// What changes in a single-page app: the page is always «m2»; the shell announces the section it
// shows with announceScreen(); the load time is the shell's first render (markLoaded()).

describe('Mise 2: one page, many views', () => {
  const stops: Array<() => void> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 9, 10, 0, 0));
  });
  afterEach(() => {
    while (stops.length) stops.pop()?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function boot(initial: TelemetrySession = READY, extra: Partial<UsageDeps> = {}, storage = memoryStorage()) {
    const source = fakeSessionSource(initial);
    const sent: Sent[] = [];
    const stop = startUsage({
      source,
      send: async (payload, id) => { sent.push({ payload, id }); },
      deps: {
        storage,
        keys: () => Object.keys(storage.data).filter(k => k.startsWith('usage-')),
        deviceId: () => DEVICE,
        kind: () => 'phone',
        version: () => '649',
        ...extra,
      },
    });
    stops.push(stop);
    return { storage, source, sent, stop };
  }

  test('the page is «m2»', () => {
    expect(MISE2_PAGE).toBe('m2');
  });

  test('announceScreen(\'orders\') leads to the accumulator screen «m2:orders», the move to it, and its seconds and taps', async () => {
    const { storage } = boot();
    announceScreen('orders');
    window.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(TICK_MS);
    const rec = stored(storage);
    expect(rec.acc.screens).toEqual({ m2: 1, 'm2:orders': 1 });
    expect(rec.acc.routes).toEqual({ 'm2>m2:orders': 1 });
    expect(rec.acc.taps).toEqual({ 'm2:orders': 1 });
    expect(rec.acc.seconds).toEqual({ 'm2:orders': 15 });
  });

  test('the sections the shell announces are all screens of their own, and the moves between them are routes', async () => {
    const { storage } = boot();
    for (const section of ['orders', 'recipes', 'more', 'settings', 'not-found']) announceScreen(section);
    await vi.advanceTimersByTimeAsync(TICK_MS);
    const rec = stored(storage);
    expect(Object.keys(rec.acc.screens).sort()).toEqual(
      ['m2', 'm2:more', 'm2:not-found', 'm2:orders', 'm2:recipes', 'm2:settings'],
    );
    expect(rec.acc.routes).toEqual({
      'm2>m2:orders': 1, 'm2:orders>m2:recipes': 1, 'm2:recipes>m2:more': 1,
      'm2:more>m2:settings': 1, 'm2:settings>m2:not-found': 1,
    });
  });

  test('announcing the same section twice counts it once; the empty view is the app\'s front again', async () => {
    const { storage } = boot();
    announceScreen('orders');
    announceScreen('orders');
    announceScreen('');
    await vi.advanceTimersByTimeAsync(TICK_MS);
    const rec = stored(storage);
    expect(rec.acc.screens).toEqual({ m2: 2, 'm2:orders': 1 });
    expect(rec.acc.routes).toEqual({ 'm2>m2:orders': 1, 'm2:orders>m2': 1 });
  });

  test('a section name the record would refuse is ignored, never turned into a line the rules reject', async () => {
    const { storage } = boot();
    announceScreen('Not A Section');
    announceScreen('x'.repeat(38));   // «m2:» + 38 characters is 41: one over the record\'s 40
    window.dispatchEvent(new CustomEvent('mise:screen', { detail: 42 }));
    window.dispatchEvent(new CustomEvent('mise:screen'));
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(stored(storage).acc.screens).toEqual({ m2: 1 });
    announceScreen('x'.repeat(37));   // and 37 fits exactly
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(Object.keys(stored(storage).acc.screens)).toContain(`m2:${'x'.repeat(37)}`);
  });

  test('announceAction counts a key action by name; a bad name is ignored', async () => {
    const { storage } = boot();
    announceAction('order-sent');
    announceAction('order-sent');
    announceAction('Bad Name');
    window.dispatchEvent(new CustomEvent('mise:action', { detail: 7 }));
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(stored(storage).acc.actions).toEqual({ 'order-sent': 2 });
  });

  test('announcing where there is no window throws nothing', () => {
    vi.stubGlobal('window', undefined);
    expect(() => announceScreen('orders')).not.toThrow();
    expect(() => announceAction('order-sent')).not.toThrow();
  });

  test('it never reads what was tapped, only which screen it was on', async () => {
    const { storage } = boot();
    announceScreen('recipes');
    const button = document.createElement('button');
    button.textContent = 'Secret recipe name';
    button.setAttribute('value', 'secret-value');
    button.id = 'secret-id';
    document.body.append(button);
    try {
      button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    } finally {
      button.remove();
    }
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(stored(storage).acc.taps).toEqual({ 'm2:recipes': 1 });
    expect(JSON.stringify(storage.data)).not.toMatch(/secret/i);
  });

  test('whatever happens before a venue opens is counted, and filed once one does', () => {
    const { storage, source } = boot({ status: 'loading' });
    announceScreen('orders');
    expect(Object.keys(storage.data).filter(k => k !== LAST_KEY)).toEqual([]);
    source.set(READY);
    expect(stored(storage).acc.screens).toEqual({ m2: 1, 'm2:orders': 1 });
  });

  test('the last screen is remembered in the storage the current app shares, so a move between the two apps is a route', async () => {
    const storage = memoryStorage({ [LAST_KEY]: JSON.stringify({ screen: 'orders:supplier', at: Date.now() - 2 * MIN }) });
    boot(READY, {}, storage);
    announceScreen('orders');
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(stored(storage).acc.routes).toEqual({ 'orders:supplier>m2': 1, 'm2>m2:orders': 1 });
    expect(JSON.parse(storage.data[LAST_KEY] as string).screen).toBe('m2:orders');
  });

  test('pressing a key, scrolling or wheeling counts as somebody being there; time passing alone does not', async () => {
    const { storage } = boot();
    const seconds = () => stored(storage).acc.seconds['m2:orders'] ?? 0;
    announceScreen('orders');
    // Opening the app counts as the last input: two minutes are credited, then nobody is there.
    await vi.advanceTimersByTimeAsync(IDLE_MS + TICK_MS);
    const idle = seconds();
    expect(idle).toBe(IDLE_MS / 1000);
    await vi.advanceTimersByTimeAsync(MIN);
    expect(seconds(), 'a minute of nothing').toBe(idle);
    for (const type of ['keydown', 'wheel', 'scroll']) {
      // Past the idle window again before each kind of input, so only the input can explain the time.
      await vi.advanceTimersByTimeAsync(IDLE_MS + MIN);
      const before = seconds();
      window.dispatchEvent(new Event(type));
      await vi.advanceTimersByTimeAsync(TICK_MS);
      expect(seconds(), type).toBe(before + 15);
    }
  });

  test('every ten minutes the day is sent through the sender passed in, under the id the rules demand', async () => {
    const { sent } = boot();
    announceScreen('orders');
    await vi.advanceTimersByTimeAsync(SEND_EVERY_MS - FLUSH_CHECK_MS);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2 * FLUSH_CHECK_MS);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.id).toBe(`${DEVICE}_20261009_u1`);
    expect(sent[0]?.payload.screens).toEqual({ m2: 1, 'm2:orders': 1 });
    expect(sent[0]?.payload.appVersion).toBe('649');
  });

  test('leaving the page hands today\'s record over once three minutes have passed since it was made', async () => {
    const { sent } = boot();
    announceScreen('orders');
    await vi.advanceTimersByTimeAsync(SEND_ON_HIDE_MS + MIN);
    expect(sent).toHaveLength(0);
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload.screens['m2:orders']).toBe(1);
    expect(sent[0]?.payload.appVersion, 'the release is cached before the page is hidden').toBe('649');
  });

  test('a page that goes to the background does the same, and a page that comes back to the front does not', async () => {
    const { sent } = boot();
    announceScreen('orders');
    await vi.advanceTimersByTimeAsync(SEND_ON_HIDE_MS + MIN);
    let state: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
      expect(sent, 'still visible: nothing to hand over').toHaveLength(0);
      state = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
      expect(sent).toHaveLength(1);
    } finally {
      Reflect.deleteProperty(document, 'visibilityState');
    }
  });

  test('a moment after a venue opens, yesterday\'s unsent record goes, and a week-old one is deleted', async () => {
    const storage = memoryStorage();
    const yesterday = storeKey('bakery', 'u1', '20261008');
    const stale = storeKey('bakery', 'u1', '20261001');
    storage.setItem(yesterday, JSON.stringify({ acc: { screens: { 'm2:orders': 3 } }, dirty: true, lastSentAt: 0, rev: 1 }));
    storage.setItem(stale, JSON.stringify({ acc: {}, dirty: true, lastSentAt: 0, rev: 1 }));
    const { sent } = boot(READY, {}, storage);
    expect(stale in storage.data, 'pruned at once').toBe(false);
    await vi.advanceTimersByTimeAsync(START_DELAY_MS - 1);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.id).toBe(`${DEVICE}_20261008_u1`);
  });

  test('⚠️ a person who signed out during that moment is not sent for', async () => {
    const storage = memoryStorage();
    storage.setItem(storeKey('bakery', 'u1', '20261008'), JSON.stringify({ acc: { screens: { orders: 3 } }, dirty: true, lastSentAt: 0, rev: 1 }));
    const { sent, source } = boot(READY, {}, storage);
    source.set({ status: 'signed-out' });
    await vi.advanceTimersByTimeAsync(START_DELAY_MS * 2);
    expect(sent).toHaveLength(0);
  });

  test('stop() takes every listener and every timer away', async () => {
    const { storage, source, stop } = boot();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    expect(source.listening()).toBe(0);
    announceScreen('orders');
    window.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(TICK_MS * 2);
    expect(stored(storage).acc.screens, 'only what was counted before stop()').toEqual({ m2: 1 });
  });

  test('a start that fails cannot throw, says only the code, and leaves nothing half-wired', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = fakeSessionSource(READY);
    source.getSnapshot = () => { throw Object.assign(new Error('secret'), { code: 'internal' }); };
    let stop = (): void => {};
    expect(() => {
      stop = startUsage({ source, send: async () => {}, deps: { storage: memoryStorage(), keys: () => [] } });
    }).not.toThrow();
    expect(warn).toHaveBeenCalledWith('Usage not started:', 'internal');
    expect(vi.getTimerCount(), 'the intervals were cleared again').toBe(0);
    expect(source.listening()).toBe(0);
    expect(() => stop()).not.toThrow();
  });
});

// The load time is Mise 2's own first paint. The module remembers it for the life of the page, so
// each spec here gets a fresh copy of the module.
describe('Mise 2: the load time is the shell\'s first render', () => {
  const stops: Array<() => void> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 9, 10, 0, 0));
    vi.resetModules();
  });
  afterEach(() => {
    while (stops.length) stops.pop()?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function fresh() {
    const usage = await import('./usage');
    const storage = memoryStorage();
    const start = () => {
      const stop = usage.startUsage({
        source: fakeSessionSource(READY),
        send: async () => {},
        deps: {
          storage,
          keys: () => Object.keys(storage.data).filter(k => k.startsWith('usage-')),
          deviceId: () => DEVICE,
          kind: () => 'phone',
        },
      });
      stops.push(stop);
    };
    return { usage, storage, start };
  }

  test('markLoaded after the start records «m2» with the time since the page opened, once', async () => {
    const { usage, storage, start } = await fresh();
    start();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(stored(storage).acc.loads, 'not known before the shell has rendered').toEqual({});
    vi.spyOn(performance, 'now').mockReturnValue(1234.4);
    usage.markLoaded();
    vi.spyOn(performance, 'now').mockReturnValue(9999);
    usage.markLoaded();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(stored(storage).acc.loads).toEqual({ m2: 1 });
    expect(stored(storage).acc.loadMs).toEqual({ m2: 1234 });
  });

  test('markLoaded before the start is not lost', async () => {
    const { usage, storage, start } = await fresh();
    vi.spyOn(performance, 'now').mockReturnValue(800);
    usage.markLoaded();
    start();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(stored(storage).acc.loads).toEqual({ m2: 1 });
    expect(stored(storage).acc.loadMs).toEqual({ m2: 800 });
  });

  test('a load slower than a minute is kept as a minute, the most the rules accept', async () => {
    const { usage, storage, start } = await fresh();
    start();
    vi.spyOn(performance, 'now').mockReturnValue(5 * MIN);
    usage.markLoaded();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(stored(storage).acc.loadMs).toEqual({ m2: 60000 });
  });
});

describe('browserUsageDeps', () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); window.localStorage.clear(); });

  test('send is the one passed in; the release is Mise 2\'s own; no session is known until it is given', async () => {
    const send = vi.fn(async () => {});
    const d = browserUsageDeps(send);
    expect(d.send).toBe(send);
    expect(await d.version()).toBe(MISE2_VERSION);
    expect(d.currentSession()).toBeNull();
    expect(d.storage).toBe(window.localStorage);
  });

  test('the keys are only the usage ones, and the device id is read or made in the shared storage', () => {
    window.localStorage.setItem(storeKey('bakery', 'u1', '20261009'), '{}');
    window.localStorage.setItem(LAST_KEY, '{}');
    window.localStorage.setItem('recipes-cache', '{}');
    const d = browserUsageDeps(async () => {});
    expect(d.keys().sort()).toEqual([LAST_KEY, storeKey('bakery', 'u1', '20261009')].sort());
    const id = d.deviceId();
    expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(window.localStorage.getItem('device-id')).toBe(id);
    expect(d.deviceId()).toBe(id);
  });

  test('it reads whether the page is on show, whether it is online, and the kind of device', () => {
    const d = browserUsageDeps(async () => {});
    expect(d.visible()).toBe(true);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(d.online()).toBe(false);
    vi.stubGlobal('screen', { width: 390, height: 844 });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(d.kind()).toBe('phone');
  });

  test('the load time is not known until the shell says so', () => {
    expect(browserUsageDeps(async () => {}).navigationMs()).toBeNull();
  });
});
