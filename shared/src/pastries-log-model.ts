// pastries-log-model.ts — what a record of a night's proving is.
//
// TypeScript port of js/pastries/pastries-log-model.js for Mise 2. Behaviour is identical, input
// for input: pastries-log-model.spec.ts runs every test against BOTH files and parity.spec.ts
// compares their exports. The comments below are the ones the original paid for in bugs.
//
// PURE: no DOM, no Firebase, no storage, and no Date.now() inside any function.
// Every entry point takes nowMs, so behaviour that depends on the clock can be
// asserted rather than waited for.
//
// ── NOTHING HERE DELETES, AND NOTHING IN THIS APP DOES ──────────────────────
// A record leaves the SCREEN after LOG_VISIBLE_DAYS and stays in the database
// for ever. That is the same shape as every other retention in The Italian
// Club: the Calculator's says "DISPLAY-only — the database keeps every log",
// and the Orders history's says "This HIDES, it never deletes".
//
// An earlier version of this file carried an automatic prune, with two
// thresholds and three brakes. It was REMOVED, not disabled, on Federico's
// instruction: deleting from the app by hand is fine, deleting from the
// database by hand is fine, but nothing may delete from the database on its
// own. Deleting the machinery rather than switching it off is the point — code
// that does not exist cannot be wired back up by accident.

import { WEEKDAYS, isWeekday, MAX_ITEMS } from './pastries-model';
import type { PastryItem, Weekday } from './pastries-model';

// How long a record stays on the SCREEN. It is never removed from the database.
export const LOG_VISIBLE_DAYS = 15;
export const MAX_LOG_ITEMS = MAX_ITEMS;

const DAY_MS = 86400000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// One stored record, as the screen works with it. `date` and `day` are '' only for a record that
// normalizeLog could not place, which normalizeLogs then drops.
export interface PastryLog {
  id: string;
  date: string;
  day: Weekday | '';
  items: PastryItem[];
  note: string;
  createdAt: string;
}

// What Confirm writes: always a real weekday, and stamped with when it was last written.
export interface BuiltLog extends PastryLog {
  day: Weekday;
  updatedAt: string;
}

// The work DATE a moment belongs to, as 'YYYY-MM-DD'. Same 4am roll-over as the
// weekday: a record confirmed at 00:30 on Wednesday belongs to Tuesday night.
//
// ⚠️ setHours, never a millisecond subtraction — the two disagree on both
// clock-change Sundays, in opposite directions. See pastries-model.ts.
export function workDate(nowMs: unknown): string {
  const ms = Number(nowMs);
  const d = new Date(Number.isFinite(ms) ? ms : 0);
  d.setHours(d.getHours() - 4);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function logIdFor(date: string, day: string): string {
  return `${date}_${day}`;
}

// True only for a string that is BOTH the right shape and a real calendar date.
// '2026-02-31' passes the regex and is not a day that exists.
//
// A type guard because callers hold `unknown` and need the string afterwards.
export function isRealISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) return false;
  // The pattern guarantees three numbers; the defaults only keep the destructuring honest under
  // noUncheckedIndexedAccess.
  const [y = NaN, m = NaN, d = NaN] = value.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  if (!Number.isFinite(ms)) return false;
  const back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d;
}

// Whole days from one ISO date to another, or null when either is unreadable.
// Both are read as UTC midnights, so a clock change cannot make a day 23 or 25
// hours long here and shift a count.
export function daysBetween(fromISO: unknown, toISO: unknown): number | null {
  if (!isRealISODate(fromISO) || !isRealISODate(toISO)) return null;
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

// Reads one field off whatever a document turned out to be, the way `raw && raw.field` does in the
// original: anything falsy has no fields, and neither has a primitive.
function fieldOf(raw: unknown, field: string): unknown {
  return raw ? (raw as Record<string, unknown>)[field] : undefined;
}

// How old a record is in days, or null when that cannot be established.
function ageOf(log: unknown, nowMs: unknown): number | null {
  if (!log || typeof log !== 'object') return null;
  const ms = Number(nowMs);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return daysBetween(fieldOf(log, 'date'), workDate(ms));
}

// Is this record still on the screen?
//
// The ONLY question this file asks about age, and it decides nothing about the
// database. A record that stops being visible is still there — in the Firebase
// console, in a backup, and to anyone who looks.
//
// Anything unreadable is SHOWN rather than hidden: the screen is where a person
// would notice something wrong, and hiding it would remove the only symptom.
export function isLogVisible(log: unknown, nowMs: unknown, days: number = LOG_VISIBLE_DAYS): boolean {
  const age = ageOf(log, nowMs);
  if (age === null) return true;    // unreadable: show it rather than hide it
  if (age < 0) return true;         // dated ahead of this clock: still show it
  return age <= days;
}

function normalizeLogItem(raw: unknown): PastryItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rawName = fieldOf(raw, 'name');
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!name) return null;
  const qty = Math.round(Number(fieldOf(raw, 'qty')));
  return { name, qty: Number.isFinite(qty) ? Math.max(0, qty) : 0 };
}

// One stored record → the shape the screen works with. Never throws.
//
// The id carries the date and the weekday, and it is what the rules pin, so
// where the id and the fields disagree the ID WINS — same rule as the day
// documents.
export function normalizeLog(raw: unknown, id?: unknown): PastryLog {
  const fromId = typeof id === 'string' ? id.split('_') : [];
  const idDate = fromId[0];
  const idDay = fromId[1];
  let date = '';
  if (isRealISODate(idDate)) {
    date = idDate;
  } else {
    const storedDate = fieldOf(raw, 'date');
    if (isRealISODate(storedDate)) date = storedDate;
  }
  let day: Weekday | '' = '';
  if (isWeekday(idDay)) {
    day = idDay;
  } else {
    const storedDay = fieldOf(raw, 'day');
    if (isWeekday(storedDay)) day = storedDay;
  }
  const stored = fieldOf(raw, 'items');
  const list: unknown[] = Array.isArray(stored) ? stored : [];
  const items: PastryItem[] = [];
  for (const entry of list) {
    const item = normalizeLogItem(entry);
    if (item) items.push(item);
    if (items.length >= MAX_LOG_ITEMS) break;
  }
  // ⚠️ A QUIRK OF THE ORIGINAL, KEPT ON PURPOSE (found while porting it, 11 Oct 2026). Its guard is
  // `typeof (raw && raw.note) === 'string' ? raw.note : ''`, and for a document that is the empty
  // string `raw && raw.note` is '' — a string — so the guard passes and `raw.note` is undefined:
  // note and createdAt come back undefined instead of ''. No stored record is ever an empty
  // string, so no screen can show it; it is copied rather than tidied so that odd-inputs.spec.ts
  // keeps the two files equal, and goes when the original is fixed (in both files at once).
  const holder = raw as { note?: unknown; createdAt?: unknown };
  const note = (typeof (raw && holder.note) === 'string' ? holder.note : '') as string;
  const createdAt = (typeof (raw && holder.createdAt) === 'string' ? holder.createdAt : '') as string;
  return {
    id: typeof id === 'string' ? id : '',
    date,
    day,
    items,
    note,
    createdAt,
  };
}

// A record with no readable date or weekday is DROPPED from the list rather than
// shown: it cannot be placed on a timeline. It stays in the database, where it
// can be looked at — nothing here removes anything.
export function normalizeLogs(docs: unknown): PastryLog[] {
  if (!Array.isArray(docs)) return [];
  return (docs as unknown[])
    .map(d => normalizeLog(d, fieldOf(d, 'id')))
    .filter(l => l.date && l.day);
}

// Newest first. Within a date, the weekday order is stable so two records on one
// date never swap places between paints.
//
// Anything that is not a list sorts as an empty one. The records must have a `date` and a `day`;
// whatever else they carry comes back untouched.
export function sortLogs<L extends { date: string; day: string }>(logs: readonly L[] | null | undefined): L[] {
  return [...(Array.isArray(logs) ? logs : [])].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (WEEKDAYS as readonly string[]).indexOf(a.day) - (WEEKDAYS as readonly string[]).indexOf(b.day);
  });
}

// The input of buildLog: everything is `unknown` except the weekday, because the id the rules pin
// is `${date}_${Weekday}` and a caller that passes anything else has a bug worth a compile error.
export interface BuildLogInput {
  day: Weekday;
  items: unknown;
  note: unknown;
  nowMs: unknown;
  existing?: unknown;
}

// What Confirm writes. `existing` is the record already filed for this date and
// weekday, if there is one — confirming twice in one night is a CORRECTION, so
// the record is replaced and its original createdAt is preserved.
export function buildLog({ day, items, note, nowMs, existing }: BuildLogInput): BuiltLog {
  const date = workDate(nowMs);
  const at = new Date(Number.isFinite(Number(nowMs)) ? Number(nowMs) : 0).toISOString();
  const clean: PastryItem[] = [];
  for (const entry of (Array.isArray(items) ? (items as unknown[]) : [])) {
    const item = normalizeLogItem(entry);
    if (item) clean.push(item);
    if (clean.length >= MAX_LOG_ITEMS) break;
  }
  const firstWritten = fieldOf(existing, 'createdAt');
  return {
    id: logIdFor(date, day),
    date,
    day,
    items: clean,
    // The standing note is FROZEN here: it was part of the instruction in force
    // that night, and a record showing today's note would misdescribe it.
    note: typeof note === 'string' ? note : '',
    createdAt: (typeof firstWritten === 'string' && firstWritten) || at,
    updatedAt: at,
  };
}
