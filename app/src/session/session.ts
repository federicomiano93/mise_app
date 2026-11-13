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
import { roleOf, canManage, canManageVenue, isOwner, DEFAULT_ROLE, type Role } from '@mise/shared/membership';
import {
  offlineCacheVerdict, shouldClearLocalData, keysToClear, OFFLINE_CACHE_OWNER_KEY,
} from '@mise/shared/local-data';
import { locationDocPath } from '@mise/shared/location-id';
import { sameData } from '@mise/shared/same-data';
import { markJustJoined } from '@mise/shared/install-hint';
import type { Language } from '../i18n/i18n';
import type { DocData, SessionBackend, SessionEnv, SessionUser } from './backend';
import { PENDING_INVITE_KEY } from './joinFlow';

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
  // ⚠️ A THIRD QUESTION, for the two partial owners: they canManage (every screen they can open is
  // on their own side) but do not manage the VENUE — its language, its Home cards, what its
  // employees are shown. Owner and manager only (js/roles.js canManageVenue).
  readonly canManageVenue: boolean;
  readonly isOwner: boolean;
  // "May create a new customer's venue" — the app's own administrator, above every venue.
  readonly isAppAdmin: boolean;
  // The venue's interface language once a venue is open; null above every venue, where the
  // phone's language is used instead (his decision, 1 Oct 2026).
  readonly language: Language | null;
  // The page is about to leave the open venue (a switch of venue, or a join that adds another): this phone's copy is being
  // wiped and a reload follows. The gate takes the app off the screen the moment this is true (SessionGate), so every
  // section's listeners unsubscribe BEFORE Firestore is terminated — terminate() errors every listener still live
  // («Firestore shutting down»), and a section that mounts after it is told «The client has already been terminated»: both
  // reached the console and the error reports at every switch of venue (found driving staff slice 1, 13 Nov 2026).
  readonly leaving: boolean;
}

// ⚠️ canManage, canManageVenue, isOwner and isAppAdmin START false AND MUST: every screen draws from this object
// before a venue is open, and the safe starting answer is "no powers".
export const INITIAL_SESSION: Session = Object.freeze({
  status: 'loading', user: null, locationId: null, location: null, options: [], optionNames: {},
  name: '', role: DEFAULT_ROLE, canManage: false, canManageVenue: false, isOwner: false, isAppAdmin: false, language: null,
  leaving: false,
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
  // Staff slice 2: creates an account (and signs it in) for somebody joining with a code, and resolves with it; rejects with
  // Firebase's `auth/…` error. ⚠️ FROM THE MOMENT IT IS CALLED, THE SESSION HOLDS STILL for that account: the sign-in it causes
  // is NOT resolved (no read, no cache wipe, no reload) until the join is over — openJoinedVenue on a yes, releaseSignUp when
  // the person leaves the form (see the function).
  signUp(email: string, password: string): Promise<SessionUser>;
  // The join form of a new account is gone (Back, sign-out, a new invitation): the account it created is resolved as any
  // sign-in is. Does nothing when no sign-up is held.
  releaseSignUp(): void;
  sendReset(email: string): Promise<void>;
  // Signs out, wipes this phone's copies and reloads. The caller asks first when
  // changesStillWaiting() says something typed has not reached the server yet.
  signOut(): Promise<void>;
  // The picker's choice, when no venue is open yet.
  chooseLocation(locationId: string): Promise<void>;
  // Moves to another of YOUR venues: wipes this phone's copies and reloads.
  switchLocation(locationId: string): Promise<void>;
  changesStillWaiting(ms?: number): Promise<boolean>;
  // Reads the open venue's document from the SERVER and puts it in the session (its sections, its switches), with no
  // reload. For a change a Cloud Function has just made to it (the recipe photo switch, step 3d-9), which no listener
  // would otherwise bring: the session reads the venue once, when it opens. Never rejects: offline, or with no venue
  // open, it changes nothing (the check made when the app next opens catches up).
  refreshLocation(): Promise<void>;
  // Staff slice 1. Asks the live Cloud Function `redeemJoinCode` to let this account into the venue a code names, and
  // resolves with that venue's id; rejects with the function's own error (session/joinErrors.ts reads it).
  // ⚠️ The code goes to the function and NOWHERE ELSE: nothing here logs, reports or keeps it.
  redeemJoinCode(code: string, kind: 'digits' | 'link', firstName: string, lastName: string): Promise<string>;
  // Opens the venue the account `uid` has just joined (see the function). Nothing moves if another account is signed in by
  // now: the join was this one's. Every way it opens marks `just-joined`, so the Home offers the install guide once.
  openJoinedVenue(locationId: string, uid: string): Promise<void>;
}

// A cold function's first call outlives anything shorter (settings/settingsSource.ts uses the same).
export const JOIN_TIMEOUT_MS = 60_000;

const userPath = (uid: string) => `users/${uid}`;
const adminPath = (uid: string) => `admins/${uid}`;

export function createSession(backend: SessionBackend, env: SessionEnv): SessionStore {
  let session: Session = INITIAL_SESSION;
  let userDoc: DocData | null = null;
  let isAppAdmin = false;
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

    const optionNames = options.length > 1 ? await readLocationNames(options) : {};
    // ⚠️ AFTER THE LAST AWAIT: a sign-out, or somebody else signing in, may have come while the venue, its language and its
    // names were being read. That session is not this person's to open; a «ready» for the old user would show their venue
    // to the next one (code review, 13 Nov 2026). Also the guard for resolveMembership and chooseLocation, which come here.
    if (signedInUid !== user.uid) return;
    setSession({
      status: 'ready', user, locationId, location, options, optionNames,
      name: typeof location?.name === 'string' && location.name ? location.name : locationId,
      role: roleOf(userDoc, locationId),
      canManage: canManage(userDoc, locationId),
      canManageVenue: canManageVenue(userDoc, locationId),
      isOwner: isOwner(userDoc, locationId),
      isAppAdmin,
      language,
    });
  }

  async function resolveMembership(user: SessionUser): Promise<void> {
    // ⚠️ FROM SCRATCH, not merged into the previous session: when the person changes inside the
    // page, nothing of the previous one's venue, role or powers may survive into a screen — or
    // into a usage line or an error report credited to the wrong venue.
    setSession({ ...INITIAL_SESSION, status: 'loading', user });
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
    if (pick.status === 'ready') {
      await enterLocation(pick.locationId, pick.options, user);
      return;
    }
    if (pick.options.length === 0) {
      setSession({ status: 'no-access', user, options: [], isAppAdmin });
      return;
    }
    setSession({
      status: 'choose-location', user, options: pick.options,
      optionNames: await readLocationNames(pick.options), isAppAdmin,
    });
  }

  function signedOut(): void {
    userDoc = null;
    isAppAdmin = false;
    session = INITIAL_SESSION;
    setSession({ status: 'signed-out' });
  }

  // ── Staff slice 2: the sign-up's own sign-in, held ─────────────────────────────────────────────────────────────────────
  // ⚠️⚠️ WHY IT IS HELD. Creating an account signs it in, and a sign-in by somebody other than whose data this phone's copy
  // holds WIPES the copy and RELOADS the page (onAuth below). For a sign-up that is the join's FIRST step: the reload would cut
  // the code's check off half-way, or throw away the form that must come back with the refusal (current-app fix 9e0a2dac). So
  // while a sign-up is held, its sign-in is only noted (`loading`, with the account) and nothing is read: the account is brand
  // new and has nothing to read anyway (no users/{uid}, every rule refuses it). The join ends it — a yes runs the wipe check
  // and reloads (joinedWithNewAccount), leaving the form runs the ordinary sign-in (releaseSignUp).
  let signUpHeld = false;
  let heldUser: SessionUser | null = null;

  function releaseSignUp(): void {
    if (!signUpHeld) return;
    signUpHeld = false;
    const user = heldUser;
    heldUser = null;
    if (user && signedInUid === user.uid) onAuth(user);
  }

  // The code was accepted for the account the form has just created. The current app reloads after every join; here it must,
  // for a reason of its own: the sign-in was held, so the previous person's copy (if any) is still on this phone. It is wiped
  // NOW, before the page starts again on the new venue, and the install guide is marked for the Home only after the last clear.
  async function joinedWithNewAccount(locationId: string, uid: string): Promise<void> {
    const user = heldUser;
    if (!user || user.uid !== uid || signedInUid !== uid) return;
    clearLocalData();
    write(env.local, ACTIVE_LOCATION_KEY, locationId);
    const verdict = offlineCacheVerdict(read(env.local, OFFLINE_CACHE_OWNER_KEY), uid);
    if (verdict === 'claim') write(env.local, OFFLINE_CACHE_OWNER_KEY, uid);
    if (verdict === 'wipe' && read(env.session, WIPE_FAILED_KEY) !== uid) {
      // As onAuth's own wipe: the owner is recorded only after a clear that worked; a busy database is tried once more at the
      // next opening; Firestore not loadable at all spends nothing, and the next opening tries again.
      const result = await backend.wipeOfflineCache();
      if (result === 'cleared') write(env.local, OFFLINE_CACHE_OWNER_KEY, uid);
      else if (result === 'busy') write(env.session, WIPE_FAILED_KEY, uid);
    }
    markJustJoined(env.local);
    env.reload();
  }

  // Who the browser's sign-in says is there, updated the moment it says so. Not session.user: a different person arriving
  // can wait for a cache wipe and a reload before the session shows anybody else, and a venue opening for the one who
  // left must not be published in that gap.
  let signedInUid: string | null = null;

  function onAuth(user: SessionUser | null): void {
    signedInUid = user && !user.isAnonymous ? user.uid : null;
    if (!user) {
      // A sign-out ends any sign-up held: there is no account left to join with.
      signUpHeld = false;
      heldUser = null;
      signedOut();
      return;
    }

    // ⚠️ A LEFTOVER ANONYMOUS SESSION IS NOT A SIGNED-IN PERSON. Phones that used the app before
    // real accounts still hold one; treated as a sign-in it parks the phone on "No venue yet"
    // and never shows the form. Dropping it comes back through here with nobody signed in.
    if (user.isAnonymous) {
      backend.signOut().catch(err => env.warn('Could not clear the old session', err));
      return;
    }

    // The account a sign-up has just created: noted, not resolved (see signUpHeld).
    if (signUpHeld) {
      heldUser = user;
      setSession({ ...INITIAL_SESSION, status: 'loading', user });
      return;
    }

    // ⚠️⚠️ SOMEBODY ELSE'S DATA IN THE OFFLINE CACHE, AND THEY NEVER SIGNED OUT (an expired or
    // revoked session, then a different person on the sign-in form of a shared tablet). Cleared
    // before a single read of theirs, then the app starts again clean. The new owner is recorded
    // only after a clear that WORKED; a failed one is tried once per opening, never in a loop.
    //
    // ⚠️ AT ANY SIGN-IN, NOT ONLY AT BOOT — the one place Mise 2 differs from js/firebase.js. The
    // current app asks only when a page boots, and every tap on a Home card boots a page, so the
    // next tap clears it. Mise 2 is ONE page that never reloads by itself: asked only at boot,
    // the previous person's prices and stocktakes would be served from the cache to the next one
    // for the whole shift (code review, 11 Oct 2026). The current app's reason for waiting — a
    // join replacing the person mid-page — is met here by HOLDING that one sign-in (signUpHeld, staff
    // slice 2): the join with a new account then runs this same check itself and reloads.
    // (Staff slice 1 joins with the account already signed in: the person does not change, so
    // openJoinedVenue opens the new venue without a reload.)
    const verdict = offlineCacheVerdict(read(env.local, OFFLINE_CACHE_OWNER_KEY), user.uid);
    if (verdict === 'claim') write(env.local, OFFLINE_CACHE_OWNER_KEY, user.uid);
    if (verdict === 'wipe' && read(env.session, WIPE_FAILED_KEY) !== user.uid) {
      clearLocalData();
      void backend.wipeOfflineCache().then(result => {
        // ⚠️ FIRESTORE COULD NOT EVEN BE LOADED (no signal on its first download): nothing was
        // wiped, and the once-per-opening guard below must NOT be spent on it — after a reload
        // with the signal back the wipe would be skipped and the previous person's copy read
        // (code review, 11 Oct 2026). Nothing can be read without Firestore either, so this is
        // the «could not check your access» screen, whose «Try again» reloads and wipes first.
        if (result === 'unavailable') {
          setSession({ ...INITIAL_SESSION, status: 'error', user });
          return;
        }
        if (result === 'cleared') write(env.local, OFFLINE_CACHE_OWNER_KEY, user.uid);
        else write(env.session, WIPE_FAILED_KEY, user.uid);
        env.reload();
      });
      return;
    }

    // ⚠️ NEVER A LOADING SCREEN FOR EVER: anything unexpected becomes the «could not check your
    // access» screen, which says what to do (P17).
    resolveMembership(user).catch(err => {
      env.warn('The session could not be resolved', err);
      setSession({ ...INITIAL_SESSION, status: 'error', user });
    });
  }

  // ⚠️ THE SCREENS GO FIRST, THEN THE DATA (see `leaving`). The person already said yes to leaving (useLeaveFlow asked about
  // anything unsent), so the venue's screens close, their listeners stop, and only then is this phone's copy wiped — in that
  // order, so nothing a closing screen writes to localStorage survives the clear either.
  // `justJoined`: the venue was just joined, so the Home offers the install guide once (marked after the clear, or it goes).
  async function leaveVenue(locationId: string, { justJoined = false } = {}): Promise<void> {
    setSession({ leaving: true });
    await env.letScreensClose();
    clearLocalData();
    write(env.local, ACTIVE_LOCATION_KEY, locationId);
    await backend.wipeOfflineCache();
    if (justJoined) markJustJoined(env.local);
    env.reload();
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
    async signUp(email, password) {
      // ⚠️ HELD BEFORE THE CALL: Firebase may announce the new account before its promise resolves.
      signUpHeld = true;
      try {
        return await backend.signUp(String(email || '').trim(), String(password || ''));
      } catch (err) {
        // No account was made (taken, offline, refused): nothing to hold.
        releaseSignUp();
        throw err;
      }
    },
    releaseSignUp,
    sendReset: email => backend.sendReset(String(email || '').trim()),
    async signOut() {
      // ⚠️ A PENDING INVITATION IS FORGOTTEN ON SIGN-OUT (docs/parity/staff-plan.md, «Security»): it is a key to a
      // venue, and the next person to pick up a shared phone must not find it waiting (session/joinFlow.ts). First,
      // before anything that can fail, and before the reload below starts the next page from this window's storage.
      write(env.session, PENDING_INVITE_KEY, null);
      await backend.signOut();
      clearLocalData();
      // Only a clear that worked forgets whose data this is: after a failed one the record
      // stays, so the next person's first boot catches it and tries again.
      if (await backend.wipeOfflineCache() === 'cleared') write(env.local, OFFLINE_CACHE_OWNER_KEY, null);
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
      await leaveVenue(locationId);
    },
    changesStillWaiting: ms => backend.changesStillWaiting(ms),
    async redeemJoinCode(code, kind, firstName, lastName) {
      const answer = await backend.callFunction('redeemJoinCode', { code, kind, firstName, lastName }, JOIN_TIMEOUT_MS);
      const locationId = answer && typeof answer === 'object' ? (answer as { locationId?: unknown }).locationId : undefined;
      // The function answers { locationId, role } on success. Anything else is not a success, whatever it says.
      if (typeof locationId !== 'string' || !locationId) throw new Error('The join answer named no venue.');
      return locationId;
    },
    // ⚠️⚠️ THE NEW VENUE IS READ FROM THE SERVER, NOT FROM THIS PHONE'S COPY. users/{uid} is written by the function, on
    // the server; this phone's copy still says the account belongs nowhere (or only to its other venues), and a session
    // started from it would open «No venue yet» again, or the OLD venue. The current app reloads the page instead, and
    // pays for the same stale copy with the 30-second check's second reload.
    async openJoinedVenue(locationId, uid) {
      // The account the form created a moment ago (staff slice 2): its sign-in is still held.
      if (signUpHeld) {
        await joinedWithNewAccount(locationId, uid);
        return;
      }
      const user = session.user;
      // ⚠️ THE ACCOUNT THAT SENT THE CODE, compared: the call can take a minute, and a sign-out and another sign-in meanwhile
      // must not have THAT person's venue switched (and their unsent writes wiped) by somebody else's join.
      if (!user || user.uid !== uid) return;
      // ⚠️ ANOTHER VENUE IS OPEN (an owner adding a second business, asked first by InviteQuestion): its screens and
      // this phone's copy of its data must not survive into the new one — exactly a switch of venue. The person was
      // told before the form opened if something typed here had not reached the server yet (useLeaveFlow).
      if (session.status === 'ready') {
        if (session.locationId === locationId) return;
        await leaveVenue(locationId, { justJoined: true });
        return;
      }
      let fresh: DocData | null = null;
      try {
        fresh = await backend.readFromServer(userPath(user.uid));
      } catch { /* offline the instant after joining: the reload below asks again */ }
      // Signed out, or somebody else signed in, while the server was asked: that session is not this one's to move.
      if (session.user?.uid !== user.uid) return;
      if (!fresh || !locationsOf(fresh).includes(locationId)) {
        // The server's answer could not be read (or has not caught up): start again on this venue, as the current
        // app always does.
        write(env.local, ACTIVE_LOCATION_KEY, locationId);
        markJustJoined(env.local);
        env.reload();
        return;
      }
      userDoc = fresh;
      // ⚠️ THE CLEAR enterLocation WOULD MAKE, MADE HERE FIRST, so `just-joined` is written after it and survives: entering a
      // venue that is not the remembered one empties localStorage of everything outside KEEP_PREFIXES, the flag included.
      if (shouldClearLocalData(read(env.local, ACTIVE_LOCATION_KEY), locationId)) clearLocalData();
      write(env.local, ACTIVE_LOCATION_KEY, locationId);
      markJustJoined(env.local);
      await enterLocation(locationId, locationsOf(fresh), user);
    },
    async refreshLocation() {
      const id = session.locationId;
      if (session.status !== 'ready' || id === null) return;
      let data: DocData | null;
      try {
        data = await backend.readFromServer(locationDocPath(id));
      } catch {
        return;
      }
      // ⚠️ ONLY IF THE SAME VENUE IS STILL OPEN: the answer may land after a sign-out or a switch, and another venue's
      // switches must never be painted over this one. A venue whose document vanished keeps what it had.
      if (data === null || session.status !== 'ready' || session.locationId !== id) return;
      setSession({ location: data });
    },
  };
}
