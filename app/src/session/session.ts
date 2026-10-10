// session.ts — who is signed in, and WHICH VENUE they are working on.
//
// A port of the session half of js/firebase.js (the current app), decision for decision. The
// pure decisions themselves come from @mise/shared (sections, membership, local-data,
// same-data), which run the current app's own tests against both files; this file is the
// sequence around them, and session.spec.ts pins every step with a fake backend.
//
// ⚠️ IT IS NOT A SECURITY BOUNDARY AND CANNOT BECOME ONE (P2). What it decides is which screens
// to draw. Every read and write is judged by firestore.rules on the server, which read the same
// users/{uid} document themselves and never trust anything sent from here.
//
// ⚠️ ONE ORIGIN WITH THE CURRENT APP. Mise 2 runs at the same address, so it shares the current
// app's localStorage keys (`active-location`, `offline-cache-uid`), sessionStorage and IndexedDB.
// Every key below means exactly what it means there: signing in, switching venue or signing out
// in either app leaves the other one consistent.
//
// States: loading · signed-out · choose-location · no-access · error · ready.
// (The current app also has `hub`, the app administrator's own home above every venue. Mise 2
// brings it with the administrator's tools in step 3g; until then an administrator lands where
// everybody else does.)

import { locationsOf, pickStart } from '@mise/shared/sections';
import { roleOf, canManage, isOwner, DEFAULT_ROLE, type Role } from '@mise/shared/membership';
import {
  offlineCacheVerdict, shouldClearLocalData, keysToClear, OFFLINE_CACHE_OWNER_KEY,
} from '@mise/shared/local-data';
import { locationDocPath } from '@mise/shared/location-id';
import { sameData } from '@mise/shared/same-data';
import type { Language } from '../i18n/i18n';
import type { DocData, SessionBackend, SessionEnv, SessionUser } from './backend';

export type SessionStatus = 'loading' | 'signed-out' | 'choose-location' | 'no-access' | 'error' | 'ready';

export interface Session {
  readonly status: SessionStatus;
  readonly user: SessionUser | null;
  readonly locationId: string | null;
  // The venue's own document (locations/{id}), or null before a venue is open or when it has
  // none yet (a missing document is not "no access": the sections then default to all).
  readonly location: DocData | null;
  // Every venue this account may open, and their names for the picker.
  readonly options: readonly string[];
  readonly optionNames: Readonly<Record<string, string>>;
  // The open venue's name (its document's `name`, else its id).
  readonly name: string;
  // ⚠️ FROM users/{uid}, WHICH NO CLIENT CAN WRITE. UX only (P2).
  readonly role: Role;
  // "May take things away" (owner AND manager) vs "may invite people and set roles" (owner
  // alone): two questions, never one.
  readonly canManage: boolean;
  readonly isOwner: boolean;
  // "May create a new customer's venue" — the app's own administrator, above every venue.
  readonly isAppAdmin: boolean;
  // The venue's interface language once a venue is open; null above every venue, where the
  // phone's language is used instead (his decision, 1 Oct 2026).
  readonly language: Language | null;
}

// ⚠️ canManage, isOwner and isAppAdmin START false AND MUST: every screen draws from this object
// before a venue is open, and the safe starting answer is "no powers".
export const INITIAL_SESSION: Session = Object.freeze({
  status: 'loading', user: null, locationId: null, location: null, options: [], optionNames: {},
  name: '', role: DEFAULT_ROLE, canManage: false, isOwner: false, isAppAdmin: false, language: null,
});

// Keys shared with the current app (js/firebase.js), same meaning.
export const ACTIVE_LOCATION_KEY = 'active-location';
export const REFRESH_KEY = 'session-refreshed-at';
export const WIPE_FAILED_KEY = 'offline-wipe-failed';
// At most one "the server disagrees" reload every 30 s, or a field this comparison does not
// understand would reload the app for ever.
export const REFRESH_BRAKE_MS = 30_000;
// A reload under somebody's fingers waits until nothing is being edited.
export const BUSY_RETRY_MS = 5_000;

// The venue's interface language. Anything else — missing, a typo, a language Mise does not
// speak — is English, as in the current app's interfaceLanguage().
export function venueLanguage(location: DocData | null): Language {
  const value = location ? location.language : undefined;
  return value === 'it' || value === 'en' ? value : 'en';
}

export interface SessionStore {
  getSnapshot(): Session;
  subscribe(listener: () => void): () => void;
  // Starts listening to the sign-in state. Call once.
  start(): void;
  signIn(email: string, password: string): Promise<void>;
  sendReset(email: string): Promise<void>;
  // Signs out, wipes this phone's copies and reloads. The caller asks first when
  // changesStillWaiting() says something typed has not reached the server yet.
  signOut(): Promise<void>;
  // The picker's choice, when no venue is open yet.
  chooseLocation(locationId: string): Promise<void>;
  // Moves to another of YOUR venues: wipes this phone's copies and reloads.
  switchLocation(locationId: string): Promise<void>;
  changesStillWaiting(ms?: number): Promise<boolean>;
}

const userPath = (uid: string) => `users/${uid}`;
const adminPath = (uid: string) => `admins/${uid}`;

export function createSession(backend: SessionBackend, env: SessionEnv): SessionStore {
  let session: Session = INITIAL_SESSION;
  let userDoc: DocData | null = null;
  let isAppAdmin = false;
  // The FIRST answer about who is signed in is the one this page opened with — the only moment
  // nothing has been read yet (see the wipe below).
  let bootAnswered = false;
  const listeners = new Set<() => void>();

  function setSession(next: Partial<Session>): void {
    session = Object.freeze({ ...session, ...next });
    listeners.forEach(listener => {
      try { listener(); } catch (err) { env.warn('A session listener failed', err); }
    });
  }

  const read = (storage: SessionEnv['local'], key: string): string | null => {
    try { return storage.getItem(key); } catch { return null; }
  };
  const write = (storage: SessionEnv['local'], key: string, value: string | null): void => {
    try {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    } catch { /* private mode: nothing to remember, which is the safe way to fail */ }
  };

  // localStorage minus the keys that must outlive a session change (KEEP_PREFIXES).
  function clearLocalData(): void {
    let keys: string[] = [];
    try { keys = env.localKeys(); } catch { return; }
    for (const key of keysToClear(keys)) write(env.local, key, null);
  }

  // ── Ask the server what the cache answered, and start again if it disagrees ──────────────
  // ⚠️ A failure is silent: with no signal the cached answer is all there is.
  function reloadWhenIdle(): void {
    if (env.isBusy()) { env.setTimeout(reloadWhenIdle, BUSY_RETRY_MS); return; }
    env.reload();
  }

  function checkBehind(pairs: ReadonlyArray<readonly [string, DocData | null]>): void {
    if (pairs.length === 0) return;
    Promise.all(pairs.map(async ([path, used]) => sameData(await backend.readFromServer(path), used)))
      .then(same => {
        if (same.every(Boolean)) return;
        const last = Number(read(env.session, REFRESH_KEY)) || 0;
        if (env.now() - last < REFRESH_BRAKE_MS) {
          env.warn('The session still differs from the server after a reload; not reloading again.');
          return;
        }
        write(env.session, REFRESH_KEY, String(env.now()));
        reloadWhenIdle();
      })
      .catch(() => { /* offline, or refused: keep what the phone had */ });
  }

  // A name is a label on a button: the phone's copy is good enough. An unreadable one falls back
  // to the id rather than to blank.
  async function readLocationNames(ids: readonly string[]): Promise<Record<string, string>> {
    const names: Record<string, string> = {};
    await Promise.all(ids.map(async id => {
      try {
        const { data } = await backend.readPreferCache(locationDocPath(id));
        names[id] = typeof data?.name === 'string' && data.name ? data.name : id;
      } catch {
        names[id] = id;
      }
    }));
    return names;
  }

  async function enterLocation(locationId: string, options: readonly string[], user: SessionUser): Promise<void> {
    // ⚠️ BEFORE ANYTHING READS ANYTHING, and before the remembered id is rewritten below (after
    // it, the check would compare the value with itself): a phone can reach the sign-in form
    // without a sign-out — an expired or revoked session — still holding the previous venue's
    // cached data.
    if (shouldClearLocalData(read(env.local, ACTIVE_LOCATION_KEY), locationId)) clearLocalData();

    let location: DocData | null = null;
    const path = locationDocPath(locationId);
    try {
      const { data, cached } = await backend.readPreferCache(path);
      location = data;
      if (cached) checkBehind([[path, location]]);
    } catch (err) {
      // The folder can hold data before anyone writes its description: missing ≠ no access.
      env.warn('Venue document unavailable', err);
    }
    write(env.local, ACTIVE_LOCATION_KEY, locationId);

    // ⚠️ THE VENUE'S LANGUAGE WINS FROM HERE ON, and it is loaded BEFORE the session is published,
    // so nothing inside the venue is drawn in the phone's language and then swapped.
    const language = venueLanguage(location);
    try { await env.preloadLanguage(language); } catch { /* the app falls back to English */ }

    setSession({
      status: 'ready', user, locationId, location, options,
      optionNames: options.length > 1 ? await readLocationNames(options) : {},
      name: typeof location?.name === 'string' && location.name ? location.name : locationId,
      role: roleOf(userDoc, locationId),
      canManage: canManage(userDoc, locationId),
      isOwner: isOwner(userDoc, locationId),
      isAppAdmin,
      language,
    });
  }

  async function resolveMembership(user: SessionUser): Promise<void> {
    setSession({ status: 'loading', user });
    // ⚠️ BOTH AT ONCE, and from this phone first. A cached "admins/{uid} does not exist" is
    // trusted (it is everybody's normal answer); a cached "users/{uid} does not exist" is NOT —
    // a new person's phone keeps that from before the join code made it exist, and trusting it
    // would show "No venue yet" to somebody who has one.
    const adminRead = backend.readPreferCache(adminPath(user.uid), { trustMissing: true }).catch(() => null);
    let userCached = false;
    try {
      const { data, cached } = await backend.readPreferCache(userPath(user.uid));
      userDoc = data;
      userCached = cached;
    } catch (err) {
      env.warn('Could not read the access document', err);
      setSession({ status: 'error', user });
      return;
    }
    const admin = await adminRead;
    // ⚠️ EVERY UNCERTAIN ANSWER IS "NO": a refused or failed read is not an administrator.
    isAppAdmin = !!admin?.data;

    const behind: Array<readonly [string, DocData | null]> = [];
    if (userCached) behind.push([userPath(user.uid), userDoc]);
    if (admin?.cached) behind.push([adminPath(user.uid), admin.data]);
    checkBehind(behind);

    // hubPassed: the hub comes in step 3g; until then nobody is held above their venues.
    const pick = pickStart(userDoc, {
      isAppAdmin, hubPassed: true, remembered: read(env.local, ACTIVE_LOCATION_KEY) ?? '',
    });
    if (pick.status === 'none' || pick.status === 'hub' && pick.options.length === 0) {
      setSession({ status: 'no-access', user, options: [], isAppAdmin });
      return;
    }
    if (pick.status === 'choose' || pick.status === 'hub') {
      setSession({
        status: 'choose-location', user, options: pick.options,
        optionNames: await readLocationNames(pick.options), isAppAdmin,
      });
      return;
    }
    await enterLocation(pick.locationId, pick.options, user);
  }

  function signedOut(): void {
    userDoc = null;
    isAppAdmin = false;
    session = INITIAL_SESSION;
    setSession({ status: 'signed-out' });
  }

  function onAuth(user: SessionUser | null): void {
    const atBoot = !bootAnswered;
    bootAnswered = true;
    if (!user) { signedOut(); return; }

    // ⚠️ A LEFTOVER ANONYMOUS SESSION IS NOT A SIGNED-IN PERSON. Phones that used the app before
    // real accounts still hold one; treated as a sign-in it parks the phone on "No venue yet"
    // and never shows the form. Dropping it comes back through here with nobody signed in.
    if (user.isAnonymous) {
      backend.signOut().catch(err => env.warn('Could not clear the old session', err));
      return;
    }

    // ⚠️⚠️ SOMEBODY ELSE'S DATA IN THE OFFLINE CACHE, AND THEY NEVER SIGNED OUT. Cleared at BOOT,
    // before a single read, then the app starts again clean. The new owner is recorded only
    // after a clear that WORKED; a failed one is tried once per opening, never in a loop.
    const verdict = offlineCacheVerdict(read(env.local, OFFLINE_CACHE_OWNER_KEY), user.uid);
    if (verdict === 'claim') write(env.local, OFFLINE_CACHE_OWNER_KEY, user.uid);
    if (verdict === 'wipe' && atBoot && read(env.session, WIPE_FAILED_KEY) !== user.uid) {
      clearLocalData();
      void backend.wipeOfflineCache().then(cleared => {
        if (cleared) write(env.local, OFFLINE_CACHE_OWNER_KEY, user.uid);
        else write(env.session, WIPE_FAILED_KEY, user.uid);
        env.reload();
      });
      return;
    }

    void resolveMembership(user);
  }

  function assertMine(locationId: string): void {
    if (!locationsOf(userDoc).includes(locationId)) throw new Error(`Not your venue: ${locationId}`);
  }

  return {
    getSnapshot: () => session,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start() { backend.onAuthChange(onAuth); },
    signIn: (email, password) => backend.signIn(String(email || '').trim(), String(password || '')),
    sendReset: email => backend.sendReset(String(email || '').trim()),
    async signOut() {
      await backend.signOut();
      clearLocalData();
      // Only a clear that worked forgets whose data this is: after a failed one the record
      // stays, so the next person's first boot catches it and tries again.
      if (await backend.wipeOfflineCache()) write(env.local, OFFLINE_CACHE_OWNER_KEY, null);
      write(env.local, ACTIVE_LOCATION_KEY, null);
      env.reload();
    },
    async chooseLocation(locationId) {
      assertMine(locationId);
      const user = session.user;
      if (!user) return;
      await enterLocation(locationId, locationsOf(userDoc), user);
    },
    // ⚠️ IT RELOADS rather than re-pointing the open screens: a listener from the previous venue
    // surviving the switch would quietly repaint the screen with the wrong venue's data.
    async switchLocation(locationId) {
      assertMine(locationId);
      clearLocalData();
      write(env.local, ACTIVE_LOCATION_KEY, locationId);
      await backend.wipeOfflineCache();
      env.reload();
    },
    changesStillWaiting: ms => backend.changesStillWaiting(ms),
  };
}
