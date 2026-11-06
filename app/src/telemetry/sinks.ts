// sinks.ts — the three telemetry writes: an error report, the daily device line, the usage line.
//
// Ported from js/firebase.js (reportError, pingDevice, saveUsage) write for write, because
// firestore.rules (match /errors, /devices, /usage under locations/{lid}) accept exactly these
// shapes and nothing else:
//   • every key set is closed — the payloads come from the shared models, which the current
//     app's own tests check against the same rules' limits;
//   • `uid` MUST be the signed-in account's and the time MUST be serverTimestamp(): the rules
//     compare them with request.auth.uid and request.time;
//   • the payload is spread FIRST, so it can never overwrite bakery, uid or the time.
// Signed out, or no venue open → reject with 'unauthenticated' / 'no-venue' (a passing failure:
// the callers drop it quietly or try again later, P17) instead of guessing a value the rules
// would refuse for good.
//
// ⚠️ NONE OF THESE IS EVER READ BACK BY THE APP. The rules refuse every read; only the owner's
// scripts (scripts/read-errors.mjs, read-usage.mjs) and the statistics page see them.
//
// ⚠️ NO SIGNAL, NO WRITE: while the device says it is offline a sink WAITS for the window's
// 'online' event before it touches Firestore. A write made offline does not fail, it sits in
// Firestore's queue — and signing out or switching venue asks that queue «is something typed
// still waiting to reach the server?» (changesStillWaiting) and warns «your changes will be
// lost». Telemetry the person never typed would trip that warning on every offline visit, and
// people would learn to click through the one warning that protects real edits.
// LIE-FI (online, but no data gets through) IS NOT COVERED, BY CHOICE: `navigator.onLine` cannot
// see it, and a timer to guess would send twice or never. The cost is the same warning once in
// a while, on a bad signal.
// What each caller does with a send that stays pending for hours (specs beside each):
//   • errors  — the report waits in memory until the signal is back (a page closed first loses
//               it: the daily throttle has already counted it);
//   • devices — the day is stamped when the write is handed over, so it is not asked again;
//   • usage   — the day's record stays dirty and is sent again, whole, ten minutes later.
// The account and the venue are asked AFTER the wait, at the moment of writing.

import type { Auth } from 'firebase/auth';
import { addDoc, collection, doc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import { buildPath } from '@mise/shared/location-id';

export interface TelemetrySinks {
  reportError(record: Record<string, unknown>): Promise<unknown>;
  pingDevice(payload: Record<string, unknown>, id: string): Promise<unknown>;
  saveUsage(payload: Record<string, unknown>, id: string): Promise<unknown>;
}

// What the sinks ask of the network. The specs pass their own; `browserConnectivity` is the real one.
export interface Connectivity {
  // false only when the device KNOWS it has no signal (navigator.onLine === false).
  online(): boolean;
  // Resolves when the device is online (at once, if it already is).
  whenOnline(): Promise<void>;
}

export function browserConnectivity(): Connectivity {
  // One listener for however many writes are waiting: they all go when the one event comes.
  let waiting: Promise<void> | null = null;
  const online = (): boolean => navigator.onLine !== false;
  return {
    online,
    whenOnline() {
      if (online()) return Promise.resolve();
      waiting ??= new Promise<void>(resolve => {
        window.addEventListener('online', () => {
          waiting = null;
          resolve();
        }, { once: true });
      });
      return waiting;
    },
  };
}

function failure(code: string): Error {
  return Object.assign(new Error(code), { code });
}

export function createTelemetrySinks(
  { db, auth }: { db: Firestore; auth: Auth },
  currentLocationId: () => string | null,
  connectivity: Connectivity = browserConnectivity(),
): TelemetrySinks {
  // Both asked at the moment of writing: a venue switch or a sign-out reloads the app, but a
  // write already queued must not land in the venue that was left.
  function who(): { uid: string; lid: string } {
    const user = auth.currentUser;
    if (!user) throw failure('unauthenticated');
    const lid = currentLocationId();
    if (!lid) throw failure('no-venue');
    return { uid: user.uid, lid };
  }

  // Waits for the signal only when there is none: with one, `write` runs in the same tick, so a
  // write handed over as the page is hidden is not a microtask late.
  async function whenConnected<T>(write: () => Promise<T>): Promise<T> {
    if (!connectivity.online()) await connectivity.whenOnline();
    return write();
  }

  return {
    // locations/{lid}/errors/{autoId}, create-only.
    reportError: record => whenConnected(() => {
      const { uid, lid } = who();
      return addDoc(collection(db, buildPath(lid, 'errors')), {
        ...record, bakery: lid, uid, createdAt: serverTimestamp(),
      });
    }),
    // locations/{lid}/devices/{deviceId}: a WHOLE-document set, no merge — the rules want every
    // field present on every write. `bakery` comes from devicePayload (the venue it was made for).
    pingDevice: (payload, id) => whenConnected(() => {
      const { uid, lid } = who();
      return setDoc(doc(db, buildPath(lid, 'devices'), id), {
        ...payload, uid, lastSeen: serverTimestamp(),
      });
    }),
    // locations/{lid}/usage/<deviceId>_<YYYYMMDD>_<uid>: the whole day's record each time.
    saveUsage: (payload, id) => whenConnected(() => {
      const { uid, lid } = who();
      return setDoc(doc(db, buildPath(lid, 'usage'), id), {
        ...payload, bakery: lid, uid, updatedAt: serverTimestamp(),
      });
    }),
  };
}
