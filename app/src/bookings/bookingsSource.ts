// bookingsSource.ts — customer bookings in Firestore, and nothing else (18 Nov 2026).
//
// NEW IN MISE 2: the current app has no bookings, so there is no original to port. The shapes below are exactly what
// firestore.rules (`match /bookings/{id}`) accepts and nothing else — every key on every document, `createdAt` set by the
// server once and `updatedAt` at every write. Behind an interface, so the store is a spec with a fake source
// (testing/fakeBookingsSource.ts) and never needs a database to be tested.
//
// ⚠️ NO WRITE HERE WAITS FOR THE SERVER BEFORE THE SCREEN CHANGES (local-first, P20). Firestore applies a write to its
// offline copy at once and the listener answers from it, so a booking taken with no signal shows at once and reaches the
// server when the signal comes back (Firestore's own queue, kept in the browser's database across a reload). The promise a
// write returns settles only when the server answers: the caller never awaits it before leaving the editor.
//
// ⚠️ READS ARE BOUNDED (P14): ONE live query, the bookings of the last 30 days and every later one, newest days first, at most
// READ_LIMIT. Older ones are deleted by the scheduled function anyway (functions/booking-cleanup-model.js).
//
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore(): its settings are fixed by its first
// use (src/firestore-access.spec.ts). ⚠️ NOTHING PERSONAL IS LOGGED: a failure logs the error alone, never a booking.

import { buildPath } from '@mise/shared/location-id';
import type { Query } from 'firebase/firestore';
import type { FirestoreKit } from '../session/firebaseBackend';
import { readBooking } from './bookingModel';
import type { Booking, BookingData, BookingStatus, RecipeName } from './bookingModel';

const BOOKINGS = 'bookings';
const RECIPES = 'recipes';

// How many bookings the list reads at most: about two a day for a year would still fit, and the retention keeps
// 30 days of past ones only.
export const READ_LIMIT = 500;

export interface BookingsSource {
  // Every booking from `fromDate` on (YYYY-MM-DD), live. Returns the unsubscribe function at once. `fromCache` says the answer
  // came from this device's offline copy rather than the server.
  watch(fromDate: string, onChange: (items: Booking[], fromCache: boolean) => void, onError: (err: unknown) => void): () => void;
  // The venue's recipe names, for the editor's suggestions (archived ones left out). Read only while an editor is open.
  watchRecipes(onChange: (recipes: RecipeName[]) => void, onError: (err: unknown) => void): () => void;
  // A new booking. The id is made here, synchronously, so the caller knows it at once.
  create(data: BookingData): { readonly id: string; readonly written: Promise<void> };
  // Every key of an existing booking again (the editor's Save); `createdAt` is left as stored.
  update(id: string, data: BookingData): Promise<void>;
  setStatus(id: string, status: BookingStatus): Promise<void>;
  remove(id: string): Promise<void>;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

// The id of a new booking, made without waiting for Firestore to load: the same 20-character alphabet as addDoc()'s ids.
export function newBookingId(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
}

export function createFirestoreBookingsSource(firestore: () => Promise<FirestoreKit>, locationId: string): BookingsSource {
  // Throws on a venue id that could point a write anywhere else (@mise/shared/location-id).
  const path = buildPath(locationId, BOOKINGS);
  const recipesPath = buildPath(locationId, RECIPES);

  // A live query whose Firestore may not be loaded yet; the returned stop works at any moment.
  // ⚠️ onSnapshot does NOT resubscribe after an error: onError lets the screen say so instead of looking like a venue with no
  // bookings. ⚠️ WITH METADATA CHANGES, so the server's answer after an empty one from the cache is delivered even when it holds
  // the same nothing.
  function listen<T>(
    target: (kit: FirestoreKit) => Query,
    read: (docs: ReadonlyArray<{ id: string; data: () => Record<string, unknown> }>) => T,
    onChange: (value: T, fromCache: boolean) => void,
    onError: (err: unknown) => void,
    what: string,
  ): () => void {
    let stopped = false;
    let unsubscribe: (() => void) | null = null;
    firestore().then(kit => {
      if (stopped) return;
      unsubscribe = kit.fs.onSnapshot(
        target(kit),
        { includeMetadataChanges: true },
        snap => { onChange(read(snap.docs.map(d => ({ id: d.id, data: () => d.data() }))), snap.metadata.fromCache); },
        err => {
          console.error(`watch(${what}) failed:`, err);
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

  // The venue stamp is applied HERE, never by a caller: the rules require `bakery` to name the folder written to.
  const stamped = (data: BookingData) => ({ ...data, bakery: locationId });

  return {
    watch(fromDate, onChange, onError) {
      return listen(
        ({ fs, db }) => fs.query(fs.collection(db, path), fs.where('date', '>=', fromDate), fs.orderBy('date', 'desc'), fs.limit(READ_LIMIT)),
        docs => docs.map(d => readBooking(d.id, d.data())).filter((b): b is Booking => b !== null),
        onChange,
        onError,
        'bookings',
      );
    },

    watchRecipes(onChange, onError) {
      return listen(
        ({ fs, db }) => fs.query(fs.collection(db, recipesPath)),
        docs => docs
          .map(d => ({ id: d.id, data: d.data() }))
          .filter(({ data }) => typeof data.name === 'string' && data.name.trim() !== '' && data.archived !== true)
          .map(({ id, data }) => ({ id, name: String(data.name).trim() })),
        recipes => { onChange(recipes); },
        onError,
        'recipes for bookings',
      );
    },

    // setDoc on a made id rather than addDoc, so the id is known before Firestore has loaded.
    create(data) {
      const id = newBookingId();
      const written = firestore().then(({ fs, db }) => fs.setDoc(fs.doc(db, path, id), {
        ...stamped(data),
        createdAt: fs.serverTimestamp(),
        updatedAt: fs.serverTimestamp(),
      }));
      return { id, written };
    },

    // A merge of every key but `createdAt`: the rules judge the merged document, which keeps the stored one.
    async update(id, data) {
      const { fs, db } = await firestore();
      await fs.setDoc(fs.doc(db, path, id), { ...stamped(data), updatedAt: fs.serverTimestamp() }, { merge: true });
    },

    async setStatus(id, status) {
      const { fs, db } = await firestore();
      await fs.updateDoc(fs.doc(db, path, id), { bakery: locationId, status, updatedAt: fs.serverTimestamp() });
    },

    async remove(id) {
      const { fs, db } = await firestore();
      await fs.deleteDoc(fs.doc(db, path, id));
    },
  };
}
