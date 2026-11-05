// pastriesSource.ts — the Pastries data in Firestore, and nothing else.
//
// A port of js/pastries/firebase-pastries.js, write for write, because firestore.rules (the
// `pastries` and `pastry-logs` blocks) accept exactly these shapes and nothing else. Behind an
// interface, so the store (pastriesStore.ts) is a spec with a fake source and never needs a
// database to be tested.
//
// Two collections under the open venue:
//   • pastries/{Monday…Sunday} — SEVEN documents, for ever, the id being the capitalised English
//     weekday (the words suppliers already store in orderDays). One listener, seven reads.
//   • pastry-logs/{YYYY-MM-DD}_{Weekday} — one record per work date per list. Nothing in the app
//     deletes one by itself (only the bin on Records), so the READ is bounded instead.
//
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore(): its
// settings are fixed by its first use (src/firestore-access.spec.ts).

import { buildPath } from '@mise/shared/location-id';
import type { BuiltLog } from '@mise/shared/pastries-log-model';
import type { PastryItem, Weekday } from '@mise/shared/pastries-model';
import type { Query } from 'firebase/firestore';
import type { FirestoreKit } from '../session/firebaseBackend';

// A document as the store reads it: its id beside its fields.
export type StoredDoc = { readonly id: string } & Record<string, unknown>;

export interface PastriesSource {
  // The seven days, live. Returns the unsubscribe function at once (Firestore may still be
  // loading; a stop before it has loaded means it never subscribes). `fromCache` says the answer
  // came from Firestore's own offline copy rather than the server: the store needs it to tell
  // «nothing here» from «nothing known yet» (pastriesStore.ts, believable()).
  watchDays(onChange: (docs: StoredDoc[], fromCache: boolean) => void, onError: (err: unknown) => void): () => void;
  // One whole day. Resolves when the server has it; rejects when it is refused.
  saveDay(day: Weekday, items: readonly PastryItem[], note: string): Promise<void>;
  // The records, newest first, bounded (see LOG_READ_LIMIT).
  watchLogs(onChange: (docs: StoredDoc[]) => void, onError: (err: unknown) => void): () => void;
  // The records of ONE work date: which lists are confirmed tonight.
  watchLogsForDate(date: string, onChange: (docs: StoredDoc[]) => void, onError: (err: unknown) => void): () => void;
  getLog(id: string): Promise<StoredDoc | null>;
  // Writes a record in a transaction; `build` is handed the record as it is INSIDE it.
  confirmLog(id: string, build: (existing: Record<string, unknown> | null) => BuiltLog): Promise<void>;
  deleteLog(id: string): Promise<void>;
}

const PASTRIES = 'pastries';
const LOGS = 'pastry-logs';

// How many records to READ. One is added a night, about 365 a year, and reading them all would
// make opening Records dearer every year (P14). 120 is about four months, eight times the
// fifteen days the screen shows, so the bound can never be what hides a record from view. Every
// record stays in the database, the console and the backups.
export const LOG_READ_LIMIT = 120;

export function createFirestorePastriesSource(
  firestore: () => Promise<FirestoreKit>,
  locationId: string,
): PastriesSource {
  // Throws on a venue id that could point a write anywhere else (@mise/shared/location-id).
  const daysPath = buildPath(locationId, PASTRIES);
  const logsPath = buildPath(locationId, LOGS);

  // The venue stamp is applied HERE, never by a caller: the rules require `bakery` to name the
  // folder written to, and a caller that hardcoded it once kept stamping 'main' after the data
  // moved under locations/ — every write refused, for weeks, silently.
  const withBakery = (data: Record<string, unknown>) => ({ ...data, bakery: locationId });

  // A live query whose Firestore may not be loaded yet. The returned stop works at any moment:
  // before the load (nothing is ever subscribed) or after it.
  //
  // ⚠️ onSnapshot does NOT resubscribe after an error, so a dropped stream would leave the screen
  // looking like a venue with nothing in it; onError lets the screen say so.
  //
  // `withMetadata` asks for metadata changes too (see watchDays for why only the days do).
  function watch(
    target: (kit: FirestoreKit) => Query,
    onChange: (docs: StoredDoc[], fromCache: boolean) => void,
    onError: (err: unknown) => void,
    what: string,
    withMetadata = false,
  ): () => void {
    let stopped = false;
    let unsubscribe: (() => void) | null = null;
    firestore().then(kit => {
      if (stopped) return;
      unsubscribe = kit.fs.onSnapshot(
        target(kit),
        { includeMetadataChanges: withMetadata },
        snap => onChange(snap.docs.map(d => ({ ...d.data(), id: d.id })), snap.metadata.fromCache),
        err => {
          console.error(`${what} failed:`, err);
          onError(err);
        },
      );
    }).catch(err => {
      if (!stopped) onError(err);
    });
    return () => {
      stopped = true;
      unsubscribe?.();
      unsubscribe = null;
    };
  }

  return {
    // ⚠️ WITH METADATA CHANGES, because the store sets an empty from-cache answer aside and waits
    // for the server: when the server then says the same nothing, only the metadata changes, and
    // without this option that answer would never be delivered — the editor would wait on every
    // opening (the current app's code review, 11 Oct 2026). It costs no reads: a few extra
    // answers with the same documents (a save confirmed, going offline or back online).
    watchDays: (onChange, onError) => watch(
      ({ fs, db }) => fs.collection(db, daysPath),
      onChange, onError, 'watchDays', true,
    ),

    // ⚠️ setDoc WITHOUT merge, on purpose: the screen always holds the whole day, and replacing
    // the document is what lets the rules REQUIRE every field, and what lets removing the last
    // row really empty the day. `day` repeats the id (the rules pin the two equal); the note is
    // written every time, because whatever is not in the payload is gone.
    async saveDay(day, items, note) {
      const { fs, db } = await firestore();
      const payload = withBakery({ day, items, note, updatedAt: new Date().toISOString() });
      await fs.setDoc(fs.doc(db, daysPath, day), payload);
    },

    // ⚠️ Ordered by the `date` FIELD, never by the document id: Firestore refuses
    // orderBy(documentId(), 'desc'), and limitToLast on an ascending key is rewritten into the
    // same scan. The rules require `date` on every record, so none can be left out by lacking it.
    watchLogs: (onChange, onError) => watch(
      ({ fs, db }) => fs.query(fs.collection(db, logsPath), fs.orderBy('date', 'desc'), fs.limit(LOG_READ_LIMIT)),
      onChange, onError, 'watchLogs',
    ),

    // One equality filter on one field: no composite index, and at most seven documents match.
    // Live, so a colleague's Confirm ticks the day off here without a reload.
    watchLogsForDate: (date, onChange, onError) => watch(
      ({ fs, db }) => fs.query(fs.collection(db, logsPath), fs.where('date', '==', date)),
      onChange, onError, 'watchLogsForDate',
    ),

    async getLog(id) {
      const { fs, db } = await firestore();
      const snap = await fs.getDoc(fs.doc(db, logsPath, id));
      return snap.exists() ? { ...snap.data(), id: snap.id } : null;
    },

    // ⚠️ A TRANSACTION: confirming twice in one night REPLACES the record and its first
    // `createdAt` must survive, but two phones can confirm within a second of each other — a
    // read-then-write would let the second overwrite what the first had just established.
    async confirmLog(id, build) {
      const { fs, db } = await firestore();
      const ref = fs.doc(db, logsPath, id);
      await fs.runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        const built = build(snap.exists() ? snap.data() : null);
        // `id` is the document's name, not a field: the key whitelist would refuse it.
        const { id: _id, ...payload } = built;
        tx.set(ref, withBakery(payload));
      });
    },

    // The only caller is the bin on Records, which a person has to tap. The rules allow the
    // delete for that reason: they cannot tell a deliberate delete from an automatic one.
    async deleteLog(id) {
      const { fs, db } = await firestore();
      await fs.deleteDoc(fs.doc(db, logsPath, id));
    },
  };
}
