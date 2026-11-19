// pushTokenRefresh.ts — tells the server, at most once a week, that this phone's alert registration is still alive.
//
// WHY: the nightly clean-up (functions/retention.js, the owner's decision of 18 Nov 2026) deletes
// locations/{lid}/fcm-tokens/{token} once its `updatedAt` is 60 days old. The current app writes `updatedAt` only when
// somebody taps «turn notifications on», or sets a timer on a phone whose stored owner is somebody else (js/push.js
// rememberToken, scheduleAlarm), and Mise 2 registers no phone yet
// (phoneMute.ts), so a phone that works perfectly would be silenced after two quiet months. Mise 2 therefore re-writes
// the stamp while the phone is in use.
//
// WHAT: once the session is ready, if this phone holds a token (`push-token`) whose stored owner (`push-token-uid`, the
// current app's keys) is the person signed in, ONE update of exactly `{ bakery, uid, updatedAt }` onto that document — the
// fields rememberToken writes, which the rules' fcm-tokens block already accepts (uid the writer's own, updatedAt a
// number). An UPDATE, never a merge: the same document carries this phone's «do not buzz me about order lists», which an
// update leaves alone.
// ⚠️ UPDATE ONLY, NEVER RE-CREATE. The server deletes a row on purpose: a dead token (functions/index.js,
// registration-token-not-registered) and a removed member's phone (functions/onboarding.js). A merge would quietly bring
// it back. The cost: a row deleted by mistake no longer heals itself; the current app's own tap re-registers it.
// A `not-found` answer is final: nothing is created and the stamp stays, so it is not asked again on every open.
// ⚠️ ONLY WHEN NOTIFICATIONS ARE GRANTED (as the current app's pushSupport().ok, js/push.js). A phone that blocked them
// writes nothing and stamps nothing, so its row ages out after 60 days, and refreshes on the next open if it is granted again.
// A phone whose token belongs to somebody else writes nothing: re-registering it in this person's name is the current
// app's decision, made on a tap, never in the background.
//
// ⚠️ NEVER VISIBLE, NEVER BLOCKING, NEVER THROWS. A failure is a console line with the error code alone (a message can name
// the document path, and that path IS the token). Nothing waits for it.
// ⚠️ NOTHING OFFLINE. A write made offline would sit in Firestore's queue, and a sign-out or venue switch would then warn
// «your changes will be lost» about something nobody typed (the same reason as telemetry/sinks.ts). Offline is skipped and
// asked again when the signal comes back.
// ⚠️ THE STAMP (`push-token-refreshed`) IS NOT UNDER KEEP_PREFIXES, ON PURPOSE: it is a fact about ONE registration —
// this token, this person, this venue — and the token and its owner key are wiped by a sign-out or a venue switch
// (neither is kept). Kept alone, a stamp written for the previous registration could silence the refresh of the next one
// for up to a week. It also carries the venue and the uid it was written for, so a stamp that somehow outlives its
// registration is simply not believed.
// ⚠️ THE STAMP IS WRITTEN WHEN THE WRITE IS HANDED OVER, not when it is confirmed (as devicePing.ts): a write that never
// settles must not be queued again on every page.

import { sameSession } from '@mise/shared/device-model';
import { buildPath } from '@mise/shared/location-id';
import type { KeyValueStorage } from '../session/backend';
import type { FirestoreKit } from '../session/firebaseBackend';
import { browserStorage, errorCode, isFinalRefusal, isReadySession, type SessionSource, type TelemetrySession } from '../telemetry/common';
import { phoneToken, phoneTokenOwner } from './phoneMute';

export const REFRESH_STAMP_KEY = 'push-token-refreshed';
export const REFRESH_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
// Let the first screen paint and the first reads finish before this one small write.
export const START_DELAY_MS = 4000;
// A page left open for days (the lab tablet) opens no new session and may never be hidden: asked again this often.
export const ASK_AGAIN_MS = 6 * 60 * 60 * 1000;

export interface TokenStamp {
  readonly bakery: string;
  readonly uid: string;
  readonly updatedAt: number;
}

export interface RefreshDeps {
  storage: KeyValueStorage | null;
  // This phone's token and the uid it was registered for ('' when none).
  token(): string;
  tokenOwner(): string;
  now(): number;
  // false only when the device KNOWS it has no signal.
  online(): boolean;
  // true only when the browser has notifications and the person allowed them.
  notificationsGranted(): boolean;
  // The update of locations/{lid}/fcm-tokens/{token} (never a create).
  write(lid: string, token: string, stamp: TokenStamp): Promise<unknown>;
}

export type RefreshResult = 'skipped' | 'no-token' | 'not-owner' | 'not-granted' | 'offline' | 'not-due' | 'sent' | 'failed';

// What the stamp holds: when, and for which venue and person.
interface StoredStamp { lid: string; uid: string; at: number }

function readStamp(storage: KeyValueStorage): StoredStamp | null {
  try {
    const raw = storage.getItem(REFRESH_STAMP_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== 'object') return null;
    const { lid, uid, at } = value as Record<string, unknown>;
    return typeof lid === 'string' && typeof uid === 'string' && typeof at === 'number' && Number.isFinite(at)
      ? { lid, uid, at }
      : null;
  } catch {
    return null;
  }
}

// Due unless this venue and person were refreshed less than a week ago. A stamp from the future (the clock was wrong,
// then corrected) is not believed: it would otherwise hold the refresh back for as long as the clock had been ahead.
export function refreshDue(stamp: StoredStamp | null, lid: string, uid: string, now: number): boolean {
  if (!stamp || stamp.lid !== lid || stamp.uid !== uid) return true;
  return stamp.at > now || now - stamp.at >= REFRESH_EVERY_MS;
}

// A token that could name a document: not empty, no path separator, no longer than the rules allow a token to be.
function usableToken(token: string): boolean {
  return token.length > 0 && token.length <= 4096 && !token.includes('/');
}

// Venues already being refreshed in this page (the session announces itself more than once).
const inFlight = new Set<string>();

// One phone, one venue, at most once a week. Never throws and never rejects.
export async function refreshIfDue(session: TelemetrySession | null | undefined, d: RefreshDeps): Promise<RefreshResult> {
  try {
    if (!isReadySession(session)) return 'skipped';
    const lid = session.locationId;
    const uid = session.user.uid;
    const storage = d.storage;
    if (!storage) return 'skipped';
    const token = d.token();
    if (!usableToken(token)) return 'no-token';
    if (d.tokenOwner() !== uid) return 'not-owner';
    if (!d.notificationsGranted()) return 'not-granted';
    const now = d.now();
    if (!refreshDue(readStamp(storage), lid, uid, now)) return 'not-due';
    if (!d.online()) return 'offline';
    const key = `${lid}|${uid}`;
    if (inFlight.has(key)) return 'skipped';

    inFlight.add(key);
    try {
      const sending = Promise.resolve().then(() => d.write(lid, token, { bakery: lid, uid, updatedAt: now }));
      // Looked after even if stamping throws below (a full storage): never an unhandled rejection.
      sending.catch(() => {});
      storage.setItem(REFRESH_STAMP_KEY, JSON.stringify({ lid, uid, at: now }));
      try {
        await sending;
      } catch (err) {
        // A passing failure (signal lost, server busy) is asked again on the next page; a refusal by the rules would
        // only repeat itself, so that stamp stays.
        if (!isFinalRefusal(err)) {
          try { storage.removeItem(REFRESH_STAMP_KEY); } catch { /* the stamp stays: one lost retry */ }
        }
        throw err;
      }
      return 'sent';
    } finally {
      inFlight.delete(key);
    }
  } catch (err) {
    console.warn('Push registration not refreshed:', errorCode(err));
    return 'failed';
  }
}

// The real write, through the backend's Firestore (the one door: firestore-access.spec.ts).
export function tokenWriter(firestore: () => Promise<FirestoreKit>): RefreshDeps['write'] {
  return async (lid, token, stamp) => {
    const { fs, db } = await firestore();
    try {
      await fs.updateDoc(fs.doc(db, buildPath(lid, 'fcm-tokens'), token), { ...stamp });
    } catch (err) {
      // The server removed this row on purpose: leave it removed (the stamp stays, so this is not retried every open).
      if ((err as { code?: unknown } | null)?.code === 'not-found') return;
      throw err;
    }
  };
}

// The browser's own answers. Read when called, not when this file is imported: the specs import it without a browser.
export function browserRefreshDeps(write: RefreshDeps['write']): RefreshDeps {
  return {
    storage: browserStorage(),
    token: phoneToken,
    tokenOwner: phoneTokenOwner,
    now: () => Date.now(),
    online: () => navigator.onLine !== false,
    notificationsGranted: () => typeof Notification !== 'undefined' && Notification.permission === 'granted',
    write,
  };
}

// Waits for a venue to be open and a moment more, re-reads who is signed in, and refreshes for THAT person; then asks
// again when the page comes back to the foreground, when the signal comes back, and every few hours. Returns a function
// that stops it (the specs use it; the app never needs to).
export function startPushTokenRefresh(
  source: SessionSource,
  deps: RefreshDeps,
  { delayMs = START_DELAY_MS, everyMs = ASK_AGAIN_MS }: { delayMs?: number; everyMs?: number } = {},
): () => void {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let unsubscribe = (): void => {};
  let stopListening = (): void => {};
  try {
    const handle = (session: TelemetrySession): void => {
      if (!isReadySession(session)) return;
      const timer = setTimeout(() => {
        timers.delete(timer);
        const now = source.getSnapshot();
        if (sameSession(session, now)) void refreshIfDue(now, deps);
      }, delayMs);
      timers.add(timer);
    };
    unsubscribe = source.subscribe(() => handle(source.getSnapshot()));
    handle(source.getSnapshot());

    const askAgain = (): void => {
      try { void refreshIfDue(source.getSnapshot(), deps); } catch { /* never visible: a broken source */ }
    };
    const onVisible = (): void => { if (document.visibilityState === 'visible') askAgain(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', askAgain);
    const every = setInterval(askAgain, everyMs);
    stopListening = () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', askAgain);
      clearInterval(every);
    };
  } catch (err) {
    console.warn('Push registration refresh not started:', errorCode(err));
  }
  return () => {
    unsubscribe();
    stopListening();
    timers.forEach(timer => clearTimeout(timer));
    timers.clear();
  };
}
