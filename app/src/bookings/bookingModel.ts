// bookingModel.ts — customer bookings («Prenotazioni»), the pure half (18 Nov 2026).
//
// NEW IN MISE 2, no original in the current app. Plain TypeScript, no React, no Firebase: what a booking is, what the
// editor's working copy is, what makes it saveable, and what is written. Every bound here is firestore.rules' own
// (`match /bookings/{id}`), so a save the app lets through is one the rules accept; the rules cannot look inside the
// list of lines, so THIS is the only check each line gets.
//
// ⚠️ PERSONAL DATA (UK/EU GDPR): name, phone and, for a delivery, address. Nothing here ever logs them. There is no field
// for allergies or health: the notes say on screen not to write them there.

import { typedDecimal } from '@mise/shared/currency';
import { addDays, parseISODate, toISODate } from '@mise/shared/day';
import { bookingUnitOf, itemNamed, lineAmount } from '@mise/shared/price-list';
import type { PriceItem } from '@mise/shared/price-list';

export type BookingMode = 'pickup' | 'delivery';
export type BookingStatus = 'todo' | 'ready' | 'collected' | 'cancelled';
export type BookingUnit = 'pcs' | 'kg';

export const BOOKING_MODES: readonly BookingMode[] = ['pickup', 'delivery'];
export const BOOKING_STATUSES: readonly BookingStatus[] = ['todo', 'ready', 'collected', 'cancelled'];
export const BOOKING_UNITS: readonly BookingUnit[] = ['pcs', 'kg'];

// The rules' bounds, and the app's own for what is inside a line.
export const LIMITS = Object.freeze({
  customerName: 80,
  phone: 30,
  address: 200,
  notes: 500,
  lines: 50,
  lineName: 120,
  lineNote: 120,
  money: 100_000,
  qty: 100_000,
  number: 9999,
});

// The owner's decision (18 Nov 2026): a booking is deleted 30 days after its day. functions/booking-cleanup-model.js
// does it; the list reads no further back than this.
export const KEEP_DAYS = 30;

export type BookingLine = {
  // A line written before the price list (step 1) may name a recipe; a line from the price list names its product.
  readonly recipeId: string | null;
  readonly productId: string | null;
  // The price of ONE unit (a piece, a kilo, a pack) when the line was saved, VAT included — FROZEN: a later price list does
  // not change a booking already taken (the owner's choice, 18 Nov 2026). null for a line with no price (free text).
  readonly unitPrice: number | null;
  readonly name: string;
  readonly qty: number;
  readonly unit: BookingUnit;
  // '' when there is none (the stored line then has no `note` key).
  readonly note: string;
};

export type Booking = {
  readonly id: string;
  readonly customerName: string;
  readonly phone: string;
  readonly mode: BookingMode;
  readonly address: string;
  readonly date: string;
  readonly time: string;
  readonly lines: readonly BookingLine[];
  readonly deposit: number | null;
  readonly total: number | null;
  readonly notes: string;
  readonly status: BookingStatus;
  readonly number: number;
};

// What is written: every key the rules require but the two server stamps (the source adds them).
export type StoredLine = {
  recipeId: string | null;
  productId: string | null;
  unitPrice: number | null;
  name: string;
  qty: number;
  unit: BookingUnit;
  note?: string;
};

export type BookingData = Omit<Booking, 'id' | 'lines'> & {
  readonly lines: ReadonlyArray<StoredLine>;
};

export const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
export const TIME_RE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
// Digits, spaces and «+» only, with at least one digit: the rules' own pattern.
export const PHONE_RE = /^[0-9 +]*[0-9][0-9 +]*$/;

const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => list.some(item => item === value);

// A finite number inside [0, max], or null. Never NaN.
function moneyOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= LIMITS.money ? value : null;
}

function readLine(raw: unknown): BookingLine | null {
  if (!raw || typeof raw !== 'object') return null;
  const line = raw as Record<string, unknown>;
  const name = typeof line.name === 'string' ? line.name : '';
  const qty = typeof line.qty === 'number' && Number.isFinite(line.qty) && line.qty > 0 ? line.qty : null;
  if (name === '' || qty === null) return null;
  return {
    recipeId: typeof line.recipeId === 'string' && line.recipeId !== '' ? line.recipeId : null,
    productId: typeof line.productId === 'string' && line.productId !== '' ? line.productId : null,
    unitPrice: moneyOrNull(line.unitPrice) || null,
    name,
    qty,
    unit: line.unit === 'kg' ? 'kg' : 'pcs',
    note: typeof line.note === 'string' ? line.note : '',
  };
}

// A stored document as the screens read it, or null when it is not one the rules could have accepted (nothing is drawn
// from a malformed document; the console still shows it).
export function readBooking(id: string, data: Record<string, unknown>): Booking | null {
  const { customerName, phone, mode, date, time, status, number } = data;
  if (typeof customerName !== 'string' || customerName === '') return null;
  if (typeof date !== 'string' || !DATE_RE.test(date)) return null;
  if (typeof time !== 'string' || !TIME_RE.test(time)) return null;
  const lines = Array.isArray(data.lines) ? data.lines.map(readLine).filter((line): line is BookingLine => line !== null) : [];
  return {
    id,
    customerName,
    phone: typeof phone === 'string' ? phone : '',
    mode: isOneOf(BOOKING_MODES, mode) ? mode : 'pickup',
    address: typeof data.address === 'string' ? data.address : '',
    date,
    time,
    lines,
    deposit: moneyOrNull(data.deposit),
    total: moneyOrNull(data.total),
    notes: typeof data.notes === 'string' ? data.notes : '',
    status: isOneOf(BOOKING_STATUSES, status) ? status : 'todo',
    number: typeof number === 'number' && Number.isInteger(number) ? number : 0,
  };
}

// ── The editor's working copy ────────────────────────────────────────────────

export type DraftLine = {
  // Only for React and the focus: never stored.
  readonly key: number;
  readonly name: string;
  readonly qty: string;
  readonly unit: BookingUnit;
  readonly note: string;
  // What the stored line was, for a line opened from a saved booking: its price stays FROZEN while its name and unit do not
  // change. null for a new line.
  readonly kept: KeptLine | null;
};

export type KeptLine = {
  readonly name: string;
  readonly unit: BookingUnit;
  readonly recipeId: string | null;
  readonly productId: string | null;
  readonly unitPrice: number | null;
};

export type Draft = {
  readonly customerName: string;
  readonly phone: string;
  // null until somebody picks one: a new booking starts empty.
  readonly mode: BookingMode | null;
  readonly address: string;
  readonly date: string;
  readonly time: string;
  readonly lines: readonly DraftLine[];
  readonly deposit: string;
  readonly total: string;
  readonly notes: string;
};

export function blankLine(key: number): DraftLine {
  return { key, name: '', qty: '', unit: 'pcs', note: '', kept: null };
}

export function emptyDraft(nextKey: () => number): Draft {
  return {
    customerName: '', phone: '', mode: null, address: '', date: '', time: '',
    lines: [blankLine(nextKey())], deposit: '', total: '', notes: '',
  };
}

// A number as the editor shows it in a box: the money's decimal mark, no grouping, no trailing zeros.
export function boxNumber(value: number | null, decimal: string): string {
  if (value === null || !Number.isFinite(value)) return '';
  const text = String(Math.round(value * 1000) / 1000);
  return decimal === '.' ? text : text.replace('.', decimal);
}

export function draftFrom(booking: Booking, nextKey: () => number, decimal: string): Draft {
  return {
    customerName: booking.customerName,
    phone: booking.phone,
    mode: booking.mode,
    address: booking.address,
    date: booking.date,
    time: booking.time,
    lines: booking.lines.length > 0
      ? booking.lines.map(line => ({
        key: nextKey(), name: line.name, qty: boxNumber(line.qty, decimal), unit: line.unit, note: line.note,
        kept: { name: line.name, unit: line.unit, recipeId: line.recipeId, productId: line.productId, unitPrice: line.unitPrice },
      }))
      : [blankLine(nextKey())],
    deposit: boxNumber(booking.deposit, decimal),
    // ⚠️ A TOTAL THAT IS THE SUM OF THE LINES' OWN PRICES WAS NOT TYPED: the box stays empty, so the total keeps following the
    // lines when they are edited. A total that differs (a discount typed at the counter) is shown, and stays the typed one.
    total: booking.total !== null && booking.total === storedLinesTotal(booking.lines) ? '' : boxNumber(booking.total, decimal),
    notes: booking.notes,
  };
}

// Whether two working copies say the same thing (keys aside): what «unsaved changes» compares.
export function sameDraft(a: Draft, b: Draft): boolean {
  const lineText = (d: Draft) => JSON.stringify(d.lines.map(({ name, qty, unit, note }) => [name, qty, unit, note]));
  return a.customerName === b.customerName && a.phone === b.phone && a.mode === b.mode && a.address === b.address
    && a.date === b.date && a.time === b.time && a.deposit === b.deposit && a.total === b.total && a.notes === b.notes
    && lineText(a) === lineText(b);
}

// A typed amount of money: null for an empty box, 'invalid' for text that is not a number in [0, LIMITS.money].
// «12,5» and «12.5» are the same (typedDecimal). Rounded to cents. Never NaN.
export function parseMoney(text: string): number | null | 'invalid' {
  const clean = typedDecimal(text);
  if (clean === '') return null;
  if (!/^[0-9]+(\.[0-9]+)?$/.test(clean)) return 'invalid';
  const n = Number(clean);
  if (!Number.isFinite(n) || n < 0 || n > LIMITS.money) return 'invalid';
  return Math.round(n * 100) / 100;
}

// A typed quantity: null for an empty box, 'invalid' for anything that is not a number above zero and at most LIMITS.qty.
// Pieces are whole; kilos keep three decimals (grams).
export function parseQty(text: string, unit: BookingUnit): number | null | 'invalid' {
  const clean = typedDecimal(text);
  if (clean === '') return null;
  if (!/^[0-9]+(\.[0-9]+)?$/.test(clean)) return 'invalid';
  const n = Number(clean);
  if (!Number.isFinite(n) || n <= 0 || n > LIMITS.qty) return 'invalid';
  if (unit === 'pcs' && !Number.isInteger(n)) return 'invalid';
  const rounded = Math.round(n * 1000) / 1000;
  return rounded > 0 ? rounded : 'invalid';
}

// What is left to pay: the total less the deposit, never below zero, only when both are known.
export function toPay(total: number | null, deposit: number | null): number | null {
  if (total === null || deposit === null) return null;
  return Math.max(0, Math.round((total - deposit) * 100) / 100);
}

// A line the person did not touch at all (a blank row left at the end): dropped on Save, never an error.
const untouchedLine = (line: DraftLine): boolean => line.name.trim() === '' && line.qty.trim() === '' && line.note.trim() === '';

// Where a problem sits, in the order of the form: Save jumps to the FIRST one.
export type DraftField =
  | 'customerName' | 'phone' | 'mode' | 'address' | 'date' | 'time'
  | { readonly line: number; readonly part: 'name' | 'qty' }
  | 'deposit' | 'total';

export type DraftProblem = {
  readonly field: DraftField;
  // A message key ending of `bookings.err.*`.
  readonly reason: 'required' | 'phone' | 'noLines' | 'qty' | 'money' | 'pastDate';
};

export function fieldId(field: DraftField): string {
  return typeof field === 'string' ? field : `line-${field.line}-${field.part}`;
}

// The first problem of the working copy, or null when it can be saved. `today` is the device's day; a NEW booking for a day
// already gone is refused (an existing one keeps its day: it is being corrected, not made).
export function firstProblem(draft: Draft, { today, isNew }: { today: string; isNew: boolean }): DraftProblem | null {
  if (draft.customerName.trim() === '') return { field: 'customerName', reason: 'required' };
  const phone = draft.phone.trim();
  if (phone === '') return { field: 'phone', reason: 'required' };
  if (!PHONE_RE.test(phone) || phone.length > LIMITS.phone) return { field: 'phone', reason: 'phone' };
  if (draft.mode === null) return { field: 'mode', reason: 'required' };
  if (draft.mode === 'delivery' && draft.address.trim() === '') return { field: 'address', reason: 'required' };
  if (!DATE_RE.test(draft.date)) return { field: 'date', reason: 'required' };
  if (isNew && draft.date < today) return { field: 'date', reason: 'pastDate' };
  if (!TIME_RE.test(draft.time)) return { field: 'time', reason: 'required' };
  const used = draft.lines.map((line, index) => ({ line, index })).filter(({ line }) => !untouchedLine(line));
  if (used.length === 0) return { field: { line: 0, part: 'name' }, reason: 'noLines' };
  for (const { line, index } of used) {
    if (line.name.trim() === '') return { field: { line: index, part: 'name' }, reason: 'required' };
    const qty = parseQty(line.qty, line.unit);
    if (qty === null) return { field: { line: index, part: 'qty' }, reason: 'required' };
    if (qty === 'invalid') return { field: { line: index, part: 'qty' }, reason: 'qty' };
  }
  if (parseMoney(draft.deposit) === 'invalid') return { field: 'deposit', reason: 'money' };
  if (parseMoney(draft.total) === 'invalid') return { field: 'total', reason: 'money' };
  return null;
}

const fold = (text: string): string => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

// ── Prices (bookings step 2) ─────────────────────────────────────────────────

// What a line is priced at, and why:
//   frozen  — a saved line whose name and unit have not changed: its own stored price, whatever the list says now;
//   listed  — a name on the published price list: that price, and the list's unit (a piece and a pack in pieces, a kilo in kg);
//   none    — free text, or a saved line that had no price and is left as it was: no price, so it adds nothing to the total.
export type LinePrice =
  | { readonly kind: 'frozen'; readonly productId: string | null; readonly unitPrice: number }
  | { readonly kind: 'listed'; readonly item: PriceItem; readonly unit: BookingUnit }
  | { readonly kind: 'none' };

export function linePrice(line: DraftLine, items: readonly PriceItem[]): LinePrice {
  const kept = line.kept;
  // ⚠️ A SAVED LINE LEFT AS IT WAS KEEPS EXACTLY WHAT IT HAD — its price, or no price at all: a free-text line saved before its
  // name was put on the list must not be priced (nor its unit changed) by a Save that touched something else.
  if (kept !== null && fold(kept.name) === fold(line.name) && kept.unit === line.unit) {
    return kept.unitPrice === null ? { kind: 'none' } : { kind: 'frozen', productId: kept.productId, unitPrice: kept.unitPrice };
  }
  const item = itemNamed(line.name, items);
  return item === null ? { kind: 'none' } : { kind: 'listed', item, unit: bookingUnitOf(item.per) };
}

const unitPriceOf = (price: LinePrice): number | null =>
  price.kind === 'frozen' ? price.unitPrice : price.kind === 'listed' ? price.item.price : null;

// What a line of the working copy costs, or null when it has no price or no readable quantity.
export function draftLineAmount(line: DraftLine, items: readonly PriceItem[]): number | null {
  const price = linePrice(line, items);
  const unitPrice = unitPriceOf(price);
  if (unitPrice === null) return null;
  const qty = parseQty(line.qty, price.kind === 'listed' ? price.unit : line.unit);
  return typeof qty === 'number' ? lineAmount(qty, unitPrice) : null;
}

// The total the price list gives the working copy: the sum of its priced lines, and how many used lines have no price (they are
// not in it, and the editor says so). `total` is null when no line is priced.
export function listTotal(draft: Draft, items: readonly PriceItem[]): { readonly total: number | null; readonly unpriced: number } {
  let total = 0;
  let priced = 0;
  let unpriced = 0;
  for (const line of draft.lines) {
    if (untouchedLine(line)) continue;
    const amount = draftLineAmount(line, items);
    if (amount === null) unpriced += 1;
    else { total += amount; priced += 1; }
  }
  return { total: priced > 0 ? Math.round(total * 100) / 100 : null, unpriced };
}

// The sum of a stored booking's priced lines (null when none is priced).
export function storedLinesTotal(lines: readonly BookingLine[]): number | null {
  const priced = lines.filter(line => line.unitPrice !== null);
  if (priced.length === 0) return null;
  return Math.round(priced.reduce((sum, line) => sum + lineAmount(line.qty, line.unitPrice), 0) * 100) / 100;
}

// The total a booking will carry: what was typed in the box, else the price list's sum (null when neither).
export function effectiveTotal(draft: Draft, items: readonly PriceItem[]): number | null {
  const typed = parseMoney(draft.total);
  if (typeof typed === 'number') return typed;
  return listTotal(draft, items).total;
}

// The booking as it is written. Call only when firstProblem() is null: it clamps rather than throws, so a bad call still
// writes nothing the rules would refuse.
export function toBookingData(
  draft: Draft,
  { status, number, items }: { status: BookingStatus; number: number; items: readonly PriceItem[] },
): BookingData {
  const cut = (text: string, max: number) => text.trim().slice(0, max);
  const mode: BookingMode = draft.mode ?? 'pickup';
  const lines = draft.lines
    .filter(line => !untouchedLine(line))
    .slice(0, LIMITS.lines)
    .map(line => {
      const price = linePrice(line, items);
      // A listed product is counted in the list's unit; a frozen or free line in its own.
      const unit: BookingUnit = price.kind === 'listed' ? price.unit : line.unit;
      const qty = parseQty(line.qty, unit);
      const name = cut(line.name, LIMITS.lineName);
      const note = cut(line.note, LIMITS.lineNote);
      const sameName = line.kept !== null && fold(line.kept.name) === fold(line.name);
      const out: StoredLine = {
        // A recipe named in step 1 stays with its line while the name does not change.
        recipeId: sameName ? line.kept?.recipeId ?? null : null,
        productId: price.kind === 'frozen' ? price.productId : price.kind === 'listed' ? price.item.productId : null,
        unitPrice: unitPriceOf(price),
        name,
        qty: typeof qty === 'number' ? qty : 1,
        unit,
      };
      if (note !== '') out.note = note;
      return out;
    });
  const money = (text: string) => {
    const value = parseMoney(text);
    return typeof value === 'number' ? value : null;
  };
  return {
    customerName: cut(draft.customerName, LIMITS.customerName),
    phone: cut(draft.phone, LIMITS.phone).replace(/\s+/g, ' '),
    mode,
    // A pickup keeps no address: nothing personal is stored that the booking does not need.
    address: mode === 'delivery' ? cut(draft.address, LIMITS.address) : '',
    date: draft.date,
    time: draft.time,
    lines,
    deposit: money(draft.deposit),
    // Typed, else the price list's sum (bookings step 2: computed, and the counter may type over it).
    total: money(draft.total) ?? listTotal(draft, items).total,
    notes: cut(draft.notes, LIMITS.notes),
    status,
    number: Math.min(Math.max(1, Math.trunc(number) || 1), LIMITS.number),
  };
}

// The short number of a new booking: one more than the highest the venue holds, back to 1 after 9999. Bookings are deleted 30
// days after their day, so the numbers in use at once are few and a number comes round again only months later.
// ⚠️ TWO DEVICES OFFLINE AT ONCE CAN GIVE THE SAME NUMBER: it is a label on paper, never a key (the id is Firestore's).
export function nextNumber(bookings: readonly Booking[]): number {
  const highest = bookings.reduce((max, booking) => Math.max(max, booking.number), 0);
  return highest >= LIMITS.number ? 1 : highest + 1;
}

// ── Days ─────────────────────────────────────────────────────────────────────

export const dayAfter = (iso: string, days: number): string => toISODate(addDays(parseISODate(iso), days));

// The oldest day still kept: bookings of earlier days have been, or are about to be, deleted.
export const oldestKeptDay = (today: string): string => dayAfter(today, -KEEP_DAYS);

// The rows of a day: by time, then by number; cancelled ones last.
export function sortForDay(bookings: readonly Booking[]): Booking[] {
  return [...bookings].sort((a, b) => {
    const cancelled = Number(a.status === 'cancelled') - Number(b.status === 'cancelled');
    if (cancelled !== 0) return cancelled;
    return a.time.localeCompare(b.time) || a.number - b.number;
  });
}

export type DayGroup = { readonly date: string; readonly bookings: readonly Booking[] };

export type ListChoice =
  | { readonly kind: 'today' }
  | { readonly kind: 'tomorrow' }
  | { readonly kind: 'later' }
  | { readonly kind: 'past'; readonly date: string };

// What one choice of the list shows, as groups of a day each (one group for a single day, possibly empty).
export function groupsFor(bookings: readonly Booking[], choice: ListChoice, today: string): DayGroup[] {
  const tomorrow = dayAfter(today, 1);
  const single = (date: string): DayGroup[] => [{ date, bookings: sortForDay(bookings.filter(b => b.date === date)) }];
  if (choice.kind === 'today') return single(today);
  if (choice.kind === 'tomorrow') return single(tomorrow);
  if (choice.kind === 'past') return single(choice.date);
  const later = bookings.filter(b => b.date > tomorrow);
  const dates = [...new Set(later.map(b => b.date))].sort();
  return dates.map(date => ({ date, bookings: sortForDay(later.filter(b => b.date === date)) }));
}

// Which choice of the list a day belongs to (after a save, the list opens where the booking is).
export function choiceForDate(date: string, today: string): ListChoice {
  if (date === today) return { kind: 'today' };
  if (date === dayAfter(today, 1)) return { kind: 'tomorrow' };
  if (date > today) return { kind: 'later' };
  return { kind: 'past', date };
}

// Today's bookings still to hand over (the Home's card): not collected, not cancelled, by time.
export function stillToHandOver(bookings: readonly Booking[], today: string): Booking[] {
  return sortForDay(bookings.filter(b => b.date === today && (b.status === 'todo' || b.status === 'ready')));
}
