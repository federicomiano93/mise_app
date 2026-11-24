// phonePush.ts — registering THIS phone for server push (Cloud Messaging), from a tap in Orders → Settings.
//
// The Mise 2 half of js/push.js (`pushSupport`, `enablePush`, `rememberToken`, `pushOnForMe`), with every browser and
// Firebase call injected so each rule below is a spec. Until this existed, the button «Enable notifications» only asked the
// browser's permission: a phone set up since Mise 2 never reached the server's list (locations/{lid}/fcm-tokens), so it got
// no order-list request and no client order while the app was closed, and the «do not buzz this phone» switch stayed locked.
//
// ⚠️ THE SAME KEYS AS js/push.js (`push-token`, `push-token-uid`, phoneMute.ts), because both apps share one origin and
// either may be opened next: a phone registered by one is registered for the other. Not under KEEP_PREFIXES — a sign-out or a
// venue switch wipes them, so the next person never inherits this one's registration.
//
// ⚠️ register() MUST BE CALLED FROM A REAL TAP: browsers refuse a permission prompt nobody asked for, and iOS refuses it
// outright outside a user gesture.
// ⚠️ THE ROW IS MERGED, NEVER WRITTEN WHOLE (code review, 23 Sep 2026, js/push.js): the same document carries this phone's
// «do not buzz me about order lists» (`muteOrderRequests`), and a whole write would switch it off in silence while the switch
// on screen, which reads a local copy, still said «muted». The document id IS the token, so registering again overwrites the
// same row rather than piling up rows nothing will clean.
// ⚠️ NOTHING OFFLINE (as pushTokenRefresh.ts): a write made offline would sit in Firestore's queue and a sign-out would then warn
// «your changes will be lost» about something nobody typed. Offline answers 'failed' and writes nothing.
// ⚠️ A WRITE CUT OFF BY THE TIME LIMIT STAYS IN FIRESTORE'S QUEUE and goes out when the signal returns (the same exposure as
// pushTokenRefresh.ts): harmless — the same row, the same person — but a sign-out may then warn about it.
// ⚠️ THE ROW CARRIES `muteOrderRequests` = what this phone's switch draws (phoneMute.ts), so the server always matches the screen.
// On a shared tablet A mutes and signs out; the next person registers with the mirror gone while the server still says true: a
// fresh device therefore RINGS (the safe direction). A deliberate difference from js/push.js, which leaves the field alone.
// ⚠️ A PHONE THAT SAYS «ON» CAN HAVE LOST ITS SUBSCRIPTION (notifications blocked then allowed again, or the server deleted the row
// for a dead token): verify() asks the browser, locally, and takes the registration back when it is gone.
// ⚠️ A FAILURE LOGS THE ERROR CODE ALONE: a message can name the document path, and that path IS the token.
// ⚠️ NEVER THROWS: the button must always come back.
// ⚠️ SIGN-OUT DELETES THIS PHONE'S ROW (security audit A2-1): wiping the local keys is not enough, the server row stays under the
// old person's uid and the server keeps sending that person's alerts (order requests, client orders, guided-mix timers) to a phone
// that has since changed hands. forgetThisPhone() runs BEFORE the account goes (the delete needs the signed-in account and live
// Firestore), only for a row this account owns, only online, bounded by FORGET_TIMEOUT_MS, and never throws or blocks longer.
// A row deleted by a sign-out that then fails is harmless: the phone registers again from Orders → Settings.
// LEAVING A VENUE (a switch) calls it too, in the venue being left (his decision, 24 Nov 2026, session.ts leaveVenue): the switch
// wipes the keys, so the row would otherwise be orphaned there.
// ⚠️⚠️ A REFUSED ROW MEANS «THIS PHONE CHANGED HANDS»: DROP THE TOKEN AND TRY ONCE WITH A NEW ONE (audit A2-1, step 2). The rules
// update a row only under its stored owner, so a row left behind under the person before (an offline sign-out, the old app, an
// expired session) refuses the next person's registration. register() then drops the token (Firebase deleteToken), takes a new
// one — a new document, which the rules let anybody in the venue create — and writes again. Only on `permission-denied`, only
// once per tap, and only while the same session holds: a time-out or an offline answer is not a refusal and keeps the token.
// The person before loses nothing they should keep: the old token is dead, the server deletes its row on its next send.

import { INSTALLED_DISPLAY_QUERY } from '../session/displayMode';
import { sameSession } from '@mise/shared/device-model';
import { buildPath } from '@mise/shared/location-id';
import type { KeyValueStorage } from '../session/backend';
import type { FirestoreKit } from '../session/firebaseBackend';
import { errorCode, type TelemetrySession } from '../telemetry/common';
import { MUTE_KEY, PUSH_TOKEN_KEY, PUSH_TOKEN_OWNER_KEY } from './phoneKeys';

// Why this phone can or cannot receive: the screen says WHICH reason, rather than offering a button that can never work.
export type PushSupport = 'granted' | 'ask' | 'blocked' | 'install-first' | 'unsupported' | 'not-configured';
export type PushOutcome = 'on' | 'blocked' | 'ask' | 'install-first' | 'unsupported' | 'not-configured' | 'failed';

export interface PushEnv {
  hasNotification(): boolean;
  hasServiceWorker(): boolean;
  hasPushManager(): boolean;
  isIOS(): boolean;
  isStandalone(): boolean;
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
}

export interface TokenRow {
  readonly bakery: string;
  readonly uid: string;
  readonly updatedAt: number;
  readonly muteOrderRequests: boolean;
}

export interface PhonePushDeps {
  readonly env: PushEnv;
  // '' = push is not configured for this project (the preview).
  readonly vapidKey: string;
  readonly storage: KeyValueStorage | null;
  readonly session: () => TelemetrySession | null | undefined;
  readonly online: () => boolean;
  readonly now: () => number;
  // The token from Cloud Messaging (the backend's `pushToken`).
  readonly getToken: () => Promise<string>;
  // Drops the token, so the next getToken() makes a new one (the backend's `dropPushToken`; a no-op on a local address).
  readonly dropToken: () => Promise<unknown>;
  // setDoc(locations/{lid}/fcm-tokens/{token}, row, { merge: true }).
  readonly writeRow: (lid: string, token: string, row: TokenRow) => Promise<unknown>;
  readonly deleteRow: (lid: string, token: string) => Promise<unknown>;
  // Does the browser still hold a push subscription for this phone? null = cannot tell (no worker in time, a local address,
  // an error). Absent on a local address: its token is made up and has no subscription.
  readonly hasSubscription?: () => Promise<boolean | null>;
  // How long the token and the write may each take before the tap answers 'failed' (and the subscription check gives up).
  readonly writeTimeoutMs?: number;
}

// What the Settings screen is given (and a spec replaces).
export interface PhonePush {
  support(): PushSupport;
  register(): Promise<PushOutcome>;
  // Is this phone registered to the person holding it? Permission alone does not say: a shared phone can still carry the
  // registration of the person before.
  onForMe(uid: string): boolean;
  // Permission-only mode: a browser that has notifications but cannot be registered for push (no push machinery, or no key in
  // this project). The calendar notices raised while the app is open still need the permission, so the button asks it, as before
  // push existed. null = not in this mode.
  permissionOnly(): 'default' | 'granted' | 'denied' | null;
  // «On» but the subscription is gone? 'cleared' = the registration was forgotten (the button comes back); 'ok'; 'unknown'.
  verify(): Promise<'ok' | 'cleared' | 'unknown'>;
  // Sign-out: delete this phone's row in the open venue, best effort. Never throws, never waits past FORGET_TIMEOUT_MS.
  forgetThisPhone(): Promise<void>;
}

export const WRITE_TIMEOUT_MS = 15_000;
// A sign-out must not feel stuck: a delete that does not answer in this time is left behind.
export const FORGET_TIMEOUT_MS = 3_000;

// A token that could name a document: not empty, no path separator, no longer than the rules allow (as pushTokenRefresh.ts).
function usableToken(token: unknown): token is string {
  return typeof token === 'string' && token.length > 0 && token.length <= 4096 && !token.includes('/');
}

export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), ms);
  });
  return Promise.race([work, late]).finally(() => { clearTimeout(timer); });
}

export function createPhonePush(deps: PhonePushDeps): PhonePush {
  const read = (key: string): string => {
    try { return deps.storage?.getItem(key) ?? ''; } catch { return ''; }
  };

  function support(): PushSupport {
    const { env } = deps;
    try {
      if (!env.hasNotification() || !env.hasServiceWorker() || !env.hasPushManager()) {
        // iOS Safari outside a Home-screen app lands here: the API is absent, not merely blocked.
        return env.isIOS() && !env.isStandalone() ? 'install-first' : 'unsupported';
      }
      if (!deps.vapidKey) return 'not-configured';
      const permission = env.permission();
      if (permission === 'denied') return 'blocked';
      if (permission === 'granted') return 'granted';
      return 'ask';
    } catch {
      return 'unsupported';
    }
  }

  function permissionOnly(): 'default' | 'granted' | 'denied' | null {
    try {
      const reason = support();
      if ((reason !== 'not-configured' && reason !== 'unsupported') || !deps.env.hasNotification()) return null;
      return deps.env.permission();
    } catch {
      return null;
    }
  }

  async function verify(): Promise<'ok' | 'cleared' | 'unknown'> {
    try {
      if (!deps.hasSubscription || support() !== 'granted' || read(PUSH_TOKEN_KEY) === '') return 'unknown';
      const has = await withTimeout(deps.hasSubscription(), deps.writeTimeoutMs ?? WRITE_TIMEOUT_MS);
      if (has === null) return 'unknown';
      if (has) return 'ok';
      try {
        deps.storage?.removeItem(PUSH_TOKEN_KEY);
        deps.storage?.removeItem(PUSH_TOKEN_OWNER_KEY);
      } catch {
        return 'unknown';
      }
      return 'cleared';
    } catch {
      return 'unknown';
    }
  }

  function onForMe(uid: string): boolean {
    return support() === 'granted' && uid !== '' && read(PUSH_TOKEN_KEY) !== '' && read(PUSH_TOKEN_OWNER_KEY) === uid;
  }

  async function register(): Promise<PushOutcome> {
    try {
      const only = permissionOnly();
      if (only !== null) {
        if (only !== 'default') return only === 'granted' ? 'on' : 'blocked';
        try {
          const answer = await deps.env.requestPermission();
          return answer === 'granted' ? 'on' : answer === 'denied' ? 'blocked' : 'ask';
        } catch {
          return 'unsupported';
        }
      }
      const reason = support();
      if (reason !== 'granted' && reason !== 'ask') return reason;

      let permission = deps.env.permission();
      if (permission === 'default') {
        try {
          permission = await deps.env.requestPermission();
        } catch {
          return 'unsupported';
        }
      }
      if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'ask';

      const session = deps.session();
      const lid = session?.locationId;
      const uid = session?.user?.uid;
      if (session?.status !== 'ready' || !lid || !uid) return 'failed';
      if (!deps.online()) return 'failed';

      const limit = deps.writeTimeoutMs ?? WRITE_TIMEOUT_MS;
      let token = await withTimeout(deps.getToken(), limit);
      if (!usableToken(token)) return 'failed';

      // ⚠️ MERGED, see the header. The tap answers 'failed' if the server does not confirm in time; a write already handed
      // over may still arrive later, which is harmless (the same row, the same person).
      const row: TokenRow = { bakery: lid, uid, updatedAt: deps.now(), muteOrderRequests: read(MUTE_KEY) === '1' };
      try {
        await withTimeout(deps.writeRow(lid, token, row), limit);
      } catch (err) {
        // ⚠️⚠️ A2-1, see the header: the row is somebody else's. Anything else (a time-out, the network) is not a refusal.
        if (errorCode(err) !== 'permission-denied') throw err;
        if (!sameSession(session, deps.session())) return 'failed';
        const refused = token;
        await withTimeout(Promise.resolve(deps.dropToken()), limit);
        token = await withTimeout(deps.getToken(), limit);
        if (!usableToken(token) || token === refused) return 'failed';
        await withTimeout(deps.writeRow(lid, token, row), limit);
      }

      // ⚠️ THE PERSON OR THE VENUE MAY HAVE CHANGED DURING THE WAIT (a sign-out, a venue switch, somebody else on a shared tablet):
      // the registration is remembered only for the session it was written for.
      if (!sameSession(session, deps.session())) return 'failed';

      const previous = read(PUSH_TOKEN_KEY);
      try {
        deps.storage?.setItem(PUSH_TOKEN_KEY, token);
        deps.storage?.setItem(PUSH_TOKEN_OWNER_KEY, uid);
      } catch {
        // Private mode: registered on the server, but this phone cannot remember it, so it is not shown as «on».
        return 'failed';
      }
      // A token can rotate: the old row goes, so the venue does not keep registrations for a phone that will never answer
      // again. After the new row is safe, best effort, and NOT WAITED FOR (a delete does not settle offline).
      if (previous && previous !== token && usableToken(previous)) {
        try {
          void Promise.resolve(deps.deleteRow(lid, previous)).catch(() => { /* best effort */ });
        } catch { /* best effort */ }
      }
      return 'on';
    } catch (err) {
      console.warn('Phone push registration failed:', errorCode(err));
      return 'failed';
    }
  }

  async function forgetThisPhone(): Promise<void> {
    try {
      const session = deps.session();
      const lid = session?.locationId;
      const uid = session?.user?.uid;
      if (!lid || !uid) return;
      const token = read(PUSH_TOKEN_KEY);
      // Only the row this account registered: a stored token under somebody else's uid is not ours to delete. An EMPTY owner
      // is tried too — a phone the current app registered before `push-token-uid` existed — because the rules delete only
      // a row whose stored uid is the signer's own (firestore.rules, fcm-tokens), so somebody else's row is refused there.
      const owner = read(PUSH_TOKEN_OWNER_KEY);
      if (!usableToken(token) || (owner !== uid && owner !== '')) return;
      // Offline a delete never settles and would sit in Firestore's queue, to be warned about as unsent work.
      if (!deps.online()) return;
      await withTimeout(Promise.resolve(deps.deleteRow(lid, token)), FORGET_TIMEOUT_MS);
      // The row is gone, so this phone must stop saying it is registered: should the sign-out itself then fail, the app
      // comes back as it was, and Settings must offer «Enable» again rather than draw «on» for a row that no longer exists.
      try {
        deps.storage?.removeItem(PUSH_TOKEN_KEY);
        deps.storage?.removeItem(PUSH_TOKEN_OWNER_KEY);
      } catch { /* storage refused: the sign-out's own wipe clears it */ }
    } catch (err) {
      // The code alone: a message can name the document path, and that path IS the token.
      console.warn('Phone push sign-out cleanup failed:', errorCode(err));
    }
  }

  return { support, register, onForMe, permissionOnly, verify, forgetThisPhone };
}

// The browser's own subscription, locally and with no network. null when the worker is not there.
export async function browserHasSubscription(): Promise<boolean | null> {
  const registration = await navigator.serviceWorker.ready;
  return (await registration.pushManager.getSubscription()) !== null;
}

// The browser's own answers, read when called (the specs import this file without a browser).
export function browserPushEnv(): PushEnv {
  return {
    hasNotification: () => typeof window !== 'undefined' && 'Notification' in window,
    hasServiceWorker: () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    hasPushManager: () => typeof window !== 'undefined' && 'PushManager' in window,
    isIOS: () => /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    isStandalone: () => window.matchMedia(INSTALLED_DISPLAY_QUERY).matches
      || (navigator as { standalone?: boolean }).standalone === true,
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
  };
}

// The real row writer and deleter, through the backend's Firestore (the one door: firestore-access.spec.ts).
export function rowWriter(firestore: () => Promise<FirestoreKit>): Pick<PhonePushDeps, 'writeRow' | 'deleteRow'> {
  return {
    async writeRow(lid, token, row) {
      const { fs, db } = await firestore();
      await fs.setDoc(fs.doc(db, buildPath(lid, 'fcm-tokens'), token), { ...row }, { merge: true });
    },
    async deleteRow(lid, token) {
      const { fs, db } = await firestore();
      await fs.deleteDoc(fs.doc(db, buildPath(lid, 'fcm-tokens'), token));
    },
  };
}
