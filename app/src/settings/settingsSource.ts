// settingsSource.ts — what Settings reads and writes in Firestore and through Cloud Functions, and nothing else
// (step 3g-2). The only file that knows the paths.
//
// A port of the data half of js/away-screen.js (`away/{uid}`, via js/orders/firebase-orders.js), js/staff/language.js and
// js/staff/home-cards-screen.js (the Cloud Functions in js/staff/firebase-staff.js). Behind an interface, so the stores and
// the screens are specs with a fake source (testing/fakeSettingsSource.ts) and never need a database.
//
// ⚠️ THE HOLIDAY IS ONE DOCUMENT, READ ONCE (P14): `locations/{lid}/away/{uid}` changes about twice a year, so it is a plain
// getDoc and never a listener. firestore.rules (`match /away/{uid}`) accept exactly { bakery, uid, until, updatedAt }, only about
// yourself; `until` '' means «I am back» and is WRITTEN, never a delete (shared away-model, buildAwayDoc).
//
// ⚠️ THE LANGUAGE AND THE STAFF SWITCHES ARE CLOUD FUNCTIONS, because locations/{lid} is a document no client may write. After
// each one the phone reads the venue document FROM THE SERVER, so its own copy hears of the change before anything reloads or
// draws from it (the current app's refreshVenueFromServer): otherwise a reload would read the stale cached venue.
//
// ⚠️ AN INVITATION IS A CLOUD FUNCTION TOO (`createJoinCode`, shared by both apps): only the full owner may mint one, the server decides
// the code, its shape and its lifetime, and it answers with the plain code ONCE (only a fingerprint is stored). Nothing here writes it
// down or logs it: the answer goes straight back to the screen that asked.
//
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore() (src/firestore-access.spec.ts).

import { buildAwayDoc } from '@mise/shared/away-model';
import { isWellFormed } from '@mise/shared/join-code';
import type { JoinCodeKind } from '@mise/shared/join-code';
import { isValidRole } from '@mise/shared/membership';
import type { ManagerTitle, Role } from '@mise/shared/membership';
import type { CardId } from '@mise/shared/home-cards';
import { buildPath, locationDocPath } from '@mise/shared/location-id';
import type { Language } from '../i18n/i18n';
import type { DocData } from '../session/backend';
import type { FirestoreKit } from '../session/firebaseBackend';

const AWAY = 'away';

// How long the phone waits for a Cloud Function. ⚠️ NOT SHORT: a function that has not run for a while starts cold, and the
// emulator's first call took longer than 15 s (driven, 7 Nov 2026) — the phone said «not saved» while the server went on and
// saved it. A timeout is not a refusal: the screen re-reads the server after any failure (StaffSectionsScreen) so it never
// shows a state the venue does not have. The current app uses the SDK's default of 70 s.
export const FUNCTION_TIMEOUT_MS = 60_000;

// A person's holiday as stored: the last day of it, or '' once they are back.
// `pending`: the answer came from this phone's copy with its own unconfirmed write applied on top (Firestore's getDoc does that), so it
// is NOT what the server holds — the holiday store must not take it as confirmed.
export type MyAway = { readonly until: string; readonly pending?: boolean };

// The answer to a holiday write. `bad-date` is decided HERE, before anything is written; `saved` carries the write's own promise,
// which settles only when the SERVER answers (offline: whenever the signal comes back) — a caller never waits for it before
// showing the change, and listens only for a rejection.
export type AwayWrite =
  | { readonly result: 'bad-date' }
  | { readonly result: 'saved'; readonly written: Promise<void> };

// An invitation as the SERVER made it. The role, the title and the shape are the server's answer, not what was asked for: the function
// reduces a role it does not know to an employee and anything that is not 'link' to six digits, so echoing the request could promise
// a manager where an employee was made (the current app's rule, js/staff/people.js mint()).
export type Invitation = {
  readonly code: string;
  readonly kind: JoinCodeKind;
  readonly role: Role;
  // The job title of the manager level ('manager' or 'head-chef'); null for every other role.
  readonly title: ManagerTitle | null;
  // When the code dies, in milliseconds since 1970 (the server's clock).
  readonly expiresAt: number;
};

// The function's answer, checked: anything that is not a whole invitation is a failure, never half a screen.
export function invitationOf(answer: unknown): Invitation | null {
  if (!answer || typeof answer !== 'object') return null;
  const { code, kind, role, title, expiresAt } = answer as Record<string, unknown>;
  if (kind !== 'digits' && kind !== 'link') return null;
  if (!isWellFormed(code, kind) || typeof code !== 'string') return null;
  if (!isValidRole(role)) return null;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;
  // ⚠️ SIX DIGITS ONLY EVER MAKE AN EMPLOYEE (the server refuses anything else): an answer that says otherwise is not believed.
  if (kind === 'digits' && role !== 'staff') return null;
  const managerTitle: ManagerTitle | null = role === 'manager' ? (title === 'head-chef' ? 'head-chef' : 'manager') : null;
  return { code, kind, role, title: managerTitle, expiresAt };
}

export interface SettingsSource {
  // This person's own holiday document, read ONCE (the phone's copy is allowed offline). null when there is none, or when it could
  // not be read: the button still works, it simply starts from nothing.
  readMyAway(uid: string): Promise<MyAway | null>;
  // Sets the holiday to the day `until` ('YYYY-MM-DD'), or ends it with ''.
  saveAway(uid: string, until: string): AwayWrite;
  // Changes the venue's interface language. REJECTS when refused, offline or past the timeout.
  setLanguage(language: Language): Promise<void>;
  // Shows or hides one card (= one section) from the venue's employees. REJECTS when refused, offline or past the timeout. Resolves
  // with the venue document as the server now holds it, or null when that could not be read straight after.
  setStaffCard(card: CardId, hidden: boolean): Promise<DocData | null>;
  // The venue document from the SERVER (not the phone's copy). REJECTS offline.
  readVenueFromServer(): Promise<DocData | null>;
  // Mints one invitation into this venue (the full owner only: the function refuses anybody else). REJECTS when refused, offline, past
  // the timeout, or when the answer is not a whole invitation.
  createInvitation(role: Role, title: ManagerTitle | null, kind: JoinCodeKind): Promise<Invitation>;
}

export type CallFunction = (name: string, data: unknown, timeoutMs: number) => Promise<unknown>;

export function createFirestoreSettingsSource(
  firestore: () => Promise<FirestoreKit>,
  callFunction: CallFunction,
  locationId: string,
  now: () => number = Date.now,
): SettingsSource {
  // Throw on a venue id that could point a write anywhere else (@mise/shared/location-id).
  const awayPath = buildPath(locationId, AWAY);
  const venuePath = locationDocPath(locationId);

  async function venueFromServer(): Promise<DocData | null> {
    const { fs, db } = await firestore();
    const snap = await fs.getDocFromServer(fs.doc(db, venuePath));
    return snap.exists() ? (snap.data() as DocData) : null;
  }

  // After a call that changed the venue document: the phone's copy hears of it. A failure here is silent (offline right after the
  // call): the check made when the app next opens catches up. Null says «could not read».
  async function freshVenue(): Promise<DocData | null> {
    try {
      return await venueFromServer();
    } catch {
      return null;
    }
  }

  return {
    async readMyAway(uid) {
      try {
        const { fs, db } = await firestore();
        const snap = await fs.getDoc(fs.doc(db, awayPath, uid));
        if (!snap.exists()) return null;
        const until = (snap.data() as DocData).until;
        if (typeof until !== 'string') return null;
        return snap.metadata?.hasPendingWrites === true ? { until, pending: true } : { until };
      } catch (err) {
        // A venue that has never used this, or an offline phone with nothing cached.
        console.warn('Could not read your own holiday:', err);
        return null;
      }
    },

    saveAway(uid, until) {
      const doc = buildAwayDoc({ uid, until, now: now() });
      if (!doc) return { result: 'bad-date' };
      // The venue stamp is applied HERE, never by a caller. Exactly the four keys the rules accept.
      const written = firestore().then(({ fs, db }) => fs.setDoc(fs.doc(db, awayPath, doc.uid), {
        bakery: locationId,
        uid: doc.uid,
        until: doc.until,
        updatedAt: doc.updatedAt,
      }));
      return { result: 'saved', written };
    },

    async setLanguage(language) {
      await callFunction('setLocationLanguage', { locationId, language }, FUNCTION_TIMEOUT_MS);
      await freshVenue();
    },

    async setStaffCard(card, hidden) {
      await callFunction('setStaffCard', { locationId, card, hidden }, FUNCTION_TIMEOUT_MS);
      return freshVenue();
    },

    readVenueFromServer: venueFromServer,

    async createInvitation(role, title, kind) {
      const answer = await callFunction('createJoinCode', { locationId, role, title, kind }, FUNCTION_TIMEOUT_MS);
      const invitation = invitationOf(answer);
      if (!invitation) throw new Error('The invitation answer was not an invitation.');
      return invitation;
    },
  };
}
