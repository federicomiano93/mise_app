// awayStore.ts — this person's holiday for as long as the venue is open (step 3g-2).
//
// Plain TypeScript with no React and no Firebase: the source (settingsSource.ts) is injected, so every rule below is a spec with a fake
// (awayStore.spec.ts). The screens read it through AwayContext.tsx. It is held at the VENUE level (the shell), not by a screen, so the
// Home's band, Settings' row and the once-a-day reminder always agree after a write.
//
// ⚠️ READ ONCE, NEVER A LISTENER (P14): the holiday changes about twice a year. start() reads the document one time when the venue
// opens; after that the store is the truth for this phone, changed only by this person's own writes.
//
// ⚠️ LOCAL-FIRST (P20): a write shows at once and the screen never waits for the server. The store listens only for a REJECTION; then it
// puts the state back (unless a newer write of this person has happened since) and says so through the `saved` promise of the change.
//
// ⚠️ `away` IS DERIVED FROM THE CLOCK every time it is asked (isAway of the shared away-model), so a holiday ends by itself on its last
// day; recheck() re-asks it when the day changes on a tablet left open.

import { isAway } from '@mise/shared/away-model';
import type { SettingsSource } from './settingsSource';

export interface AwaySnapshot {
  // `loading` until the one read has answered (or failed: a failed read is «not away», and the button still works).
  readonly status: 'loading' | 'ready';
  // The last day of the holiday, '' once the person is back, null when there is no holiday document.
  readonly until: string | null;
  readonly away: boolean;
}

// What a write answers. Not accepted: the date cannot be used, nothing was changed. Accepted: the change is already on screen, and
// `saved` settles true when the server agreed, false when it refused (the state has then been put back).
export type AwayChange =
  | { readonly accepted: false }
  | { readonly accepted: true; readonly saved: Promise<boolean> };

export interface AwayStore {
  getSnapshot(): AwaySnapshot;
  subscribe(listener: () => void): () => void;
  // Reads the holiday once. Safe to call more than once (React's development mode mounts twice): only the first reads.
  start(): void;
  // Asks the clock again (the day may have changed).
  recheck(): void;
  // Sets the holiday to the day `until` ('YYYY-MM-DD'); '' ends it.
  set(until: string): AwayChange;
  // Ends the holiday now. Asks nothing: its callers have already asked.
  comeBack(): AwayChange;
}

export function createAwayStore(source: SettingsSource, uid: string, now: () => number = Date.now): AwayStore {
  let snapshot: AwaySnapshot = Object.freeze({ status: 'loading', until: null, away: false });
  const listeners = new Set<() => void>();
  let started = false;
  // Counts this person's writes: an older write's refusal must not put back over a newer one, and a read that answers after a write
  // must not overwrite it.
  let writes = 0;

  function publish(next: Pick<AwaySnapshot, 'status' | 'until'>): void {
    const away = next.until !== null && isAway({ until: next.until }, now());
    if (next.status === snapshot.status && next.until === snapshot.until && away === snapshot.away) return;
    snapshot = Object.freeze({ status: next.status, until: next.until, away });
    listeners.forEach(listener => { listener(); });
  }

  function write(until: string): AwayChange {
    const attempt = source.saveAway(uid, until);
    if (attempt.result === 'bad-date') return { accepted: false };
    const before = snapshot.until;
    writes += 1;
    const mine = writes;
    publish({ status: 'ready', until });
    const saved = attempt.written.then(
      () => true,
      (err: unknown) => {
        console.error('Saving the holiday failed:', err);
        if (writes === mine) publish({ status: 'ready', until: before });
        return false;
      },
    );
    return { accepted: true, saved };
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start() {
      if (started) return;
      started = true;
      void source.readMyAway(uid).then(mine => {
        if (writes > 0) return;
        publish({ status: 'ready', until: mine ? mine.until : null });
      });
    },
    recheck() {
      publish({ status: snapshot.status, until: snapshot.until });
    },
    set: write,
    comeBack: () => write(''),
  };
}

// For a venue with nobody to be (no signed-in person): never away, never writes.
const INERT_SNAPSHOT: AwaySnapshot = Object.freeze({ status: 'ready', until: null, away: false });
export const INERT_AWAY_STORE: AwayStore = Object.freeze({
  getSnapshot: (): AwaySnapshot => INERT_SNAPSHOT,
  subscribe: () => () => undefined,
  start: () => undefined,
  recheck: () => undefined,
  set: (): AwayChange => ({ accepted: false }),
  comeBack: (): AwayChange => ({ accepted: false }),
});
