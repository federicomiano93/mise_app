// todosSource.ts — the venue's «Da fare» list in Firestore, and nothing else (step 3g-1).
//
// NEW in Mise 2: the current app has no to-do list, so there is no original to port. The shapes
// below are exactly what firestore.rules (`match /todos/{id}`) accepts and nothing else:
//   { bakery, text (1–200), day (YYYY-MM-DD), done, doneAt, expireAt, createdAt }
// with EVERY key on every document. Behind an interface, so the store is a spec with a fake source
// (testing/fakeTodosSource.ts) and never needs a database to be tested.
//
// ⚠️ THE DELETION IS FIRESTORE'S, NOT THE APP'S: a TTL policy on the collection group `todos`,
// field `expireAt` (P13, docs/parity/home.md H7). So `expireAt` is written ONLY with a tick —
// now + 30 days, the phone's clock, because the server cannot add to a serverTimestamp() — and
// cleared on an untick. An item never ticked is never deleted by itself.
//
// ⚠️ NO WRITE HERE WAITS FOR THE SERVER BEFORE THE SCREEN CHANGES. Firestore applies a write to
// its local copy at once and the listener answers from it, so a tick or a new item shows offline
// too (local-first, P20). The promise each write returns settles only when the server answers:
// the caller must never await it before closing a form — it only listens for a refusal.
//
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore(): its
// settings are fixed by its first use (src/firestore-access.spec.ts).

import { buildPath } from '@mise/shared/location-id';
import type { FirestoreKit } from '../session/firebaseBackend';

const TODOS = 'todos';

// How long a ticked item lives before Firestore deletes it (and the app stops showing it).
export const TODO_KEEP_DAYS = 30;
const DAY_MS = 86_400_000;

// The longest an item's words may be — the rules' own bound.
export const TODO_TEXT_MAX = 200;

// An item as the screen reads it. Times are milliseconds; a server time not yet confirmed (a write
// still on its way) is Firestore's own estimate, so a fresh tick has a doneAt at once.
export type TodoItem = {
  readonly id: string;
  readonly text: string;
  readonly day: string;
  readonly done: boolean;
  readonly doneAtMs: number | null;
  readonly createdAtMs: number | null;
};

export interface TodosSource {
  // Every item of the venue, live. Returns the unsubscribe function at once (Firestore may still be
  // loading; a stop before it has loaded means it never subscribes). `fromCache` says the answer
  // came from this phone's offline copy rather than the server.
  watch(onChange: (items: TodoItem[], fromCache: boolean) => void, onError: (err: unknown) => void): () => void;
  // A new item, not ticked. The id is made here, synchronously, so the caller knows it at once.
  add(text: string, day: string): { readonly id: string; readonly written: Promise<void> };
  // New words and day for an item; its tick, if any, and its deletion date are left as they are.
  edit(id: string, text: string, day: string): Promise<void>;
  // Tick (done) or untick an item.
  setDone(id: string, done: boolean): Promise<void>;
  remove(id: string): Promise<void>;
}

const DAY_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

// The words as they are saved: trimmed, never empty, never past the rules' bound. Throws on
// what the rules would refuse, so a bad call fails here, loudly, instead of as a 403 later.
export function cleanTodoText(text: string): string {
  const clean = text.trim();
  if (clean === '') throw new Error('A to-do needs some words.');
  if (clean.length > TODO_TEXT_MAX) throw new Error(`A to-do is at most ${TODO_TEXT_MAX} characters.`);
  return clean;
}

function checkDay(day: string): string {
  if (!DAY_RE.test(day)) throw new Error(`Not a day: ${day}`);
  return day;
}

// A stored document as the screen reads it, or null when it is not one the rules could have
// accepted (nothing is drawn from a malformed document; the console still shows it).
export function readTodo(id: string, data: Record<string, unknown>): TodoItem | null {
  const { text, day, done } = data;
  if (typeof text !== 'string' || text === '' || typeof day !== 'string' || !DAY_RE.test(day)) return null;
  return {
    id,
    text,
    day,
    done: done === true,
    doneAtMs: millisOf(data.doneAt),
    createdAtMs: millisOf(data.createdAt),
  };
}

function millisOf(value: unknown): number | null {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

export function createFirestoreTodosSource(
  firestore: () => Promise<FirestoreKit>,
  locationId: string,
  now: () => number = Date.now,
): TodosSource {
  // Throws on a venue id that could point a write anywhere else (@mise/shared/location-id).
  const path = buildPath(locationId, TODOS);

  // The id of a new item, made without waiting for Firestore to load: the same 20-character
  // alphabet as addDoc()'s ids.
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  function newId(): string {
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
  }

  return {
    // ⚠️ WITH METADATA CHANGES, so the answer that comes from the server after an empty one from
    // the cache is delivered even when it holds the same nothing (pastriesSource.ts, watchDays).
    // ⚠️ onSnapshot does NOT resubscribe after an error: onError lets the screen say so instead of
    // looking like a venue with nothing to do.
    watch(onChange, onError) {
      let stopped = false;
      let unsubscribe: (() => void) | null = null;
      firestore().then(({ fs, db }) => {
        if (stopped) return;
        unsubscribe = fs.onSnapshot(
          fs.collection(db, path),
          { includeMetadataChanges: true },
          snap => {
            const items: TodoItem[] = [];
            for (const d of snap.docs) {
              const item = readTodo(d.id, d.data({ serverTimestamps: 'estimate' }));
              if (item) items.push(item);
            }
            onChange(items, snap.metadata.fromCache);
          },
          err => {
            console.error('watch(todos) failed:', err);
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

    // setDoc on a made id rather than addDoc, so the id is known before Firestore has loaded.
    // The venue stamp is applied HERE, never by a caller (pastriesSource.ts says why).
    add(text, day) {
      const id = newId();
      const clean = cleanTodoText(text);
      checkDay(day);
      const written = firestore().then(({ fs, db }) => fs.setDoc(fs.doc(db, path, id), {
        bakery: locationId,
        text: clean,
        day,
        done: false,
        doneAt: null,
        expireAt: null,
        createdAt: fs.serverTimestamp(),
      }));
      return { id, written };
    },

    async edit(id, text, day) {
      const clean = cleanTodoText(text);
      checkDay(day);
      const { fs, db } = await firestore();
      // `bakery` again: the rules judge the merged document, and stampedFor() reads it.
      await fs.updateDoc(fs.doc(db, path, id), { bakery: locationId, text: clean, day });
    },

    async setDone(id, done) {
      const { fs, db } = await firestore();
      await fs.updateDoc(fs.doc(db, path, id), done
        ? {
            bakery: locationId,
            done: true,
            doneAt: fs.serverTimestamp(),
            expireAt: fs.Timestamp.fromMillis(now() + TODO_KEEP_DAYS * DAY_MS),
          }
        : { bakery: locationId, done: false, doneAt: null, expireAt: null });
    },

    async remove(id) {
      const { fs, db } = await firestore();
      await fs.deleteDoc(fs.doc(db, path, id));
    },
  };
}
