// kioskTodosSource.ts — what the kiosk's rest screen reads for its «To do today» half, and nothing else: ONE one-time, read-only query
// on the venue's to-dos (`done == false`, a single field: no composite index, no orderBy; the sorting is restTodos.ts). No listener: the
// cover reads when it goes to rest and every 15 minutes while it stays there (restTodosFeed.ts). The rules let any member read
// `todos` (`match /todos/{id}`), so every role sees this half, whatever the venue shows of Orders.
//
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore() (src/firestore-access.spec.ts). A feature
// never imports another's source, so the collection name below repeats the Home's: keep it equal to `TODOS` in home/todosSource.ts.

import { buildPath } from '@mise/shared/location-id';
import type { FirestoreKit } from '../session/firebaseBackend';

const TODOS = 'todos';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// A to-do as the cover needs it: its words, its day and when it was made (milliseconds, null when not known).
export type KioskTodo = { readonly text: string; readonly day: string; readonly createdAtMs: number | null };

export interface KioskTodosSource {
  // Every to-do of the venue not ticked yet.
  readOpen(): Promise<KioskTodo[]>;
}

// A stored document, or null when it is not one the rules could have accepted (nothing is drawn from a malformed document).
export function readKioskTodo(data: Record<string, unknown>): KioskTodo | null {
  const { text, day, createdAt } = data;
  if (typeof text !== 'string' || text === '' || typeof day !== 'string' || !DAY_RE.test(day)) return null;
  let createdAtMs: number | null = null;
  if (createdAt && typeof createdAt === 'object' && 'toMillis' in createdAt && typeof createdAt.toMillis === 'function') {
    const ms = Number(createdAt.toMillis());
    if (Number.isFinite(ms)) createdAtMs = ms;
  }
  return { text, day, createdAtMs };
}

export function createFirestoreKioskTodosSource(firestore: () => Promise<FirestoreKit>, locationId: string): KioskTodosSource {
  // Throws on a venue id that could point a read anywhere else (@mise/shared/location-id).
  const path = buildPath(locationId, TODOS);
  return {
    async readOpen() {
      const { fs, db } = await firestore();
      const snap = await fs.getDocs(fs.query(fs.collection(db, path), fs.where('done', '==', false)));
      const out: KioskTodo[] = [];
      for (const d of snap.docs) {
        const todo = readKioskTodo(d.data() as Record<string, unknown>);
        if (todo !== null) out.push(todo);
      }
      return out;
    },
  };
}
