// bookingsStore.ts — the venue's bookings for as long as the section is on screen (18 Nov 2026).
//
// Plain TypeScript with no React and no Firebase: the source (bookingsSource.ts) is injected, so every rule below is a spec
// with a fake (bookingsStore.spec.ts). The screens read it through BookingsContext.tsx. It says nothing in words: a failure
// is a BookingsMessage and the screen puts it in the person's language.
//
// ⚠️ A WRITE IS NEVER AWAITED BY THE SCREEN (local-first, P20). Firestore applies it to its offline copy at once; the promise
// settles only when the SERVER answers, which offline is whenever the signal comes back. The store listens for a REJECTION.
//
// ⚠️ A REFUSED SAVE NEVER LOSES THE TYPING (P20). When the server refuses a booking the editor saved (the rules, a venue
// that switched the section off), Firestore takes the write back out of its copy — so the store keeps the working copy that
// was saved, in memory, and the list offers to open it again («Not saved — open it to try again»). Kept until it is opened
// or the section closes.

import type { Booking, BookingData, BookingStatus, Draft } from './bookingModel';
import type { BookingsSource } from './bookingsSource';
import { monthRange } from './bookingModel';

export type BookingsMessage = {
  // `not-saved`: a write did not go through. `no-access`: the rules refused it (permission-denied).
  readonly kind: 'not-saved' | 'no-access';
  // True for a one-tap status change (Collected / Undo, bookings rebuild step 3): the row has been put back as it was, and the
  // screen says so in those words.
  readonly status?: true;
};

// A save the server refused, with what the person had typed.
export type RefusedSave = {
  // null for a new booking.
  readonly id: string | null;
  readonly draft: Draft;
  readonly status: BookingStatus;
  readonly number: number;
};

export interface BookingsSnapshot {
  // `loading` until the first answer (live or from this device's copy); `error` when the stream failed.
  readonly status: 'loading' | 'ready' | 'error';
  // The month the items cover ('YYYY-MM'), or null before the first start. Bookings rebuild step 3: ONE month at a time.
  readonly month: string | null;
  readonly items: readonly Booking[];
  readonly refused: RefusedSave | null;
}

export interface BookingsStore {
  getSnapshot(): BookingsSnapshot;
  subscribe(listener: () => void): () => void;
  onMessage(listener: (message: BookingsMessage) => void): () => void;
  // One listener from start() to stop() (P14), on the month last asked by watchMonth() — or `fallbackMonth` ('YYYY-MM') when none
  // was asked yet. Safe to call start → stop → start.
  start(fallbackMonth: string): void;
  // The month to listen to ('YYYY-MM'). A different month while started drops the listener and opens one on the new month (the
  // calendar's ‹ ›, or a form whose day moved to another month); the same month changes nothing.
  watchMonth(month: string): void;
  stop(): void;
  // Returns the booking's id (made at once for a new one), or null when the source refused the call outright.
  save(id: string | null, data: BookingData, draft: Draft): string | null;
  setStatus(id: string, status: BookingStatus): void;
  remove(id: string): void;
  // The refused save, taken out of the store as the editor opens it again.
  takeRefused(): RefusedSave | null;
}

function messageFor(err: unknown, status: boolean): BookingsMessage {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : '';
  const kind = code === 'permission-denied' || code === 'firestore/permission-denied' ? 'no-access' : 'not-saved';
  return status ? { kind, status: true } : { kind };
}

// After a stream error the store asks again: 30 s, then 60 s, doubling, never past 5 minutes.
export const RETRY_FIRST_MS = 30_000;
export const RETRY_MAX_MS = 300_000;

export type Timers = {
  readonly setTimeout: (run: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

const browserTimers: Timers = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: handle => { clearTimeout(handle as number); },
};

export function createBookingsStore(source: BookingsSource, timers: Timers = browserTimers): BookingsStore {
  let snapshot: BookingsSnapshot = { status: 'loading', month: null, items: [], refused: null };
  // What the listener last said, before the taps still in the air are laid over it.
  let stored: readonly Booking[] = [];
  // ⚠️ A ONE-TAP STATUS SHOWS AT ONCE (bookings rebuild step 3, the counter on 24 December): laid over the listener's bookings
  // until the server answers, so the row changes even before Firestore has loaded. A refusal takes it off (the row is put back as
  // the listener has it) and is said; a success takes it off too, the listener already carrying it. Keyed by booking; the latest
  // tap wins, and an earlier tap's answer never takes a later one off.
  const taps = new Map<string, { readonly status: BookingStatus; readonly token: number }>();
  let tapCounter = 0;
  let month: string | null = null;
  const shown = (): Booking[] => stored.map(b => {
    const tap = taps.get(b.id);
    return tap === undefined || tap.status === b.status ? b : { ...b, status: tap.status };
  });
  const listeners = new Set<() => void>();
  const messageListeners = new Set<(message: BookingsMessage) => void>();
  let stopWatching: (() => void) | null = null;
  let started = false;
  let retryHandle: unknown = null;
  let retryDelay = RETRY_FIRST_MS;

  function set(next: Partial<BookingsSnapshot>): void {
    snapshot = { ...snapshot, ...next };
    for (const listener of [...listeners]) listener();
  }

  function report(err: unknown, status = false): void {
    // The error alone: never the booking, which holds a customer's name and phone.
    console.error('A booking write failed:', err);
    const message = messageFor(err, status);
    for (const listener of [...messageListeners]) listener(message);
  }

  // Runs a write: a refusal (or a call the source itself rejects) is reported, never thrown at the screen.
  function write(run: () => Promise<void>, onRefused?: () => void, status = false, onDone?: () => void): void {
    const failed = (err: unknown) => {
      onRefused?.();
      report(err, status);
    };
    try {
      run().then(onDone, failed);
    } catch (err) {
      failed(err);
    }
  }

  function watch(): void {
    const watched = month ?? '';
    stopWatching = source.watch(
      monthRange(watched),
      items => {
        retryDelay = RETRY_FIRST_MS;
        stored = items;
        set({ status: 'ready', month: watched, items: shown() });
      },
      // Logged once, by the source: a second console.error here would send every failure to the error report twice.
      () => {
        set({ status: 'error' });
        stopWatching?.();
        stopWatching = null;
        if (!started || retryHandle !== null) return;
        const delay = retryDelay;
        retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
        // The bookings and the error stay shown until an answer arrives.
        retryHandle = timers.setTimeout(() => {
          retryHandle = null;
          if (started) watch();
        }, delay);
      },
    );
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    onMessage(listener) {
      messageListeners.add(listener);
      return () => { messageListeners.delete(listener); };
    },
    start(fallbackMonth) {
      if (started) return;
      started = true;
      month ??= fallbackMonth;
      retryDelay = RETRY_FIRST_MS;
      stored = [];
      set({ status: 'loading', month, items: [] });
      watch();
    },
    watchMonth(next) {
      if (next === month) return;
      month = next;
      if (!started) return;
      if (retryHandle !== null) timers.clearTimeout(retryHandle);
      retryHandle = null;
      stopWatching?.();
      stopWatching = null;
      retryDelay = RETRY_FIRST_MS;
      // The other month's bookings never stand in for this one's: the calendar's counts and the form's free places start empty.
      stored = [];
      set({ status: 'loading', month, items: [] });
      watch();
    },
    stop() {
      started = false;
      if (retryHandle !== null) timers.clearTimeout(retryHandle);
      retryHandle = null;
      stopWatching?.();
      stopWatching = null;
    },
    save(id, data, draft) {
      let savedId: string | null = id;
      const keep = () => { set({ refused: { id, draft, status: data.status, number: data.number } }); };
      write(() => {
        if (id !== null) return source.update(id, data);
        const made = source.create(data);
        savedId = made.id;
        return made.written;
      }, keep);
      return savedId;
    },
    setStatus(id, status) {
      tapCounter += 1;
      const token = tapCounter;
      taps.set(id, { status, token });
      set({ items: shown() });
      const settle = () => {
        if (taps.get(id)?.token !== token) return;
        taps.delete(id);
        set({ items: shown() });
      };
      write(() => source.setStatus(id, status), settle, true, settle);
    },
    remove(id) {
      write(() => source.remove(id));
    },
    takeRefused() {
      const refused = snapshot.refused;
      if (refused !== null) set({ refused: null });
      return refused;
    },
  };
}
