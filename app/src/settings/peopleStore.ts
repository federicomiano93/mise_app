// peopleStore.ts — the venue's roster for as long as the people list of «Who can get in» is on screen (staff slice 4).
//
// Plain TypeScript with no React and no Firebase: the source is injected, so every rule below is a spec with a fake
// (peopleStore.spec.ts). The screen reads it through usePeople (PeopleList.tsx).
//
// ⚠️ ONE LISTENER, FROM start() TO stop() (P14), and nothing after stop(): the screen stops it when it goes away, which is also what
// happens on a sign-out and on a change of venue — the session says `leaving` and the gate takes every screen off BEFORE Firestore is
// terminated (session.ts, SessionGate), so this listener is gone by then and never hears «Firestore shutting down» (staff slice 2's
// defect). An answer or an error that still arrives after stop() is dropped, unlogged.
//
// ⚠️ THE CONSOLE GETS THE ERROR'S CODE ONLY: a roster holds email addresses and surnames, and a console line reaches the owner's error
// reports.

import type { Member, SettingsSource } from './settingsSource';

export interface PeopleSnapshot {
  // `loading` until the first answer (live or from this phone's copy); `error` when the stream failed.
  readonly status: 'loading' | 'ready' | 'error';
  readonly members: readonly Member[];
}

export interface PeopleStore {
  getSnapshot(): PeopleSnapshot;
  subscribe(listener: () => void): () => void;
  // Safe to call start → stop → start (React's development mode does exactly that).
  start(): void;
  stop(): void;
}

const LOADING: PeopleSnapshot = Object.freeze({ status: 'loading', members: Object.freeze([]) as readonly Member[] });

function codeOf(error: unknown): string {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : 'no code';
}

export function createPeopleStore(source: Pick<SettingsSource, 'watchMembers'>): PeopleStore {
  let snapshot: PeopleSnapshot = LOADING;
  const listeners = new Set<() => void>();
  let stopWatching: (() => void) | null = null;
  // Each start() is a new generation: an answer from an earlier one is never taken.
  let generation = 0;

  function set(next: PeopleSnapshot): void {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start() {
      if (stopWatching !== null) return;
      generation += 1;
      const mine = generation;
      const live = () => mine === generation && stopWatching !== null;
      set(LOADING);
      let stop: (() => void) | null = null;
      stopWatching = () => { stop?.(); };
      stop = source.watchMembers(
        members => {
          if (live()) set({ status: 'ready', members });
        },
        error => {
          if (!live()) return;
          console.error('The people list stream failed:', codeOf(error));
          // What was shown stays, with the error said above it.
          set({ status: 'error', members: snapshot.members });
        },
      );
    },
    stop() {
      generation += 1;
      const stop = stopWatching;
      stopWatching = null;
      stop?.();
    },
  };
}
