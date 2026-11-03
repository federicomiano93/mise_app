// devicePing.ts — the device count: «this device used this venue today».
//
// Port of js/device-ping.js (the current app) for Mise 2, flow for flow; devicePing.spec.ts carries
// every test of the original. The comments below are the ones it paid for in bugs.
//
// Once a venue is open, a device writes ONE line, locations/{lid}/devices/{id} (sinks.ts), at
// most once per venue per account per day (P14). The id is random, made here and kept in this
// device's storage; the line holds the venue, the signed-in account's uid, the kind of device, the
// release, installed-or-browser and the server's clock — the uid is an opaque account id, never a
// name or an email (P8). The rules refuse every read, so only the owner's script
// (scripts/read-devices.mjs) can count them.
//
// ⚠️ SAME KEYS AS THE CURRENT APP, ON PURPOSE. Mise 2 runs at the same address, so it shares the
// current app's localStorage: one device keeps ONE id and ONE daily ping whichever app it opens
// first, instead of counting twice.
// ⚠️ NEVER VISIBLE, NEVER BLOCKING (P17). Every failure is a console line with the error
// code and nothing else; nothing is thrown, nothing is drawn, nothing waits for it.
// ⚠️ NO STORAGE, NO PING. Without a place to keep the id, every page would count as a new
// device, so the count would lie. A device that cannot remember says nothing.
// ⚠️ THE KEYS ARE "device-id" AND "device-ping-…": local-data keeps those two prefixes through a
// sign-out and a venue switch. Wiped, one phone would count again on every switch.
// ⚠️ THE DAY IS STAMPED WHEN THE WRITE IS HANDED OVER, not when it is confirmed (see pingIfDue).

import {
  newDeviceId, isValidDeviceId, dueToday, localDayKey, devicePayload, sameSession,
  type DeviceKind, type DevicePayload,
} from '@mise/shared/device-model';
import type { KeyValueStorage } from '../session/backend';
import {
  browserDeviceKind, browserStorage, errorCode, isFinalRefusal,
  type SessionSource, type TelemetrySession,
} from './common';
import { MISE2_VERSION } from './version';

export const DEVICE_ID_KEY = 'device-id';
export const PING_DAY_KEY_PREFIX = 'device-ping-';

// Let the page paint and the first reads finish before this one small write.
export const START_DELAY_MS = 2500;

// Venues already being reported in this page (the session callback fires more than once).
const inFlight = new Set<string>();

function readStored(storage: Pick<KeyValueStorage, 'getItem'>, key: string): string | null {
  try { return storage.getItem(key); } catch { return null; }
}

// This device's id, made on first use. null = storage unavailable: do nothing.
export function deviceIdFrom(
  storage: Pick<KeyValueStorage, 'getItem' | 'setItem'> | null | undefined,
  randomBytes: () => ArrayLike<number>,
): string | null {
  if (!storage) return null;
  const known = readStored(storage, DEVICE_ID_KEY);
  if (isValidDeviceId(known)) return known;
  const id = newDeviceId(randomBytes());
  if (!id) return null;
  try {
    storage.setItem(DEVICE_ID_KEY, id);
    // Written, but did it stick? A browser that silently drops writes would otherwise make
    // a new id every page.
    return storage.getItem(DEVICE_ID_KEY) === id ? id : null;
  } catch {
    return null;
  }
}

// The browser's own answers, and the data layer, as the ping asks for them. Replaced one by one
// in the specs; `browserPingDeps` is the real set.
export interface PingDeps {
  storage: KeyValueStorage | null;
  randomBytes(): ArrayLike<number>;
  now(): Date;
  kind(): DeviceKind;
  installed(): boolean;
  version(): Promise<string | null> | string | null;
  send(payload: DevicePayload, id: string): Promise<unknown>;
}

export type PingResult = 'skipped' | 'no-storage' | 'not-due' | 'sent' | 'failed';

// One venue, one device, at most once a day. Never throws and never rejects.
export async function pingIfDue(session: TelemetrySession | null | undefined, d: PingDeps): Promise<PingResult> {
  try {
    if (!session || session.status !== 'ready' || !session.locationId) return 'skipped';
    const lid = session.locationId;
    const uid = session.user && session.user.uid;
    if (!uid) return 'skipped';
    // One stamp per venue AND account: on a shared tablet each person who signs in reports once
    // a day, so the single line (the device's id) ends up showing the last person to use it.
    const dayKey = `${PING_DAY_KEY_PREFIX}${lid}-${uid}`;
    if (inFlight.has(dayKey)) return 'skipped';

    const storage = d.storage;
    const id = deviceIdFrom(storage, d.randomBytes);
    if (!storage || !id) return 'no-storage';
    const today = localDayKey(d.now());
    if (!dueToday(readStored(storage, dayKey), today)) return 'not-due';

    inFlight.add(dayKey);
    try {
      const payload = devicePayload({
        locationId: lid, uid, kind: d.kind(), appVersion: await d.version(), installed: d.installed(),
      });
      if (!payload) return 'skipped';
      // The write is HANDED to the SDK first, and the day is stamped at once, before the answer:
      // with the offline cache a write made offline never settles, and stamping only after the
      // answer would queue one more write on every page opened offline (P14).
      const sending = Promise.resolve().then(() => d.send(payload, id));
      // ⚠️ A branch that only marks the write as «looked after». If stamping the day throws
      // (a full storage) the line below is never reached, nobody awaits `sending`, and its later
      // failure would be an unhandled rejection — which the error report itself would then send.
      // The await below still sees the failure: this does not change `sending`.
      sending.catch(() => {});
      storage.setItem(dayKey, today);
      try {
        await sending;
      } catch (err) {
        // A passing failure (offline, signed out, server busy) is tried again on the next page;
        // a refusal by the rules would only repeat itself, so that stamp stays.
        if (!isFinalRefusal(err)) {
          try { storage.removeItem(dayKey); } catch { /* the stamp stays: one lost retry */ }
        }
        throw err;
      }
      return 'sent';
    } finally {
      inFlight.delete(dayKey);
    }
  } catch (err) {
    console.warn('Device count not sent:', errorCode(err));
    return 'failed';
  }
}

// The browser's own answers. `send` is the data layer's pingDevice (sinks.ts).
//
// Read when called, not when this file is imported: the specs import it without a browser.
export function browserPingDeps(send: PingDeps['send']): PingDeps {
  return {
    storage: browserStorage(),
    randomBytes: () => crypto.getRandomValues(new Uint8Array(64)),
    now: () => new Date(),
    kind: browserDeviceKind,
    installed: () => window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    version: () => MISE2_VERSION,
    send,
  };
}

// Waits for a venue to be open, then a moment more, re-reads who is signed in, and pings for
// THAT person. Returns a function that stops it (the specs use it; the app never needs to).
//
// ⚠️ The session is re-read when the timer fires: the person may have signed out or switched
// venue in the meantime, and the write must belong to who is signed in NOW.
export function startDevicePing(
  source: SessionSource,
  deps: PingDeps,
  { delayMs = START_DELAY_MS }: { delayMs?: number } = {},
): () => void {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let unsubscribe = (): void => {};
  let stopListening = (): void => {};
  try {
    const handle = (session: TelemetrySession): void => {
      if (session.status !== 'ready' || !session.locationId) return;
      const timer = setTimeout(() => {
        timers.delete(timer);
        const now = source.getSnapshot();
        if (sameSession(session, now)) void pingIfDue(now, deps);
      }, delayMs);
      timers.add(timer);
    };
    // A store does not call back at once the way the current app's onSession() did.
    unsubscribe = source.subscribe(() => handle(source.getSnapshot()));
    handle(source.getSnapshot());

    // ⚠️ A PAGE LEFT OPEN FOR DAYS (the lab tablet) opens no new session, so the day's line would
    // never be sent again. Coming back to the page, and the signal coming back, both ask «is it
    // due today?» — which pingIfDue answers from the stamp, so it still goes at most once a day.
    const askAgain = (): void => {
      try { void pingIfDue(source.getSnapshot(), deps); } catch { /* never visible: a broken source */ }
    };
    const onVisible = (): void => { if (document.visibilityState === 'visible') askAgain(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', askAgain);
    stopListening = () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', askAgain);
    };
  } catch (err) {
    console.warn('Device count not started:', errorCode(err));
  }
  return () => {
    unsubscribe();
    stopListening();
    timers.forEach(timer => clearTimeout(timer));
    timers.clear();
  };
}
