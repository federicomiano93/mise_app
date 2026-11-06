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
  add(text: string, day: string): void;
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

export function createTodosStore(source: TodosSource): TodosStore {
  let snapshot: TodosSnapshot = { status: 'loading', items: [] };
  const listeners = new Set<() => void>();
  const messageListeners = new Set<(message: TodosMessage) => void>();
  let stopWatching: (() => void) | null = null;

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
  function write(run: () => Promise<void>): void {
    try {
      run().catch(report);
    } catch (err) {
      report(err);
    }
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
      if (stopWatching) return;
      set({ status: 'loading', items: [] });
      stopWatching = source.watch(
        items => { set({ status: 'ready', items }); },
        err => {
          console.error('The to-do list stream failed:', err);
          set({ status: 'error', items: snapshot.items });
        },
      );
    },
    stop() {
      stopWatching?.();
      stopWatching = null;
    },
    add(text, day) {
      write(() => {
        const { written } = source.add(text, day);
        return written;
      });
    },
    edit(id, text, day) {
      write(() => source.edit(id, text, day));
    },
    setDone(id, done) {
      write(() => source.setDone(id, done));
    },
    remove(id) {
      write(() => source.remove(id));
    },
  };
}
