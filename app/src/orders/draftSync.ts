// draftSync.ts — the order in progress (drafts/current) kept in step between this phone and the others (step 3f-1).
//
// A port of the SYNC half of js/orders/draft.js — `known`, `pending`, the 800 ms autosave, the flush — decision for
// decision, with no Firebase and no timers of its own: the write and the clock are injected, so every trap below is a spec
// (draftSync.spec.ts). The record half (archive, clear after placing, deliveries) comes with slices 3f-2 and 3f-5.
//
// ONE live document for the whole venue: every phone types into it at once (docs/parity/orders.md L31–L37).
//
// It also keeps this device's NOTE of the typing the server has not confirmed (@mise/shared/draft-journal, parity F-15) and the
// rules of a correction made while the write it corrects is in the air (parity F-16, the current app's #444): both are ports of
// the current draft.js, decision for decision (draftSync.journal.spec.ts, draftSync.claims.spec.ts).
//
// ⚠️ ONLY THE FIELDS THIS PHONE CHANGED ARE SENT (changedEntries / changedDays of @mise/shared/archive, narrowed field by
// field), through a merge write: the rows and fields not mentioned keep whatever anybody else has put there. Sending the whole map re-asserted every other
// row at this phone's stale value and erased a colleague's typing (the current app's concurrency fix).

import { changedDays, changedEntries, wholeNumber } from '@mise/shared/archive';
import { cleanSupplierId, overrideOf } from '@mise/shared/line-supplier';
import { cleanUnit } from '@mise/shared/order-unit';
import { DRAFT_JOURNAL_MAX_AGE_MS, historyLookBackDay, orderedSince, readJournal, writeJournal } from '@mise/shared/draft-journal';
import type { Journal, JournalDay, JournalLine } from '@mise/shared/draft-journal';
import type { CopyStorage } from '@mise/shared/list-copy';

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
  // This device's note of unconfirmed typing (parity F-15). Absent = no note (the specs that do not test it).
  journal?: DraftJournalDeps;
}

export interface DraftJournalDeps {
  // The venue the note belongs to.
  readonly lid: string;
  // The device's localStorage, or null when it has none (private mode, blocked).
  readonly storage: CopyStorage | null;
  // The clock of the note's age, in ms.
  now(): number;
  // The orders-history records dated `fromDate` or later, read from the SERVER only (never the browser's own copy, which is
  // exactly what may not know about an order another phone placed). REJECTS when the server cannot be reached.
  ordersSince(fromDate: string): Promise<readonly unknown[]>;
  // Lines the last page left have come back onto the screen (once the server answered and no order names them): `view` is the
  // draft to draw. The store draws it and holds the busy marker, because the autosave is armed.
  onCameBack(view: DraftView): void;
}

// What the snapshot says about where it came from. `fromServer`: the SERVER has answered, not only this phone's own database.
export interface ReceiveMeta {
  readonly fromServer: boolean;
}

// Debounce to limit Firestore writes (P14): one write per pause in the typing, never one per keystroke.
export const SAVE_DELAY_MS = 800;

// A tablet can stay open for days: when the orders could not be read, the note asks again after this long.
export const ORDERS_RETRY_MS = 30000;

export const EMPTY_DRAFT: DraftView = Object.freeze({
  entries: Object.freeze({}), days: Object.freeze({}), updatedAt: '', exists: false,
});

export interface DraftSync {
  // A snapshot of drafts/current arrived (null = no document): it becomes the baseline, and what this phone typed and the
  // server has not confirmed goes back ON TOP. Returns what the screens draw.
  // `meta.fromServer` (the first one while a note is waiting) is the moment the note may be judged (parity F-15).
  receive(doc: Readonly<Record<string, unknown>> | null, meta?: ReceiveMeta): DraftView;
  // The sync is being used (the section started, the venue is certainly known): reads this device's note once, and makes this
  // sync the ONE writer of it. Safe to call again (a restart).
  open(): void;
  // The section was left: the sync no longer judges a note (its snapshots have stopped, so what it knows is stale). It still
  // notes what its writes in the air do when they land, until another sync opens.
  close(): void;
  // A change is waiting for the pause to end (the page going out of sight sends it at once).
  waiting(): boolean;
  // The whole local state after an edit: the changed rows are claimed as this phone's and the autosave is (re)armed.
  change(entries: DraftEntries, days: DraftDays): void;
  // Sends a waiting (or refused) change RIGHT NOW (leaving the section, or before a record is written). Resolves at once
  // when nothing waits; otherwise as the save does — and REJECTS when it is refused.
  flush(): Promise<void>;
  // flush, but first every write already in the air has its answer: before an order is recorded and its lines forgotten.
  // A refused one hands its typing back, which then goes again — and a second refusal REJECTS, before anything is recorded.
  settle(): Promise<void>;
  // The screen's draft now: the last snapshot with this phone's unconfirmed typing on top (redrawn after a refusal).
  view(): DraftView;
  // True while a change is waiting for the debounce, a save is in the air, or a refused change waits to be sent again.
  hasUnsaved(): boolean;
  // True while a write is in the air (sent, no answer yet).
  saving(): boolean;
  // These lines (and these suppliers' day stamps) leave THIS phone now, before their clear is written: from the screen's
  // copy, from the baseline and from what this phone claims. `quantitiesOnly` keeps each line's stock reading (a «Clear
  // quantities», draft.js clearQuantities); otherwise the whole line goes (an order was recorded, draft.js clearSupplier).
  // Returns what the screens draw.
  forget(ingredientIds: readonly string[], supplierIds: readonly string[], options?: { quantitiesOnly?: boolean }): DraftView;
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
// ⚠️ ONE WRITER OF THE NOTE. The current app is one page = one module; Mise 2 makes a new store and a new sync each time the Orders
// section mounts, while the previous, stopped one may still have a write in the air. Its landing saves the note, and would
// overwrite what the new sync has just read and holds (and its release of a line is not the new sync's word). So the note is
// written only by the sync that opened last: a stopped sync stays the owner until a new one opens, which keeps noting what its
// own writes in the air do (a correction left in the air by the section just left).
let journalOwner: object | null = null;

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
  // The same writes as answers to wait for (settle).
  const answers = new Set<Promise<unknown>>();
  // The last snapshot, so the screen can be redrawn when a refusal hands typing back.
  let lastDoc: Readonly<Record<string, unknown>> | null = null;
  let timer: unknown = null;
  // A change is waiting for the pause to end.
  let waiting = false;

  // ── What survives this page (parity F-15) ────────────────────────────────────────────────────────────────────────────
  //
  // ⚠️ `pending` DIES WITH THE PAGE. Measured on the lab tablet: on a freshly opened page a write reaches Firestore's queue about
  // 5 s after the keystroke, and a reload before that lost the number for good. So every claim is also noted on this device, in
  // the same keystroke (draft-journal.ts), until a snapshot shows it: Firestore only reports a write after storing it in the
  // browser's database, so from then on the queue answers for it. A correction stays noted until the writes it corrects have
  // landed too.
  //
  // ⚠️⚠️ THE NOTE IS NEVER SENT BLIND, AND NEVER ON THE WORD OF THE OFFLINE COPY. It can be hours old by the time the page opens,
  // and the copy on this device may not know that a colleague has placed that order: sending it then would put back quantities of
  // an order already placed. So what the last page left waits in `restored`, off the screen and out of every save, until the
  // SERVER has answered (settleRestored). It is not the busy marker's business (hasUnsaved): it lives in storage.
  const journal = deps.journal;
  const self = {};
  let opened = false;
  let closed = false;
  let journalAt = 0;              // when the note was last typed into: what its 24 hours count from
  let restored: Journal | null = null;   // what the last page left, while the server has not answered
  let settleBusy = false;         // a judgement is running, or waiting to ask the orders again
  // Writes the server said no to: see wasRefused.
  const refused: Array<{ entries: Rows; days: MutableDays }> = [];

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

  // What this phone's screen holds that the server does not — or will not once the writes in the air have landed.
  //
  // ⚠️ A CORRECTION MADE WHILE THE WRITE IT CORRECTS IS IN THE AIR (the current app's #444). Until a snapshot shows that write
  // (about 5 s on the lab tablet, on a freshly opened page), «5 put back to 0» matches `known`, so measured against `known` alone it
  // said nothing, and the 5 then landed and came back, on screen and on the server. So a field a write in the air says
  // differently is claimed too. ONLY a line and a day the page still holds: one it has just forgotten is an order placed, and a
  // blank row written now would outlive its clear. A redraw gives that line a blank row back, and the next keystroke then writes
  // it at zero: wanted, because a 5 landing after the clear would otherwise stay.
  function differences(entries: DraftEntries, days: DraftDays): { entries: Rows; days: MutableDays } {
    const rows: Rows = {};
    const ids = new Set(Object.keys(changedEntries(entries, known.entries)));
    for (const flight of flights) for (const id of Object.keys(flight.entries)) if (entries?.[id]) ids.add(id);
    for (const id of ids) {
      const mine = local(entries[id]);
      const theirs = stored(known.entries[id]);
      const row: Row = {};
      const overtaken = (field: Field) => inAir(id, field) && carried(id, field) !== mine[field];
      // ⚠️ A LEFTOVER {qty: 0, supplierId: 'X'} IS NOT THIS PHONE'S TO CLEAN on an edit of another line: it is harmless at
      // zero, and cleaning it could erase a colleague typing a quantity under X in the same second. The first quantity
      // typed here for that line sends the override with it (below), which clears it.
      const overrideDiffers = mine.supplierId !== theirs.supplierId && !(mine.qty === 0 && theirs.qty === 0);
      if (mine.qty !== theirs.qty || mine.unit !== theirs.unit || overrideDiffers || GROUP.some(overtaken)) {
        // ⚠️ THE GROUP GOES WHOLE, '' INCLUDED: «5 of the card's unit, from the usual supplier» must say both, or a colleague
        // switching the unit (or moving the line) in the same second turns this phone's 5 into 5 buste, or files it under
        // their supplier. '' is also the clear (a merge cannot delete a nested key).
        row.qty = mine.qty;
        row.unit = mine.unit;
        row.supplierId = mine.supplierId;
      }
      // ⚠️ A LINE THE SERVER DOES NOT HAVE CARRIES ONLY WHAT IS IN IT: padded with stock 0, it erased the shelf count a
      // colleague put on the same line in the same second.
      if (mine.stock !== theirs.stock || overtaken('stock')) row.stock = mine.stock;
      if (!isEmpty(row)) rows[id] = row;
    }
    const claimedDays = changedDays(days, known.days) as MutableDays;
    for (const [id, day] of Object.entries(days ?? {})) if (dayInAir(id) && dayCarried(id) !== day) claimedDays[id] = day;
    return { entries: rows, days: claimedDays };
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

  // A write the server refused is refused again on the next open, and every save would then carry it: a note that outlived the
  // page would turn one bad line into an order that can never be saved again, for good. So it stays claimed in this page, as
  // before, but is not noted: a reload is still the way out. A saved write proves the rules accept this device again, and clears
  // the list.
  const wasRefused = (id: string, field: Field, value: number | string | undefined) =>
    refused.some(write => write.entries[id] !== undefined && write.entries[id]?.[field] === value);

  // Reads the note once and makes this sync the one writer of it (⚠️ journalOwner). Not at creation: only once the section is
  // started is a venue certainly open.
  function open() {
    if (!journal) return;
    journalOwner = self;
    closed = false;
    if (opened) return;
    opened = true;
    if (!journal.lid) return;
    const note = readJournal(journal.lid, journal.now(), journal.storage);
    if (!note) return;
    journalAt = note.at;
    restored = note;
  }

  // Bring the note up to date. `typed` says this comes from a keystroke, which restarts its 24 hours: not while something from an
  // earlier page is still in it, which keeps its own age, or a tablet used offline could carry a number past the day it is allowed.
  function saveJournal(typed = false) {
    if (!journal?.lid) return;
    // ⚠️ A row can be drawn a frame before the section is started, and what is typed in that frame needs its note as much as any
    // other.
    if (!opened) open();
    // ⚠️ ONE WRITER (journalOwner): a stopped sync whose write lands after a new one opened must not rewrite its note.
    if (journalOwner !== self) return;
    if ((typed && !restored) || !journalAt) journalAt = journal.now();
    const entries: Record<string, JournalLine> = {};
    const days: Record<string, JournalDay> = {};
    if (restored) {
      for (const [id, left] of Object.entries(restored.entries)) {
        entries[id] = { row: { ...left.row }, base: { ...left.base } };
        if (left.air?.length) entries[id].air = left.air.map(seen => ({ ...seen }));
      }
      Object.assign(days, restored.days);
    }
    for (const [id, held] of Object.entries(pending.entries)) {
      const there = stored(known.entries[id]);
      const row: Row = {};
      const base: Row = {};
      const air: Row[] = [];
      const noteFields = (fields: readonly Field[], corrected: Row[]) => {
        for (const field of fields) { row[field] = held[field]; base[field] = there[field]; }
        air.push(...corrected);
      };
      // ⚠️ «5 PUT BACK TO 0» MATCHES `known` UNTIL A SNAPSHOT SHOWS THE 5, BUT THE 5 MAY ALREADY BE IN FIRESTORE'S QUEUE: with the
      // page gone before the 0 left, it lands and comes back. So a claim that corrects a write in the air is noted even when it
      // matches `known`, and says what that write said, because on the next open the line can read either way (stillOurs).
      const corrects = (fields: readonly Field[]): Row[] => flights.map(flight => flight.entries[id])
        .filter((sent): sent is Row => sent !== undefined
          && fields.every(field => field in sent)
          && fields.some(field => sent[field] !== held[field])
          && fields.some(field => sent[field] !== there[field]))
        .map(sent => Object.fromEntries(fields.map(field => [field, sent[field]])) as Row);
      // What a snapshot already shows is in Firestore's queue. The group only as a whole.
      const group = GROUP.filter(field => field in held);
      const groupCorrects = group.length > 0 ? corrects(group) : [];
      if ((group.some(field => held[field] !== there[field]) || groupCorrects.length > 0)
        && !group.every(field => wasRefused(id, field, held[field]))) noteFields(group, groupCorrects);
      const stockCorrects = 'stock' in held ? corrects(['stock']) : [];
      if ('stock' in held && (held.stock !== there.stock || stockCorrects.length > 0)
        && !wasRefused(id, 'stock', held.stock)) noteFields(['stock'], stockCorrects);
      if (isEmpty(row)) continue;
      const seen = [...(entries[id]?.air ?? []), ...air];
      const line: JournalLine = { row: { ...entries[id]?.row, ...row }, base: { ...entries[id]?.base, ...base } };
      if (seen.length > 0) line.air = seen;
      entries[id] = line;
    }
    for (const [id, day] of Object.entries(pending.days)) {
      if (day && known.days[id] !== day && !refused.some(write => write.days[id] === day)) {
        days[id] = { day, base: known.days[id] ?? '' };
      }
    }
    writeJournal(journal.lid, { at: journalAt, entries, days }, journal.storage);
  }

  // What the last page left that `from` still reads as it did when it was typed, or as a write it had in the air and had
  // corrected (`air`: that write reached the queue and landed). Already holding it means it arrived; holding anything else means
  // somebody changed that line meanwhile, and their word wins. The quantity group and the stock are judged apart, as they are
  // written: a colleague's shelf count says nothing about a quantity.
  function stillOurs(left: Journal, from: { entries: MutableEntries; days: MutableDays }): { entries: Rows; days: MutableDays } {
    const entries: Rows = {};
    for (const [id, { row, base, air = [] }] of Object.entries(left.entries)) {
      const there = stored(from.entries[id]);
      const kept: Row = {};
      for (const fields of [GROUP.filter(field => field in row), 'stock' in row ? ['stock' as Field] : []]) {
        if (fields.length > 0 && [base, ...air].some(seen => fields.every(field => seen[field] === there[field]))
          && fields.some(field => row[field] !== there[field])) {
          for (const field of fields) kept[field] = row[field];
        }
      }
      if (!isEmpty(kept)) entries[id] = kept;
    }
    const days: MutableDays = {};
    for (const [id, { day, base }] of Object.entries(left.days)) {
      const there = from.days[id] ?? '';
      if (there === base && there !== day) days[id] = day;
    }
    return { entries, days };
  }

  // The server has answered, so `known` is its word, and the snapshot has been taken in first. Says whether any line came back, or
  // null when the orders could not be read and the note goes on waiting.
  //
  // ⚠️⚠️ «STILL READS AS IT DID» CANNOT TELL AN UNTOUCHED LINE FROM ONE THAT WAS FILLED AND ORDERED: placing empties a line, and
  // empty is what most lines were when typed on. Worse, the note may even be for a write that did get through, in the instant
  // between Firestore storing it and telling this page, and any page of the app then sends it. So before anything comes back the
  // server is asked about the orders themselves: a line some order has named since it was typed stays out. Read only when there
  // is something to bring back, which is rare.
  async function settleRestored(): Promise<boolean | null> {
    if (!journal || !restored) return false;
    // ⚠️ AGAIN HERE, not only when the note is read: a page can wait offline for days.
    const expired = journal.now() - restored.at > DRAFT_JOURNAL_MAX_AGE_MS;
    if (expired || isEmpty(stillOurs(restored, known).entries)) {
      restored = null;
      saveJournal();
      return false;
    }
    let ordered: Set<string>;
    try {
      ordered = orderedSince(await journal.ordersSince(historyLookBackDay(restored.at)), restored.at);
    } catch (err) {
      console.error('The orders could not be checked, the typed quantities wait:', err);
      return null;
    }
    // Time has passed: whatever was typed or cleared since has already been taken out of `restored`, and `known` has moved on with
    // every snapshot.
    const left = restored;
    if (!left) return false;
    const { entries, days } = stillOurs(left, known);
    restored = null;
    for (const id of Object.keys(entries)) {
      if (!ordered.has(id)) continue;
      const kept = entries[id] as Row;
      for (const field of GROUP) delete kept[field];
      if (isEmpty(kept)) delete entries[id];
    }
    const quantities = (rows: Row[]) => rows.filter(row => GROUP.some(field => field in row)).length;
    // A correction whose line already reads as it wanted asked for nothing: it is no line dropped.
    // ⚠️ UNLESS AN ORDER NAMES IT: placing empties a line too, and that is the stamp to keep out.
    const typedLines = quantities(Object.entries(left.entries)
      .filter(([id, { row, air }]) => !air?.length || ordered.has(id)
        || GROUP.filter(field => field in row).some(field => row[field] !== stored(known.entries[id])[field]))
      .map(([, { row }]) => row));
    const back = quantities(Object.values(entries));
    const anyLine = !isEmpty(entries);
    for (const [id, row] of Object.entries(entries)) pending.entries[id] = { ...row, ...pending.entries[id] };
    // ⚠️ A DAY STAMP MEANS NOTHING WITHOUT ITS LINES, and a line dropped here may be why: a stamp for next week left on a supplier
    // whose order has gone would date that supplier's next order too. This file does not know whose line is whose, so the stamps
    // come back only if every quantity did. A line with none reads under the draft's own day, as it would anywhere, until the next
    // keystroke stamps it.
    if (back > 0 && back === typedLines) {
      for (const [id, day] of Object.entries(days)) if (!(id in pending.days)) pending.days[id] = day;
    }
    saveJournal();
    return anyLine;
  }

  // A line typed on this page beats what the last page left for it, whatever comes later.
  function forgetRestored(id: string, fields: readonly Field[]) {
    const left = restored?.entries[id];
    if (!restored || !left) return;
    for (const field of fields) { delete left.row[field]; delete left.base[field]; }
    if (left.air) left.air = left.air.filter(seen => !fields.some(field => field in seen));
    if (isEmpty(left.row)) delete restored.entries[id];
  }

  // Claim exactly what differs from the server now, and note it before anything else can happen.
  function claim(entries: DraftEntries, days: DraftDays) {
    if (journal && !opened) open();   // first, so that typing can take a line out of what it finds
    pending = differences(entries, days);
    if (restored) {
      for (const [id, row] of Object.entries(pending.entries)) {
        if (GROUP.some(field => field in row)) forgetRestored(id, GROUP);
        if ('stock' in row) forgetRestored(id, ['stock']);
      }
      for (const id of Object.keys(pending.days)) delete restored.days[id];
    }
    saveJournal(true);
  }

  // The debounced autosave. ⚠️ The timer sends `pending`, never what it was armed with. It is the ONE write with no caller to hand
  // a rejection to, so it catches its own: an unhandled refusal let somebody keep typing an order that was no longer being saved
  // anywhere.
  function armSave() {
    waiting = true;
    disarm();
    timer = deps.setTimer(() => {
      timer = null;
      if (!waiting) return;
      saveNow()
        .then(() => deps.onResult(true))
        .catch((err: unknown) => {
          console.error('Draft autosave failed:', err);
          deps.onResult(false);
        });
    }, SAVE_DELAY_MS);
  }

  // The first answer of the SERVER while a note waits: judge it. A failed read of the orders asks again later (a tablet can stay
  // open for days); lines that came back are drawn and sent after the pause, like typing.
  function settleSoon() {
    if (!journal || !restored || settleBusy || closed) return;
    settleBusy = true;
    void settleRestored().then(cameBack => {
      if (cameBack === null) {
        deps.setTimer(() => { settleBusy = false; settleSoon(); }, ORDERS_RETRY_MS);
        return;
      }
      settleBusy = false;
      if (!cameBack) return;
      journal.onCameBack(view());
      armSave();
    });
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
    const answer = deps.save(payload);
    const settled = answer.then(() => undefined, () => undefined);
    answers.add(settled);
    void settled.then(() => { answers.delete(settled); });
    return answer.then(() => {
      land();
      refused.length = 0;
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
        // ⚠️ NEVER WHILE A LATER WRITE STILL CARRIES THE FIELD: 5, then 0, then 5 again, and the first 5 landing would release the
        // last one, leaving the 0 to win.
        if (group.length > 0 && !group.some(field => inAir(id, field)) && group.every(field => held[field] === row[field])) {
          for (const field of group) delete held[field];
        }
        if ('stock' in held && !inAir(id, 'stock') && held.stock === row.stock) delete held.stock;
        if (isEmpty(held)) delete pending.entries[id];
      }
      for (const [id, day] of Object.entries(sent.days)) {
        if (!dayInAir(id) && pending.days[id] === day) delete pending.days[id];
      }
      saveJournal();
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
          // …or unless a later write still in the air already says something newer about it.
          const typedOver = (field === 'stock' ? 'stock' in held : groupHeld) || inAir(id, field);
          if (!typedOver) held[field] = row[field];
          delete base[field];
        }
        if (!isEmpty(held)) pending.entries[id] = held;
        if (entries[id] !== undefined) entries[id] = base as DraftEntry;
      }
      const days: MutableDays = { ...known.days };
      for (const [id, day] of Object.entries(sent.days)) {
        if (!(id in pending.days) && !dayInAir(id)) pending.days[id] = day;
        delete days[id];
      }
      known = { entries, days };
      refused.push(sent);
      saveJournal();
      throw err;
    });
  }

  // Also after a refusal with nothing typed since: leaving the section tries the refused typing once more.
  function flush(): Promise<void> {
    if (!waiting && isEmpty(pending.entries) && isEmpty(pending.days)) return Promise.resolve();
    return saveNow().then(
      () => deps.onResult(true),
      (err: unknown) => {
        deps.onResult(false);
        throw err;
      },
    );
  }

  return {
    receive(doc, meta) {
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
      // …and a snapshot that shows a claim is the end of its note (Firestore stores a write before it reports it).
      saveJournal();
      // …but anything typed here and not yet written goes back ON TOP, or the snapshot would erase it mid-keystroke.
      const drawn = view();
      // The SERVER's first word is the moment what the last page left may be judged: `known` is its word, taken in above.
      if (meta?.fromServer) settleSoon();
      return drawn;
    },

    view,

    open,

    close() { closed = true; },

    waiting: () => waiting,

    change(entries, days) {
      // Claim exactly what differs from the server now: a line put back to the server's value is released at once.
      claim(entries, days);
      armSave();
    },

    flush,

    // ⚠️ AN AUTOSAVE STILL IN THE AIR IS NOT IN THE CLAIMS that forget() wipes: landing after it, it would put a placed line
    // back in the baseline, or — refused — back in the claims, on screen and into the next write: ordered twice.
    async settle() {
      while (answers.size > 0) await Promise.all([...answers]);
      await flush();
    },

    // ⚠️ A REFUSED CHANGE IS STILL UNSAVED: it lives only here (Firestore took its copy back), so a self-started reload
    // must not throw it away (rule 2 of every screen).
    hasUnsaved: () => waiting || flights.length > 0 || !isEmpty(pending.entries) || !isEmpty(pending.days),

    saving: () => flights.length > 0,

    // ⚠️ ALL THREE COPIES, OR THE LINES COME BACK (draft.js forgetKnown):
    //   • `pending`: re-applied over every snapshot, so a quantity left there after its order was recorded would reappear on
    //     screen and be ordered a second time;
    //   • `known`: until the clear's snapshot arrives the baseline would still hold the old quantity, so typing that SAME
    //     number again would read as unchanged and never be sent;
    //   • the last snapshot: the screen draws from it, and the clear's own snapshot may come a moment later.
    // Called AFTER the record is written and BEFORE the clear: if the clear is refused, Firestore's take-back snapshot puts
    // the lines back on screen, which is the truth (they are still in the draft) and is said by the caller.
    forget(ingredientIds, supplierIds, { quantitiesOnly = false } = {}) {
      const entries: MutableEntries = { ...known.entries };
      const stored = (lastDoc?.entries && typeof lastDoc.entries === 'object' ? lastDoc.entries : {}) as Record<string, DraftEntry>;
      const shown: Record<string, DraftEntry> = { ...stored };
      for (const id of ingredientIds) {
        const held = pending.entries[id];
        // ⚠️ WHEN A CLEAR STARTS, NOT WHEN IT LANDS: on a weak connection the server's first answer can come while the clear is in
        // the air, and what the last page left would then come back over it (draft.js forgetRestoredPaths). The quantity group
        // only for «Clear quantities»: the stock reading stays.
        if (quantitiesOnly) forgetRestored(id, GROUP);
        else if (restored) delete restored.entries[id];
        if (quantitiesOnly) {
          // The stock reading stays this phone's to send if it was typed here and not yet sent.
          if (held) {
            for (const field of GROUP) delete held[field];
            if (isEmpty(held)) delete pending.entries[id];
          }
          const keep = (row: DraftEntry | undefined) => (Number(row?.stock) > 0 ? { stock: row?.stock } : undefined);
          const base = keep(entries[id]);
          if (base) entries[id] = base; else delete entries[id];
          // Nothing ordered and nothing on the shelf is not a line at all — what Firestore does when the last key of a map
          // is deleted.
          const row = keep(shown[id]);
          if (row) shown[id] = row; else delete shown[id];
        } else {
          delete pending.entries[id];
          delete entries[id];
          delete shown[id];
        }
      }
      const days: MutableDays = { ...known.days };
      const shownDays = daysOf(lastDoc?.days);
      for (const id of supplierIds) {
        delete pending.days[id];
        delete days[id];
        delete shownDays[id];
      }
      known = { entries, days };
      if (lastDoc) lastDoc = { ...lastDoc, entries: shown, days: shownDays };
      if (restored) for (const id of supplierIds) delete restored.days[id];
      saveJournal();
      return view();
    },
  };
}
