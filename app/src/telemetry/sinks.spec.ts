import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { Auth } from 'firebase/auth';
import { addDoc, setDoc, type Firestore } from 'firebase/firestore';
import { browserConnectivity, createTelemetrySinks, type Connectivity } from './sinks';

// sinks.ts is the only place the telemetry reaches Firestore, and firestore.rules accept exactly
// the shapes it writes (see its header). Firestore itself is replaced: what is pinned here is
// WHAT is written and WHERE, which no other spec sees.
const SERVER_TIME = { sentinel: 'serverTimestamp' };

vi.mock('firebase/firestore', () => ({
  addDoc: vi.fn(async () => ({ id: 'new-document' })),
  setDoc: vi.fn(async () => undefined),
  collection: vi.fn((_db: unknown, path: string) => ({ type: 'collection', path })),
  doc: vi.fn((_db: unknown, path: string, id?: string) => ({ type: 'document', path: id === undefined ? path : `${path}/${id}` })),
  serverTimestamp: vi.fn(() => ({ sentinel: 'serverTimestamp' })),
}));

const db = {} as Firestore;

function setup(uid: string | null = 'u1', lid: string | null = 'bakery') {
  const state = { user: uid === null ? null : { uid }, lid };
  const auth = { get currentUser() { return state.user; } } as unknown as Auth;
  return { state, sinks: createTelemetrySinks({ db, auth }, () => state.lid) };
}

beforeEach(() => {
  vi.mocked(addDoc).mockClear();
  vi.mocked(setDoc).mockClear();
});

describe('reportError', () => {
  test('adds a document to locations/<lid>/errors with the venue, the account and the server clock', async () => {
    const { sinks } = setup();
    await sinks.reportError({ source: 'console', message: 'boom' });

    expect(addDoc).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addDoc).mock.calls[0]).toEqual([
      { type: 'collection', path: 'locations/bakery/errors' },
      { source: 'console', message: 'boom', bakery: 'bakery', uid: 'u1', createdAt: SERVER_TIME },
    ]);
  });

  // ⚠️ THE RULES COMPARE uid WITH request.auth.uid AND createdAt WITH request.time: the payload is
  // spread FIRST, so nothing it carries can claim to be somebody else's, or from another time.
  test('a payload that carries uid, bakery or createdAt cannot overwrite the real ones', async () => {
    const { sinks } = setup();
    await sinks.reportError({ message: 'x', uid: 'someone-else', bakery: 'other', createdAt: 'yesterday' });

    expect(vi.mocked(addDoc).mock.calls[0]?.[1]).toEqual({
      message: 'x', uid: 'u1', bakery: 'bakery', createdAt: SERVER_TIME,
    });
  });
});

describe('pingDevice', () => {
  test('sets locations/<lid>/devices/<id> WHOLE, with the account and the server clock', async () => {
    const { sinks } = setup();
    await sinks.pingDevice({ bakery: 'bakery', kind: 'phone', appVersion: 'm2-abc1234' }, 'Dev1ce2Id3Abc4Def5Gh');

    expect(setDoc).toHaveBeenCalledTimes(1);
    const call = vi.mocked(setDoc).mock.calls[0];
    expect(call?.[0]).toEqual({ type: 'document', path: 'locations/bakery/devices/Dev1ce2Id3Abc4Def5Gh' });
    expect(call?.[1]).toEqual({
      bakery: 'bakery', kind: 'phone', appVersion: 'm2-abc1234', uid: 'u1', lastSeen: SERVER_TIME,
    });
    // No third argument: a merge would leave fields the rules want on every write out of the check.
    expect(call).toHaveLength(2);
  });

  test('a payload that carries uid or lastSeen cannot overwrite the real ones', async () => {
    const { sinks } = setup();
    await sinks.pingDevice({ uid: 'someone-else', lastSeen: 'yesterday' }, 'Dev1ce2Id3Abc4Def5Gh');

    expect(vi.mocked(setDoc).mock.calls[0]?.[1]).toEqual({ uid: 'u1', lastSeen: SERVER_TIME });
  });
});

describe('saveUsage', () => {
  test('sets locations/<lid>/usage/<id> whole, with the venue, the account and the server clock', async () => {
    const { sinks } = setup();
    await sinks.saveUsage({ dayKey: '20261011', kind: 'phone' }, 'Dev1ce2Id3Abc4Def5Gh_20261011_u1');

    expect(setDoc).toHaveBeenCalledTimes(1);
    const call = vi.mocked(setDoc).mock.calls[0];
    expect(call?.[0]).toEqual({ type: 'document', path: 'locations/bakery/usage/Dev1ce2Id3Abc4Def5Gh_20261011_u1' });
    expect(call?.[1]).toEqual({
      dayKey: '20261011', kind: 'phone', bakery: 'bakery', uid: 'u1', updatedAt: SERVER_TIME,
    });
    expect(call).toHaveLength(2);
  });

  test('a payload that carries uid, bakery or updatedAt cannot overwrite the real ones', async () => {
    const { sinks } = setup();
    await sinks.saveUsage({ uid: 'someone-else', bakery: 'other', updatedAt: 'yesterday' }, 'id');

    expect(vi.mocked(setDoc).mock.calls[0]?.[1]).toEqual({
      uid: 'u1', bakery: 'bakery', updatedAt: SERVER_TIME,
    });
  });
});

describe('who is writing, and where', () => {
  // A venue switch or a sign-out reloads the app, but a write already queued must not land in the
  // venue that was left: the account and the venue are asked when the write goes out.
  test('the account and the venue are read at the moment of writing, not when the sinks were made', async () => {
    const { sinks, state } = setup('u1', 'bakery');
    state.user = { uid: 'u2' };
    state.lid = 'loc-e015733e55e7';

    await sinks.reportError({ message: 'x' });
    await sinks.pingDevice({}, 'Dev1ce2Id3Abc4Def5Gh');
    await sinks.saveUsage({}, 'id');

    expect(vi.mocked(addDoc).mock.calls[0]?.[0]).toEqual({ type: 'collection', path: 'locations/loc-e015733e55e7/errors' });
    expect(vi.mocked(addDoc).mock.calls[0]?.[1]).toMatchObject({ uid: 'u2', bakery: 'loc-e015733e55e7' });
    expect(vi.mocked(setDoc).mock.calls[0]?.[1]).toMatchObject({ uid: 'u2' });
    expect(vi.mocked(setDoc).mock.calls[0]?.[0]).toEqual({ type: 'document', path: 'locations/loc-e015733e55e7/devices/Dev1ce2Id3Abc4Def5Gh' });
    expect(vi.mocked(setDoc).mock.calls[1]?.[1]).toMatchObject({ uid: 'u2', bakery: 'loc-e015733e55e7' });
  });

  test('nobody signed in: each write is refused as «unauthenticated» and Firestore is not touched', async () => {
    const { sinks } = setup(null, 'bakery');
    await expect(sinks.reportError({})).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(sinks.pingDevice({}, 'id')).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(sinks.saveUsage({}, 'id')).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(addDoc).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
  });

  test('no venue open: each write is refused as «no-venue» and Firestore is not touched', async () => {
    const { sinks } = setup('u1', null);
    await expect(sinks.reportError({})).rejects.toMatchObject({ code: 'no-venue' });
    await expect(sinks.pingDevice({}, 'id')).rejects.toMatchObject({ code: 'no-venue' });
    await expect(sinks.saveUsage({}, 'id')).rejects.toMatchObject({ code: 'no-venue' });
    expect(addDoc).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
  });

  test('both missing: the account is what is reported', async () => {
    const { sinks } = setup(null, null);
    await expect(sinks.reportError({})).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  test('a venue id that cannot build a path writes nothing, and the caller gets a rejection, not a throw', async () => {
    const { sinks } = setup('u1', 'not/a/venue');
    const attempt = sinks.reportError({ message: 'x' });
    await expect(attempt).rejects.toThrow('Invalid location id');
    expect(addDoc).not.toHaveBeenCalled();
  });
});

// ── No signal, no write ─────────────────────────────────────────────────────────────────────
// A write made offline sits in Firestore's queue, and signing out or switching venue then warns
// «your changes will be lost» about something the person never typed (see sinks.ts).

function fakeConnectivity(startsOnline: boolean) {
  let online = startsOnline;
  const waiters: Array<() => void> = [];
  const connectivity: Connectivity = {
    online: () => online,
    whenOnline: () => (online ? Promise.resolve() : new Promise<void>(resolve => { waiters.push(resolve); })),
  };
  return {
    connectivity,
    waiting: () => waiters.length,
    goOnline() {
      online = true;
      waiters.splice(0).forEach(resolve => resolve());
    },
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('no signal, no write', () => {
  function offlineSetup() {
    const network = fakeConnectivity(false);
    const state = { user: { uid: 'u1' } as { uid: string } | null, lid: 'bakery' as string | null };
    const auth = { get currentUser() { return state.user; } } as unknown as Auth;
    return { network, state, sinks: createTelemetrySinks({ db, auth }, () => state.lid, network.connectivity) };
  }

  test('offline, nothing reaches Firestore; when the signal is back each write goes exactly once', async () => {
    const { network, sinks } = offlineSetup();
    const sent = [
      sinks.reportError({ message: 'x' }),
      sinks.pingDevice({}, 'Dev1ce2Id3Abc4Def5Gh'),
      sinks.saveUsage({}, 'id'),
    ];
    await flush();
    expect(addDoc).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();

    network.goOnline();
    await Promise.all(sent);

    expect(addDoc).toHaveBeenCalledTimes(1);
    expect(setDoc).toHaveBeenCalledTimes(2);
  });

  test('a send that stays pending is a promise that stays pending: nothing throws and nothing is dropped', async () => {
    const { network, sinks } = offlineSetup();
    let settled = false;
    void sinks.reportError({ message: 'x' }).then(() => { settled = true; }, () => { settled = true; });
    await flush();
    await flush();
    expect(settled).toBe(false);
    expect(network.waiting()).toBe(1);
  });

  test('online, the write is handed over in the same tick — nothing waits, not even a microtask', () => {
    const network = fakeConnectivity(true);
    const auth = { currentUser: { uid: 'u1' } } as unknown as Auth;
    const sinks = createTelemetrySinks({ db, auth }, () => 'bakery', network.connectivity);

    void sinks.reportError({ message: 'x' });
    void sinks.pingDevice({}, 'Dev1ce2Id3Abc4Def5Gh');
    void sinks.saveUsage({}, 'id');

    expect(addDoc).toHaveBeenCalledTimes(1);
    expect(setDoc).toHaveBeenCalledTimes(2);
    expect(network.waiting()).toBe(0);
  });

  // ⚠️ ASKED AFTER THE WAIT: whoever is signed in when the signal comes back is who writes.
  test('the account is read after the wait, so a person who signed out meanwhile writes nothing', async () => {
    const { network, state, sinks } = offlineSetup();
    const attempt = sinks.saveUsage({}, 'id');
    state.user = null;

    network.goOnline();

    await expect(attempt).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(setDoc).not.toHaveBeenCalled();
  });
});

describe('browserConnectivity', () => {
  let onLine: MockInstance<() => boolean>;

  beforeEach(() => {
    onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(true);
  });

  afterEach(() => {
    onLine.mockRestore();
    vi.restoreAllMocks();
  });

  const goOnline = () => {
    onLine.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
  };

  test('online is false only when the device KNOWS it has no signal', () => {
    const network = browserConnectivity();
    expect(network.online()).toBe(true);
    onLine.mockReturnValue(false);
    expect(network.online()).toBe(false);
  });

  test('online, whenOnline resolves at once and listens to nothing', async () => {
    const listen = vi.spyOn(window, 'addEventListener');
    await browserConnectivity().whenOnline();
    expect(listen).not.toHaveBeenCalledWith('online', expect.anything(), expect.anything());
  });

  test('offline, whenOnline waits for the window\'s online event', async () => {
    onLine.mockReturnValue(false);
    const network = browserConnectivity();
    let resolved = false;
    void network.whenOnline().then(() => { resolved = true; });
    await flush();
    expect(resolved).toBe(false);

    goOnline();
    await flush();
    expect(resolved).toBe(true);
  });

  test('however many writes wait, they share one listener and all go on the one event', async () => {
    onLine.mockReturnValue(false);
    const listen = vi.spyOn(window, 'addEventListener');
    const network = browserConnectivity();
    const resolved: number[] = [];
    [1, 2, 3].forEach(n => { void network.whenOnline().then(() => { resolved.push(n); }); });

    expect(listen.mock.calls.filter(([type]) => type === 'online')).toHaveLength(1);
    goOnline();
    await flush();
    expect(resolved).toEqual([1, 2, 3]);
  });

  test('a second spell offline waits again', async () => {
    onLine.mockReturnValue(false);
    const network = browserConnectivity();
    void network.whenOnline();
    goOnline();
    await flush();

    onLine.mockReturnValue(false);
    let resolved = false;
    void network.whenOnline().then(() => { resolved = true; });
    await flush();
    expect(resolved).toBe(false);
    goOnline();
    await flush();
    expect(resolved).toBe(true);
  });

  test('the sinks use it by default: offline, the write waits for the real online event', async () => {
    onLine.mockReturnValue(false);
    const auth = { currentUser: { uid: 'u1' } } as unknown as Auth;
    const sinks = createTelemetrySinks({ db, auth }, () => 'bakery');

    const sent = sinks.reportError({ message: 'x' });
    await flush();
    expect(addDoc).not.toHaveBeenCalled();

    goOnline();
    await sent;
    expect(addDoc).toHaveBeenCalledTimes(1);
  });
});
