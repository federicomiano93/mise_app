// A page of Orders reduced to what the draft sync sees of it, for draftSync.claims.spec.ts and draftSync.journal.spec.ts: the
// ports of the current app's tests/draft-claims.test.mjs and tests/draft-journal.test.mjs (which run draft.js against a
// recording stub of its data layer; this file is that stub and that page).
//
// A «page» is one createDraftSync with its own clock for the debounce, its own writes (held in the air on demand, each settled by
// the test as the server's answer would arrive) and its own screen maps. A «new page» is a fresh page over the same `world`: the
// storage, the clock of the note and the server's orders — what survives a reload.

import { createDraftSync, ORDERS_RETRY_MS, SAVE_DELAY_MS } from '../orders/draftSync';
import type { DraftPayload, DraftSync, DraftView } from '../orders/draftSync';
import type { CopyStorage } from '@mise/shared/list-copy';

export interface HeldWrite {
  readonly data: DraftPayload;
  resolve(): void;
  reject(err: unknown): void;
}

export function memoryStorage(): CopyStorage & { read(key: string): string | null } {
  const map = new Map<string, string>();
  return {
    getItem: key => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
    read: key => (map.has(key) ? (map.get(key) as string) : null),
  };
}

// What survives a reload: the device's storage and clock, and the orders the server holds.
export interface World {
  storage: CopyStorage & { read(key: string): string | null };
  // Replaceable, to make the storage throw.
  active: CopyStorage | null;
  clock: { now: number };
  history: { records: unknown[]; fail: boolean; reads: number; asked: string[] };
}

export function newWorld(): World {
  const storage = memoryStorage();
  return {
    storage, active: storage, clock: { now: Date.parse('2026-11-01T10:00:00Z') },
    history: { records: [], fail: false, reads: 0, asked: [] },
  };
}

export const settle = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });

export interface PageOptions {
  day?: string;
  lid?: string;
  // With a world the page keeps a note (the journal); without one it is the plain sync.
  world?: World;
}

export function newPage({ day = '2026-10-28', lid = 'venue-a', world }: PageOptions = {}) {
  const sent: DraftPayload[] = [];
  const held: HeldWrite[] = [];
  const results: boolean[] = [];
  let holding = false;
  let timers: Array<{ run: () => void; ms: number; live: boolean }> = [];
  const page = {
    entries: {} as Record<string, Record<string, unknown>>,
    days: {} as Record<string, string>,
    shows: 0,
    cameBack: 0,
    sync: undefined as unknown as DraftSync,
    sent, held, results,
    holdSaves() { holding = true; },
    letSavesThrough() { holding = false; },
    // The screen redraws what the sync hands it (the store sets `draft` from it).
    apply(view: DraftView) {
      page.entries = structuredClone(view.entries) as Record<string, Record<string, unknown>>;
      page.days = { ...view.days };
      page.shows += 1;
    },
    // The listener's snapshot; `fromServer` is the server's first word, which settles a note.
    snapshot(entries: Record<string, unknown>, days: Record<string, string> = {}, fromServer = false) {
      page.apply(page.sync.receive(structuredClone({ entries, days, updatedAt: 'x' }), fromServer ? { fromServer: true } : undefined));
    },
    // The same for a missing document.
    snapshotNone(fromServer = false) {
      page.apply(page.sync.receive(null, fromServer ? { fromServer: true } : undefined));
    },
    // A keystroke on line `id`; `stamp` is the supplier whose day is stamped with it.
    type(id: string, patch: Record<string, unknown>, stamp?: string) {
      page.entries[id] = { qty: 0, stock: 0, ...page.entries[id], ...patch };
      if (stamp) page.days[stamp] = day;
      page.sync.change(page.entries, page.days);
    },
    // The same claims, sent without waiting (a re-order, a restamped day): rejects when refused.
    saveNow() {
      page.sync.change(page.entries, page.days);
      return page.sync.flush();
    },
    // The debounce runs out.
    async pause() {
      const due = timers.filter(t => t.live && t.ms === SAVE_DELAY_MS);
      timers = timers.filter(t => !due.includes(t));
      due.forEach(t => { t.live = false; t.run(); });
      await settle();
    },
    // The 30 s after which a note asks the orders again.
    async retry() {
      const due = timers.filter(t => t.live && t.ms === ORDERS_RETRY_MS);
      timers = timers.filter(t => !due.includes(t));
      due.forEach(t => { t.live = false; t.run(); });
      await settle();
    },
    // The server's first word on the draft (the listener's own snapshot comes first, as in the SDK).
    async answer(entries: Record<string, unknown> | null, days: Record<string, string> = {}) {
      if (entries === null) page.snapshotNone(true); else page.snapshot(entries, days, true);
      await settle();
    },
    releaseHeld() { held.forEach(write => write.resolve()); },
  };
  page.sync = createDraftSync({
    save: payload => {
      sent.push(payload);
      if (!holding) return Promise.resolve();
      return new Promise<void>((resolve, reject) => { held.push({ data: payload, resolve, reject }); });
    },
    nowIso: () => '2026-10-28T10:00:00.000Z',
    setTimer: (run, ms) => {
      const timer = { run, ms, live: true };
      timers.push(timer);
      return timer;
    },
    clearTimer: handle => { (handle as { live: boolean }).live = false; },
    onResult: ok => { results.push(ok); },
    journal: world ? {
      lid,
      get storage() { return world.active; },
      now: () => world.clock.now,
      ordersSince: async fromDate => {
        world.history.reads += 1;
        world.history.asked.push(fromDate);
        if (world.history.fail) throw new Error('unavailable');
        return world.history.records;
      },
      onCameBack: view => { page.apply(view); page.cameBack += 1; },
    } : undefined,
  });
  return page;
}

export type Page = ReturnType<typeof newPage>;
