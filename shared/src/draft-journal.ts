// draft-journal.ts — this device's own note of what was typed on Orders and has not yet reached Firestore's queue, so
// leaving the page at the wrong moment cannot lose it.
//
// TypeScript port of js/orders/draft-journal.js for Mise 2 (F-15 in docs/parity/orders.md), FULL and paired
// (parity.spec.ts; draft-journal.spec.ts runs every case against both files). app/src/orders/draftSync.ts decides what
// the note holds and when it may be sent.
//
// WHY. A change waits 0.8 s (the autosave pause) and then for Firestore's queue, which on a freshly opened page is busy for
// about 5 s more (measured on the lab tablet, 302 ingredients: +4.5–5.5 s, against +0.95 s on a settled page). Until the
// write is in the browser's database it exists only in this page's memory: a reload, a closed Chrome or the tablet going
// off threw it away for good. This note is written in the same keystroke, and localStorage is synchronous, so it is
// already safe when the next thing happens.
//
// THE SHAPE. `entries[id] = { row, base }`, `days[supplierId] = { day, base }`: `row`/`day` is the claim, `base` what the
// server held for those same fields when this device last heard from it. The base is what makes it safe to send later: a
// line that no longer reads like the base was changed by somebody else meanwhile, and their word wins. An entry may also
// hold `air`: what writes in the air said that the claim has corrected. Each may be in Firestore's queue and so land after
// the page has gone, so reading like one of them is not a colleague's doing either.
//
// ⚠️ NOT IN KEEP_PREFIXES (local-data.ts), ON PURPOSE: signing out or switching venue wipes it. It is one venue's order on
// a device that may be shared, and signing out already throws away Firestore's own queue of unsent writes.
//
// ⚠️ IT TRUSTS NOTHING IT READS. Storage can hold anything (another version of the app, a half-written value, another
// venue's note): every refusal reads as «nothing to bring back».

import { toISODate } from './day';

export const DRAFT_JOURNAL_KEY = 'orders-draft-claims';
export const DRAFT_JOURNAL_VERSION = 1;

// A number typed in the evening comes back in the morning; one typed before a weekend does not.
export const DRAFT_JOURNAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Two phones' clocks can disagree: an order placed this long BEFORE the note still counts as after. Wrong in the safe
// direction: a number is dropped, never ordered twice.
export const CLOCK_MARGIN_MS = 2 * 60 * 1000;
// An order is filed under the day its lines were FOR, which can be before the day it is placed.
export const HISTORY_LOOK_BACK_DAYS = 7;

// The fields of a draft line, as the note holds them.
export interface NotedFields {
  qty?: number;
  stock?: number;
  unit?: string;
  supplierId?: string;
}
export interface NotedLine {
  row: NotedFields;
  base: NotedFields;
  air?: NotedFields[];
}
export interface NotedDay {
  day: string;
  base: string;
}
export interface DraftJournal {
  at: number;
  entries: Record<string, NotedLine>;
  days: Record<string, NotedDay>;
}

// The three calls of localStorage the note makes. shared/ compiles without DOM types.
export interface JournalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): JournalStorage | null {
  try {
    return (globalThis as { localStorage?: JournalStorage }).localStorage || null;
  } catch {
    return null;
  }
}

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const isText = (value: unknown): value is string => typeof value === 'string';
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// Only the fields a draft line has, each of the right type; anything else makes the side unusable.
function cleanFields(source: unknown): NotedFields | null {
  if (!isPlainObject(source)) return null;
  const out: NotedFields = {};
  for (const field of ['qty', 'stock'] as const) {
    if (field in source) {
      const value = source[field];
      if (!isCount(value)) return null;
      out[field] = value;
    }
  }
  for (const field of ['unit', 'supplierId'] as const) {
    if (field in source) {
      const value = source[field];
      if (!isText(value)) return null;
      out[field] = value;
    }
  }
  return Object.keys(out).length ? out : null;
}

// What this device noted, or null. A note that cannot be used is removed, not left to be read again.
export function readJournal(
  lid: string,
  now: number = Date.now(),
  storage: JournalStorage | null = defaultStorage(),
): DraftJournal | null {
  if (!storage || !lid) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(DRAFT_JOURNAL_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  const drop = (): null => {
    try {
      storage.removeItem(DRAFT_JOURNAL_KEY);
    } catch {
      /* private mode / blocked */
    }
    return null;
  };
  let note: unknown = null;
  try {
    note = JSON.parse(raw);
  } catch {
    return drop();
  }
  if (!isPlainObject(note) || note.v !== DRAFT_JOURNAL_VERSION || note.lid !== lid) return drop();
  const at = note.at;
  if (typeof at !== 'number' || !Number.isFinite(at) || now - at > DRAFT_JOURNAL_MAX_AGE_MS) return drop();

  const entries: Record<string, NotedLine> = {};
  for (const [id, claim] of Object.entries(isPlainObject(note.entries) ? note.entries : {})) {
    const line = isPlainObject(claim) ? claim : {};
    const row = cleanFields(line.row);
    const base = cleanFields(line.base);
    if (!row || !base) continue;
    entries[id] = { row, base };
    const air = (Array.isArray(line.air) ? line.air : []).map(cleanFields).filter((seen): seen is NotedFields => Boolean(seen));
    if (air.length) entries[id].air = air;
  }
  const days: Record<string, NotedDay> = {};
  for (const [id, claim] of Object.entries(isPlainObject(note.days) ? note.days : {})) {
    const stamp = isPlainObject(claim) ? claim : {};
    if (isText(stamp.day) && stamp.day && isText(stamp.base)) days[id] = { day: stamp.day, base: stamp.base };
  }
  if (!Object.keys(entries).length && !Object.keys(days).length) return drop();
  return { at, entries, days };
}

// Replace the note. Nothing to remember removes it. Never throws: a full or blocked storage must not stop anybody typing,
// the write to Firestore still goes.
export function writeJournal(
  lid: string,
  { at, entries, days }: DraftJournal,
  storage: JournalStorage | null = defaultStorage(),
): void {
  if (!storage || !lid) return;
  try {
    if (!Object.keys(entries).length && !Object.keys(days).length) {
      storage.removeItem(DRAFT_JOURNAL_KEY);
      return;
    }
    storage.setItem(DRAFT_JOURNAL_KEY, JSON.stringify({ v: DRAFT_JOURNAL_VERSION, lid, at, entries, days }));
  } catch {
    // Quota or blocked: never log the data. The older note goes, it no longer says what is claimed.
    try {
      storage.removeItem(DRAFT_JOURNAL_KEY);
    } catch {
      /* blocked */
    }
  }
}

// Take one line out of the note: its ingredient has been deleted. For a page that holds no note of its own (the
// suppliers' screens), and only that line: the rest is still somebody's typing.
export function dropNotedLine(lid: string, id: string, storage: JournalStorage | null = defaultStorage()): void {
  const note = readJournal(lid, Date.now(), storage);
  if (!note || !(id in note.entries)) return;
  delete note.entries[id];
  writeJournal(lid, note, storage);
}

// The first day whose orders can have been placed after `at` (the `date` of orders-history).
export function historyLookBackDay(at: number): string {
  return toISODate(new Date(at - HISTORY_LOOK_BACK_DAYS * 24 * 60 * 60 * 1000));
}

// The ingredients that some order placed since `at` names. From each send, not from the record's total, and not from its
// updatedAt: confirming a delivery next week orders nothing. Nor from a correction made in History (`kind: 'edit'`), which
// lists the WHOLE record and orders nothing either.
export function orderedSince(records: readonly unknown[] | null | undefined, at: number): Set<string> {
  const ids = new Set<string>();
  for (const value of records || []) {
    const record = (isPlainObject(value) ? value : {}) as Record<string, unknown>;
    // A record from before `sends` existed is one order, placed when it was created.
    const sends: unknown[] = record.sends && typeof record.sends === 'object'
      ? Object.values(record.sends as Record<string, unknown>)
      : [{ at: record.createdAt, quantities: record.quantities }];
    for (const raw of sends) {
      const send = (isPlainObject(raw) ? raw : {}) as Record<string, unknown>;
      const when = Date.parse(send.at as string);
      if (send.kind === 'edit' || !(when >= at - CLOCK_MARGIN_MS)) continue;
      // As the original reads it, odd inputs included (Object.entries of whatever is there).
      for (const [id, qty] of Object.entries((send.quantities || {}) as object)) if (Number(qty) > 0) ids.add(id);
    }
  }
  return ids;
}
