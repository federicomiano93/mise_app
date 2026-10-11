// devicePing.ts — the flow, with every collaborator replaced. Ported from the current app's
// tests/device-ping.test.mjs, test for test.
//
// NOT PORTED (they read source files as text, or belong to the current app's pages):
//   · «the line carries the signed-in uid but never a name or email, and is written whole with the
//     server clock» (reads js/device-ping.js, js/firebase.js and firebase.example.js) — the uid in
//     the payload is pinned by the first test below; the whole-document write with the server's
//     clock is sinks.ts's job, Mise 2's writer;
//   · «the staff door starts it and the client ordering page does not» (reads js/auth-gate.js and
//     order.html) — Mise 2 has one page and no client ordering page;
//   · «the counter starts: start() runs at load and waits, re-reads the session, then pings»
//     (reads the source) — replaced by the startDevicePing specs at the end, which run it;
//   · «both new files are precached» (the current app's sw.js ASSETS list) — Mise 2's offline cache
//     is a later step.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { sameSession, type DevicePayload } from '@mise/shared/device-model';
import { KEEP_PREFIXES, keysToClear } from '@mise/shared/local-data';
import {
  pingIfDue, deviceIdFrom, startDevicePing, browserPingDeps, DEVICE_ID_KEY, PING_DAY_KEY_PREFIX,
  START_DELAY_MS, type PingDeps,
} from './devicePing';
import type { KeyValueStorage } from '../session/backend';
import type { SessionSource, TelemetrySession } from './common';
import { fakeSessionSource } from '../testing/fakeSessionSource';
import { MISE2_VERSION } from './version';

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

// A storage that has only the two methods a test cares about, as the original's fakes did.
const partial = (storage: Pick<KeyValueStorage, 'getItem' | 'setItem'>): KeyValueStorage => storage as KeyValueStorage;

interface Sent { payload: DevicePayload; id: string }
type Deps = PingDeps & { sent: Sent[]; storage: MemoryStorage };

function deps(over: Partial<PingDeps> = {}): Deps {
  const sent: Sent[] = [];
  return {
    sent,
    storage: memoryStorage(),
    randomBytes: () => Uint8Array.from({ length: 64 }, (_, i) => (i * 7) % 200),
    now: () => new Date(2026, 9, 9, 10, 0),
    kind: () => 'phone',
    installed: () => true,
    version: async () => '643',
    send: async (payload, id) => { sent.push({ payload, id }); },
    ...over,
  } as Deps;
}

const STAMP = PING_DAY_KEY_PREFIX + 'bakery-u1';
const READY: TelemetrySession = { status: 'ready', locationId: 'bakery', user: { uid: 'u1' } };

describe('pingIfDue', () => {
  test('a ready venue is reported once, with the signed-in uid, the four facts and a fresh id', async () => {
    const d = deps();
    expect(await pingIfDue(READY, d)).toBe('sent');
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0]?.payload).toEqual({ bakery: 'bakery', uid: 'u1', kind: 'phone', appVersion: '643', installed: true });
    expect(d.sent[0]?.id).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(d.storage.data[DEVICE_ID_KEY]).toBe(d.sent[0]?.id);
    expect(d.storage.data[STAMP]).toBe('2026-10-09');
  });

  test('the same device, the same venue, the same day: no second write', async () => {
    const d = deps();
    await pingIfDue(READY, d);
    expect(await pingIfDue(READY, d)).toBe('not-due');
    expect(d.sent).toHaveLength(1);
  });

  test('another venue the same day is reported, with the SAME device id', async () => {
    const d = deps();
    await pingIfDue(READY, d);
    expect(await pingIfDue({ status: 'ready', locationId: 'loc-b', user: { uid: 'u1' } }, d)).toBe('sent');
    expect(d.sent).toHaveLength(2);
    expect(d.sent[0]?.id).toBe(d.sent[1]?.id);
  });

  test('another person on the same device, same day, is reported', async () => {
    const d = deps();
    await pingIfDue(READY, d);
    expect(await pingIfDue({ ...READY, user: { uid: 'u2' } }, d)).toBe('sent');
    expect(d.sent).toHaveLength(2);
    expect(d.sent[0]?.id).toBe(d.sent[1]?.id);
    expect(d.sent[1]?.payload.uid).toBe('u2');
    expect(await pingIfDue({ ...READY, user: { uid: 'u2' } }, d)).toBe('not-due');
  });

  test('a write that never settles (offline) still stamps the day, so the next page does not queue another', async () => {
    // Its own account: the never-settling write stays «in flight» for the life of the module.
    const hanging: TelemetrySession = { ...READY, user: { uid: 'hangs' } };
    const calls: DevicePayload[] = [];
    const d = deps({ send: payload => { calls.push(payload); return new Promise(() => {}); } });
    void pingIfDue(hanging, d);   // never awaited: it will not settle
    await new Promise(r => setTimeout(r, 20));
    expect(calls).toHaveLength(1);
    expect(d.storage.data[PING_DAY_KEY_PREFIX + 'bakery-hangs']).toBe('2026-10-09');
  });

  test('a passing failure takes the stamp back; a refusal keeps it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const code of ['unavailable', 'unauthenticated', 'deadline-exceeded']) {
        const d = deps({ send: async () => { throw Object.assign(new Error('x'), { code }); } });
        expect(await pingIfDue(READY, d)).toBe('failed');
        expect(d.storage.data[STAMP], code).toBeUndefined();
      }
      const d = deps({ send: async () => { throw Object.assign(new Error('x'), { code: 'invalid-argument' }); } });
      await pingIfDue(READY, d);
      expect(d.storage.data[STAMP]).toBe('2026-10-09');
    } finally { warn.mockRestore(); }
  });

  // ⚠️ Vitest fails the run on an unhandled rejection, so this test is red without the guard in
  // pingIfDue even though every assertion in it holds: the write was handed to the SDK, the day
  // could not be stamped, nobody awaited the write, and its later failure had no handler.
  test('a full storage cannot leave the write it already handed over as an unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const storage = memoryStorage();
      const full: KeyValueStorage = {
        ...storage,
        setItem(key, value) {
          if (key.startsWith(PING_DAY_KEY_PREFIX)) throw new Error('QuotaExceededError');
          storage.setItem(key, value);
        },
      };
      const calls: DevicePayload[] = [];
      const d = deps({
        storage: full,
        send: async payload => {
          calls.push(payload);
          await new Promise(r => setTimeout(r, 5));
          throw Object.assign(new Error('x'), { code: 'unavailable' });
        },
      });
      expect(await pingIfDue({ ...READY, user: { uid: 'full' } }, d)).toBe('failed');
      expect(calls).toHaveLength(1);
      // Long enough for the write to fail, and for the runtime to notice nobody was listening.
      await new Promise(r => setTimeout(r, 50));
      expect(warn).toHaveBeenCalledWith('Device count not sent:', 'unknown');
    } finally { warn.mockRestore(); }
  });

  test('the same venue and account is never sent twice at the same moment', async () => {
    let release: () => void = () => {};
    const calls: DevicePayload[] = [];
    const d = deps({ send: payload => { calls.push(payload); return new Promise<void>(r => { release = r; }); } });
    const slow: TelemetrySession = { ...READY, user: { uid: 'slow' } };
    const first = pingIfDue(slow, d);
    await new Promise(r => setTimeout(r, 20));
    expect(await pingIfDue(slow, d)).toBe('skipped');
    release();
    expect(await first).toBe('sent');
    expect(calls).toHaveLength(1);
  });

  test('tomorrow it is reported again', async () => {
    const d = deps();
    await pingIfDue(READY, d);
    d.now = () => new Date(2026, 9, 10, 8, 0);
    expect(await pingIfDue(READY, d)).toBe('sent');
  });

  test('only a venue that is open and ready, with a signed-in uid, is reported', async () => {
    const d = deps();
    const notReady: Array<TelemetrySession | null> = [
      null, { status: 'hub' }, { status: 'no-access' }, { status: 'signed-out' },
      { status: 'loading' }, { status: 'ready' }, { status: 'ready', locationId: null },
      { status: 'ready', locationId: 'bakery' }, { status: 'ready', locationId: 'bakery', user: {} },
    ];
    for (const s of notReady) {
      expect(await pingIfDue(s, d)).toBe('skipped');
    }
    expect(d.sent).toHaveLength(0);
  });

  test('no usable storage: nothing is sent, with a throwaway id or otherwise', async () => {
    const noStorage = deps({ storage: null });
    expect(await pingIfDue(READY, noStorage)).toBe('no-storage');
    const droppingWrites = deps({ storage: partial({ getItem: () => null, setItem: () => {} }) });
    expect(await pingIfDue(READY, droppingWrites)).toBe('no-storage');
    const blocked = () => { throw new Error('blocked'); };
    const throwing = deps({ storage: partial({ getItem: blocked, setItem: blocked }) });
    expect(await pingIfDue(READY, throwing)).toBe('no-storage');
    expect(noStorage.sent.length + droppingWrites.sent.length + throwing.sent.length).toBe(0);
  });

  test('a failed send never throws, says only the error code, and is tried again next page', async () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };
    try {
      const d = deps({ send: async () => { throw Object.assign(new Error('secret detail'), { code: 'unavailable' }); } });
      expect(await pingIfDue(READY, d)).toBe('failed');
      expect(d.storage.data[STAMP]).toBeUndefined();
      expect(warnings).toEqual(['Device count not sent: unavailable']);
    } finally { console.warn = original; }
  });

  test('a refusal by the rules is not retried on every page of the day', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const d = deps({ send: async () => { throw Object.assign(new Error('x'), { code: 'permission-denied' }); } });
      expect(await pingIfDue(READY, d)).toBe('failed');
      expect(d.storage.data[STAMP]).toBe('2026-10-09');
    } finally { warn.mockRestore(); }
  });
});

describe('deviceIdFrom', () => {
  test('a known id is kept; a damaged one is replaced', () => {
    const kept = memoryStorage({ [DEVICE_ID_KEY]: 'Ab3dEf6hIj9lMn2pQr5t' });
    expect(deviceIdFrom(kept, () => new Uint8Array(64))).toBe('Ab3dEf6hIj9lMn2pQr5t');
    const damaged = memoryStorage({ [DEVICE_ID_KEY]: 'nonsense' });
    expect(deviceIdFrom(damaged, () => Uint8Array.from({ length: 64 }, (_, i) => i))).toMatch(/^[A-Za-z0-9]{20}$/);
  });
});

describe('the keys', () => {
  test('the id and the day survive a sign-out and a venue switch', () => {
    expect(keysToClear([DEVICE_ID_KEY, PING_DAY_KEY_PREFIX + 'bakery-u1', 'device-other', 'some-cache'])).toEqual(['device-other', 'some-cache']);
    expect(KEEP_PREFIXES.some(p => DEVICE_ID_KEY.startsWith(p))).toBe(true);
  });

  test('only the two real prefixes are kept, not everything that starts with device-', () => {
    expect(KEEP_PREFIXES.includes('device-id') && KEEP_PREFIXES.includes('device-ping-')).toBe(true);
    expect(KEEP_PREFIXES.includes('device-')).toBe(false);
  });

  test('the keys are the current app\'s, so one device keeps one id and one daily ping for both apps', () => {
    expect(DEVICE_ID_KEY).toBe('device-id');
    expect(PING_DAY_KEY_PREFIX).toBe('device-ping-');
  });
});

describe('the fire-time check', () => {
  test('same venue and same account, still ready', () => {
    const a = { status: 'ready', locationId: 'bakery', user: { uid: 'u1' } };
    expect(sameSession(a, { ...a })).toBe(true);
    expect(sameSession(a, { ...a, locationId: 'loc-b' })).toBe(false);
    expect(sameSession(a, { ...a, user: { uid: 'u2' } })).toBe(false);
    expect(sameSession(a, { status: 'signed-out' })).toBe(false);
    expect(sameSession(a, { ...a, status: 'loading' })).toBe(false);
    expect(sameSession(a, null)).toBe(false);
    expect(sameSession(null, a)).toBe(false);
    expect(sameSession({ ...a, user: null }, { ...a, user: null })).toBe(false);
  });
});

// ── What Mise 2 adds: the real browser answers, and the start-up wiring ─────────────────────

describe('browserPingDeps', () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

  test('send is the one passed in; the release is Mise 2\'s own', async () => {
    const send = vi.fn(async () => {});
    const d = browserPingDeps(send);
    expect(d.send).toBe(send);
    expect(await d.version()).toBe(MISE2_VERSION);
    expect(d.storage).toBe(window.localStorage);
  });

  test('random bytes are 64 of them, enough for a 20-character id', () => {
    const bytes = browserPingDeps(async () => {}).randomBytes();
    expect(bytes).toHaveLength(64);
    expect(deviceIdFrom(memoryStorage(), () => bytes)).toMatch(/^[A-Za-z0-9]{20}$/);
  });

  test('the kind of device and installed-or-browser come from the screen, the pointer and the display mode', () => {
    let standalone = false;
    vi.stubGlobal('screen', { width: 820, height: 1180 });
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(pointer: coarse)' ? true : query === '(display-mode: standalone)' ? standalone : false,
    }));
    const d = browserPingDeps(async () => {});
    expect(d.kind()).toBe('tablet');
    expect(d.installed()).toBe(false);
    standalone = true;
    expect(d.installed()).toBe(true);
  });

  test('an iPhone home-screen app counts as installed through navigator.standalone', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const d = browserPingDeps(async () => {});
    expect(d.installed()).toBe(false);
    vi.stubGlobal('navigator', { ...navigator, standalone: true });
    expect(d.installed()).toBe(true);
  });
});

describe('startDevicePing', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const session =(uid: string, locationId = 'bakery'): TelemetrySession => ({ status: 'ready', locationId, user: { uid } });

  test('it waits for the page to settle, then pings once for the open venue', async () => {
    const d = deps();
    startDevicePing(fakeSessionSource(session('start-a')), d);
    await vi.advanceTimersByTimeAsync(START_DELAY_MS - 1);
    expect(d.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0]?.payload.uid).toBe('start-a');
  });

  test('nothing happens while no venue is open; the ping follows once one opens', async () => {
    const d = deps();
    const source = fakeSessionSource({ status: 'loading' });
    startDevicePing(source, d);
    source.set({ status: 'choose-location' });
    await vi.advanceTimersByTimeAsync(START_DELAY_MS * 2);
    expect(d.sent).toHaveLength(0);
    source.set(session('start-b'));
    await vi.advanceTimersByTimeAsync(START_DELAY_MS + 1);
    expect(d.sent).toHaveLength(1);
  });

  test('⚠️ the session is re-read when the timer fires: a person who signed out in the meantime is not pinged', async () => {
    const d = deps();
    const source = fakeSessionSource(session('start-c'));
    startDevicePing(source, d);
    await vi.advanceTimersByTimeAsync(1000);
    source.set({ status: 'signed-out' });
    await vi.advanceTimersByTimeAsync(START_DELAY_MS * 2);
    expect(d.sent).toHaveLength(0);
  });

  test('⚠️ nor is the line written under the wrong venue or account: whoever is signed in NOW is the one pinged', async () => {
    const d = deps();
    const source = fakeSessionSource(session('start-d'));
    startDevicePing(source, d);
    await vi.advanceTimersByTimeAsync(1000);
    source.set(session('start-e', 'loc-b'));
    await vi.advanceTimersByTimeAsync(START_DELAY_MS * 2);
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0]?.payload).toMatchObject({ bakery: 'loc-b', uid: 'start-e' });
  });

  test('the same session announced twice is still pinged once', async () => {
    const d = deps();
    const source = fakeSessionSource(session('start-f'));
    startDevicePing(source, d);
    source.set(session('start-f'));
    source.set(session('start-f'));
    await vi.advanceTimersByTimeAsync(START_DELAY_MS + 1);
    expect(d.sent).toHaveLength(1);
  });

  test('the stop function takes the listener away and cancels a ping that has not fired', async () => {
    const d = deps();
    const source = fakeSessionSource(session('start-g'));
    const stop = startDevicePing(source, d);
    expect(source.listening()).toBe(1);
    stop();
    expect(source.listening()).toBe(0);
    await vi.advanceTimersByTimeAsync(START_DELAY_MS * 2);
    expect(d.sent).toHaveLength(0);
  });

  test('a session source that fails cannot break the start; it says only the code', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const broken: SessionSource = {
        getSnapshot: () => { throw Object.assign(new Error('secret'), { code: 'internal' }); },
        subscribe: () => () => {},
      };
      let stop = (): void => {};
      expect(() => { stop = startDevicePing(broken, deps()); }).not.toThrow();
      expect(() => stop()).not.toThrow();
      expect(warn).toHaveBeenCalledWith('Device count not started:', 'internal');
    } finally { warn.mockRestore(); }
  });
});
