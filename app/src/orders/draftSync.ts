// draftSync.ts — the order in progress (drafts/current) kept in step between this phone and the others (step 3f-1).
//
// A port of the SYNC half of js/orders/draft.js — `known`, `pending`, the 800 ms autosave, the flush — decision for
// decision, with no Firebase and no timers of its own: the write and the clock are injected, so every trap below is a spec
// (draftSync.spec.ts). The record half (archive, clear after placing, deliveries) comes with slices 3f-2 and 3f-5.
//
// ONE live document for the whole venue: every phone types into it at once (docs/parity/orders.md L31–L37).
//
// ⚠️ ONLY THE KEYS THIS PHONE CHANGED ARE SENT (changedEntries / changedDays of @mise/shared/archive), through a merge
// write: the rows not mentioned keep whatever anybody else has put there. Sending the whole map re-asserted every other
// row at this phone's stale value and erased a colleague's typing (the current app's concurrency fix).

import { changedDays, changedEntries } from '@mise/shared/archive';
import { cleanSupplierId } from '@mise/shared/line-supplier';
import { cleanUnit } from '@mise/shared/order-unit';

// One line of the order, as stored: `qty` and `stock` are whole numbers; `unit` only when the line is not in the card's
// own unit ('' = back to the card's unit); `supplierId` only when the line is ordered from another supplier this time
// ('' = back to its usual one). ⚠️ A merge write cannot delete a nested key, so '' IS the clear (parity L36).
export interface DraftEntry {
  readonly qty?: number;
  readonly stock?: number;
  readonly unit?: string;
  readonly supplierId?: string;
}

export type DraftEntries = Readonly<Record<string, DraftEntry>>;
// The day each supplier's lines are FOR, by supplier id: 'YYYY-MM-DD' (order-day.js stampFor).
export type DraftDays = Readonly<Record<string, string>>;

// The draft as the screens draw it: the server's document with this phone's unsent typing on top.
export interface DraftView {
  readonly entries: DraftEntries;
  readonly days: DraftDays;
  // The document's own `updatedAt` (ISO), '' when it has none.
  readonly updatedAt: string;
  // Whether drafts/current exists at all.
  readonly exists: boolean;
}

// What one autosave sends: the changed rows and days only, and the time of the write.
export interface DraftPayload {
  readonly updatedAt: string;
  readonly entries?: Readonly<Record<string, DraftEntry>>;
  readonly days?: Readonly<Record<string, string>>;
}

export interface DraftSyncDeps {
  // The merge write of drafts/current (the venue stamp is the source's). Settles when the SERVER answers; REJECTS when
  // refused (offline it simply waits).
  save(payload: DraftPayload): Promise<void>;
  // The time of a write, ISO.
  nowIso(): string;
  // The debounce clock; a spec passes its own.
  setTimer(run: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  // How a save ended: true = it landed, false = it was refused. ⚠️ Success is said too, so a later save that carried the
  // same values clears a failure message left by a transient blip (parity L37).
  onResult(ok: boolean): void;
}

// Debounce to limit Firestore writes (P14): one write per pause in the typing, never one per keystroke.
export const SAVE_DELAY_MS = 800;

export const EMPTY_DRAFT: DraftView = Object.freeze({
  entries: Object.freeze({}), days: Object.freeze({}), updatedAt: '', exists: false,
});

export interface DraftSync {
  // A snapshot of drafts/current arrived (null = no document): it becomes the baseline, and what this phone typed and the
  // server has not confirmed goes back ON TOP. Returns what the screens draw.
  receive(doc: Readonly<Record<string, unknown>> | null): DraftView;
  // The whole local state after an edit: the changed rows are claimed as this phone's and the autosave is (re)armed.
  change(entries: DraftEntries, days: DraftDays): void;
  // Sends a waiting change RIGHT NOW (leaving the section, or before a record is written). Resolves at once when nothing
  // waits; otherwise as the save does — and REJECTS when it is refused.
  flush(): Promise<void>;
  // True while a change is waiting for the debounce or a save is in the air.
  hasUnsaved(): boolean;
}

type MutableEntries = Record<string, DraftEntry>;
type MutableDays = Record<string, string>;

// A DETACHED copy of an entries map: same numbers, none of the same objects.
//
// ⚠️ LOAD-BEARING IN THE CURRENT APP (draft.js `detach`), where typing mutated the live objects in place and a shared
// reference made every change look already saved. Mise 2's store never mutates a line, but the baseline is still a copy
// of only the four fields the comparison reads: a field another screen adds to a line must not make it look changed.
function detach(entries: unknown): MutableEntries {
  const out: MutableEntries = {};
  if (!entries || typeof entries !== 'object') return out;
  for (const [id, raw] of Object.entries(entries as Record<string, unknown>)) {
    const entry = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const copy: { qty?: unknown; stock?: unknown; unit?: unknown; supplierId?: unknown } = {
      qty: entry.qty, stock: entry.stock,
    };
    // Only when present, so an ordinary entry keeps its {qty, stock} shape.
    if (entry.unit !== undefined) copy.unit = entry.unit;
    // The override travels the same way: without it the baseline could never see that a line had been sent elsewhere.
    if (entry.supplierId !== undefined) copy.supplierId = entry.supplierId;
    out[id] = copy as DraftEntry;
  }
  return out;
}

function daysOf(days: unknown): MutableDays {
  const out: MutableDays = {};
  if (!days || typeof days !== 'object') return out;
  for (const [id, day] of Object.entries(days as Record<string, unknown>)) {
    if (typeof day === 'string') out[id] = day;
  }
  return out;
}

const isEmpty = (map: object) => Object.keys(map).length === 0;

export function createDraftSync(deps: DraftSyncDeps): DraftSync {
  // The draft as this phone last agreed on it with the server: what a snapshot reported, plus what it has since sent and
  // had accepted. ⚠️ NOT updated when a write fails: the change then still counts as unsent and goes out again with the
  // next save, instead of being forgotten.
  let known: { entries: MutableEntries; days: MutableDays } = { entries: {}, days: {} };
  // ⚠️ WHAT THIS PHONE HAS TYPED AND THE SERVER HAS NOT CONFIRMED. Every snapshot replaces the whole map, and a change is
  // not sent for up to 800 ms: when another phone wrote anything in that window, its snapshot took the half-typed number
  // with it (reproduced against the emulator in the current app). Re-applied over each snapshot: the server owns every
  // row this phone has not touched, and this phone owns the one it is typing into until the write lands.
  let pending: { entries: MutableEntries; days: MutableDays } = { entries: {}, days: {} };
  let timer: unknown = null;
  let queued: { entries: DraftEntries; days: DraftDays } | null = null;
  let inFlight = 0;

  function disarm() {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  }

  function saveNow(entries: DraftEntries, days: DraftDays): Promise<void> {
    disarm();
    queued = null;
    const entriesDelta = changedEntries(entries, known.entries) as MutableEntries;
    const daysDelta = changedDays(days, known.days) as MutableDays;
    // Nothing this phone changed, so nothing to say. Staying quiet also stops a snapshot bouncing straight back as a write.
    if (isEmpty(entriesDelta) && isEmpty(daysDelta)) return Promise.resolve();

    const payload: { updatedAt: string; entries?: MutableEntries; days?: MutableDays } = { updatedAt: deps.nowIso() };
    if (!isEmpty(entriesDelta)) payload.entries = entriesDelta;
    if (!isEmpty(daysDelta)) payload.days = daysDelta;

    inFlight += 1;
    return deps.save(payload).then(() => {
      known = {
        entries: { ...known.entries, ...entriesDelta },
        days: { ...known.days, ...daysDelta },
      };
      // Release only what was actually sent, and only if it has not been typed over meanwhile: a value changed again
      // while this write was in the air is still this phone's, and must stay claimed.
      for (const [id, sent] of Object.entries(entriesDelta)) {
        const held = pending.entries[id];
        if (held && held.qty === sent.qty && held.stock === sent.stock
          && cleanUnit(held.unit) === cleanUnit(sent.unit)
          && cleanSupplierId(held.supplierId) === cleanSupplierId(sent.supplierId)) delete pending.entries[id];
      }
      for (const [id, sent] of Object.entries(daysDelta)) {
        if (pending.days[id] === sent) delete pending.days[id];
      }
    }).finally(() => {
      inFlight -= 1;
    });
  }

  return {
    receive(doc) {
      // The server's word becomes the baseline, so a row somebody else changed is not «changed here» and never gets
      // re-asserted at this phone's stale value…
      known = { entries: detach(doc?.entries), days: daysOf(doc?.days) };
      // …but anything typed here and not yet written goes back ON TOP, or the snapshot would erase it mid-keystroke.
      const stored = (doc?.entries && typeof doc.entries === 'object' ? doc.entries : {}) as Record<string, DraftEntry>;
      return {
        entries: { ...stored, ...pending.entries },
        days: { ...daysOf(doc?.days), ...pending.days },
        updatedAt: typeof doc?.updatedAt === 'string' ? doc.updatedAt : '',
        exists: doc !== null && doc !== undefined,
      };
    },

    change(entries, days) {
      queued = { entries, days };
      // Claim these rows as this phone's until the write lands, so a snapshot during the debounce cannot take them away.
      pending = {
        entries: { ...pending.entries, ...(changedEntries(entries, known.entries) as MutableEntries) },
        days: { ...pending.days, ...(changedDays(days, known.days) as MutableDays) },
      };
      disarm();
      timer = deps.setTimer(() => {
        timer = null;
        const next = queued;
        if (!next) return;
        // ⚠️ The timer is the ONE write with no caller to hand a rejection to, so it catches its own: an unhandled
        // refusal let somebody keep typing an order that was no longer being saved anywhere.
        saveNow(next.entries, next.days)
          .then(() => deps.onResult(true))
          .catch((err: unknown) => {
            console.error('Draft autosave failed:', err);
            deps.onResult(false);
          });
      }, SAVE_DELAY_MS);
    },

    flush() {
      if (!queued) return Promise.resolve();
      const next = queued;
      return saveNow(next.entries, next.days).then(
        () => deps.onResult(true),
        (err: unknown) => {
          deps.onResult(false);
          throw err;
        },
      );
    },

    hasUnsaved: () => queued !== null || inFlight > 0,
  };
}
