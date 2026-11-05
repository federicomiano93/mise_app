import { describe, expect, test, vi } from 'vitest';
import {
  createSession, venueLanguage, ACTIVE_LOCATION_KEY, REFRESH_KEY, WIPE_FAILED_KEY,
  REFRESH_BRAKE_MS, BUSY_RETRY_MS, type SessionStore,
} from './session';
import type { DocData, KeyValueStorage, SessionBackend, SessionEnv, SessionUser } from './backend';
import { OFFLINE_CACHE_OWNER_KEY } from '@mise/shared/local-data';

// Every step of the session against a fake backend: a "server" and a "phone's copy" that can
// disagree, as they do in a kitchen with patchy signal.

const ALICE: SessionUser = { uid: 'alice', email: 'alice@club.test', isAnonymous: false };

interface World {
  server: Map<string, DocData>;
  cache: Map<string, DocData | null>;
  failReads?: Set<string>;
  // true (default) = 'cleared', false = 'busy' (another tab), 'unavailable' = Firestore not loadable.
  wipeWorks?: boolean | 'unavailable';
}

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: key => { map.delete(key); },
  };
}

function setup(world: World, { local = {}, session = {}, now = 1_000_000, busy = () => false } = {} as {
  local?: Record<string, string>; session?: Record<string, string>; now?: number; busy?: () => boolean;
}) {
  let authCallback: (user: SessionUser | null) => void = () => {};
  const calls: string[] = [];
  const backend: SessionBackend = {
    onAuthChange: cb => { authCallback = cb; return () => {}; },
    async readPreferCache(path, { trustMissing = false } = {}) {
      calls.push(`readPreferCache ${path}`);
      if (world.failReads?.has(path)) throw new Error('offline');
      if (world.cache.has(path)) {
        const cached = world.cache.get(path) ?? null;
        if (cached || trustMissing) return { data: cached, cached: true };
      }
      return { data: world.server.get(path) ?? null, cached: false };
    },
    async readFromServer(path) {
      calls.push(`readFromServer ${path}`);
      return world.server.get(path) ?? null;
    },
    signIn: vi.fn(async () => {}),
    sendReset: vi.fn(async () => {}),
    signOut: vi.fn(async () => { calls.push('signOut'); }),
    wipeOfflineCache: vi.fn(async () => {
      calls.push('wipe');
      if (world.wipeWorks === 'unavailable') return 'unavailable' as const;
      return world.wipeWorks === false ? 'busy' as const : 'cleared' as const;
    }),
    changesStillWaiting: vi.fn(async () => false),
  };
  const localStore = memoryStorage(local);
  const sessionStore = memoryStorage(session);
  const timers: Array<{ callback: () => void; ms: number }> = [];
  const env: SessionEnv = {
    local: localStore,
    session: sessionStore,
    localKeys: () => [...localStore.map.keys()],
    reload: vi.fn(() => { calls.push('reload'); }),
    now: () => now,
    setTimeout: (callback, ms) => { timers.push({ callback, ms }); return timers.length; },
    isBusy: busy,
    preloadLanguage: vi.fn(async lang => { calls.push(`preload ${lang}`); }),
    warn: () => {},
  };
  const store: SessionStore = createSession(backend, env);
  const states: string[] = [];
  store.subscribe(() => states.push(store.getSnapshot().status));
  store.start();
  return { store, backend, env, calls, timers, localStore, sessionStore, states, auth: (u: SessionUser | null) => authCallback(u) };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function world(docs: Record<string, DocData>, cache: Record<string, DocData | null> = {}): World {
  return { server: new Map(Object.entries(docs)), cache: new Map(Object.entries(cache)) };
}

describe('venueLanguage', () => {
  test('the venue\'s own language, else English', () => {
    expect(venueLanguage({ language: 'it' })).toBe('it');
    expect(venueLanguage({ language: 'en' })).toBe('en');
    expect(venueLanguage({ language: 'fr' })).toBe('en');
    expect(venueLanguage({ language: 'IT' })).toBe('en');
    expect(venueLanguage({})).toBe('en');
    expect(venueLanguage(null)).toBe('en');
  });
});

describe('who is signed in', () => {
  test('nobody → signed-out, with no powers', async () => {
    const s = setup(world({}));
    s.auth(null);
    await settle();
    const snap = s.store.getSnapshot();
    expect(snap.status).toBe('signed-out');
    expect([snap.canManage, snap.isOwner, snap.isAppAdmin]).toEqual([false, false, false]);
  });

  test('a leftover anonymous session is dropped, never treated as a person', async () => {
    const s = setup(world({}));
    s.auth({ uid: 'anon', email: null, isAnonymous: true });
    await settle();
    expect(s.backend.signOut).toHaveBeenCalledOnce();
    expect(s.store.getSnapshot().status).toBe('loading');
    expect(s.calls.some(c => c.startsWith('readPreferCache'))).toBe(false);
  });

  test('an unreadable users/{uid} is an error, not "no access"', async () => {
    const w = world({});
    w.failReads = new Set(['users/alice']);
    const s = setup(w);
    s.auth(ALICE);
    await settle();
    expect(s.store.getSnapshot().status).toBe('error');
  });
});

describe('somebody else\'s offline copy', () => {
  const docs = { 'users/alice': { locations: { bakery: true } }, 'locations/bakery': { name: 'Bakery' } };

  test('first account on this phone: claimed, nothing wiped', async () => {
    const s = setup(world(docs));
    s.auth(ALICE);
    await settle();
    expect(s.localStore.getItem(OFFLINE_CACHE_OWNER_KEY)).toBe('alice');
    expect(s.backend.wipeOfflineCache).not.toHaveBeenCalled();
    expect(s.store.getSnapshot().status).toBe('ready');
  });

  test('another person\'s copy at boot: local data and the offline database wiped BEFORE any read, then a reload', async () => {
    const s = setup(world(docs), { local: { [OFFLINE_CACHE_OWNER_KEY]: 'bob', 'recipes-cache': 'x', 'active-location': 'bakery', 'device-id': 'd1' } });
    s.auth(ALICE);
    await settle();
    expect(s.calls).toEqual(['wipe', 'reload']);
    expect(s.localStore.getItem('recipes-cache')).toBeNull();
    expect(s.localStore.getItem('device-id')).toBe('d1');
    expect(s.localStore.getItem('active-location')).toBe('bakery');
    expect(s.localStore.getItem(OFFLINE_CACHE_OWNER_KEY)).toBe('alice');
  });

  test('a wipe that fails keeps the previous owner on record and is not retried in this opening', async () => {
    const w = world(docs);
    w.wipeWorks = false;
    const s = setup(w, { local: { [OFFLINE_CACHE_OWNER_KEY]: 'bob' } });
    s.auth(ALICE);
    await settle();
    expect(s.localStore.getItem(OFFLINE_CACHE_OWNER_KEY)).toBe('bob');
    expect(s.sessionStore.getItem(WIPE_FAILED_KEY)).toBe('alice');
    expect(s.calls.at(-1)).toBe('reload');

    // The reload: same opening (sessionStorage survives), so no second attempt — the app opens.
    const again = setup(w, { local: { [OFFLINE_CACHE_OWNER_KEY]: 'bob' }, session: { [WIPE_FAILED_KEY]: 'alice' } });
    again.auth(ALICE);
    await settle();
    expect(again.backend.wipeOfflineCache).not.toHaveBeenCalled();
    expect(again.store.getSnapshot().status).toBe('ready');
  });

  // ⚠️ Firestore could not even be downloaded (no signal on a first visit): the browser remembers
  // that failure for the page, so the once-per-opening guard must not be spent on it — after a
  // reload with the signal back, the wipe would be skipped and the previous copy read.
  test('a wipe that could not load Firestore shows the error screen and does not spend the once-per-opening guard', async () => {
    const w = world(docs);
    w.wipeWorks = 'unavailable';
    const s = setup(w, { local: { [OFFLINE_CACHE_OWNER_KEY]: 'bob', 'prices-cache': 'x' } });
    s.auth(ALICE);
    await settle();
    expect(s.store.getSnapshot()).toMatchObject({ status: 'error', user: ALICE, locationId: null });
    expect(s.sessionStore.getItem(WIPE_FAILED_KEY)).toBeNull();
    expect(s.localStore.getItem(OFFLINE_CACHE_OWNER_KEY)).toBe('bob');
    expect(s.env.reload).not.toHaveBeenCalled();
    expect(s.calls.some(c => c.startsWith('readPreferCache'))).toBe(false);
  });

  test('a sign-out whose wipe could not load Firestore keeps the owner on record', async () => {
    const w = world({ 'users/alice': { locations: { bakery: true } }, 'locations/bakery': {} });
    const s = setup(w);
    s.auth(ALICE);
    await settle();
    w.wipeWorks = 'unavailable';
    await s.store.signOut();
    expect(s.localStore.getItem(OFFLINE_CACHE_OWNER_KEY)).toBe('alice');
  });

  // ⚠️ THE ONE PLACE MISE 2 DIFFERS FROM js/firebase.js: one page that never reloads by itself,
  // so waiting for "the next boot" would serve Bob's cached data to Alice for the whole shift.
  test('a different person signing in INSIDE the page (Bob’s session expired, Alice on the form) is wiped too', async () => {
    const s = setup(world({ ...docs, 'users/bob': { locations: { bakery: 'manager' } } }), { local: { [OFFLINE_CACHE_OWNER_KEY]: 'bob', 'prices-cache': 'x' } });
    s.auth({ uid: 'bob', email: null, isAnonymous: false });
    await settle();
    expect(s.backend.wipeOfflineCache).not.toHaveBeenCalled();
    s.auth(null);
    await settle();
    s.auth(ALICE);
    await settle();
    expect(s.backend.wipeOfflineCache).toHaveBeenCalledOnce();
    expect(s.localStore.getItem('prices-cache')).toBeNull();
    expect(s.localStore.getItem(OFFLINE_CACHE_OWNER_KEY)).toBe('alice');
    expect(s.calls.at(-1)).toBe('reload');
  });

  test('the person changing directly (no sign-out in between) carries nothing of the previous one', async () => {
    const w = world({ ...docs, 'users/bob': { locations: { bakery: 'owner' } } });
    const s = setup(w);
    s.auth({ uid: 'bob', email: null, isAnonymous: false });
    await settle();
    expect(s.store.getSnapshot()).toMatchObject({ status: 'ready', isOwner: true, locationId: 'bakery' });
    // A wipe that failed earlier in this opening: Alice then goes through membership directly.
    s.sessionStore.setItem(WIPE_FAILED_KEY, 'alice');
    w.server.set('users/alice', { locations: {} });
    s.auth(ALICE);
    await settle();
    expect(s.store.getSnapshot()).toMatchObject({
      status: 'no-access', locationId: null, location: null, role: 'staff', canManage: false, isOwner: false, name: '', language: null,
    });
  });

  test('anything unexpected while resolving shows the error screen, never an endless loading', async () => {
    // A users/{uid} document whose `locations` cannot even be read: the throw comes from the
    // venue choice, outside every inner try.
    const strange = Object.defineProperty({}, 'locations', { get() { throw new Error('corrupt'); } });
    const s = setup(world({ 'users/alice': strange as DocData }));
    s.auth(ALICE);
    await settle();
    expect(s.store.getSnapshot()).toMatchObject({ status: 'error', user: ALICE, locationId: null });
  });
});

describe('which venue opens', () => {
  test('no venue → no-access', async () => {
    const s = setup(world({ 'users/alice': { locations: {} } }));
    s.auth(ALICE);
    await settle();
    expect(s.store.getSnapshot().status).toBe('no-access');
  });

  test('a cached "users/{uid} does not exist" is not trusted: the server is asked', async () => {
    const s = setup(world({ 'users/alice': { locations: { bakery: true } }, 'locations/bakery': {} }, { 'users/alice': null }));
    s.auth(ALICE);
    await settle();
    expect(s.store.getSnapshot().status).toBe('ready');
  });

  test('one venue opens straight in, with its name, its language loaded BEFORE it is published', async () => {
    const s = setup(world({ 'users/alice': { locations: { bakery: true } }, 'locations/bakery': { name: 'The Bakery', language: 'it' } }));
    s.auth(ALICE);
    await settle();
    const snap = s.store.getSnapshot();
    expect(snap).toMatchObject({ status: 'ready', locationId: 'bakery', name: 'The Bakery', language: 'it', options: ['bakery'] });
    expect(s.calls).toContain('preload it');
    expect(s.states.at(-1)).toBe('ready');
    expect(s.localStore.getItem(ACTIVE_LOCATION_KEY)).toBe('bakery');
  });

  test('a venue whose document cannot be read still opens: name = id, English, every section', async () => {
    const w = world({ 'users/alice': { locations: { bakery: true } } });
    w.failReads = new Set(['locations/bakery']);
    const s = setup(w);
    s.auth(ALICE);
    await settle();
    expect(s.store.getSnapshot()).toMatchObject({ status: 'ready', name: 'bakery', language: 'en', location: null });
  });

  test('two venues and a remembered one that is still yours → it opens', async () => {
    const s = setup(world({ 'users/alice': { locations: { bakery: true, restaurant: true } }, 'locations/bakery': {}, 'locations/restaurant': { name: 'Restaurant' } }),
      { local: { [ACTIVE_LOCATION_KEY]: 'restaurant' } });
    s.auth(ALICE);
    await settle();
    expect(s.store.getSnapshot()).toMatchObject({ status: 'ready', locationId: 'restaurant', optionNames: { bakery: 'bakery', restaurant: 'Restaurant' } });
  });

  test('two venues and a remembered one that was taken away → the picker, with names', async () => {
    const s = setup(world({ 'users/alice': { locations: { bakery: true, restaurant: 'owner' } }, 'locations/bakery': { name: 'Bakery' }, 'locations/restaurant': { name: 'Restaurant' } }),
      { local: { [ACTIVE_LOCATION_KEY]: 'gone' } });
    s.auth(ALICE);
    await settle();
    expect(s.store.getSnapshot()).toMatchObject({ status: 'choose-location', options: ['bakery', 'restaurant'], optionNames: { bakery: 'Bakery', restaurant: 'Restaurant' } });
  });

  test('the app administrator lands like everybody else (the hub arrives in step 3g)', async () => {
    const s = setup(world({ 'users/alice': { locations: { bakery: 'owner' } }, 'admins/alice': { since: 1 }, 'locations/bakery': {} }));
    s.auth(ALICE);
    await settle();
    expect(s.store.getSnapshot()).toMatchObject({ status: 'ready', isAppAdmin: true });
  });

  test('an administrator with no venue sees "no access", not an empty picker', async () => {
    const s = setup(world({ 'users/alice': { locations: {} }, 'admins/alice': { since: 1 } }));
    s.auth(ALICE);
    await settle();
    expect(s.store.getSnapshot()).toMatchObject({ status: 'no-access', isAppAdmin: true });
  });

  test('an unreadable admins/{uid} means "not an administrator"', async () => {
    const w = world({ 'users/alice': { locations: { bakery: true } }, 'admins/alice': { since: 1 }, 'locations/bakery': {} });
    w.failReads = new Set(['admins/alice']);
    const s = setup(w);
    s.auth(ALICE);
    await settle();
    expect(s.store.getSnapshot().isAppAdmin).toBe(false);
  });

  test('opening a DIFFERENT venue from the remembered one clears local data first; the same one keeps it', async () => {
    const docs = { 'users/alice': { locations: { bakery: true } }, 'locations/bakery': {} };
    const other = setup(world(docs), { local: { [ACTIVE_LOCATION_KEY]: 'restaurant', 'orders-draft': 'x' } });
    other.auth(ALICE);
    await settle();
    expect(other.localStore.getItem('orders-draft')).toBeNull();

    const same = setup(world(docs), { local: { [ACTIVE_LOCATION_KEY]: 'bakery', 'orders-draft': 'x' } });
    same.auth(ALICE);
    await settle();
    expect(same.localStore.getItem('orders-draft')).toBe('x');
  });
});

describe('roles', () => {
  async function as(value: unknown) {
    const s = setup(world({ 'users/alice': { locations: { bakery: value } }, 'locations/bakery': {} }));
    s.auth(ALICE);
    await settle();
    const { role, canManage, isOwner } = s.store.getSnapshot();
    return { role, canManage, isOwner };
  }
  test('owner, manager and employee', async () => {
    expect(await as('owner')).toEqual({ role: 'owner', canManage: true, isOwner: true });
    expect(await as('manager')).toEqual({ role: 'manager', canManage: true, isOwner: false });
    expect(await as(true)).toEqual({ role: 'staff', canManage: false, isOwner: false });
  });
});

describe('the phone\'s copy, checked against the server behind it', () => {
  const docs = { 'users/alice': { locations: { bakery: 'owner' } }, 'locations/bakery': { name: 'Bakery' } };

  test('same answer → no reload', async () => {
    const s = setup(world(docs, { 'users/alice': { locations: { bakery: 'owner' } }, 'locations/bakery': { name: 'Bakery' } }));
    s.auth(ALICE);
    await settle();
    await settle();
    expect(s.env.reload).not.toHaveBeenCalled();
  });

  test('a role changed on the server → one reload, and the time is recorded for the brake', async () => {
    const s = setup(world(docs, { 'users/alice': { locations: { bakery: true } } }));
    s.auth(ALICE);
    await settle();
    await settle();
    expect(s.env.reload).toHaveBeenCalledOnce();
    expect(s.sessionStore.getItem(REFRESH_KEY)).toBe('1000000');
  });

  test('within 30 seconds of the last such reload → no second one', async () => {
    const s = setup(world(docs, { 'users/alice': { locations: { bakery: true } } }),
      { session: { [REFRESH_KEY]: String(1_000_000 - REFRESH_BRAKE_MS + 1) } });
    s.auth(ALICE);
    await settle();
    await settle();
    expect(s.env.reload).not.toHaveBeenCalled();
  });

  test('somebody is typing → the reload waits and tries again', async () => {
    let busy = true;
    const s = setup(world(docs, { 'users/alice': { locations: { bakery: true } } }), { busy: () => busy });
    s.auth(ALICE);
    await settle();
    await settle();
    expect(s.env.reload).not.toHaveBeenCalled();
    expect(s.timers.at(-1)?.ms).toBe(BUSY_RETRY_MS);
    busy = false;
    s.timers.at(-1)?.callback();
    expect(s.env.reload).toHaveBeenCalledOnce();
  });
});

describe('leaving', () => {
  const docs = { 'users/alice': { locations: { bakery: true, restaurant: true } }, 'locations/bakery': {}, 'locations/restaurant': {} };

  test('sign-out: signs out, wipes both copies, forgets the venue and the owner, reloads', async () => {
    const s = setup(world(docs), { local: { [ACTIVE_LOCATION_KEY]: 'bakery', 'orders-draft': 'x', 'device-id': 'd' } });
    s.auth(ALICE);
    await settle();
    await s.store.signOut();
    expect(s.calls.slice(-3)).toEqual(['signOut', 'wipe', 'reload']);
    expect(s.localStore.getItem('orders-draft')).toBeNull();
    expect(s.localStore.getItem(ACTIVE_LOCATION_KEY)).toBeNull();
    expect(s.localStore.getItem(OFFLINE_CACHE_OWNER_KEY)).toBeNull();
    expect(s.localStore.getItem('device-id')).toBe('d');
  });

  test('sign-out whose wipe fails keeps the owner on record, so the next boot retries', async () => {
    const w = world(docs);
    const s = setup(w, { local: { [ACTIVE_LOCATION_KEY]: 'bakery' } });
    s.auth(ALICE);
    await settle();
    w.wipeWorks = false;
    await s.store.signOut();
    expect(s.localStore.getItem(OFFLINE_CACHE_OWNER_KEY)).toBe('alice');
  });

  test('switching venue: only to one of yours; wipes, remembers the new one, reloads', async () => {
    const s = setup(world(docs), { local: { [ACTIVE_LOCATION_KEY]: 'bakery', 'orders-draft': 'x' } });
    s.auth(ALICE);
    await settle();
    await expect(s.store.switchLocation('someone-else')).rejects.toThrow(/Not your venue/);
    await s.store.switchLocation('restaurant');
    expect(s.localStore.getItem(ACTIVE_LOCATION_KEY)).toBe('restaurant');
    expect(s.localStore.getItem('orders-draft')).toBeNull();
    expect(s.calls.slice(-2)).toEqual(['wipe', 'reload']);
  });

  test('the picker opens only one of yours', async () => {
    const s = setup(world(docs));
    s.auth(ALICE);
    await settle();
    expect(s.store.getSnapshot().status).toBe('choose-location');
    await expect(s.store.chooseLocation('someone-else')).rejects.toThrow(/Not your venue/);
    await s.store.chooseLocation('restaurant');
    expect(s.store.getSnapshot()).toMatchObject({ status: 'ready', locationId: 'restaurant' });
  });

  test('sign-in trims the email and passes the password untouched', async () => {
    const s = setup(world({}));
    await s.store.signIn('  alice@club.test ', ' pass word ');
    expect(s.backend.signIn).toHaveBeenCalledWith('alice@club.test', ' pass word ');
  });
});

describe('the venue read again from the server (refreshLocation, step 3d-9)', () => {
  test('a switch thrown by a Cloud Function reaches the session with no reload', async () => {
    const w = world({ 'users/alice': { locations: { bakery: 'owner' } }, 'locations/bakery': { name: 'The Bakery' } });
    const s = setup(w);
    s.auth(ALICE);
    await settle();
    w.server.set('locations/bakery', { name: 'The Bakery', recipePhoto: true });
    await s.store.refreshLocation();
    expect(s.store.getSnapshot().location).toMatchObject({ recipePhoto: true });
    expect(s.calls).toContain('readFromServer locations/bakery');
    expect(s.calls).not.toContain('reload');
  });

  test('offline it changes nothing and never rejects; a vanished document keeps what the session had', async () => {
    const w = world({ 'users/alice': { locations: { bakery: 'owner' } }, 'locations/bakery': { name: 'The Bakery', recipePhoto: true } });
    const s = setup(w);
    s.auth(ALICE);
    await settle();
    s.backend.readFromServer = vi.fn(async () => { throw new Error('offline'); });
    await expect(s.store.refreshLocation()).resolves.toBeUndefined();
    expect(s.store.getSnapshot().location).toMatchObject({ recipePhoto: true });
    s.backend.readFromServer = vi.fn(async () => null);
    await s.store.refreshLocation();
    expect(s.store.getSnapshot().location).toMatchObject({ recipePhoto: true });
  });

  test('with no venue open it reads nothing', async () => {
    const s = setup(world({ 'users/alice': { locations: {} } }));
    s.auth(ALICE);
    await settle();
    const before = s.calls.length;
    await s.store.refreshLocation();
    expect(s.calls.slice(before).some(call => call.startsWith('readFromServer'))).toBe(false);
  });
});
