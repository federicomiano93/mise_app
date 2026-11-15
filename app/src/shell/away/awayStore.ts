// awayStore.ts — this person's holiday for as long as the venue is open (step 3g-2).
//
// Plain TypeScript with no React and no Firebase: the source (settingsSource.ts) is injected, so every rule below is a spec with a fake
// (awayStore.spec.ts). The screens read it through AwayContext.tsx. It is held at the VENUE level (the shell), not by a screen, so the
// Home's band, Settings' row and the once-a-day reminder always agree after a write.
//
// ⚠️ NEVER A LISTENER (P14): the holiday changes about twice a year. start() reads the document when the venue opens; after that it is
// read again only on a new day, on waking (at most every ten minutes) and right after a refusal.
//
// ⚠️ LOCAL-FIRST (P20): a write shows at once and the screen never waits for the server. The store listens only for a REJECTION; then it
// puts the state back (unless a newer write of this person has happened since), reads the server again, says so through the `saved`
// promise of the change and tells `onRefused` (the shell's AwayRefusalAlert says it).
//
// ⚠️ `away` IS DERIVED FROM THE CLOCK every time it is asked (isAway of the shared away-model), so a holiday ends by itself on its last
// day; recheck() re-asks it when the day changes on a tablet left open.

import { isAway } from '@mise/shared/away-model';
import { markBusy } from '../../session/busy';
import type { SettingsSource } from '../../settings/settingsSource';

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
  // Reads the holiday again — a day change, the tablet back in the foreground — at most once every ten minutes. Never overwrites a write
  // still in the air.
  refresh(): void;
  // Asks the clock again (the day may have changed).
  recheck(): void;
  // Sets the holiday to the day `until` ('YYYY-MM-DD'); '' ends it.
  set(until: string): AwayChange;
  // Ends the holiday now. Asks nothing: its callers have already asked.
  comeBack(): AwayChange;
  // Told when the server refused this person's NEWEST write (the state has been put back). The shell says it, once, wherever the person
  // is by then (AwayRefusalAlert): the answer can land long after the screen that wrote it has gone.
  onRefused(listener: () => void): () => void;
}

// How often the holiday may be read again (a day change, the tablet coming back to the foreground): a holiday ended or set on another
// phone shows within a day or on waking, at the price of a read every ten minutes at most (P14).
export const REREAD_MIN_MS = 600_000;

// `hold` is session/busy.ts's markBusy (a spec passes its own).
export function createAwayStore(
  source: SettingsSource, uid: string, now: () => number = Date.now, hold: () => () => void = markBusy,
): AwayStore {
  let snapshot: AwaySnapshot = Object.freeze({ status: 'loading', until: null, away: false });
  const listeners = new Set<() => void>();
  const refusedListeners = new Set<() => void>();
  let started = false;
  let lastRead = 0;
  // Counts this person's writes: only the NEWEST write's refusal puts anything back.
  let writes = 0;
  // Writes sent and not yet answered. While any is in the air a read never changes what the screen shows.
  let inFlight = 0;
  // ⚠️ THE LAST STATE THE SERVER IS KNOWN TO HOLD: what a read answered, or what a write whose promise resolved. undefined until
  // either has happened. A refusal puts THIS back, never the previous optimistic value (which may itself have been refused).
  let confirmed: string | null | undefined;
  // The newest write the server has answered; a read that STARTED before it is older news than the write and changes nothing.
  let lastConfirmedWrite = 0;
  // What showed before the first of the writes now in the air: with nothing confirmed yet (the first read has not answered, or answered
  // only with this phone's own unconfirmed write), a refusal puts back THIS, never an earlier refused value.
  let burstBefore: string | null = null;

  function publish(next: Pick<AwaySnapshot, 'status' | 'until'>): void {
    const away = next.until !== null && isAway({ until: next.until }, now());
    if (next.status === snapshot.status && next.until === snapshot.until && away === snapshot.away) return;
    snapshot = Object.freeze({ status: next.status, until: next.until, away });
    listeners.forEach(listener => { listener(); });
  }

  function write(until: string): AwayChange {
    const attempt = source.saveAway(uid, until);
    if (attempt.result === 'bad-date') return { accepted: false };
    if (inFlight === 0) burstBefore = snapshot.until;
    writes += 1;
    inFlight += 1;
    const mine = writes;
    publish({ status: 'ready', until });
    // ⚠️ BUSY UNTIL THE SERVER HAS ANSWERED (review of 3g-2, 8 Nov 2026): a self-started reload (the session's, or a new
    // release of the service worker) while the write is in the air would leave nobody listening for a refusal — the phone
    // would show a holiday the server never accepted, with no «Not saved» — or, with no offline copy, lose the write.
    const release = hold();
    const saved = attempt.written.finally(release).then(
      () => {
        inFlight -= 1;
        confirmed = until;
        lastConfirmedWrite = Math.max(lastConfirmedWrite, mine);
        return true;
      },
      (err: unknown) => {
        inFlight -= 1;
        console.error('Saving the holiday failed:', err);
        if (writes === mine) {
          publish({ status: 'ready', until: confirmed !== undefined ? confirmed : burstBefore });
          // ⚠️ AND ASKED AGAIN AT ONCE, past the ten-minute gate. With real Firestore a read that answered while the write was in the air
          // carried that write on top (`pending`) and was not recorded, so `confirmed` may be unknown and what was put back a guess; by
          // the time the refusal arrives the phone's copy has dropped the refused write, so this read is the server's word.
          read(false);
          refusedListeners.forEach(listener => { listener(); });
        }
        return false;
      },
    );
    return { accepted: true, saved };
  }

  // One read. A read that answers while a local write is still in the air is recorded as the confirmed state but NOT shown over the
  // write; if that write is then refused, the confirmed state is what comes back. A re-read that finds nothing is ignored: the document
  // is never deleted (it is written empty), so nothing after a first answer means the read failed, not that the holiday went.
  function read(first: boolean): void {
    lastRead = now();
    const startedAt = writes;
    void source.readMyAway(uid).then(mine => {
      if (!first && mine === null) return;
      if (lastConfirmedWrite > startedAt) return;
      // This phone's own unconfirmed write, read back from its copy: show it if nothing is in the air (a write queued before a reload),
      // never record it as what the server holds.
      // ⚠️ AND ONLY IF NO WRITE HAS STARTED SINCE THIS READ DID: otherwise the write on top may be one refused meanwhile (review, 8 Nov 2026).
      if (mine?.pending) {
        if (inFlight === 0 && startedAt === writes) publish({ status: 'ready', until: mine.until });
        return;
      }
      confirmed = mine ? mine.until : null;
      if (inFlight > 0) return;
      publish({ status: 'ready', until: confirmed });
    });
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
      read(true);
    },
    refresh() {
      if (!started || now() - lastRead < REREAD_MIN_MS) return;
      read(false);
    },
    recheck() {
      publish({ status: snapshot.status, until: snapshot.until });
    },
    set: write,
    comeBack: () => write(''),
    onRefused(listener) {
      refusedListeners.add(listener);
      return () => { refusedListeners.delete(listener); };
    },
  };
}

// For a venue with nobody to be (no signed-in person): never away, never writes.
const INERT_SNAPSHOT: AwaySnapshot = Object.freeze({ status: 'ready', until: null, away: false });
export const INERT_AWAY_STORE: AwayStore = Object.freeze({
  getSnapshot: (): AwaySnapshot => INERT_SNAPSHOT,
  subscribe: () => () => undefined,
  start: () => undefined,
  refresh: () => undefined,
  recheck: () => undefined,
  set: (): AwayChange => ({ accepted: false }),
  comeBack: (): AwayChange => ({ accepted: false }),
  onRefused: () => () => undefined,
});
