// todosStore.ts — the venue's «Da fare» list for as long as the Home is on screen.
//
// Plain TypeScript with no React and no Firebase: the source (todosSource.ts) is injected, so every
// rule below is a spec with a fake (todosStore.spec.ts). The screen reads it through TodosContext.tsx.
//
// It says nothing in words: a failure is a TodosMessage and the screen puts it in the person's language.
//
// ⚠️ A WRITE IS NEVER AWAITED BY THE SCREEN. Firestore applies it to its local copy at once and the
// listener answers from it; the promise it returns settles only when the SERVER answers, which offline
// is whenever the signal comes back. The store calls the source and listens only for a REJECTION.

import type { TodoItem, TodosSource } from './todosSource';

export type TodosMessage =
  // A write did not go through.
  | { readonly kind: 'not-saved' }
  // The rules refused it (permission-denied).
  | { readonly kind: 'no-access' };

export interface TodosSnapshot {
  // `loading` until the first answer (live or from this phone's copy); `error` when the stream failed.
  readonly status: 'loading' | 'ready' | 'error';
  readonly items: readonly TodoItem[];
}

export interface TodosStore {
  getSnapshot(): TodosSnapshot;
  subscribe(listener: () => void): () => void;
  onMessage(listener: (message: TodosMessage) => void): () => void;
  // One listener from start() to stop() (P14). Safe to call start → stop → start (React's development
  // mode does exactly that).
  start(): void;
  stop(): void;
  // Returns the new item's id, or null when the source refused the call at once (the message goes out as for any write).
  add(text: string, day: string): string | null;
  edit(id: string, text: string, day: string): void;
  setDone(id: string, done: boolean): void;
  remove(id: string): void;
}

function messageFor(err: unknown): TodosMessage {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : '';
  return code === 'permission-denied' || code === 'firestore/permission-denied'
    ? { kind: 'no-access' }
    : { kind: 'not-saved' };
}

// After a stream error the store asks again: 30 s, then 60 s, doubling, never past 5 minutes.
export const RETRY_FIRST_MS = 30_000;
export const RETRY_MAX_MS = 300_000;

// How long a refused tick waits for the list to show the server's answer before deciding whether to say so.
export const REFUSAL_SETTLE_MS = 2_000;

// The timer is injected so a spec never waits for real time.
export type Timers = {
  readonly setTimeout: (run: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

export function createTodosStore(
  source: TodosSource,
  timers: Timers = { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: handle => { clearTimeout(handle as number); } },
): TodosStore {
  let snapshot: TodosSnapshot = { status: 'loading', items: [] };
  const listeners = new Set<() => void>();
  const messageListeners = new Set<(message: TodosMessage) => void>();
  let stopWatching: (() => void) | null = null;
  let started = false;
  let retryHandle: unknown = null;
  let retryDelay = RETRY_FIRST_MS;

  function set(next: TodosSnapshot): void {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  }

  function report(err: unknown): void {
    console.error('A to-do write failed:', err);
    const message = messageFor(err);
    for (const listener of [...messageListeners]) listener(message);
  }

  // Runs a write: a refusal (or a call the source itself rejects) is reported, never thrown at the screen.
  // `alreadyDone` says the list shows what the write wanted: another phone got there first, so a refusal is the rules
  // keeping the first tick and there is nothing to tell the person.
  //
  // ⚠️ ASKED ONLY ONCE THE LIST HAS SETTLED (REFUSAL_SETTLE_MS), NEVER AT THE MOMENT OF THE REFUSAL: Firestore shows this
  // phone's own tick at once, and when the server refuses it the listener may hear of the rollback AFTER the promise
  // rejects. Asked at once, the list would still show the person's own refused tick and a genuine refusal (a phone
  // whose clock is days off) would pass in silence. Once settled, the list holds the server's answer: ticked by the
  // other phone → quiet; back to unticked → said.
  function write(run: () => Promise<void>, alreadyDone: (() => boolean) | null = null): void {
    const failed = (err: unknown) => {
      if (alreadyDone === null) {
        report(err);
        return;
      }
      timers.setTimeout(() => {
        if (alreadyDone()) {
          console.error('A to-do write was refused, and the list already shows its result:', err);
          return;
        }
        report(err);
      }, REFUSAL_SETTLE_MS);
    };
    try {
      run().catch(failed);
    } catch (err) {
      failed(err);
    }
  }

  function watch(): void {
    stopWatching = source.watch(
      items => {
        retryDelay = RETRY_FIRST_MS;
        set({ status: 'ready', items });
      },
      err => {
        console.error('The to-do list stream failed:', err);
        set({ status: 'error', items: snapshot.items });
        stopWatching?.();
        stopWatching = null;
        if (!started || retryHandle !== null) return;
        const delay = retryDelay;
        retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
        // The items and the error stay shown until an answer arrives.
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
    start() {
      if (started) return;
      started = true;
      retryDelay = RETRY_FIRST_MS;
      set({ status: 'loading', items: [] });
      watch();
    },
    stop() {
      started = false;
      if (retryHandle !== null) timers.clearTimeout(retryHandle);
      retryHandle = null;
      stopWatching?.();
      stopWatching = null;
    },
    add(text, day) {
      let id: string | null = null;
      write(() => {
        const made = source.add(text, day);
        id = made.id;
        return made.written;
      });
      return id as string | null;
    },
    edit(id, text, day) {
      write(() => source.edit(id, text, day));
    },
    setDone(id, done) {
      // A refusal is reported only when the list does not already show the item as the write wanted (ticked or
      // unticked elsewhere), or no longer has it at all (deleted elsewhere).
      write(() => source.setDone(id, done), () => {
        const current = snapshot.items.find(item => item.id === id);
        return current === undefined || current.done === done;
      });
    },
    remove(id) {
      write(() => source.remove(id));
    },
  };
}
