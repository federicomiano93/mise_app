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
// ⚠️ A FAILURE LOGS THE ERROR CODE ALONE: a message can name the document path, and that path IS the token.
// ⚠️ NEVER THROWS: the button must always come back.

import { buildPath } from '@mise/shared/location-id';
import type { KeyValueStorage } from '../session/backend';
import type { FirestoreKit } from '../session/firebaseBackend';
import { errorCode, type TelemetrySession } from '../telemetry/common';
import { PUSH_TOKEN_KEY, PUSH_TOKEN_OWNER_KEY } from './phoneMute';

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
  // setDoc(locations/{lid}/fcm-tokens/{token}, row, { merge: true }).
  readonly writeRow: (lid: string, token: string, row: TokenRow) => Promise<unknown>;
  readonly deleteRow: (lid: string, token: string) => Promise<unknown>;
  // How long the write may take before the tap answers 'failed'.
  readonly writeTimeoutMs?: number;
}

// What the Settings screen is given (and a spec replaces).
export interface PhonePush {
  support(): PushSupport;
  register(): Promise<PushOutcome>;
  // Is this phone registered to the person holding it? Permission alone does not say: a shared phone can still carry the
  // registration of the person before.
  onForMe(uid: string): boolean;
}

export const WRITE_TIMEOUT_MS = 15_000;

// A token that could name a document: not empty, no path separator, no longer than the rules allow (as pushTokenRefresh.ts).
function usableToken(token: unknown): token is string {
  return typeof token === 'string' && token.length > 0 && token.length <= 4096 && !token.includes('/');
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
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

  function onForMe(uid: string): boolean {
    return support() === 'granted' && uid !== '' && read(PUSH_TOKEN_KEY) !== '' && read(PUSH_TOKEN_OWNER_KEY) === uid;
  }

  async function register(): Promise<PushOutcome> {
    try {
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

      const token = await deps.getToken();
      if (!usableToken(token)) return 'failed';

      // ⚠️ MERGED, see the header. The tap answers 'failed' if the server does not confirm in time; a write already handed
      // over may still arrive later, which is harmless (the same row, the same person).
      await withTimeout(deps.writeRow(lid, token, { bakery: lid, uid, updatedAt: deps.now() }), deps.writeTimeoutMs ?? WRITE_TIMEOUT_MS);

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

  return { support, register, onForMe };
}

// The browser's own answers, read when called (the specs import this file without a browser).
export function browserPushEnv(): PushEnv {
  return {
    hasNotification: () => typeof window !== 'undefined' && 'Notification' in window,
    hasServiceWorker: () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    hasPushManager: () => typeof window !== 'undefined' && 'PushManager' in window,
    isIOS: () => /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    isStandalone: () => window.matchMedia('(display-mode: standalone)').matches
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
