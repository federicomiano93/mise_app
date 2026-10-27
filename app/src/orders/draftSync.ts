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
  // Sends a waiting (or refused) change RIGHT NOW (leaving the section, or before a record is written). Resolves at once
  // when nothing waits; otherwise as the save does — and REJECTS when it is refused.
  flush(): Promise<void>;
  // The screen's draft now: the last snapshot with this phone's unconfirmed typing on top (redrawn after a refusal).
  view(): DraftView;
  // True while a change is waiting for the debounce, a save is in the air, or a refused change waits to be sent again.
  hasUnsaved(): boolean;
  // True while a write is in the air (sent, no answer yet).
  saving(): boolean;
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

// A line's fields, as the comparison reads them (changedEntries' own rules): whole numbers; the card's unit as ''; on THIS
// phone's side the override exists only while there is a quantity (overrideOf), on the server's side it is the stored
// value, raw.
//
// ⚠️ QUANTITY, UNIT AND OVERRIDE ARE ONE MEANING («5 buste from Brava this time») and always travel together; only the
// stock is independent. Sent apart, a colleague placing the order in the same second turned «5 buste» into 5 of the card's
// unit, or filed the line back under its usual supplier (found reviewing 3f-1).
type Field = 'qty' | 'stock' | 'unit' | 'supplierId';
const GROUP: readonly Field[] = ['qty', 'unit', 'supplierId'];
type Row = Partial<Record<Field, number | string>>;
type Rows = Record<string, Row>;
type Flat = { qty: number; stock: number; unit: string; supplierId: string };

function local(entry: unknown): Flat {
  const row = (entry ?? {}) as Record<string, unknown>;
  return { qty: wholeNumber(row.qty), stock: wholeNumber(row.stock), unit: cleanUnit(row.unit), supplierId: overrideOf(entry) };
}
function stored(entry: unknown): Flat {
  const row = (entry ?? {}) as Record<string, unknown>;
  return {
    qty: wholeNumber(row.qty), stock: wholeNumber(row.stock), unit: cleanUnit(row.unit), supplierId: cleanSupplierId(row.supplierId),
  };
}
const blank = (field: Field, value: number | string | undefined) => value === undefined || value === (field === 'qty' || field === 'stock' ? 0 : '');

export function createDraftSync(deps: DraftSyncDeps): DraftSync {
  // The draft as this phone last agreed on it with the server: what a snapshot reported, plus what it has since sent and
  // had accepted. ⚠️ NOT updated when a write fails: the change then still counts as unsent and goes out again with the
  // next save, instead of being forgotten.
  let known: { entries: MutableEntries; days: MutableDays } = { entries: {}, days: {} };
  // ⚠️ WHAT THIS PHONE HAS TYPED AND THE SERVER HAS NOT CONFIRMED. Every snapshot replaces the whole map, and a change is
  // not sent for up to 800 ms: when another phone wrote anything in that window, its snapshot took the half-typed number
  // with it (reproduced against the emulator in the current app). Laid over each snapshot: the server owns every field
  // this phone has not touched, and this phone owns the one it is typing into until the write lands.
  //
  // ⚠️ IT IS ALWAYS «WHAT DIFFERS FROM `known`», recomputed at every change, and IT IS WHAT A SAVE SENDS. The current app's
  // draft.js kept the whole screen as it was at the keystroke, let the claims only grow and sent whole rows; found driving
  // and reviewing 3f-1, each of these brought back quantities of an order another phone had just placed:
  //   • another phone clearing lines during the pause got them written back;
  //   • a line corrected back inside the pause (+ then −), or typed to the value another phone had just written, stayed
  //     claimed for ever, came back on screen at the next snapshot and was written with the next keystroke;
  //   • a stock count sent the whole row, re-asserting this phone's copy of a quantity another phone had just cleared.
  let pending: { entries: Rows; days: MutableDays } = { entries: {}, days: {} };
  // The writes in the air, as sent: a snapshot never releases their fields (it may be Firestore showing this phone's own
  // write before the server answers), and a refused one hands them back.
  const flights: Array<{ entries: Rows; days: MutableDays }> = [];
  // The last snapshot, so the screen can be redrawn when a refusal hands typing back.
  let lastDoc: Readonly<Record<string, unknown>> | null = null;
  let timer: unknown = null;
  // A change is waiting for the pause to end.
  let waiting = false;

  function disarm() {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  }

  const inAir = (id: string, field: Field) => flights.some(flight => flight.entries[id] !== undefined && field in flight.entries[id]);
  const dayInAir = (id: string) => flights.some(flight => id in flight.days);
  // What the LATEST write in the air says for a field (or a supplier's day): undefined when none carries it.
  function carried(id: string, field: Field): number | string | undefined {
    for (let i = flights.length - 1; i >= 0; i -= 1) {
      const row = flights[i]?.entries[id];
      if (row !== undefined && field in row) return row[field];
    }
    return undefined;
  }
  function dayCarried(id: string): string | undefined {
    for (let i = flights.length - 1; i >= 0; i -= 1) {
      const days = flights[i]?.days;
      if (days !== undefined && id in days) return days[id];
    }
    return undefined;
  }

  // What this phone's screen holds that the server does not.
  function differences(entries: DraftEntries, days: DraftDays): { entries: Rows; days: MutableDays } {
    const rows: Rows = {};
    for (const id of Object.keys(changedEntries(entries, known.entries))) {
      const exists = known.entries[id] !== undefined;
      const mine = local(entries[id]);
      const theirs = stored(known.entries[id]);
      const row: Row = {};
      // ⚠️ A LEFTOVER {qty: 0, supplierId: 'X'} IS NOT THIS PHONE'S TO CLEAN on an edit of another line: it is harmless at
      // zero, and cleaning it could erase a colleague typing a quantity under X in the same second. The first quantity
      // typed here for that line sends the override with it (below), which clears it.
      const overrideDiffers = mine.supplierId !== theirs.supplierId && !(mine.qty === 0 && theirs.qty === 0);
      if (mine.qty !== theirs.qty || mine.unit !== theirs.unit || overrideDiffers) {
        // ⚠️ THE GROUP GOES WHOLE, '' INCLUDED: «5 of the card's unit, from the usual supplier» must say both, or a colleague
        // switching the unit (or moving the line) in the same second turns this phone's 5 into 5 buste, or files it under
        // their supplier. '' is also the clear (a merge cannot delete a nested key).
        row.qty = mine.qty;
        row.unit = mine.unit;
        row.supplierId = mine.supplierId;
      }
      // ⚠️ A LINE THE SERVER DOES NOT HAVE CARRIES ONLY WHAT IS IN IT: padded with stock 0, it erased the shelf count a
      // colleague put on the same line in the same second.
      if (mine.stock !== theirs.stock) row.stock = mine.stock;
      if (!isEmpty(row)) rows[id] = row;
    }
    return { entries: rows, days: changedDays(days, known.days) as MutableDays };
  }

  // The screen's draft: the server's lines with this phone's unconfirmed fields on top.
  function view(): DraftView {
    const doc = lastDoc;
    const storedEntries = (doc?.entries && typeof doc.entries === 'object' ? doc.entries : {}) as Record<string, DraftEntry>;
    const entries: Record<string, DraftEntry> = { ...storedEntries };
    for (const [id, row] of Object.entries(pending.entries)) entries[id] = { ...(storedEntries[id] ?? {}), ...row } as DraftEntry;
    return {
      entries,
      days: { ...daysOf(doc?.days), ...pending.days },
      updatedAt: typeof doc?.updatedAt === 'string' ? doc.updatedAt : '',
      exists: doc !== null && doc !== undefined,
    };
  }

  function saveNow(): Promise<void> {
    disarm();
    waiting = false;
    // Copies: a change typed while the write is in the air must not alter what this write says it sent. ⚠️ LEFT OUT: what
    // a write still in the air already says at the same value (the group only whole). Sent again — leaving the section a
    // moment after the autosave went — it could land after a colleague's newer value and put this phone's old one back
    // (found in the fourth review of 3f-1).
    const sent: { entries: Rows; days: MutableDays } = { entries: {}, days: {} };
    for (const [id, held] of Object.entries(pending.entries)) {
      const row: Row = { ...held };
      const group = GROUP.filter(field => field in row);
      if (group.length > 0 && group.every(field => carried(id, field) === row[field])) for (const field of group) delete row[field];
      if ('stock' in row && carried(id, 'stock') === row.stock) delete row.stock;
      if (!isEmpty(row)) sent.entries[id] = row;
    }
    for (const [id, day] of Object.entries(pending.days)) if (dayCarried(id) !== day) sent.days[id] = day;
    // Nothing this phone changed, so nothing to say. Staying quiet also stops a snapshot bouncing straight back as a write.
    if (isEmpty(sent.entries) && isEmpty(sent.days)) return Promise.resolve();

    const payload: { updatedAt: string; entries?: MutableEntries; days?: MutableDays } = { updatedAt: deps.nowIso() };
    if (!isEmpty(sent.entries)) payload.entries = sent.entries as MutableEntries;
    if (!isEmpty(sent.days)) payload.days = sent.days;

    flights.push(sent);
    const land = () => { flights.splice(flights.indexOf(sent), 1); };
    return deps.save(payload).then(() => {
      land();
      // What landed joins the baseline — except a field a LATER write still in the air also carries: the baseline already
      // holds that newer value (Firestore showed it), and going back to this older one would make it look changed here
      // and be sent again over whatever a colleague writes meanwhile.
      const entries: MutableEntries = { ...known.entries };
      for (const [id, row] of Object.entries(sent.entries)) {
        const landed = Object.fromEntries(Object.entries(row).filter(([field]) => !inAir(id, field as Field)));
        entries[id] = { ...(entries[id] ?? {}), ...landed } as DraftEntry;
      }
      const days: MutableDays = { ...known.days };
      for (const [id, day] of Object.entries(sent.days)) if (!dayInAir(id)) days[id] = day;
      known = { entries, days };
      // Release only what was actually sent, and only if it has not been typed over meanwhile: a value changed again
      // while this write was in the air is still this phone's, and must stay claimed. The group only as a whole.
      for (const [id, row] of Object.entries(sent.entries)) {
        const held = pending.entries[id];
        if (!held) continue;
        const group = GROUP.filter(field => field in held);
        if (group.length > 0 && group.every(field => held[field] === row[field])) for (const field of group) delete held[field];
        if ('stock' in held && held.stock === row.stock) delete held.stock;
        if (isEmpty(held)) delete pending.entries[id];
      }
      for (const [id, day] of Object.entries(sent.days)) {
        if (pending.days[id] === day) delete pending.days[id];
      }
    }, (err: unknown) => {
      land();
      // ⚠️ A REFUSED WRITE HANDS ITS TYPING BACK (parity L37: «the typing is kept»). A change made while it was in the air
      // may have dropped those fields from the claims — Firestore showed the write at once, so they matched `known` — and the
      // snapshot that takes the write back would then erase them. Each group or stock goes back unless typed over since.
      // The baseline forgets those fields too (it may hold Firestore's showing of this very write), so a keystroke before the
      // take-back arrives still counts them as this phone's.
      const entries: MutableEntries = { ...known.entries };
      for (const [id, row] of Object.entries(sent.entries)) {
        const held: Row = pending.entries[id] ?? {};
        const groupHeld = GROUP.some(field => field in held);
        const base: Record<string, unknown> = { ...(entries[id] ?? {}) };
        for (const field of Object.keys(row) as Field[]) {
          const typedOver = field === 'stock' ? 'stock' in held : groupHeld;
          if (!typedOver) held[field] = row[field];
          delete base[field];
        }
        if (!isEmpty(held)) pending.entries[id] = held;
        if (entries[id] !== undefined) entries[id] = base as DraftEntry;
      }
      const days: MutableDays = { ...known.days };
      for (const [id, day] of Object.entries(sent.days)) {
        if (!(id in pending.days)) pending.days[id] = day;
        delete days[id];
      }
      known = { entries, days };
      throw err;
    });
  }

  return {
    receive(doc) {
      lastDoc = doc;
      // The server's word becomes the baseline, so a row somebody else changed is not «changed here» and never gets
      // re-asserted at this phone's stale value…
      known = { entries: detach(doc?.entries), days: daysOf(doc?.days) };
      // …and what the server now holds at exactly this phone's value is no longer this phone's to send. ⚠️ NEVER A FIELD
      // OF A WRITE IN THE AIR: that snapshot may be Firestore showing this phone's own write before the server answers.
      for (const [id, row] of Object.entries(pending.entries)) {
        const exists = known.entries[id] !== undefined;
        const theirs = stored(known.entries[id]);
        const group = GROUP.filter(field => field in row);
        // The group is released whole or not at all (on a line the server does not have: when it is blank).
        if (group.length > 0 && !group.some(field => inAir(id, field))
          && (exists ? group.every(field => row[field] === theirs[field]) : group.every(field => blank(field, row[field])))) {
          for (const field of group) delete row[field];
        }
        if ('stock' in row && !inAir(id, 'stock') && row.stock === (exists ? theirs.stock : 0)) delete row.stock;
        if (isEmpty(row)) delete pending.entries[id];
      }
      for (const [id, day] of Object.entries(pending.days)) {
        if (!dayInAir(id) && known.days[id] === day) delete pending.days[id];
      }
      // …but anything typed here and not yet written goes back ON TOP, or the snapshot would erase it mid-keystroke.
      return view();
    },

    view,

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

    // Also after a refusal with nothing typed since: leaving the section tries the refused typing once more.
    flush() {
      if (!waiting && isEmpty(pending.entries) && isEmpty(pending.days)) return Promise.resolve();
      return saveNow().then(
        () => deps.onResult(true),
        (err: unknown) => {
          deps.onResult(false);
          throw err;
        },
      );
    },

    // ⚠️ A REFUSED CHANGE IS STILL UNSAVED: it lives only here (Firestore took its copy back), so a self-started reload
    // must not throw it away (rule 2 of every screen).
    hasUnsaved: () => waiting || flights.length > 0 || !isEmpty(pending.entries) || !isEmpty(pending.days),

    saving: () => flights.length > 0,
  };
}
