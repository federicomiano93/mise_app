import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Auth } from 'firebase/auth';
import { addDoc, setDoc, type Firestore } from 'firebase/firestore';
import { createTelemetrySinks } from './sinks';

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
