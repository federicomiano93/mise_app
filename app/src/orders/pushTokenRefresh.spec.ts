// pushTokenRefresh.ts — keeping this phone's alert registration younger than the nightly clean-up's 60 days.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { keysToClear } from '@mise/shared/local-data';
import type { KeyValueStorage } from '../session/backend';
import type { FirestoreKit } from '../session/firebaseBackend';
import type { TelemetrySession } from '../telemetry/common';
import { fakeSessionSource } from '../testing/fakeSessionSource';
import { PUSH_TOKEN_KEY, PUSH_TOKEN_OWNER_KEY } from './phoneMute';
import {
  ASK_AGAIN_MS, REFRESH_EVERY_MS, REFRESH_STAMP_KEY, START_DELAY_MS,
  browserRefreshDeps, refreshDue, refreshIfDue, startPushTokenRefresh, tokenWriter,
  type RefreshDeps, type TokenStamp,
} from './pushTokenRefresh';

interface MemoryStorage extends KeyValueStorage { data: Record<string, string> }
function memoryStorage(initial: Record<string, string> = {}): MemoryStorage {
  const data: Record<string, string> = { ...initial };
  return {
    getItem: k => (k in data ? (data[k] as string) : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
    data,
  };
}

const NOW = Date.UTC(2026, 10, 18, 9, 0);
const READY: TelemetrySession = { status: 'ready', locationId: 'bakery', user: { uid: 'u1' } };

interface Written { lid: string; token: string; stamp: TokenStamp }
type Deps = RefreshDeps & { written: Written[]; storage: MemoryStorage };

function deps(over: Partial<RefreshDeps> = {}): Deps {
  const written: Written[] = [];
  return {
    written,
    storage: memoryStorage(),
    token: () => 'tok:abc-123',
    tokenOwner: () => 'u1',
    now: () => NOW,
    online: () => true,
    notificationsGranted: () => true,
    write: async (lid, token, stamp) => { written.push({ lid, token, stamp }); },
    ...over,
  } as Deps;
}
const stampOf = (d: Deps) => JSON.parse(d.storage.data[REFRESH_STAMP_KEY] ?? 'null') as unknown;
const stamped = (at: number, lid = 'bakery', uid = 'u1') => ({ [REFRESH_STAMP_KEY]: JSON.stringify({ lid, uid, at }) });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warn.mockRestore(); vi.useRealTimers(); });

describe('refreshIfDue', () => {
  test('writes exactly bakery, uid and the time onto this phone\'s token, then stamps the venue and person', async () => {
    const d = deps();
    expect(await refreshIfDue(READY, d)).toBe('sent');
    expect(d.written).toStrictEqual([{ lid: 'bakery', token: 'tok:abc-123', stamp: { bakery: 'bakery', uid: 'u1', updatedAt: NOW } }]);
    expect(stampOf(d)).toStrictEqual({ lid: 'bakery', uid: 'u1', at: NOW });
  });

  test('at most once a week: not again inside seven days, again from the seventh', async () => {
    const d1 = deps({ now: () => NOW + REFRESH_EVERY_MS - 1 });
    Object.assign(d1.storage.data, stamped(NOW));
    expect(await refreshIfDue(READY, d1)).toBe('not-due');
    expect(d1.written).toHaveLength(0);

    const d2 = deps({ now: () => NOW + REFRESH_EVERY_MS });
    Object.assign(d2.storage.data, stamped(NOW));
    expect(await refreshIfDue(READY, d2)).toBe('sent');
  });

  test('a stamp written for another venue, another person, the future or in a broken shape is not believed', async () => {
    for (const initial of [stamped(NOW, 'other-venue'), stamped(NOW, 'bakery', 'u2'), stamped(NOW + 60_000),
      { [REFRESH_STAMP_KEY]: '{not json' }, { [REFRESH_STAMP_KEY]: JSON.stringify({ lid: 'bakery', uid: 'u1', at: 'today' }) }]) {
      const d = deps();
      Object.assign(d.storage.data, initial);
      expect(await refreshIfDue(READY, d)).toBe('sent');
    }
    expect(refreshDue(null, 'bakery', 'u1', NOW)).toBe(true);
  });

  test('nothing without a ready session with a venue and a person', async () => {
    for (const session of [null, undefined, { status: 'loading' }, { status: 'signed-out' },
      { status: 'ready', locationId: null, user: { uid: 'u1' } }, { status: 'ready', locationId: 'bakery', user: null }] as TelemetrySession[]) {
      const d = deps();
      expect(await refreshIfDue(session, d)).toBe('skipped');
      expect(d.written).toHaveLength(0);
    }
  });

  test('nothing for a phone with no usable token', async () => {
    for (const token of ['', 'a/b', 'x'.repeat(4097)]) {
      const d = deps({ token: () => token });
      expect(await refreshIfDue(READY, d)).toBe('no-token');
      expect(d.written).toHaveLength(0);
    }
  });

  // ⚠️ A shared phone may still carry the previous person's registration: re-writing it in this person's name would move
  // their alerts here without anybody tapping anything.
  test('nothing when the token was registered for somebody else, or for nobody known', async () => {
    for (const owner of ['u2', '']) {
      const d = deps({ tokenOwner: () => owner });
      expect(await refreshIfDue(READY, d)).toBe('not-owner');
      expect(d.written).toHaveLength(0);
      expect(d.storage.data[REFRESH_STAMP_KEY]).toBeUndefined();
    }
  });

  // ⚠️ A phone that blocked notifications must let its row age out; granted again later, the next open refreshes it.
  test('nothing and no stamp while notifications are blocked or not asked yet', async () => {
    for (const permission of ['denied', 'default']) {
      vi.stubGlobal('Notification', { permission });
      const d = deps({ ...browserRefreshDeps(async () => {}), storage: memoryStorage(), token: () => 'tok:abc-123', tokenOwner: () => 'u1' });
      const written: unknown[] = [];
      d.write = async (...args) => { written.push(args); };
      expect(await refreshIfDue(READY, d)).toBe('not-granted');
      expect(written).toHaveLength(0);
      expect(d.storage?.getItem(REFRESH_STAMP_KEY)).toBeNull();
    }
    vi.stubGlobal('Notification', { permission: 'granted' });
    const g = deps({ ...browserRefreshDeps(async () => {}), storage: memoryStorage(), token: () => 'tok:abc-123', tokenOwner: () => 'u1' });
    const written: unknown[] = [];
    g.write = async (...args) => { written.push(args); };
    expect(await refreshIfDue(READY, g)).toBe('sent');
    expect(written).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  test('nothing offline, and no stamp, so the signal coming back asks again', async () => {
    const d = deps({ online: () => false });
    expect(await refreshIfDue(READY, d)).toBe('offline');
    expect(d.written).toHaveLength(0);
    expect(d.storage.data[REFRESH_STAMP_KEY]).toBeUndefined();
  });

  test('nothing without storage', async () => {
    const d = deps({ storage: null });
    expect(await refreshIfDue(READY, d)).toBe('skipped');
    expect(d.written).toHaveLength(0);
  });

  test('a passing failure removes the stamp (asked again next page); a refusal by the rules keeps it', async () => {
    const passing = deps({ write: async () => { throw Object.assign(new Error('x'), { code: 'unavailable' }); } });
    expect(await refreshIfDue(READY, passing)).toBe('failed');
    expect(passing.storage.data[REFRESH_STAMP_KEY]).toBeUndefined();

    const refused = deps({ write: async () => { throw Object.assign(new Error('x'), { code: 'permission-denied' }); } });
    expect(await refreshIfDue(READY, refused)).toBe('failed');
    expect(stampOf(refused)).toStrictEqual({ lid: 'bakery', uid: 'u1', at: NOW });
  });

  test('never throws: a write that throws at once, a storage that refuses, a token getter that breaks', async () => {
    expect(await refreshIfDue(READY, deps({ write: () => { throw new Error('sync'); } }))).toBe('failed');
    const full = deps();
    full.storage.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(await refreshIfDue(READY, full)).toBe('failed');
    expect(await refreshIfDue(READY, deps({ token: () => { throw new Error('blocked'); } }))).toBe('failed');
  });

  test('the console says the error code and nothing else', async () => {
    await refreshIfDue(READY, deps({ write: async () => { throw Object.assign(new Error('locations/bakery/fcm-tokens/tok:abc-123'), { code: 'unavailable' }); } }));
    expect(warn).toHaveBeenCalledWith('Push registration not refreshed:', 'unavailable');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('tok:abc-123');
  });

  test('two announcements of the same session write once', async () => {
    let release = (): void => {};
    const d = deps({ write: () => new Promise<void>(resolve => { release = resolve; }) });
    const first = refreshIfDue(READY, d);
    // The first has stamped already, so the second is not due either way.
    expect(await refreshIfDue(READY, d)).toBe('not-due');
    release();
    expect(await first).toBe('sent');
  });
});

describe('tokenWriter', () => {
  function kitWith(updateDoc: (...args: unknown[]) => Promise<void>, calls: unknown[][], created: unknown[][] = []): FirestoreKit {
    return {
      db: { id: 'db' },
      fs: {
        doc: (...args: unknown[]) => ({ path: args.slice(1).join('/') }),
        updateDoc: async (...args: unknown[]) => { calls.push(args); await updateDoc(...args); },
        setDoc: async (...args: unknown[]) => { created.push(args); },
      },
    } as unknown as FirestoreKit;
  }
  const STAMP = { bakery: 'bakery', uid: 'u1', updatedAt: NOW };

  test('one UPDATE of the stamp onto locations/{lid}/fcm-tokens/{token}, through the backend’s Firestore', async () => {
    const calls: unknown[][] = [];
    const created: unknown[][] = [];
    const firestore = vi.fn(async () => kitWith(async () => {}, calls, created));
    await tokenWriter(firestore)('bakery', 'tok:abc', STAMP);
    expect(firestore).toHaveBeenCalledOnce();
    expect(calls).toStrictEqual([[{ path: 'locations/bakery/fcm-tokens/tok:abc' }, STAMP]]);
    expect(created).toHaveLength(0);
  });

  // ⚠️ A row the server deleted on purpose (a dead token, a removed member's phone) must stay deleted.
  test('a row that is gone (not-found) is never re-created and is not an error', async () => {
    const calls: unknown[][] = [];
    const created: unknown[][] = [];
    const gone = async () => { throw Object.assign(new Error('x'), { code: 'not-found' }); };
    await expect(tokenWriter(async () => kitWith(gone, calls, created))('bakery', 'tok:abc', STAMP)).resolves.toBeUndefined();
    expect(created).toHaveLength(0);
  });

  test('a not-found keeps the stamp, so it is not asked again on every open', async () => {
    const calls: unknown[][] = [];
    const gone = async () => { throw Object.assign(new Error('x'), { code: 'not-found' }); };
    const d = deps({ write: tokenWriter(async () => kitWith(gone, calls)) });
    expect(await refreshIfDue(READY, d)).toBe('sent');
    expect(stampOf(d)).toStrictEqual({ lid: 'bakery', uid: 'u1', at: NOW });
  });

  test('any other error still throws', async () => {
    const down = async () => { throw Object.assign(new Error('x'), { code: 'unavailable' }); };
    await expect(tokenWriter(async () => kitWith(down, []))('bakery', 'tok:abc', STAMP)).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('browserRefreshDeps', () => {
  afterEach(() => localStorage.clear());

  test('reads the current app\'s token and owner keys', () => {
    const d = browserRefreshDeps(async () => {});
    expect([d.token(), d.tokenOwner()]).toStrictEqual(['', '']);
    localStorage.setItem(PUSH_TOKEN_KEY, 'tok');
    localStorage.setItem(PUSH_TOKEN_OWNER_KEY, 'u1');
    expect([d.token(), d.tokenOwner()]).toStrictEqual(['tok', 'u1']);
    expect(PUSH_TOKEN_OWNER_KEY).toBe('push-token-uid');
  });
});

describe('the stamp lives and dies with the registration', () => {
  // ⚠️ The token and its owner key are wiped by a sign-out or a venue switch; the stamp must go with them, or a stamp
  // written for one registration would hold back the refresh of the next (shared/src/local-data.spec.ts pins the same
  // through both apps' keysToClear).
  test('sign-out and a venue switch wipe the stamp, the token and its owner', () => {
    const keys = [REFRESH_STAMP_KEY, PUSH_TOKEN_KEY, PUSH_TOKEN_OWNER_KEY];
    expect(keysToClear(keys)).toStrictEqual(keys);
  });
});

describe('startPushTokenRefresh', () => {
  test('refreshes a moment after a venue opens, for whoever is signed in then', async () => {
    vi.useFakeTimers();
    const source = fakeSessionSource({ status: 'loading' });
    const d = deps();
    const stop = startPushTokenRefresh(source, d);
    source.set(READY);
    await vi.advanceTimersByTimeAsync(START_DELAY_MS - 1);
    expect(d.written).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(d.written).toHaveLength(1);
    stop();
  });

  test('nothing when the person or the venue changed before the moment came', async () => {
    vi.useFakeTimers();
    const source = fakeSessionSource(READY);
    const d = deps();
    const stop = startPushTokenRefresh(source, d);
    source.set({ status: 'signed-out' });
    await vi.advanceTimersByTimeAsync(START_DELAY_MS);
    expect(d.written).toHaveLength(0);
    stop();
  });

  test('a page left open asks again every few hours, and writes only when a week has passed', async () => {
    vi.useFakeTimers();
    let now = NOW;
    const source = fakeSessionSource(READY);
    const d = deps({ now: () => now });
    const stop = startPushTokenRefresh(source, d);
    await vi.advanceTimersByTimeAsync(START_DELAY_MS);
    expect(d.written).toHaveLength(1);
    now += ASK_AGAIN_MS;
    await vi.advanceTimersByTimeAsync(ASK_AGAIN_MS);
    expect(d.written).toHaveLength(1);
    now = NOW + REFRESH_EVERY_MS;
    await vi.advanceTimersByTimeAsync(ASK_AGAIN_MS);
    expect(d.written).toHaveLength(2);
    stop();
  });

  test('the signal coming back asks again; stop() ends every listener and timer', async () => {
    vi.useFakeTimers();
    let online = false;
    const source = fakeSessionSource(READY);
    const d = deps({ online: () => online });
    const stop = startPushTokenRefresh(source, d);
    await vi.advanceTimersByTimeAsync(START_DELAY_MS);
    expect(d.written).toHaveLength(0);
    online = true;
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(d.written).toHaveLength(1);

    stop();
    expect(source.listening()).toBe(0);
    d.storage.removeItem(REFRESH_STAMP_KEY);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(ASK_AGAIN_MS);
    expect(d.written).toHaveLength(1);
  });

  test('a broken session source never stops the app', () => {
    const broken = { getSnapshot: () => { throw new Error('x'); }, subscribe: () => () => {} };
    expect(() => startPushTokenRefresh(broken, deps())()).not.toThrow();
  });
});
