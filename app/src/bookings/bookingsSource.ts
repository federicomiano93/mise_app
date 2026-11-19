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
// ⚠️ READS ARE BOUNDED (P14): ONE live query, the bookings of ONE calendar month (bookings rebuild step 3: the month the calendar
// shows), by day, at most READ_LIMIT; a new month is a new query. Bookings are deleted 30 days after their day by the scheduled
// function (functions/booking-cleanup-model.js), so a month long gone reads empty — which is right.
//
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore(): its settings are fixed by its first
// use (src/firestore-access.spec.ts). ⚠️ NOTHING PERSONAL IS LOGGED: a failure logs the error alone, never a booking.

import { buildPath } from '@mise/shared/location-id';
import type { Query } from 'firebase/firestore';
import type { FirestoreKit } from '../session/firebaseBackend';
import { PRICE_LIST_DOC, readPriceList } from '@mise/shared/price-list';
import type { PriceList } from '@mise/shared/price-list';
import { readBooking } from './bookingModel';
import type { Booking, BookingData, BookingStatus } from './bookingModel';
import { readSettings, settingsChanges } from './bookingSettings';
import type { BookingSettings } from './bookingSettings';

const BOOKINGS = 'bookings';
const PRICE_LIST = 'price-list';
// The section's own settings document (bookings settings, 18 Nov 2026): `config/bookings`.
const CONFIG = 'config';
const SETTINGS_DOC = 'bookings';

// How many bookings one month's query reads at most. December at a busy counter is a few hundred (24 December alone may be two
// hundred); the bound is there so a mistake can never read a whole collection.
export const READ_LIMIT = 1500;
// One day's bookings at most (the Home's card).
export const DAY_LIMIT = 200;

export interface BookingsSource {
  // Every booking with `from` <= date < `until` (YYYY-MM-DD: one calendar month, bookingModel.ts monthRange), live. Returns the
  // unsubscribe function at once. `fromCache` says the answer came from this device's offline copy rather than the server.
  watch(range: { readonly from: string; readonly until: string }, onChange: (items: Booking[], fromCache: boolean) => void, onError: (err: unknown) => void): () => void;
  // The bookings of ONE day, live (the Home's «Prenotazioni di oggi»: today only, never the days after).
  watchDay(date: string, onChange: (items: Booking[], fromCache: boolean) => void, onError: (err: unknown) => void): () => void;
  // The price list Food cost published (bookings step 2): the products the counter books, with their prices. An empty list when
  // nothing has been published. Read only while an editor is open.
  watchPriceList(onChange: (list: PriceList) => void, onError: (err: unknown) => void): () => void;
  // The venue's bookings settings (config/bookings), live, read with their defaults (a missing document is today's form).
  // `fromServer` tells the server's word from this device's own copy: the settings SCREEN copies only the first (a phone
  // offline with no copy would offer the defaults and a Save would write them over the real ones); the form takes either.
  watchSettings(
    onChange: (settings: BookingSettings, meta: { readonly fromServer: boolean }) => void,
    onError: (err: unknown) => void,
  ): () => void;
  // Saves what changed from `previous` to `settings` (merge; a cleared slot or limit is a deleted field), so a setting another
  // device changed meanwhile and this one did not touch is kept. Settles when the server answers.
  saveSettings(settings: BookingSettings, previous: BookingSettings): Promise<void>;
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
  const priceListPath = buildPath(locationId, PRICE_LIST);
  const configPath = buildPath(locationId, CONFIG);

  // A live query whose Firestore may not be loaded yet; the returned stop works at any moment.
  // ⚠️ onSnapshot does NOT resubscribe after an error: onError lets the screen say so instead of looking like a venue with no
  // bookings. ⚠️ WITH METADATA CHANGES, so the server's answer after an empty one from the cache is delivered even when it holds
  // the same nothing.
  function listen<T>(
    target: (kit: FirestoreKit) => Query,
    read: (docs: ReadonlyArray<{ id: string; data: () => Record<string, unknown> }>) => T,
    onChange: (value: T, fromCache: boolean) => void,
    onError: (err: unknown) => void,
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
          console.error('watch(bookings) failed:', err);
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
  // ⚠️ `slotEnd` IS WRITTEN ONLY WHEN THERE IS ONE: the rules allow the key to be missing, never to be null.
  const stamped = ({ slotEnd, ...data }: BookingData) => ({ ...data, ...(slotEnd === null ? {} : { slotEnd }), bakery: locationId });

  return {
    // A range and an order on the same single field: Firestore's automatic index serves it (firestore.indexes.json keeps the
    // collection-scope ascending index beside the cleanup's collection-group override).
    watch({ from, until }, onChange, onError) {
      return listen(
        ({ fs, db }) => fs.query(
          fs.collection(db, path), fs.where('date', '>=', from), fs.where('date', '<', until), fs.orderBy('date'), fs.limit(READ_LIMIT),
        ),
        docs => docs.map(d => readBooking(d.id, d.data())).filter((b): b is Booking => b !== null),
        onChange,
        onError,
      );
    },

    watchDay(date, onChange, onError) {
      return listen(
        ({ fs, db }) => fs.query(fs.collection(db, path), fs.where('date', '==', date), fs.limit(DAY_LIMIT)),
        docs => docs.map(d => readBooking(d.id, d.data())).filter((b): b is Booking => b !== null),
        onChange,
        onError,
      );
    },

    // ⚠️ A REFUSAL IS NOT REPORTED AS AN ERROR: a venue whose bookings are switched off, or a moment offline with no copy, leaves
    // the editor with free text only, which it says.
    watchPriceList(onChange, onError) {
      let stopped = false;
      let unsubscribe: (() => void) | null = null;
      firestore().then(({ fs, db }) => {
        if (stopped) return;
        unsubscribe = fs.onSnapshot(
          fs.doc(db, priceListPath, PRICE_LIST_DOC),
          snap => { onChange(readPriceList(snap.exists() ? snap.data({ serverTimestamps: 'estimate' }) : null)); },
          err => {
            // A warning, not an error report: a venue whose bookings are off refuses it, and the editor says so.
            console.warn('watch(price list) failed:', err);
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
    },

    watchSettings(onChange, onError) {
      let stopped = false;
      let unsubscribe: (() => void) | null = null;
      firestore().then(({ fs, db }) => {
        if (stopped) return;
        unsubscribe = fs.onSnapshot(
          fs.doc(db, configPath, SETTINGS_DOC),
          // With metadata changes: the server's answer after this device's own copy arrives even when it says the same.
          { includeMetadataChanges: true },
          snap => { onChange(readSettings(snap.exists() ? snap.data() : null), { fromServer: !snap.metadata.fromCache }); },
          err => {
            console.warn('watch(bookings settings) failed:', err);
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
    },

    async saveSettings(settings, previous) {
      const { fs, db } = await firestore();
      const { fields, cleared } = settingsChanges(previous, settings);
      const write: Record<string, unknown> = { ...fields, bakery: locationId };
      for (const key of cleared) write[key] = fs.deleteField();
      await fs.setDoc(fs.doc(db, configPath, SETTINGS_DOC), write, { merge: true });
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
    // ⚠️ A BOOKING MOVED FROM A SLOT TO AN EXACT TIME LOSES ITS `slotEnd` HERE: a merge never removes a key by itself.
    async update(id, data) {
      const { fs, db } = await firestore();
      await fs.setDoc(fs.doc(db, path, id), {
        ...stamped(data),
        ...(data.slotEnd === null ? { slotEnd: fs.deleteField() } : {}),
        updatedAt: fs.serverTimestamp(),
      }, { merge: true });
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
