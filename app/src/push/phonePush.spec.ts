import { afterEach, describe, expect, test, vi } from 'vitest';
import type { KeyValueStorage } from '../session/backend';
import { browserPushEnv, createPhonePush, FORGET_TIMEOUT_MS, rowWriter } from './phonePush';
import type { PhonePushDeps, PushEnv } from './phonePush';

// Registering this phone for server push: js/push.js's pushSupport / enablePush / rememberToken / pushOnForMe, with the browser
// and Firebase replaced.

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); },
  };
}

function env({ permission: start = 'default', ...over }: Omit<Partial<PushEnv>, 'permission'> & { permission?: NotificationPermission } = {}): PushEnv {
  let permission: NotificationPermission = start;
  return {
    hasNotification: () => true,
    hasServiceWorker: () => true,
    hasPushManager: () => true,
    isIOS: () => false,
    isStandalone: () => false,
    permission: () => permission,
    requestPermission: vi.fn(async () => { permission = 'granted'; return permission; }),
    ...over,
  };
}

const READY = { status: 'ready', locationId: 'bakery', user: { uid: 'u1' } } as const;

function setup(over: Partial<PhonePushDeps> = {}, stored: Record<string, string> = {}) {
  const storage = memoryStorage(stored);
  const writeRow = vi.fn<PhonePushDeps['writeRow']>(async () => undefined);
  const deleteRow = vi.fn<PhonePushDeps['deleteRow']>(async () => undefined);
  const getToken = vi.fn(async () => 'tok-1');
  const deps: PhonePushDeps = {
    env: env({ permission: 'granted' }),
    vapidKey: 'KEY',
    storage,
    session: () => READY,
    online: () => true,
    now: () => 1234,
    getToken,
    writeRow,
    deleteRow,
    ...over,
  };
  return { push: createPhonePush(deps), storage, writeRow, deleteRow, getToken, deps };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('support: why a phone can or cannot receive', () => {
  test('granted, ask, blocked', () => {
    expect(setup({ env: env({ permission: 'granted' }) }).push.support()).toBe('granted');
    expect(setup({ env: env({ permission: 'default' }) }).push.support()).toBe('ask');
    expect(setup({ env: env({ permission: 'denied' }) }).push.support()).toBe('blocked');
  });

  test('no push machinery: unsupported, or on an iPhone outside the Home-screen app, install first', () => {
    expect(setup({ env: env({ hasPushManager: () => false }) }).push.support()).toBe('unsupported');
    expect(setup({ env: env({ hasNotification: () => false }) }).push.support()).toBe('unsupported');
    expect(setup({ env: env({ hasServiceWorker: () => false }) }).push.support()).toBe('unsupported');
    expect(setup({ env: env({ hasNotification: () => false, isIOS: () => true, isStandalone: () => false }) }).push.support())
      .toBe('install-first');
    // Added to the Home screen: the API is back in a real iPhone; if it is still absent it is plainly unsupported.
    expect(setup({ env: env({ hasNotification: () => false, isIOS: () => true, isStandalone: () => true }) }).push.support())
      .toBe('unsupported');
  });

  test('no web-push key (the preview project): not configured, whatever the permission', () => {
    expect(setup({ vapidKey: '' }).push.support()).toBe('not-configured');
    expect(setup({ vapidKey: '', env: env({ permission: 'denied' }) }).push.support()).toBe('not-configured');
  });

  test('a browser that throws on the question says unsupported', () => {
    const throwing = env({ permission: 'granted' });
    throwing.permission = () => { throw new Error('boom'); };
    expect(setup({ env: throwing }).push.support()).toBe('unsupported');
  });
});

describe('register', () => {
  test('⚠️ asks the permission only when it is still «default»', async () => {
    const asking = env({ permission: 'default' });
    const first = setup({ env: asking });
    expect(await first.push.register()).toBe('on');
    expect(asking.requestPermission).toHaveBeenCalledTimes(1);

    const already = env({ permission: 'granted' });
    const second = setup({ env: already });
    expect(await second.push.register()).toBe('on');
    expect(already.requestPermission).not.toHaveBeenCalled();
  });

  test('a refused prompt answers blocked, a dismissed one answers ask, and nothing is written', async () => {
    const refusing = env({ permission: 'default', requestPermission: vi.fn(async () => 'denied' as const) });
    const a = setup({ env: refusing });
    expect(await a.push.register()).toBe('blocked');
    const dismissing = env({ permission: 'default', requestPermission: vi.fn(async () => 'default' as const) });
    const b = setup({ env: dismissing });
    expect(await b.push.register()).toBe('ask');
    for (const run of [a, b]) {
      expect(run.getToken).not.toHaveBeenCalled();
      expect(run.writeRow).not.toHaveBeenCalled();
    }
  });

  test('a blocked, unsupported, install-first or unconfigured phone answers that reason and does nothing', async () => {
    const cases: Array<[Partial<PhonePushDeps>, string]> = [
      [{ env: env({ permission: 'denied' }) }, 'blocked'],
      [{ env: env({ hasNotification: () => false }) }, 'unsupported'],
      [{ env: env({ hasPushManager: () => false, isIOS: () => true }) }, 'install-first'],
    ];
    for (const [over, reason] of cases) {
      const run = setup(over);
      expect(await run.push.register()).toBe(reason);
      expect(run.getToken).not.toHaveBeenCalled();
      expect(run.writeRow).not.toHaveBeenCalled();
    }
  });

  test('⚠️ writes ONE merged row of exactly {bakery, uid, updatedAt, muteOrderRequests} and remembers the token under the current app\'s keys', async () => {
    const run = setup();
    expect(await run.push.register()).toBe('on');
    expect(run.writeRow).toHaveBeenCalledTimes(1);
    expect(run.writeRow).toHaveBeenCalledWith('bakery', 'tok-1', { bakery: 'bakery', uid: 'u1', updatedAt: 1234, muteOrderRequests: false });
    expect(Object.keys((run.writeRow.mock.calls[0] as unknown[])[2] as object).sort()).toEqual(['bakery', 'muteOrderRequests', 'uid', 'updatedAt']);
    expect(run.storage.data.get('push-token')).toBe('tok-1');
    expect(run.storage.data.get('push-token-uid')).toBe('u1');
    expect(run.deleteRow).not.toHaveBeenCalled();
    expect(run.push.onForMe('u1')).toBe(true);
  });

  test('a rotated token: the new row is written, the old row is deleted', async () => {
    const run = setup({}, { 'push-token': 'old-tok', 'push-token-uid': 'u1' });
    expect(await run.push.register()).toBe('on');
    expect(run.deleteRow).toHaveBeenCalledWith('bakery', 'old-tok');
    expect(run.storage.data.get('push-token')).toBe('tok-1');
  });

  test('the same token again: nothing is deleted (it would delete the row just written)', async () => {
    const run = setup({}, { 'push-token': 'tok-1', 'push-token-uid': 'somebody-else' });
    expect(await run.push.register()).toBe('on');
    expect(run.deleteRow).not.toHaveBeenCalled();
    expect(run.storage.data.get('push-token-uid')).toBe('u1');
  });

  test('a failing delete of the old row is ignored', async () => {
    const deleteRow = vi.fn(async () => { throw Object.assign(new Error('nope'), { code: 'permission-denied' }); });
    const run = setup({ deleteRow }, { 'push-token': 'old-tok' });
    expect(await run.push.register()).toBe('on');
    expect(deleteRow).toHaveBeenCalled();
  });

  test('⚠️ offline: no token asked for, nothing written, nothing remembered', async () => {
    const run = setup({ online: () => false });
    expect(await run.push.register()).toBe('failed');
    expect(run.getToken).not.toHaveBeenCalled();
    expect(run.writeRow).not.toHaveBeenCalled();
    expect(run.storage.data.size).toBe(0);
  });

  test('no open venue or nobody signed in: failed, nothing written', async () => {
    for (const session of [() => null, () => ({ status: 'signed-out' }), () => ({ status: 'ready', locationId: null, user: { uid: 'u1' } })]) {
      const run = setup({ session });
      expect(await run.push.register()).toBe('failed');
      expect(run.writeRow).not.toHaveBeenCalled();
    }
  });

  test('⚠️ a failure answers failed, never throws, and logs the error CODE only — never the token', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const writeRow = vi.fn(async () => {
      throw Object.assign(new Error('Missing permissions at locations/bakery/fcm-tokens/tok-1'), { code: 'permission-denied' });
    });
    const run = setup({ writeRow });
    await expect(run.push.register()).resolves.toBe('failed');
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('permission-denied');
    expect(logged).not.toContain('tok-1');
    expect(run.storage.data.size).toBe(0);
  });

  test('a token request that fails (the SDK refuses) answers failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const run = setup({ getToken: vi.fn(async () => { throw Object.assign(new Error('x'), { code: 'messaging/token-subscribe-failed' }); }) });
    await expect(run.push.register()).resolves.toBe('failed');
    expect(JSON.stringify(warn.mock.calls)).toContain('messaging/token-subscribe-failed');
    expect(run.writeRow).not.toHaveBeenCalled();
  });

  test('an empty or unusable token (a «/» would name another document) answers failed', async () => {
    for (const bad of ['', 'a/b']) {
      const run = setup({ getToken: async () => bad });
      expect(await run.push.register()).toBe('failed');
      expect(run.writeRow).not.toHaveBeenCalled();
    }
  });

  test('a write the server never confirms answers failed after the time limit', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const run = setup({ writeRow: () => new Promise(() => undefined), writeTimeoutMs: 500 });
      const answer = run.push.register();
      await vi.advanceTimersByTimeAsync(600);
      await expect(answer).resolves.toBe('failed');
      expect(run.storage.data.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test('storage that refuses the write: failed, so the screen does not say «on» for a phone that will not remember it', async () => {
    const storage = memoryStorage();
    storage.setItem = () => { throw new Error('quota'); };
    const run = setup({ storage });
    expect(await run.push.register()).toBe('failed');
  });
});

describe('register: the later rules', () => {
  test('⚠️ the row says what this phone’s switch draws, so a fresh device rings and a muted one stays muted', async () => {
    const fresh = setup();
    await fresh.push.register();
    expect(fresh.writeRow.mock.calls[0]?.[2]).toMatchObject({ muteOrderRequests: false });
    const muted = setup({}, { 'push-mute-order-requests': '1' });
    await muted.push.register();
    expect(muted.writeRow.mock.calls[0]?.[2]).toMatchObject({ muteOrderRequests: true });
  });

  test('a token that never arrives answers failed after the time limit, writing nothing', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const run = setup({ getToken: () => new Promise<string>(() => undefined), writeTimeoutMs: 500 });
      const answer = run.push.register();
      await vi.advanceTimersByTimeAsync(600);
      await expect(answer).resolves.toBe('failed');
      expect(run.writeRow).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  test('⚠️ the venue switched during the write: nothing is remembered', async () => {
    let current: { status: string; locationId: string; user: { uid: string } } = { ...READY, user: { uid: 'u1' } };
    const writeRow = vi.fn(async () => { current = { ...current, locationId: 'cafe' }; });
    const run = setup({ writeRow, session: () => current });
    expect(await run.push.register()).toBe('failed');
    expect(run.storage.data.size).toBe(0);
  });

  test('the person changed during the write: nothing is remembered', async () => {
    let current: { status: string; locationId: string; user: { uid: string } } = { ...READY, user: { uid: 'u1' } };
    const writeRow = vi.fn(async () => { current = { ...current, user: { uid: 'u2' } }; });
    const run = setup({ writeRow, session: () => current });
    expect(await run.push.register()).toBe('failed');
    expect(run.storage.data.size).toBe(0);
  });
});

describe('permission-only mode', () => {
  test('a browser with notifications but no push machinery, or no key, only asks the permission', async () => {
    for (const over of [{ vapidKey: '' }, { env: env({ permission: 'default', hasPushManager: () => false }) }]) {
      const asking = over.env ?? env({ permission: 'default' });
      const run = setup({ ...over, env: asking });
      expect(run.push.permissionOnly()).toBe('default');
      expect(await run.push.register()).toBe('on');
      expect(asking.requestPermission).toHaveBeenCalledTimes(1);
      expect(run.getToken).not.toHaveBeenCalled();
      expect(run.writeRow).not.toHaveBeenCalled();
      expect(run.push.permissionOnly()).toBe('granted');
    }
  });

  test('a refused prompt says blocked; a normal phone and an iPhone-to-install are not in this mode', async () => {
    const refusing = env({ permission: 'default', requestPermission: vi.fn(async () => 'denied' as const) });
    expect(await setup({ vapidKey: '', env: refusing }).push.register()).toBe('blocked');
    expect(setup().push.permissionOnly()).toBeNull();
    expect(setup({ env: env({ hasNotification: () => false, hasPushManager: () => false }) }).push.permissionOnly()).toBeNull();
    expect(setup({ env: env({ hasPushManager: () => false, isIOS: () => true }) }).push.permissionOnly()).toBeNull();
  });
});

describe('verify: a phone that says «on» but lost its subscription', () => {
  const owned = { 'push-token': 'tok-1', 'push-token-uid': 'u1' };

  test('⚠️ no subscription: both keys are cleared, so the button comes back', async () => {
    const run = setup({ hasSubscription: async () => false }, owned);
    expect(run.push.onForMe('u1')).toBe(true);
    expect(await run.push.verify()).toBe('cleared');
    expect(run.storage.data.has('push-token')).toBe(false);
    expect(run.storage.data.has('push-token-uid')).toBe(false);
    expect(run.push.onForMe('u1')).toBe(false);
  });

  test('a subscription present leaves everything as it is', async () => {
    const run = setup({ hasSubscription: async () => true }, owned);
    expect(await run.push.verify()).toBe('ok');
    expect(run.push.onForMe('u1')).toBe(true);
  });

  test('cannot tell (null, a throw, a worker that never gets ready, or no check on a local address): nothing is cleared', async () => {
    for (const hasSubscription of [async () => null, async () => { throw new Error('x'); }, () => new Promise<boolean>(() => undefined), undefined]) {
      vi.useFakeTimers();
      try {
        const run = setup({ hasSubscription, writeTimeoutMs: 100 }, owned);
        const answer = run.push.verify();
        await vi.advanceTimersByTimeAsync(200);
        expect(await answer).toBe('unknown');
        expect(run.push.onForMe('u1')).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    }
  });

  test('not asked when there is no token or the permission is not granted', async () => {
    const check = vi.fn(async () => false);
    expect(await setup({ hasSubscription: check }).push.verify()).toBe('unknown');
    expect(await setup({ hasSubscription: check, env: env({ permission: 'denied' }) }, owned).push.verify()).toBe('unknown');
    expect(check).not.toHaveBeenCalled();
  });
});

describe('onForMe', () => {
  test('⚠️ a token registered for somebody else is not mine', () => {
    const run = setup({}, { 'push-token': 'tok-1', 'push-token-uid': 'u2' });
    expect(run.push.onForMe('u1')).toBe(false);
    expect(run.push.onForMe('u2')).toBe(true);
  });

  test('no token, no owner, no person, or no permission: not registered', () => {
    expect(setup({}, {}).push.onForMe('u1')).toBe(false);
    expect(setup({}, { 'push-token': 'tok-1' }).push.onForMe('u1')).toBe(false);
    expect(setup({}, { 'push-token': 'tok-1', 'push-token-uid': 'u1' }).push.onForMe('')).toBe(false);
    expect(setup({ env: env({ permission: 'denied' }) }, { 'push-token': 'tok-1', 'push-token-uid': 'u1' }).push.onForMe('u1')).toBe(false);
    expect(setup({ storage: null }, {}).push.onForMe('u1')).toBe(false);
  });
});

// ⚠️ Security audit A2-1: sign-out deletes this phone's row, only when it is this account's, and never traps the sign-out.
describe('forgetThisPhone', () => {
  const OWNED = { 'push-token': 'tok-1', 'push-token-uid': 'u1' };

  test('deletes exactly this phone\'s row when the owner matches', async () => {
    const { push, deleteRow } = setup({}, OWNED);
    await push.forgetThisPhone();
    expect(deleteRow).toHaveBeenCalledOnce();
    expect(deleteRow).toHaveBeenCalledWith('bakery', 'tok-1');
  });

  // Should the sign-out then fail, Settings must offer «Enable» again, not draw «on» for a row that is gone.
  test('after the row is gone, this phone no longer says it is registered', async () => {
    const { push, storage } = setup({}, OWNED);
    expect(push.onForMe('u1')).toBe(true);
    await push.forgetThisPhone();
    expect(storage.getItem('push-token')).toBeNull();
    expect(storage.getItem('push-token-uid')).toBeNull();
    expect(push.onForMe('u1')).toBe(false);
  });

  test('a delete that fails leaves the registration as it was', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { push, storage } = setup({ deleteRow: vi.fn(async () => { throw new Error('x'); }) }, OWNED);
    await push.forgetThisPhone();
    expect(storage.getItem('push-token')).toBe('tok-1');
  });

  // A phone the current app registered before `push-token-uid` existed: the rules refuse anybody else's row, so trying is safe.
  test('a stored token with no recorded owner is tried too', async () => {
    const { push, deleteRow } = setup({}, { 'push-token': 'tok-1' });
    await push.forgetThisPhone();
    expect(deleteRow).toHaveBeenCalledWith('bakery', 'tok-1');
  });

  test.each([
    ['another account owns the stored token', {}, { 'push-token': 'tok-1', 'push-token-uid': 'other' }],
    ['the stored token is empty', {}, { 'push-token': '', 'push-token-uid': 'u1' }],
    ['no token is stored', {}, {}],
    ['only an owner is stored', {}, { 'push-token-uid': 'u1' }],
    ['the phone is offline', { online: () => false }, OWNED],
    ['no venue is open', { session: () => ({ status: 'ready', user: { uid: 'u1' } }) as never }, OWNED],
    ['nobody is signed in', { session: () => ({ status: 'ready', locationId: 'bakery' }) as never }, OWNED],
  ])('no delete when %s', async (_name, over, stored) => {
    const { push, deleteRow } = setup(over as Partial<PhonePushDeps>, stored);
    await push.forgetThisPhone();
    expect(deleteRow).not.toHaveBeenCalled();
  });

  test('a delete that rejects never throws, and the log carries the code alone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = Object.assign(new Error('locations/bakery/fcm-tokens/tok-1 refused'), { code: 'permission-denied' });
    const { push } = setup({ deleteRow: vi.fn(async () => { throw err; }) }, OWNED);
    await expect(push.forgetThisPhone()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).toContain('permission-denied');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('tok-1');
  });

  test('a delete that hangs is given up on after the time limit', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { push } = setup({ deleteRow: () => new Promise(() => {}) }, OWNED);
      let done = false;
      const run = push.forgetThisPhone().then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(FORGET_TIMEOUT_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      await run;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a deleteRow that throws at once (not a rejected promise) still does not throw', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { push } = setup({ deleteRow: () => { throw new Error('sync'); } }, OWNED);
    await expect(push.forgetThisPhone()).resolves.toBeUndefined();
  });
});

describe('rowWriter: the real write', () => {
  test('⚠️ setDoc with {merge: true} on locations/{lid}/fcm-tokens/{token}, and deleteDoc for the old row', async () => {
    const setDoc = vi.fn(async () => undefined);
    const deleteDoc = vi.fn(async () => undefined);
    const doc = vi.fn((_db: unknown, path: string, id: string) => ({ path: `${path}/${id}` }));
    const kit = { fs: { setDoc, deleteDoc, doc }, db: 'db' } as unknown as Awaited<ReturnType<Parameters<typeof rowWriter>[0]>>;
    const writer = rowWriter(async () => kit);
    await writer.writeRow('bakery', 'tok-1', { bakery: 'bakery', uid: 'u1', updatedAt: 5, muteOrderRequests: false });
    expect(setDoc).toHaveBeenCalledWith({ path: 'locations/bakery/fcm-tokens/tok-1' }, { bakery: 'bakery', uid: 'u1', updatedAt: 5, muteOrderRequests: false }, { merge: true });
    await writer.deleteRow('bakery', 'old');
    expect(deleteDoc).toHaveBeenCalledWith({ path: 'locations/bakery/fcm-tokens/old' });
  });
});

describe('browserPushEnv: the installed app in every display mode', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  test('the PC app with its title bar folded into the page (window-controls-overlay) is standalone too', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: /display-mode: window-controls-overlay/.test(query) }));
    expect(browserPushEnv().isStandalone()).toBe(true);
  });

  test('a browser tab is not', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(browserPushEnv().isStandalone()).toBe(false);
  });
});
