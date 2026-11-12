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
import {
  DRAFT_JOURNAL_MAX_AGE_MS, historyLookBackDay, orderedSince, readJournal, writeJournal,
} from '@mise/shared/draft-journal';
import type { DraftJournal, JournalStorage, NotedFields, NotedLine } from '@mise/shared/draft-journal';
import { readRefusedNote, writeRefusedNote } from './refusedNote';
import type { RefusedNote } from './refusedNote';

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
  // The suppliers closed as «not ordered» (drafts/current.skipped, { supplierId: 'YYYY-MM-DD' }), as the server last said.
  // Written on their own, never by the autosave (ordersSource.setSupplierSkipped); only the day counts (reminders skippedOn).
  readonly skipped: DraftDays;
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
  // The note that outlives the page (F-15, @mise/shared/draft-journal). Absent: nothing is noted (a spec of the sync alone).
  journal?: DraftJournalDeps;
}

// What the note needs from the page around it.
export interface DraftJournalDeps {
  // The open venue: the note is one venue's.
  readonly venue: string;
  // localStorage, or null where it is blocked (private mode): the note is then simply not kept.
  storage(): JournalStorage | null;
  // The note's clock (ms).
  now(): number;
  // orders-history from `fromDay` ('YYYY-MM-DD') onwards, read from the SERVER, never from the phone's copy; REJECTS when the
  // server cannot be reached (the note then waits).
  ordersSince(fromDay: string): Promise<readonly unknown[]>;
  // Asks again later, when the orders could not be read.
  retryLater(run: () => void, ms: number): void;
  // Lines came back from the note: what the screens draw now. The section can then look again for orders never placed.
  onCameBack(view: DraftView): void;
  // ── A write the server refused after the section closed (item 6 of docs/mise2-port-owed.md, refusedNote.ts) ──
  // The signed-in person's uid: such a write is noted for this venue AND this person. Absent or '': not noted.
  readonly person?: string;
  // An earlier opening noted a refusal nobody has been told about: the section says so now (once).
  onRefusedEarlier?(): void;
  // Lines refused after an earlier opening closed are back on screen, held as a refusal on this opening would hold them:
  // what the screens draw now.
  onRefusedBack?(view: DraftView): void;
  // A refusal was just noted after the section closed: an opening of Orders already on screen looks at once (lookForRefused).
  refusedNoted?(): void;
}

// Debounce to limit Firestore writes (P14): one write per pause in the typing, never one per keystroke.
export const SAVE_DELAY_MS = 800;
// A tablet can stay open for days: «the next open» may be far away, so orders that could not be read are asked for again.
export const ORDERS_RETRY_MS = 30_000;

export const EMPTY_DRAFT: DraftView = Object.freeze({
  entries: Object.freeze({}), days: Object.freeze({}), skipped: Object.freeze({}), updatedAt: '', exists: false,
});

export interface DraftSync {
  // A snapshot of drafts/current arrived (null = no document): it becomes the baseline, and what this phone typed and the
  // server has not confirmed goes back ON TOP. Returns what the screens draw.
  // `fromServer`: the SERVER sent it (not the phone's own copy). The first such snapshot is what a note left by the last page
  // waits for (F-15).
  receive(doc: Readonly<Record<string, unknown>> | null, fromServer?: boolean): DraftView;
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
  // Sends a change still waiting for its pause NOW, and reports it as an autosave does (the page went out of sight: F-15).
  // Nothing waiting, nothing sent.
  sendWaiting(): void;
  // The section closed (stopJournal) or opened again (startJournal): see `journalLive` below. A sync without a journal ignores
  // both.
  stopJournal(): void;
  startJournal(): void;
  // Reads what earlier openings had refused after they closed (refusedNote.ts): said once, then judged on the server's word and
  // handed back as a refusal. Called by startJournal, and again when another opening has just noted one.
  lookForRefused(): void;
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

  // ── What survives this page (F-15, the current app's js/orders/draft.js) ─────────────────────────────────────────────
  //
  // ⚠️ `pending` DIES WITH THE PAGE. Measured on the lab tablet in the current app: on a freshly opened page a write reaches
  // Firestore's queue about 5 s after the keystroke, and a reload before that lost the number for good. So every claim is
  // also noted on this device, in the same keystroke (@mise/shared/draft-journal), until a snapshot shows it: Firestore only
  // reports a write after storing it in the browser's database, so from then on the queue answers for it. A correction stays
  // noted until the writes it corrects have landed too.
  //
  // ⚠️⚠️ THE NOTE IS NEVER SENT BLIND, AND NEVER ON THE WORD OF THE OFFLINE COPY. It can be hours old by the time the page
  // opens, and the copy on this device may not know that a colleague has placed that order: sending it then would put back
  // quantities of an order already placed, the very hole `pending` was rebuilt to close. So what the last page left waits in
  // `restored`, off the screen and out of every save, until the SERVER has answered (settleRestored).
  const journal = deps.journal;
  let journalOpen = false; // read once, at the first snapshot or keystroke: only then is a venue certainly open
  let journalAt = 0; // when the note was last typed into: what its 24 hours count from
  let restored: DraftJournal | null = null; // what the last page left, while the server has not answered
  let settleStarted = false;
  // ⚠️ ONLY AN OPEN SECTION OWNS THE NOTE (code review, 8 Nov 2026). Mise 2 is one page: the store, and this sync with it,
  // outlives a closed Orders until its last write is answered, and Orders opened again reads the same note in a new store.
  // A closed one judging the note on its frozen copy of the draft (a 30 s retry, an order read still on its way) wrote an old
  // number back over a colleague's, over a correction or over a «Clear quantities»; rewriting the note whole from its own
  // memory erased what the open one had just noted. So once stopped it judges nothing, brings nothing back and never writes the
  // note whole: a write answered after the stop only takes its own fields out of the stored note (releaseStored). `epoch` tells
  // a check that began before the stop.
  let journalLive = true;
  let epoch = 0;
  // Writes the server said no to (wasRefused).
  const refused: Array<{ entries: Rows; days: MutableDays }> = [];

  // ── A write refused after the section closed (item 6 of docs/mise2-port-owed.md) ──────────────────────────────────────
  //
  // ⚠️ LEAVING ORDERS DOES NOT WAIT FOR THE SERVER (ordersStore.stop sends what waits and goes): a refusal that comes back
  // afterwards reached nobody, and the quantity was gone without a word. The current app asks «Quantità non salvata» before it
  // lets the person go. So such a refusal is noted on this device (refusedNote.ts, never in the draft journal: a refused value
  // there would be replayed at every opening), the next opening says so, and then judges it as the journal is judged — on the
  // SERVER's word and the orders placed since — and hands back what may come back exactly as a refusal on screen is handed back:
  // on screen, «not saved», out of the journal, sent with the next change or on leaving. Never sent by itself.
  const person = journal?.person ?? '';
  let refusedLeft: RefusedNote | null = null; // what earlier openings had refused, waiting for the server's word
  // The same, as read: typing takes lines out of `refusedLeft`, but every line read is judged and leaves storage.
  let refusedRead: RefusedNote | null = null;
  let refusedAsk = 0; // tells a judgement that began before a stop or a newer reading
  let serverAnswered = false; // the server's first snapshot has come since this opening started
  // What came back from that note on THIS opening. Refused again after leaving, it is final, as any refusal is final once it
  // has been tried again on leaving: it was already said, and a value that can never be saved must not come back for ever.
  const told: Array<{ entries: Rows; days: MutableDays }> = [];

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

  function openJournal() {
    if (!journal || !journalLive || journalOpen) return;
    journalOpen = true;
    const note = readJournal(journal.venue, journal.now(), journal.storage());
    if (!note) return;
    journalAt = note.at;
    restored = note;
  }

  // A write the server refused is refused again on the next open, and every save would then carry it: a note that outlived
  // the page would turn one bad line into an order that can never be saved again, for good. So it stays claimed in this
  // page, as before, but is not noted: a reload is still the way out. A saved write proves the rules accept this device
  // again, and clears the list.
  const wasRefused = (id: string, field: Field, value: unknown) =>
    refused.some(write => write.entries[id] !== undefined && write.entries[id][field] === value);

  // Bring the note up to date. `typed` says this comes from a keystroke, which restarts its 24 hours: not while something
  // from an earlier page is still in it, which keeps its own age, or a tablet used offline could carry a number past the
  // day it is allowed.
  function saveJournal(typed = false) {
    if (!journal || !journalLive) return;
    openJournal();
    if ((typed && !restored) || !journalAt) journalAt = journal.now();
    const entries: Record<string, NotedLine> = {};
    const days: Record<string, { day: string; base: string }> = {};
    if (restored) {
      for (const [id, left] of Object.entries(restored.entries)) {
        entries[id] = { row: { ...left.row }, base: { ...left.base } };
        if (left.air?.length) entries[id].air = left.air.map(seen => ({ ...seen }));
      }
      Object.assign(days, restored.days);
    }
    for (const [id, held] of Object.entries(pending.entries)) {
      const there = stored(known.entries[id]);
      const row: Record<string, number | string | undefined> = {};
      const base: Record<string, number | string> = {};
      const air: NotedFields[] = [];
      const noteFields = (fields: readonly Field[], corrected: readonly NotedFields[]) => {
        for (const field of fields) {
          row[field] = held[field];
          base[field] = there[field];
        }
        air.push(...corrected);
      };
      // ⚠️ «5 PUT BACK TO 0» MATCHES `known` UNTIL A SNAPSHOT SHOWS THE 5, BUT THE 5 MAY ALREADY BE IN FIRESTORE'S QUEUE: with
      // the page gone before the 0 left, it lands and comes back. So a claim that corrects a write in the air is noted even
      // when it matches `known`, and says what that write said, because on the next open the line can read either way
      // (stillOurs).
      const corrects = (fields: readonly Field[]): NotedFields[] => flights
        .map(flight => flight.entries[id])
        .filter((sent): sent is Row => sent !== undefined
          && fields.every(field => field in sent)
          && fields.some(field => sent[field] !== held[field])
          && fields.some(field => sent[field] !== there[field]))
        .map(sent => Object.fromEntries(fields.map(field => [field, sent[field]])) as NotedFields);
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
      entries[id] = {
        row: { ...entries[id]?.row, ...row } as NotedFields,
        base: { ...entries[id]?.base, ...base } as NotedFields,
      };
      if (seen.length > 0) entries[id].air = seen;
    }
    for (const [id, day] of Object.entries(pending.days)) {
      if (day && known.days[id] !== day && !refused.some(write => write.days[id] === day)) {
        days[id] = { day, base: known.days[id] ?? '' };
      }
    }
    writeJournal(journal.venue, { at: journalAt, entries, days }, journal.storage());
  }

  // What the last page left that `doc` still reads as it did when it was typed, or as a write it had in the air and had
  // corrected (`air`: that write reached the queue and landed). Already holding it means it arrived; holding anything else
  // means somebody changed that line meanwhile, and their word wins. The quantity group and the stock are judged apart, as
  // they are written: a colleague's shelf count says nothing about a quantity.
  function stillOurs(left: DraftJournal, doc: { entries: MutableEntries; days: MutableDays }): { entries: Rows; days: MutableDays } {
    const entries: Rows = {};
    for (const [id, { row, base, air = [] }] of Object.entries(left.entries)) {
      const there = stored(doc.entries[id]);
      const kept: Row = {};
      const sides: Field[][] = [GROUP.filter(field => field in row), 'stock' in row ? ['stock'] : []];
      for (const fields of sides) {
        if (fields.length > 0 && [base, ...air].some(seen => fields.every(field => seen[field] === there[field]))
          && fields.some(field => row[field] !== there[field])) {
          for (const field of fields) kept[field] = row[field];
        }
      }
      if (!isEmpty(kept)) entries[id] = kept;
    }
    const days: MutableDays = {};
    for (const [id, { day, base }] of Object.entries(left.days)) {
      const there = doc.days[id] ?? '';
      if (there === base && there !== day) days[id] = day;
    }
    return { entries, days };
  }

  // The server has answered, so `known` is its word. Says whether any line came back, or null when the orders could not be
  // read and the note goes on waiting.
  //
  // ⚠️⚠️ «STILL READS AS IT DID» CANNOT TELL AN UNTOUCHED LINE FROM ONE THAT WAS FILLED AND ORDERED: placing empties a line, and
  // empty is what most lines were when typed on. Worse, the note may even be for a write that did get through, in the instant
  // between Firestore storing it and telling this page. So before anything comes back the server is asked about the orders
  // themselves: a line some order has named since it was typed stays out. Read only when there is something to bring back,
  // which is rare.
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
    const asked = epoch;
    try {
      ordered = orderedSince(await journal.ordersSince(historyLookBackDay(restored.at)), restored.at);
    } catch (err) {
      if (asked !== epoch) return false;
      console.error('The orders could not be checked, the typed quantities wait:', err);
      return null;
    }
    // The section closed while the orders were read: what it holds is no longer the draft. The next opening judges the note.
    if (asked !== epoch) return false;
    // Time has passed: whatever was typed or cleared since has already been taken out of `restored`, and `known` has moved on
    // with every snapshot.
    const left = restored;
    if (!left) return false;
    const { entries, days } = stillOurs(left, known);
    restored = null;
    for (const id of Object.keys(entries)) {
      if (!ordered.has(id)) continue;
      const row = entries[id] ?? {};
      for (const field of GROUP) delete row[field];
      if (isEmpty(row)) delete entries[id];
    }
    const quantities = (rows: readonly Row[]) => rows.filter(row => GROUP.some(field => field in row)).length;
    // A correction whose line already reads as it wanted asked for nothing: it is no line dropped. ⚠️ UNLESS AN ORDER NAMES
    // IT: placing empties a line too, and that is the stamp to keep out.
    const typed = quantities(Object.entries(left.entries)
      .filter(([id, { row, air }]) => !air?.length || ordered.has(id)
        || GROUP.filter(field => field in row).some(field => row[field] !== stored(known.entries[id])[field]))
      .map(([, { row }]) => row as Row));
    const back = quantities(Object.values(entries));
    const anyLine = !isEmpty(entries);
    for (const [id, row] of Object.entries(entries)) pending.entries[id] = { ...row, ...pending.entries[id] };
    // ⚠️ A DAY STAMP MEANS NOTHING WITHOUT ITS LINES, and a line dropped here may be why: a stamp for next week left on a
    // supplier whose order has gone would date that supplier's next order too. This file does not know whose line is whose,
    // so the stamps come back only if every quantity did. A line with none reads under the draft's own day, as it would
    // anywhere, until the next keystroke stamps it.
    if (back > 0 && back === typed) {
      for (const [id, day] of Object.entries(days)) if (!(id in pending.days)) pending.days[id] = day;
    }
    saveJournal();
    return anyLine;
  }

  // Started by the first snapshot the SERVER sent once the note is open; asks again later when the orders could not be read.
  // (Not the public settle(), which waits for the writes in the air.)
  function checkNote() {
    if (!journal) return;
    const asked = epoch;
    void settleRestored().then(cameBack => {
      if (asked !== epoch) return;
      if (cameBack === null) {
        journal.retryLater(() => { if (asked === epoch) checkNote(); }, ORDERS_RETRY_MS);
        return;
      }
      if (!cameBack) return;
      journal.onCameBack(view());
      arm();
    });
  }

  // A write answered after the section closed: its fields leave the STORED note (it may be the one a newer opening wrote), and
  // nothing else of it changes. Landed, the server has them; refused, they could never be saved and would be replayed for
  // ever (wasRefused). A line typed differently since keeps its own claim.
  function releaseStored(sent: { entries: Rows; days: MutableDays }) {
    if (!journal) return;
    const note = readJournal(journal.venue, journal.now(), journal.storage());
    if (!note) return;
    for (const [id, row] of Object.entries(sent.entries)) {
      const line = note.entries[id];
      if (!line) continue;
      const sides: Field[][] = [GROUP.filter(field => field in row), 'stock' in row ? ['stock'] : []];
      for (const fields of sides) {
        if (fields.length === 0 || !fields.every(field => line.row[field] === row[field])) continue;
        const gone: readonly Field[] = fields.includes('stock') ? ['stock'] : GROUP;
        for (const field of gone) {
          delete line.row[field];
          delete line.base[field];
        }
        if (line.air) line.air = line.air.filter(seen => !gone.some(field => field in seen));
      }
      if (line.air?.length === 0) delete line.air;
      if (isEmpty(line.row)) delete note.entries[id];
    }
    for (const [id, day] of Object.entries(sent.days)) if (note.days[id]?.day === day) delete note.days[id];
    writeJournal(journal.venue, note, journal.storage());
  }

  // A line typed on this page beats what the last page left for it, whatever comes later — in the journal's note and in the
  // note of refusals alike.
  function forgetIn(note: { entries: Record<string, NotedLine> } | null, id: string, fields: readonly Field[]) {
    const left = note?.entries[id];
    if (!left || !note) return;
    for (const field of fields) {
      delete left.row[field];
      delete left.base[field];
    }
    if (left.air) left.air = left.air.filter(seen => !fields.some(field => field in seen));
    if (isEmpty(left.row)) delete note.entries[id];
  }
  const forgetRestored = (id: string, fields: readonly Field[]) => { forgetIn(restored, id, fields); };

  // A write refused after the section closed: noted for the next opening, field group by field group, with what the server
  // held when it left (`base`, for stillOurs). Not a group a later write still in the air carries (that one answers for
  // itself), and not one that already came back from this note on this opening (`told`: final).
  function noteRefused(sent: { entries: Rows; days: MutableDays }, base: { entries: Rows; days: MutableDays }) {
    if (!journal || !person) return;
    const storage = journal.storage();
    const note = readRefusedNote(journal.venue, person, journal.now(), storage)
      ?? { at: journal.now(), told: false, entries: {}, days: {} };
    let added = false;
    for (const [id, row] of Object.entries(sent.entries)) {
      const sides: Field[][] = [GROUP.filter(field => field in row), 'stock' in row ? ['stock'] : []];
      for (const fields of sides) {
        if (fields.length === 0 || fields.some(field => inAir(id, field))) continue;
        if (told.some(write => write.entries[id] !== undefined && fields.every(field => write.entries[id]?.[field] === row[field]))) continue;
        const line: NotedLine = note.entries[id] ?? { row: {}, base: {} };
        const rowOut = line.row as Row;
        const baseOut = line.base as Row;
        for (const field of fields) {
          rowOut[field] = row[field] as number | string;
          baseOut[field] = base.entries[id]?.[field] ?? (field === 'qty' || field === 'stock' ? 0 : '');
        }
        note.entries[id] = line;
        added = true;
      }
    }
    for (const [id, day] of Object.entries(sent.days)) {
      if (dayInAir(id) || told.some(write => write.days[id] === day)) continue;
      note.days[id] = { day, base: base.days[id] ?? '' };
      added = true;
    }
    if (!added) return;
    // Something new nobody has been told about.
    writeRefusedNote(journal.venue, person, { ...note, told: false }, storage);
    journal.refusedNoted?.();
  }

  // Takes what was judged out of the STORED note (an older opening may have added to it meanwhile): only the very values read.
  function releaseRefusedNote(judged: RefusedNote) {
    if (!journal) return;
    const storage = journal.storage();
    const note = readRefusedNote(journal.venue, person, journal.now(), storage);
    if (!note) return;
    for (const [id, { row }] of Object.entries(judged.entries)) {
      const line = note.entries[id];
      if (!line) continue;
      for (const field of Object.keys(row) as Field[]) {
        if (line.row[field] !== row[field]) continue;
        delete line.row[field];
        delete line.base[field];
      }
      if (isEmpty(line.row)) delete note.entries[id];
    }
    for (const [id, { day }] of Object.entries(judged.days)) if (note.days[id]?.day === day) delete note.days[id];
    writeRefusedNote(journal.venue, person, note, storage);
  }

  // The server has answered: what earlier openings had refused comes back where the line still reads as it did when the write
  // left and no order has named it since (the journal's own judge, stillOurs + orderedSince), handed back as the refusal path
  // below hands back — never over a value typed on this page or a write in the air. Says whether anything came back, or null
  // when the orders could not be read (the note then waits, and is asked again).
  async function judgeRefused(): Promise<boolean | null> {
    const left = refusedLeft;
    const read = refusedRead;
    if (!journal || !left || !read) return false;
    const asked = refusedAsk;
    const asJournal: DraftJournal = { at: left.at, entries: left.entries, days: left.days };
    let ordered = new Set<string>();
    // Read only when a line may come back, which is rare.
    if (!isEmpty(stillOurs(asJournal, known).entries)) {
      try {
        ordered = orderedSince(await journal.ordersSince(historyLookBackDay(left.at)), left.at);
      } catch (err) {
        if (asked !== refusedAsk) return false;
        console.error('The orders could not be checked, the refused quantities wait:', err);
        return null;
      }
      if (asked !== refusedAsk) return false;
    }
    // Time has passed: `known` has moved on with every snapshot, and typing or a clear has taken lines out of `left`.
    const { entries, days } = stillOurs(asJournal, known);
    refusedLeft = null;
    for (const id of Object.keys(entries)) {
      if (!ordered.has(id)) continue;
      const row = entries[id] ?? {};
      for (const field of GROUP) delete row[field];
      if (isEmpty(row)) delete entries[id];
    }
    const back: { entries: Rows; days: MutableDays } = { entries: {}, days: {} };
    for (const [id, row] of Object.entries(entries)) {
      const held: Row = pending.entries[id] ?? {};
      const groupHeld = GROUP.some(field => field in held);
      const handed: Row = {};
      for (const field of Object.keys(row) as Field[]) {
        const typedOver = (field === 'stock' ? 'stock' in held : groupHeld) || inAir(id, field);
        if (!typedOver) handed[field] = row[field] as number | string;
      }
      if (isEmpty(handed)) continue;
      Object.assign(held, handed);
      pending.entries[id] = held;
      back.entries[id] = handed;
    }
    // ⚠️ A day stamp means nothing without its lines (settleRestored): only when every refused quantity came back.
    const quantities = (rows: readonly Row[]) => rows.filter(row => GROUP.some(field => field in row)).length;
    const typed = quantities(Object.values(left.entries).map(({ row }) => row as Row));
    const backCount = quantities(Object.values(back.entries));
    if (backCount > 0 && backCount === typed) {
      for (const [id, day] of Object.entries(days)) {
        if (id in pending.days || dayInAir(id)) continue;
        pending.days[id] = day;
        back.days[id] = day;
      }
    }
    // As refused on this opening: never noted in the journal (wasRefused), and final if refused again after leaving.
    if (!isEmpty(back.entries) || !isEmpty(back.days)) {
      refused.push(back);
      told.push(back);
    }
    refusedRead = null;
    releaseRefusedNote(read);
    saveJournal();
    return !isEmpty(back.entries) || !isEmpty(back.days);
  }

  function checkRefused() {
    if (!journal || !refusedLeft || !journalLive) return;
    const asked = refusedAsk;
    void judgeRefused().then(back => {
      if (asked !== refusedAsk) return;
      if (back === null) {
        journal.retryLater(() => { if (asked === refusedAsk) checkRefused(); }, ORDERS_RETRY_MS);
        return;
      }
      if (back) journal.onRefusedBack?.(view());
    });
  }

  function lookForRefused() {
    if (!journal || !person || !journalLive) return;
    const storage = journal.storage();
    const note = readRefusedNote(journal.venue, person, journal.now(), storage);
    // A newer reading replaces the one being judged (it holds it, plus what was noted since).
    refusedAsk += 1;
    refusedLeft = note;
    refusedRead = note ? JSON.parse(JSON.stringify(note)) as RefusedNote : null;
    if (!note) return;
    if (!note.told) {
      // Marked before it is said: a second opening (or React's development mode starting twice) does not say it again.
      writeRefusedNote(journal.venue, person, { ...note, told: true }, storage);
      journal.onRefusedEarlier?.();
    }
    if (serverAnswered) checkRefused();
  }

  // What this phone's screen holds that the server does not — or will not once the writes in the air have landed.
  //
  // ⚠️ A CORRECTION MADE WHILE THE WRITE IT CORRECTS IS IN THE AIR (F-16, the current app's PR #444). Until a snapshot shows
  // that write (about 5 s on the lab tablet, on a freshly opened page), «5 put back to 0» matches `known`, so measured
  // against `known` alone it said nothing, and the 5 then landed and came back, on screen and on the server. So a field a
  // write in the air says differently is claimed too. ONLY a line and a day the screen still holds: one it has just
  // forgotten is an order placed, and a blank row written now would outlive its clear. A redraw that gives that line a
  // blank row back makes the next keystroke write it at zero: wanted, because a 5 landing after the clear would stay.
  function differences(entries: DraftEntries, days: DraftDays): { entries: Rows; days: MutableDays } {
    const rows: Rows = {};
    const ids = new Set(Object.keys(changedEntries(entries, known.entries)));
    for (const flight of flights) for (const id of Object.keys(flight.entries)) if (entries[id]) ids.add(id);
    for (const id of ids) {
      const mine = local(entries[id]);
      const theirs = stored(known.entries[id]);
      const overtaken = (field: Field) => inAir(id, field) && carried(id, field) !== mine[field];
      const row: Row = {};
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
    for (const [id, day] of Object.entries(days)) if (dayInAir(id) && dayCarried(id) !== day) claimedDays[id] = day;
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
      skipped: daysOf(doc?.skipped),
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

    // What the server held for those fields as the write leaves (before Firestore shows it here): the base a refusal after
    // the section closed is noted with (noteRefused).
    const sentBase: { entries: Rows; days: MutableDays } = { entries: {}, days: {} };
    for (const [id, row] of Object.entries(sent.entries)) {
      const there = stored(known.entries[id]);
      sentBase.entries[id] = Object.fromEntries(Object.keys(row).map(field => [field, there[field as Field]])) as Row;
    }
    for (const id of Object.keys(sent.days)) sentBase.days[id] = known.days[id] ?? '';

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
      // while this write was in the air is still this phone's, and must stay claimed. The group only as a whole. ⚠️ NEVER
      // WHILE A LATER WRITE STILL CARRIES THE FIELD (F-16): 5, then 0, then 5 again, and the first 5 landing would release
      // the last one, leaving the 0 to win.
      for (const [id, row] of Object.entries(sent.entries)) {
        const held = pending.entries[id];
        if (!held) continue;
        const group = GROUP.filter(field => field in held);
        if (group.length > 0 && !group.some(field => inAir(id, field)) && group.every(field => held[field] === row[field])) {
          for (const field of group) delete held[field];
        }
        if ('stock' in held && !inAir(id, 'stock') && held.stock === row.stock) delete held.stock;
        if (isEmpty(held)) delete pending.entries[id];
      }
      for (const [id, day] of Object.entries(sent.days)) {
        if (!dayInAir(id) && pending.days[id] === day) delete pending.days[id];
      }
      if (journalLive) saveJournal(); else releaseStored(sent);
    }, (err: unknown) => {
      land();
      // ⚠️ A REFUSED WRITE HANDS ITS TYPING BACK (parity L37: «the typing is kept»). A change made while it was in the air
      // may have dropped those fields from the claims — Firestore showed the write at once, so they matched `known` — and the
      // snapshot that takes the write back would then erase them. Each group or stock goes back unless typed over since, or
      // unless a later write still in the air already says something newer about it (F-16: a refused 5 must not come
      // back over a 0 already on its way).
      // The baseline forgets those fields too (it may hold Firestore's showing of this very write), so a keystroke before the
      // take-back arrives still counts them as this phone's.
      const entries: MutableEntries = { ...known.entries };
      for (const [id, row] of Object.entries(sent.entries)) {
        const held: Row = pending.entries[id] ?? {};
        const groupHeld = GROUP.some(field => field in held);
        const base: Record<string, unknown> = { ...(entries[id] ?? {}) };
        for (const field of Object.keys(row) as Field[]) {
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
      if (journalLive) saveJournal();
      else {
        // ⚠️ THE SECTION IS GONE, SO NOBODY HEARD THIS REFUSAL: it leaves the journal (it could never be saved, and would be
        // replayed for ever) and goes to the note of refusals, which the next opening says and judges (item 6).
        releaseStored(sent);
        noteRefused(sent, sentBase);
      }
      throw err;
    });
  }

  // Send what is waiting, reporting the result. ⚠️ The timer is the ONE write with no caller to hand a rejection to, so it
  // catches its own: an unhandled refusal let somebody keep typing an order that was no longer being saved anywhere.
  function autosave() {
    saveNow()
      .then(() => deps.onResult(true))
      .catch((err: unknown) => {
        console.error('Draft autosave failed:', err);
        deps.onResult(false);
      });
  }

  function arm() {
    waiting = true;
    disarm();
    timer = deps.setTimer(() => {
      timer = null;
      if (waiting) autosave();
    }, SAVE_DELAY_MS);
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
    receive(doc, fromServer = false) {
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
      saveJournal();
      // The note waits for the SERVER's first word (never the offline copy's), and is judged against it.
      if (fromServer && restored && !settleStarted) {
        settleStarted = true;
        checkNote();
      }
      // So do the refusals noted after an earlier opening closed.
      if (fromServer && !serverAnswered) {
        serverAnswered = true;
        if (refusedLeft) checkRefused();
      }
      // …but anything typed here and not yet written goes back ON TOP, or the snapshot would erase it mid-keystroke.
      return view();
    },

    view,

    change(entries, days) {
      // First, so that typing can take a line out of what the last page left.
      openJournal();
      // Claim exactly what differs from the server now: a line put back to the server's value is released at once.
      pending = differences(entries, days);
      for (const note of [restored, refusedLeft]) {
        if (!note) continue;
        for (const [id, row] of Object.entries(pending.entries)) {
          if (GROUP.some(field => field in row)) forgetIn(note, id, GROUP);
          if ('stock' in row) forgetIn(note, id, ['stock']);
        }
        for (const id of Object.keys(pending.days)) delete note.days[id];
      }
      // …and note it before anything else can happen.
      saveJournal(true);
      arm();
    },

    sendWaiting() {
      if (waiting) autosave();
    },

    stopJournal() {
      journalLive = false;
      epoch += 1;
      // The refusals noted earlier, likewise: left in storage for the next opening (already said: `told`).
      refusedAsk += 1;
      refusedLeft = null;
      refusedRead = null;
      serverAnswered = false;
      // Forgotten here, not in storage: the note stays for the next opening, which reads it afresh.
      restored = null;
      journalOpen = false;
      settleStarted = false;
      journalAt = 0;
    },

    startJournal() {
      journalLive = true;
      lookForRefused();
    },

    lookForRefused,

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
      // What the last page left for these lines goes too: an order placed (or a «clear») beats a number typed before it.
      // So does what an earlier opening had refused: it must not come back over the clear.
      for (const id of ingredientIds) {
        if (quantitiesOnly) {
          forgetRestored(id, GROUP);
          forgetIn(refusedLeft, id, GROUP);
        } else {
          if (restored) delete restored.entries[id];
          if (refusedLeft) delete refusedLeft.entries[id];
        }
      }
      for (const note of [restored, refusedLeft]) if (note) for (const id of supplierIds) delete note.days[id];
      const entries: MutableEntries = { ...known.entries };
      const stored = (lastDoc?.entries && typeof lastDoc.entries === 'object' ? lastDoc.entries : {}) as Record<string, DraftEntry>;
      const shown: Record<string, DraftEntry> = { ...stored };
      for (const id of ingredientIds) {
        const held = pending.entries[id];
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
      saveJournal();
      return view();
    },
  };
}
