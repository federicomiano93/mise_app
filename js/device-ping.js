// device-ping.js — the device count: «this device used this venue today».
//
// Once a venue is open, a device writes ONE line, locations/{lid}/devices/{id}, at most once
// per venue per account per day (P14). The id is random, made here and kept in this device's storage; the
// line holds the venue, the signed-in account's uid, the kind of device, the release,
// installed-or-browser and the server's clock — the uid is an opaque account id, never a name
// or an email (P8). The rules refuse every
// read, so only the owner's script (scripts/read-devices.mjs) can count them.
//
// Imported by js/auth-gate.js, which every member page loads and the client ordering page
// (order.html) does not: a client account is not a member and its writes would be refused.
//
// ⚠️ NEVER VISIBLE, NEVER BLOCKING (P17). Every failure is a console line with the error
// code and nothing else; nothing is thrown, nothing is drawn, nothing waits for it.
// ⚠️ NO STORAGE, NO PING. Without a place to keep the id, every page would count as a new
// device, so the count would lie. A device that cannot remember says nothing.
// ⚠️ THE KEYS ARE "device-id" AND "device-ping-…": js/local-data.js keeps those two prefixes
// through a sign-out and a venue switch. Wiped, one phone would count again on every switch.
// ⚠️ THE DAY IS STAMPED WHEN THE WRITE IS HANDED OVER, not when it is confirmed (see pingIfDue).

import { askVersionOf, versionNumber } from './app-version.js';
import {
  deviceKind, newDeviceId, isValidDeviceId, dueToday, localDayKey, devicePayload, sameSession,
} from './device-model.js';

export const DEVICE_ID_KEY = 'device-id';
export const PING_DAY_KEY_PREFIX = 'device-ping-';

// Let the page paint and the first reads finish before this one small write.
const START_DELAY_MS = 2500;

// Venues already being reported in this page (the session callback fires more than once).
const inFlight = new Set();

function readStored(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}

// This device's id, made on first use. null = storage unavailable: do nothing.
export function deviceIdFrom(storage, randomBytes) {
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

// Only these codes mean «asking again tomorrow won't help differently from asking again
// now»: a refusal does not heal by retrying on every page of the day.
function isFinalRefusal(err) {
  const code = err && err.code ? String(err.code) : '';
  return code === 'permission-denied' || code === 'invalid-argument';
}

// One venue, one device, at most once a day. `deps` exists so the flow can be tested without
// a browser; production passes nothing.
export async function pingIfDue(session, deps = {}) {
  const d = { ...REAL(), ...deps };
  try {
    if (!session || session.status !== 'ready' || !session.locationId) return 'skipped';
    const lid = session.locationId;
    const uid = session.user && session.user.uid;
    if (!uid) return 'skipped';
    // One stamp per venue AND account: on a shared tablet each person who signs in reports once
    // a day, so the single line (the device's id) ends up showing the last person to use it.
    const dayKey = `${PING_DAY_KEY_PREFIX}${lid}-${uid}`;
    if (inFlight.has(dayKey)) return 'skipped';

    const id = deviceIdFrom(d.storage, d.randomBytes);
    if (!id) return 'no-storage';
    const today = localDayKey(d.now());
    if (!dueToday(readStored(d.storage, dayKey), today)) return 'not-due';

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
      d.storage.setItem(dayKey, today);
      try {
        await sending;
      } catch (err) {
        // A passing failure (offline, signed out, server busy) is tried again on the next page;
        // a refusal by the rules would only repeat itself, so that stamp stays.
        if (!isFinalRefusal(err)) {
          try { d.storage.removeItem(dayKey); } catch { /* the stamp stays: one lost retry */ }
        }
        throw err;
      }
      return 'sent';
    } finally {
      inFlight.delete(dayKey);
    }
  } catch (err) {
    console.warn('Device count not sent:', err && err.code ? err.code : 'unknown');
    return 'failed';
  }
}

// The browser's own answers, read when needed (not at import: this file is also loaded by tests).
function REAL() {
  return {
    storage: (() => { try { return window.localStorage; } catch { return null; } })(),
    randomBytes: () => crypto.getRandomValues(new Uint8Array(64)),
    now: () => new Date(),
    kind: () => deviceKind({
      width: screen.width,
      height: screen.height,
      coarse: window.matchMedia('(pointer: coarse)').matches,
    }),
    installed: () => window.matchMedia('(display-mode: standalone)').matches
      || navigator.standalone === true,
    version: async () => {
      const controller = navigator.serviceWorker ? navigator.serviceWorker.controller : null;
      return versionNumber(await askVersionOf(controller, { timeoutMs: 800, attempts: 1 }));
    },
    send: (payload, id) => import('./firebase.js').then(m => m.pingDevice(payload, id)),
  };
}

// firebase.js is loaded here, not imported at the top, so tests can read this file without
// the Firebase SDK from its CDN. Every page that loads the gate has already loaded it.
function start() {
  import('./firebase.js').then(({ onSession, currentSession }) => {
    onSession(session => {
      if (session.status !== 'ready' || !session.locationId) return;
      // Re-read the session when the timer fires: the person may have signed out or switched
      // venue in the meantime, and the write must belong to who is signed in NOW.
      setTimeout(() => {
        const now = currentSession();
        if (sameSession(session, now)) pingIfDue(now);
      }, START_DELAY_MS);
    });
  }).catch(err => {
    console.warn('Device count not started:', err && err.code ? err.code : 'unknown');
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') start();
