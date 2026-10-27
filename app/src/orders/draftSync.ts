// draftSync.ts — the order in progress (drafts/current) kept in step between this phone and the others (step 3f-1).
//
// A port of the SYNC half of js/orders/draft.js — `known`, `pending`, the 800 ms autosave, the flush — decision for
// decision, with no Firebase and no timers of its own: the write and the clock are injected, so every trap below is a spec
// (draftSync.spec.ts). The record half (archive, clear after placing, deliveries) comes with slices 3f-2 and 3f-5.
//
// ONE live document for the whole venue: every phone types into it at once (docs/parity/orders.md L31–L37).
//
// ⚠️ ONLY THE FIELDS THIS PHONE CHANGED ARE SENT (changedEntries / changedDays of @mise/shared/archive, narrowed field by
// field), through a merge write: the rows and fields not mentioned keep whatever anybody else has put there. Sending the whole map re-asserted every other
// row at this phone's stale value and erased a colleague's typing (the current app's concurrency fix).

import { changedDays, changedEntries, wholeNumber } from '@mise/shared/archive';
import { cleanSupplierId, overrideOf } from '@mise/shared/line-supplier';
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

// The four fields of a line, each compared on its own: a stock count must not re-send this phone's copy of the quantity.
type Field = 'qty' | 'stock' | 'unit' | 'supplierId';
const FIELDS: readonly Field[] = ['qty', 'stock', 'unit', 'supplierId'];
type Row = Partial<Record<Field, number | string>>;
type Rows = Record<string, Row>;

// A field as the comparison reads it (changedEntries' own rules): whole numbers; the card's unit as ''; on THIS phone's side
// the override exists only while there is a quantity (overrideOf), on the server's side it is the stored value, raw — so a
// leftover {qty: 0, supplierId: 'X'} is still seen and cleared.
function localField(entry: unknown, field: Field): number | string {
  const row = (entry ?? {}) as Record<string, unknown>;
  if (field === 'qty' || field === 'stock') return wholeNumber(row[field]);
  return field === 'unit' ? cleanUnit(row.unit) : overrideOf(entry);
}
function storedField(entry: unknown, field: Field): number | string {
  const row = (entry ?? {}) as Record<string, unknown>;
  if (field === 'qty' || field === 'stock') return wholeNumber(row[field]);
  return field === 'unit' ? cleanUnit(row.unit) : cleanSupplierId(row.supplierId);
}

export function createDraftSync(deps: DraftSyncDeps): DraftSync {
  // The draft as this phone last agreed on it with the server: what a snapshot reported, plus what it has since sent and
  // had accepted. ⚠️ NOT updated when a write fails: the change then still counts as unsent and goes out again with the
  // next save, instead of being forgotten.
  let known: { entries: MutableEntries; days: MutableDays } = { entries: {}, days: {} };
  // ⚠️ WHAT THIS PHONE HAS TYPED AND THE SERVER HAS NOT CONFIRMED — field by field. Every snapshot replaces the whole map,
  // and a change is not sent for up to 800 ms: when another phone wrote anything in that window, its snapshot took the
  // half-typed number with it (reproduced against the emulator in the current app). Laid over each snapshot: the server
  // owns every field this phone has not touched, and this phone owns the one it is typing into until the write lands.
  //
  // ⚠️ IT IS ALWAYS «WHAT DIFFERS FROM `known`», recomputed at every change, and IT IS WHAT A SAVE SENDS. Three holes of the
  // current app's draft.js (found driving and reviewing 3f-1) came from keeping the whole screen as it was at the keystroke,
  // letting the claims only grow and sending whole rows:
  //   • another phone clearing lines during the pause (an order placed) got them written back;
  //   • a line corrected back inside the pause (+ then −), or typed to the value another phone had just written, stayed
  //     claimed for ever, came back on screen at the next snapshot and was written with the next keystroke;
  //   • a stock count sent the whole row, re-asserting this phone's copy of a quantity another phone had just cleared.
  let pending: { entries: Rows; days: MutableDays } = { entries: {}, days: {} };
  let timer: unknown = null;
  // A change is waiting for the pause to end.
  let waiting = false;
  let inFlight = 0;

  function disarm() {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  }

  // What this phone's screen holds that the server does not, field by field. A line the document does not have yet goes
  // whole ({qty, stock}, as changedEntries shapes it); a line looked at and left blank is not a change.
  function differences(entries: DraftEntries, days: DraftDays): { entries: Rows; days: MutableDays } {
    const whole = changedEntries(entries, known.entries) as MutableEntries;
    const rows: Rows = {};
    for (const [id, row] of Object.entries(whole)) {
      const before = known.entries[id];
      if (!before) {
        rows[id] = { ...row };
        continue;
      }
      const fields: Row = {};
      for (const field of FIELDS) {
        const mine = localField(entries[id], field);
        if (mine !== storedField(before, field)) fields[field] = mine;
      }
      if (!isEmpty(fields)) rows[id] = fields;
    }
    return { entries: rows, days: changedDays(days, known.days) as MutableDays };
  }

  function saveNow(): Promise<void> {
    disarm();
    waiting = false;
    // Copies: a change typed while the write is in the air must not alter what this write says it sent.
    const entriesDelta: Rows = Object.fromEntries(Object.entries(pending.entries).map(([id, row]) => [id, { ...row }]));
    const daysDelta: MutableDays = { ...pending.days };
    // Nothing this phone changed, so nothing to say. Staying quiet also stops a snapshot bouncing straight back as a write.
    if (isEmpty(entriesDelta) && isEmpty(daysDelta)) return Promise.resolve();

    const payload: { updatedAt: string; entries?: MutableEntries; days?: MutableDays } = { updatedAt: deps.nowIso() };
    if (!isEmpty(entriesDelta)) payload.entries = entriesDelta as MutableEntries;
    if (!isEmpty(daysDelta)) payload.days = daysDelta;

    inFlight += 1;
    return deps.save(payload).then(() => {
      const entries: MutableEntries = { ...known.entries };
      for (const [id, row] of Object.entries(entriesDelta)) entries[id] = { ...(entries[id] ?? {}), ...row } as DraftEntry;
      known = { entries, days: { ...known.days, ...daysDelta } };
      // Release only what was actually sent, and only if it has not been typed over meanwhile: a value changed again
      // while this write was in the air is still this phone's, and must stay claimed.
      for (const [id, sent] of Object.entries(entriesDelta)) {
        const held = pending.entries[id];
        if (!held) continue;
        for (const field of FIELDS) {
          if (field in sent && held[field] === sent[field]) delete held[field];
        }
        if (isEmpty(held)) delete pending.entries[id];
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
      // …a field the server now holds at exactly this phone's value is no longer this phone's to send. ⚠️ NOT WHILE A
      // WRITE IS IN THE AIR: Firestore shows this phone's own write at once, and if the server then refuses it the snapshot
      // taken back would erase the typing the message says is kept (parity L37). That write's own success releases it.
      if (inFlight === 0) {
        for (const [id, row] of Object.entries(pending.entries)) {
          // A line the server does not have (any more) goes whole, {qty, stock} as changedEntries shapes it — unless it is
          // blank, which says nothing worth storing.
          if (!known.entries[id]) {
            const whole: Row = { ...row, qty: row.qty ?? 0, stock: row.stock ?? 0 };
            if (whole.qty === 0 && whole.stock === 0 && !whole.unit && !whole.supplierId) delete pending.entries[id];
            else pending.entries[id] = whole;
            continue;
          }
          for (const field of FIELDS) {
            if (field in row && row[field] === storedField(known.entries[id], field)) delete row[field];
          }
          if (isEmpty(row)) delete pending.entries[id];
        }
        for (const [id, day] of Object.entries(pending.days)) {
          if (known.days[id] === day) delete pending.days[id];
        }
      }
      // …but anything typed here and not yet written goes back ON TOP, or the snapshot would erase it mid-keystroke.
      const stored = (doc?.entries && typeof doc.entries === 'object' ? doc.entries : {}) as Record<string, DraftEntry>;
      const entries: Record<string, DraftEntry> = { ...stored };
      for (const [id, row] of Object.entries(pending.entries)) entries[id] = { ...(stored[id] ?? {}), ...row } as DraftEntry;
      return {
        entries,
        days: { ...daysOf(doc?.days), ...pending.days },
        updatedAt: typeof doc?.updatedAt === 'string' ? doc.updatedAt : '',
        exists: doc !== null && doc !== undefined,
      };
    },

    change(entries, days) {
      waiting = true;
      // Claim exactly what differs from the server now: a line put back to the server's value is released at once.
      pending = differences(entries, days);
      disarm();
      timer = deps.setTimer(() => {
        timer = null;
        if (!waiting) return;
        // ⚠️ The timer is the ONE write with no caller to hand a rejection to, so it catches its own: an unhandled
        // refusal let somebody keep typing an order that was no longer being saved anywhere.
        saveNow()
          .then(() => deps.onResult(true))
          .catch((err: unknown) => {
            console.error('Draft autosave failed:', err);
            deps.onResult(false);
          });
      }, SAVE_DELAY_MS);
    },

    flush() {
      if (!waiting) return Promise.resolve();
      return saveNow().then(
        () => deps.onResult(true),
        (err: unknown) => {
          deps.onResult(false);
          throw err;
        },
      );
    },

    hasUnsaved: () => waiting || inFlight > 0,
  };
}
