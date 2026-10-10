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

import type { Auth } from 'firebase/auth';
import { addDoc, collection, doc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import { buildPath } from '@mise/shared/location-id';

export interface TelemetrySinks {
  reportError(record: Record<string, unknown>): Promise<unknown>;
  pingDevice(payload: Record<string, unknown>, id: string): Promise<unknown>;
  saveUsage(payload: Record<string, unknown>, id: string): Promise<unknown>;
}

function failure(code: string): Error {
  return Object.assign(new Error(code), { code });
}

export function createTelemetrySinks(
  { db, auth }: { db: Firestore; auth: Auth },
  currentLocationId: () => string | null,
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

  return {
    // locations/{lid}/errors/{autoId}, create-only.
    async reportError(record) {
      const { uid, lid } = who();
      return addDoc(collection(db, buildPath(lid, 'errors')), {
        ...record, bakery: lid, uid, createdAt: serverTimestamp(),
      });
    },
    // locations/{lid}/devices/{deviceId}: a WHOLE-document set, no merge — the rules want every
    // field present on every write. `bakery` comes from devicePayload (the venue it was made for).
    async pingDevice(payload, id) {
      const { uid, lid } = who();
      return setDoc(doc(db, buildPath(lid, 'devices'), id), {
        ...payload, uid, lastSeen: serverTimestamp(),
      });
    },
    // locations/{lid}/usage/<deviceId>_<YYYYMMDD>_<uid>: the whole day's record each time.
    async saveUsage(payload, id) {
      const { uid, lid } = who();
      return setDoc(doc(db, buildPath(lid, 'usage'), id), {
        ...payload, bakery: lid, uid, updatedAt: serverTimestamp(),
      });
    },
  };
}
