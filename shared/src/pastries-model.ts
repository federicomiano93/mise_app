// pastries-model.ts — everything the Pastries feature knows how to reason about,
// with nothing it can reason about a screen or a database with.
//
// TypeScript port of js/pastries/pastries-model.js for Mise 2. Behaviour is identical, input for
// input: pastries-model.spec.ts runs every test against BOTH files and odd-inputs.spec.ts feeds
// both the same strange values. The comments below are the ones the original paid for in bugs.
//
// ⚠️ A PARTIAL PORT, SO parity.spec.ts DOES NOT PAIR IT. The original also exports weekdayLabel and
// weekdayShortLabel, which look a word up in the interface dictionary (js/i18n.js). In Mise 2 the
// dictionary belongs to the app (app/src/i18n/), and shared/ is pure logic that must run on the
// server too, so those two are NOT here: the app keeps its own lookup, keyed by the weekday id.
// pastries-model.spec.ts pins that the two files export the same names otherwise.
//
// PURE by design: no DOM, no Firebase, no localStorage, and — importantly — no
// Date.now() inside any function. Every entry point takes `nowMs`, so the one
// behaviour that is impossible to observe by hand (what the screen shows at 1am)
// can be asserted in a test at any hour, in any timezone, on any machine.
//
// The feature is seven lists, one per weekday: what has to be put to prove
// tonight for tomorrow's service.

// ── The vocabulary ───────────────────────────────────────────────────────────
// Monday-first, because that is how a week is read on a wall planner. JS's own
// getDay() is Sunday-first, so every conversion between the two goes through the
// (+6) % 7 shift below and nowhere else.
//
// The NAMES are deliberately the same strings the Orders feature stores in
// supplier orderDays/deliveryDays. A second weekday vocabulary in one database
// is a bug waiting for the day someone compares them.
//
// ⚠️⚠️ THE ID AND THE WORD ARE DIFFERENT THINGS. WEEKDAYS are Firestore document ids —
// `pastries/Monday` — so they are DATA: translate one and all seven proving lists become
// unreachable, with the app showing seven empty days and nothing anywhere saying why. A screen
// that must SAY «Lunedì» looks the word up separately, keyed BY the id (found by looking at the
// Italian screen on 13 Aug 2026: everything around the strip was Italian and the seven chips
// still read "Mon Tue Wed…", because until then the app simply printed the id). That lookup is
// the app's, not this file's — see the note at the top.
export const WEEKDAYS = Object.freeze([
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
] as const);

export type Weekday = (typeof WEEKDAYS)[number];

// The three-letter chips in English. ⚠️ A screen asks the dictionary for its short label and never
// cuts one from the full name: Italian abbreviates «mercoledì» as «mer», and slicing the first
// three letters of a translated word is the reshaping rule this project already forbids.
export const WEEKDAY_SHORT = Object.freeze([
  'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
] as const);

// ── The work day ─────────────────────────────────────────────────────────────
// A bakery's day does not end at midnight. Someone shaping pastries at 00:30 on
// Tuesday is still working Monday night's shift, and the list they need is the
// one for Tuesday — not Wednesday's. So the day rolls over at 4am, the same
// convention the Calculator already uses for its logs.
export const DAY_START_HOUR = 4;

// ── Limits ───────────────────────────────────────────────────────────────────
// MAX_ITEMS is enforced by firestore.rules too. The others cannot be: rules v2
// has no way to look inside a list, so the shape of each row is a guarantee this
// file makes and the database takes on trust.
export const MAX_ITEMS = 100;
export const MAX_NAME_LENGTH = 80;
export const MAX_QTY = 9999;

// The standing note on a day. It is one string, not a list, which is why the
// field is named `note` and not `notes` — and the name is pinned by the rules
// whitelist the moment they deploy, so it cannot be renamed casually afterwards.
export const MAX_NOTE_LENGTH = 500;

// ── The shapes ───────────────────────────────────────────────────────────────

// One pastry on one day's list.
export interface PastryItem {
  name: string;
  qty: number;
}

// One day as the screen works with it: what to prove, and the standing note.
export interface PastryDay {
  items: PastryItem[];
  note: string;
}

// What normalizeDay hands back: the day plus the weekday it is for.
export interface NormalizedDay extends PastryDay {
  day: Weekday;
}

// The whole collection: ALL SEVEN keys, always.
export type PastryDays = Record<Weekday, PastryDay>;

export type InvalidProblem = 'too-many' | 'too-long' | 'duplicate' | 'no-qty' | 'qty-too-big';

// What stops a save: which rule, which row (-1 when it is the list as a whole), and its name.
export interface InvalidItems {
  problem: InvalidProblem;
  index: number;
  name: string;
}

// The first weekday, and the answer for anything that is not one. Written once, typed as a
// Weekday, because reading WEEKDAYS[0] directly types as «or undefined» under
// noUncheckedIndexedAccess even though the index is always in range.
const MONDAY: Weekday = 'Monday';

function weekdayAt(index: number): Weekday {
  return WEEKDAYS[index] ?? MONDAY;
}

// Reads one field off whatever a document turned out to be, the way `raw && raw.field` does in the
// original: anything falsy has no fields, and neither has a primitive. It never throws unless the
// field is a getter that does, which is what the original does too.
function fieldOf(raw: unknown, field: string): unknown {
  return raw ? (raw as Record<string, unknown>)[field] : undefined;
}

export function isWeekday(name: unknown): name is Weekday {
  return typeof name === 'string' && (WEEKDAYS as readonly string[]).includes(name);
}

function indexOfWeekday(day: unknown): number {
  return (WEEKDAYS as readonly unknown[]).indexOf(day);
}

// Both wrap. Sunday's next day is Monday — a week has no end.
export function nextWeekday(day: unknown): Weekday {
  const i = indexOfWeekday(day);
  return i === -1 ? weekdayAt(0) : weekdayAt((i + 1) % 7);
}

export function previousWeekday(day: unknown): Weekday {
  const i = indexOfWeekday(day);
  return i === -1 ? weekdayAt(0) : weekdayAt((i + 6) % 7);
}

// Which work day a moment belongs to.
//
// ⚠️ THE FOUR HOURS ARE SUBTRACTED WITH setHours, NEVER FROM THE TIMESTAMP.
// `new Date(ms - 4 * 3600 * 1000)` looks equivalent and is wrong on BOTH
// clock-change Sundays, in opposite directions: a local day is 23 or 25 hours
// long there, so a fixed four-hour slice of milliseconds lands in the wrong
// place. Measured, not assumed (Europe/London and Europe/Rome share these dates):
//
//   Sun 25 Oct 2026 03:30 — ms says Sunday, correct is SATURDAY
//                           (03:30 is before 4am, so it is still the night before)
//   Sun 29 Mar 2026 04:30 — ms says Saturday, correct is SUNDAY
//                           (04:30 is past 4am, so the new work day has started)
//
// setHours works on the local calendar, which is the thing actually being asked
// about. It also makes this function correct in a zone with no DST at all, which
// is what CI runs in — so the tests below hold everywhere.
//
// ⚠️ A QUIRK OF THE ORIGINAL, KEPT ON PURPOSE (found while porting it, 11 Oct 2026). A finite
// timestamp beyond what a Date can hold (more than 8.64e15 ms from 1970, or within four hours of
// that edge) makes `d` invalid, getDay() NaN, and the original answers `undefined` — not a weekday,
// and provingDayFor then answers Monday. This port answers the same, so the two apps
// cannot disagree; the type says Weekday because no clock can produce such a timestamp. The fix
// (fall back to Monday, like every other function here) belongs in BOTH files at once:
// odd-inputs.spec.ts feeds both these timestamps and will fail until they agree.
export function workWeekday(nowMs: unknown): Weekday {
  const ms = Number(nowMs);
  const d = new Date(Number.isFinite(ms) ? ms : 0);
  d.setHours(d.getHours() - DAY_START_HOUR);
  return WEEKDAYS[(d.getDay() + 6) % 7] as Weekday;
}

// The day the screen opens on: the one being proved FOR, which is the day after
// the work day currently under way.
export function provingDayFor(nowMs: unknown): Weekday {
  return nextWeekday(workWeekday(nowMs));
}

// A quantity, made safe to store.
//
// ⚠️ A number field happily accepts `1e999`, which is Infinity, and Firestore
// REFUSES a non-finite number — so one keystroke would break every save that
// followed while the row on screen looked perfectly ordinary. Anything that is
// not a usable whole number becomes 0, which findInvalidItems then reports as a
// missing quantity: the person is told, rather than the save failing later.
//
// There is deliberately NO upper clamp here. Quietly turning a typed 50000 into
// 9999 would store a number nobody chose — the same objection that stops an
// over-long NAME being truncated on the way in. An absurd quantity is caught by
// findInvalidItems instead, which can point at the row and say so.
export function wholeNumber(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function normalizeItem(raw: unknown): PastryItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rawName = fieldOf(raw, 'name');
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!name) return null;
  return { name: name.slice(0, MAX_NAME_LENGTH), qty: wholeNumber(fieldOf(raw, 'qty')) };
}

// A standing note, made safe to store and to show. Anything that is not a string
// becomes '' — a day with no note and a day whose note field is corrupt look the
// same on screen, which is the honest answer in both cases.
//
// Trailing whitespace is trimmed but the INNER line breaks are kept: a note is
// written in lines ("check the fridge / butter is low") and flattening it would
// change what someone wrote.
export function cleanNote(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, MAX_NOTE_LENGTH);
}

// Move one row's quantity, keyed by index AND checked by name.
//
// ⚠️ THE NAME CHECK IS THE POINT. The day view lets someone type a number and
// confirm it minutes later, and a snapshot from another phone can reorder or
// replace the rows in between. An index alone would then write the number onto
// whatever row had slid into that position. Returns null when the row is no
// longer the one that was typed into, so the caller can say so instead of
// quietly changing the wrong pastry.
//
// Comparison is case-insensitive and trimmed, matching how findInvalidItems
// decides two rows are the same pastry.
//
// A list of PastryItem comes back as a list of PastryItem; the second signature is for the odd
// inputs the original tolerates (anything that is not a list is refused with null).
export function setQuantityAt(
  items: readonly PastryItem[], index: number, qty: unknown, expectedName: unknown,
): PastryItem[] | null;
export function setQuantityAt(
  items: unknown, index: unknown, qty: unknown, expectedName: unknown,
): unknown[] | null;
export function setQuantityAt(
  items: unknown, index: unknown, qty: unknown, expectedName: unknown,
): unknown[] | null {
  if (!Array.isArray(items)) return null;
  const rows: unknown[] = items;
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= rows.length) return null;
  const row = rows[i];
  const rowName = fieldOf(row, 'name');
  if (!row || typeof rowName !== 'string') return null;
  const wanted = typeof expectedName === 'string' ? expectedName.trim().toLowerCase() : null;
  if (wanted === null || rowName.trim().toLowerCase() !== wanted) return null;
  const next = rows.slice();
  next[i] = { name: rowName, qty: wholeNumber(qty) };
  return next;
}

// One stored day document → the shape the rest of the feature works with.
// Never throws: a missing document, a corrupt field and a document that was
// never written all have to come back as an empty day, because that is what the
// screen shows on the days nobody has filled in yet.
//
// ⚠️ THE MAX_ITEMS TRUNCATION HERE IS LOAD-BEARING, and it is on the READ side
// on purpose. Without it a document that somehow carried more rows than the cap
// would display perfectly, accept one more row, and then have every single save
// refused by the rules — with nothing on screen able to explain why. Truncating
// on the way in means what you see is always something you can save.
export function normalizeDay(raw: unknown, dayId?: unknown): NormalizedDay {
  // The stored `day` field is only read when the id is no use, as in the original.
  let day: Weekday;
  if (isWeekday(dayId)) {
    day = dayId;
  } else {
    const storedDay = fieldOf(raw, 'day');
    day = isWeekday(storedDay) ? storedDay : weekdayAt(0);
  }
  const stored = fieldOf(raw, 'items');
  const list: unknown[] = Array.isArray(stored) ? stored : [];
  const items: PastryItem[] = [];
  for (const entry of list) {
    const item = normalizeItem(entry);
    if (item) items.push(item);
    if (items.length >= MAX_ITEMS) break;
  }
  return { day, items, note: cleanNote(fieldOf(raw, 'note')) };
}

// The whole collection → { Monday: { items, note }, …, Sunday: { items, note } }.
//
// ⚠️ THE VALUE IS AN OBJECT, NOT THE ITEMS ARRAY. It was the bare array until the
// standing note existed. Anything reading a cached copy written by an older
// version has to cope with both — see fromStored() in pastries-store.js, and
// daysFromCache below.
//
// ALL SEVEN KEYS, ALWAYS. The screen can be asked for any weekday at any moment,
// including the five nobody has ever filled in, and a caller that has to guard
// every lookup will eventually forget one.
//
// A document whose id is not a weekday is IGNORED rather than rendered: the
// rules refuse to create one, so its presence would mean something has gone
// wrong, and inventing an eighth day on screen is not the way to report that.
// Where the id and the stored `day` field disagree, the ID WINS — it is the one
// the rules pin, and it is the one that decides which list was being written.
export function normalizeDays(docs: unknown): PastryDays {
  // Every key is filled in on the next line, so the cast only tells the compiler what is true.
  const out = {} as PastryDays;
  WEEKDAYS.forEach(day => { out[day] = { items: [], note: '' }; });
  if (!Array.isArray(docs)) return out;
  for (const doc of docs as unknown[]) {
    const id = fieldOf(doc, 'id');
    if (!doc || !isWeekday(id)) continue;
    const { items, note } = normalizeDay(doc, id);
    out[id] = { items, note };
  }
  return out;
}

// A localStorage mirror → the same shape a Firestore read produces.
//
// ⚠️ IT ACCEPTS TWO SHAPES, AND IT HAS TO. Before the standing note existed, the
// cached value under each weekday was the ITEMS ARRAY itself; it is now
// { items, note }. A phone updating to the version that added notes reads a
// cache its PREVIOUS version wrote, and it reads it before the network answers —
// so a reader that understood only the new shape would show seven empty days on
// the first paint after every update, on every phone, once.
//
// It lives here, in the pure model, rather than inside the store, for one reason:
// here it can be tested. The store cannot be imported by a test — it reaches
// Firestore — and this is exactly the kind of migration that is never exercised
// by hand because it only happens once per device.
export function daysFromCache(raw: unknown): PastryDays {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return normalizeDays([]);
  const cache = raw as Record<string, unknown>;
  return normalizeDays(WEEKDAYS.map(day => {
    const stored = cache[day];
    if (Array.isArray(stored)) return { id: day, items: stored };          // the old shape
    return { id: day, items: fieldOf(stored, 'items'), note: fieldOf(stored, 'note') };
  }));
}

// An editor's working rows → what actually gets stored.
//
// A row with no name is DROPPED, not refused: an empty row is someone who has
// tapped "add" and not typed yet, and refusing to save because of it would make
// the button feel broken. (Same choice the recipe editor makes.) Order is
// preserved exactly — it is the order the work gets done in.
export function cleanItems(list: unknown): PastryItem[] {
  if (!Array.isArray(list)) return [];
  const out: PastryItem[] = [];
  for (const raw of list as unknown[]) {
    const item = normalizeItem(raw);
    if (item) out.push(item);
  }
  return out;
}

// What must stop a save, and why — or null when there is nothing wrong.
//
// An EMPTY LIST IS VALID. "Nothing proves on Sunday" is a real answer, and
// clearing a day is how it gets recorded.
export function findInvalidItems(list: unknown): InvalidItems | null {
  const items: unknown[] = Array.isArray(list) ? list : [];
  if (items.length > MAX_ITEMS) return { problem: 'too-many', index: -1, name: '' };

  const seen = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    const rawName = fieldOf(raw, 'name');
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!name) continue; // dropped by cleanItems, not an error

    if (name.length > MAX_NAME_LENGTH) return { problem: 'too-long', index: i, name };

    // Case-insensitive: two rows reading "Cornetti" and "cornetti" carry no more
    // information than one, and with no quantity to tell them apart the second
    // is always a slip.
    const key = name.toLowerCase();
    if (seen.has(key)) return { problem: 'duplicate', index: i, name };
    seen.set(key, i);

    // A name with no number is the one thing this list cannot be read from: the
    // whole point is knowing HOW MANY to put out. Blocked rather than saved as
    // zero, which would look deliberate on the shelf at 4am. A non-number
    // (Infinity, text, a negative) has already become 0 by this point, so it
    // lands here too and is reported the same way.
    const qty = wholeNumber(fieldOf(raw, 'qty'));
    if (qty <= 0) return { problem: 'no-qty', index: i, name };
    if (qty > MAX_QTY) return { problem: 'qty-too-big', index: i, name };
  }
  return null;
}
