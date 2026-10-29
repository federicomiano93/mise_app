// deliveries.ts — what has been ordered and has not arrived yet, and what is still to re-order because it never came.
// TypeScript FULL port of js/orders/deliveries.js for Mise 2 (step 3f-5, Incoming). Behaviour is identical, input for input:
// deliveries.spec.ts runs every test against BOTH files and parity.spec.ts pairs them.
//
// PURE: no DOM, no Firestore, so every rule below can be asserted in a test (P15).
//
// ⚠️⚠️ THE WHOLE FEATURE RESTS ON ONE DECISION: THE APP IS TOLD WHAT ARRIVED, IT DOES NOT GUESS. A supplier's `deliveryDays` say
// when a delivery is EXPECTED; they are not a record that anything turned up. Dropping an order off the list once its expected
// day has passed fails in the one direction that matters: the order nobody delivered would be the only one you never see, on a
// screen that looks perfectly healthy because it is empty. So an order leaves this list when somebody says it arrived, and never
// on its own.
//
// The second decision, Federico's, 14 Aug 2026: an ingredient that did not arrive is MARKED, never removed from the order.
// `orders-history.quantities` is the map the suggestion engine averages over, so deleting from it would quietly change what the
// app suggests for months — and destroy the evidence that the thing was ordered at all, which is what you need to chase a
// supplier.

import { historyDocId, isLegacyRecord, recordDate, wholeNumber } from './archive';
import { cleanUnit } from './order-unit';
import { addDays, isBefore, parseISODate, toISODate, weekdayOf } from './day';
import { beforeCurrentWeek, DEFAULT_WEEK_START, inCurrentWeek } from './work-week';

// How far ahead "coming" reaches. Beyond this an order is still pending, it is simply not shown as imminent.
export const AHEAD_DAYS = 7;

// How far forward to look for a supplier's next delivery day before giving up. Two weeks covers every weekly rhythm; a supplier
// that declares no days at all is answered with '' by the loop never matching.
const MAX_LOOKAHEAD = 14;

// An order record as these rules read it: everything optional, because stored documents are whatever was written.
export interface DeliveryRecord {
  readonly id?: string;
  readonly supplierId?: string;
  readonly date?: string;
  readonly weekStart?: string;
  readonly deliveredAt?: unknown;
  readonly quantities?: Readonly<Record<string, unknown>>;
  readonly units?: Readonly<Record<string, unknown>>;
  readonly missing?: Readonly<Record<string, unknown>>;
  readonly missingResolved?: Readonly<Record<string, unknown>>;
}

export interface DeliverySupplier { readonly deliveryDays?: unknown }

export interface PendingEntry<R, S> { order: R; supplier: S | null; expected: string }
export interface PendingGroups<R, S> { late: PendingEntry<R, S>[]; dueToday: PendingEntry<R, S>[]; coming: PendingEntry<R, S>[] }

export interface ReorderItem { id: string; supplierId: string | undefined; recordId: string; qty: number; missedOn: string; unit?: string }

type DraftLines = Readonly<Record<string, { readonly qty?: unknown } | undefined>> | null | undefined;

const asRecord = (r: unknown): DeliveryRecord | null | undefined => r as DeliveryRecord | null | undefined;

// Has somebody said this order arrived?
//
// ⚠️ ANY NON-EMPTY STAMP COUNTS AS DELIVERED, and an unreadable one counts as NOT delivered. The two directions are deliberate
// opposites: a corrupt value must leave the order on the list (visible, correctable) rather than making it disappear.
export function isDelivered(order?: unknown): boolean {
  const at = asRecord(order)?.deliveredAt;
  return typeof at === 'string' && at.trim() !== '';
}

// The ingredient ids that were ordered and did not arrive.
//
// ⚠️ INTERSECTED WITH `quantities`, NOT READ FROM `missing` ALONE. A `missing` entry for something the order never contained is
// meaningless — and would put a phantom row on the "still to re-order" list that no amount of ordering could clear.
export function shortfall(order?: unknown): string[] {
  const missing = asRecord(order)?.missing || {};
  const quantities = asRecord(order)?.quantities || {};
  return Object.keys(missing)
    .filter(id => missing[id] === true && wholeNumber(quantities[id]) > 0)
    .sort();
}

// When this order is expected, from the supplier's own declared delivery days.
//
// ⚠️ STRICTLY AFTER THE ORDER DATE. Ordering on a delivery day means the NEXT one: what is on today's van was decided before
// today's order existed.
//
// ⚠️ A SUPPLIER THAT DECLARES NO DELIVERY DAYS GETS '', AND THAT IS NOT AN ERROR — it means "we do not know", and the caller must
// still show the order. Treating an unknown date as "no delivery" would hide exactly the suppliers nobody has finished setting up.
export function expectedDeliveryOn(order?: unknown, supplier?: unknown): string {
  const from = recordDate(order);
  const days = (supplier as DeliverySupplier | null | undefined)?.deliveryDays;
  if (!from || !Array.isArray(days) || !days.length) return '';

  const start = parseISODate(from);
  for (let i = 1; i <= MAX_LOOKAHEAD; i++) {
    const iso = toISODate(addDays(start, i));
    if (days.includes(weekdayOf(iso))) return iso;
  }
  return '';
}

// Everything ordered and not yet confirmed, in the order the screen shows it: { late, dueToday, coming }, each entry
// { order, supplier, expected } — `expected` may be ''.
//
// ⚠️⚠️ `late` IS UNBOUNDED IN THE PAST, ON PURPOSE (within the week below). An order whose expected day went by and was never
// confirmed is the single most important row on the screen, and any window would eventually swallow it. It is also why `late` is
// listed FIRST. In practice it is bounded by what Orders reads live (HISTORY_LIVE_MONTHS, two months).
//
// ⚠️ AN ORDER WITH NO EXPECTED DATE IS NEVER "late" — we do not know that it is. It sits at the end of `coming`, visible, waiting
// for somebody to confirm it.
export function pendingDeliveries<R, S>(
  orders: readonly R[] | null | undefined,
  suppliersById: Readonly<Record<string, S>> | null | undefined,
  today: string | null | undefined,
  { aheadDays = AHEAD_DAYS, weekStartsOn = DEFAULT_WEEK_START }: { aheadDays?: number; weekStartsOn?: string } = {},
): PendingGroups<R, S> {
  const out: PendingGroups<R, S> = { late: [], dueToday: [], coming: [] };
  if (!today) return out;

  const horizon = toISODate(addDays(parseISODate(today), aheadDays));

  (orders || []).forEach(order => {
    // The pre-v179 weekly records merged every supplier into one document, so they cannot name a delivery. They stay readable in
    // History and are not deliveries.
    if (!order || isLegacyRecord(order) || isDelivered(order)) return;

    // ⚠️⚠️ THIS WINDOW IS THE FEATURE, NOT A TIDY-UP (Federico, 14 Aug 2026): without it his real venue opened this screen on 34
    // orders, the oldest from 11 July, every one marked late — the delivery fields did not exist when they were recorded. ⚠️ AND
    // WHAT FALLS OUTSIDE IS NOT DROPPED: beforeCurrentWeek() feeds unansweredBefore() below, which puts it in front of somebody.
    if (!inCurrentWeek(recordDate(order), today, weekStartsOn)) return;

    const supplierId = asRecord(order)?.supplierId;
    const supplier = (supplierId !== undefined ? suppliersById?.[supplierId] : undefined) || null;
    const expected = expectedDeliveryOn(order, supplier);
    const entry: PendingEntry<R, S> = { order, supplier, expected };

    if (!expected) { out.coming.push(entry); return; }
    if (isBefore(expected, today)) out.late.push(entry);
    else if (expected === today) out.dueToday.push(entry);
    else if (!isBefore(horizon, expected)) out.coming.push(entry);
    else out.coming.push(entry);
  });

  const byExpected = (a: PendingEntry<R, S>, b: PendingEntry<R, S>) =>
    String(a.expected || '￿').localeCompare(String(b.expected || '￿'));
  out.late.sort(byExpected);
  out.dueToday.sort(byExpected);
  out.coming.sort(byExpected);
  return out;
}

// When a missing line was marked «Risolto», or '' — a non-empty string is the only answer.
export function resolvedOn(record?: unknown, id?: string): string {
  const at = id === undefined ? undefined : asRecord(record)?.missingResolved?.[id];
  return typeof at === 'string' && at.trim() !== '' ? at : '';
}

// Everything that did not arrive and has not been dealt with since: [{ id, supplierId, recordId, qty, missedOn, unit? }].
//
// ⚠️⚠️ IT IS DERIVED, NOT STORED, AND THAT IS WHAT MAKES IT SAFE — with ONE stored answer, «Risolto» (`missingResolved`): «I
// bought it elsewhere» leaves no trace in any order, so it has to be said and kept. An ingredient drops off when somebody marked it
// «Risolto», when a later order (to any supplier) asked for it again, or when it already has a quantity in the order being typed
// now — ⚠️ the last is why the list goes quiet the moment the work is done: a reminder that survives the action it asked for is one
// people learn to ignore.
export function stillToReorder(history: readonly unknown[] | null | undefined, draftEntries?: DraftLines): ReorderItem[] {
  const records = (history || []).filter(r => r && !isLegacyRecord(r)) as DeliveryRecord[];
  const out: ReorderItem[] = [];

  records.forEach(record => {
    const missedOn = recordDate(record);
    const supplierId = record.supplierId;

    shortfall(record).forEach(id => {
      // Marked «Risolto» — bought elsewhere (1 Oct 2026). Federico wants a missing line to wait until he decides.
      if (resolvedOn(record, id)) return;

      // Asked for again, later, from ANY supplier? «Another supplier» keeps the same ingredient id and files the line under the
      // other supplier's order, so once that order is placed its record names this ingredient. If that order is never placed no
      // record exists and the line stays here.
      const reordered = records.some(other =>
        isBefore(missedOn, recordDate(other)) &&
        wholeNumber(other.quantities?.[id]) > 0);
      if (reordered) return;

      // Already in the order being typed?
      if (wholeNumber(draftEntries?.[id]?.qty) > 0) return;

      // The unit the missed line was ORDERED in, when the record froze one: putting it back in another unit would order a
      // different thing. Absent for ordinary lines.
      const unit = cleanUnit(record.units?.[id]);
      out.push({
        id,
        supplierId,
        // The record a «Risolto» is written to.
        recordId: record.id || historyDocId(missedOn, supplierId),
        qty: wholeNumber(record.quantities?.[id]),
        missedOn,
        ...(unit ? { unit } : {}),
      });
    });
  });

  // Newest first: the thing that has just failed to turn up is the thing being thought about. Ties broken by id so two repaints
  // never swap two rows.
  return out.sort((a, b) =>
    String(b.missedOn).localeCompare(String(a.missedOn)) || String(a.id).localeCompare(String(b.id)));
}

// What "put it back in the order" would actually do: { applied: [{id, qty, unit?}], skipped: [{id, qty, existing}] }.
//
// ⚠️⚠️ A ROW THAT ALREADY HAS A QUANTITY IS NEVER OVERWRITTEN. The order is shared and live: that number was typed by a person,
// possibly seconds ago on another phone. It is skipped and REPORTED, so the screen can say so.
export function applyReorder(
  items: ReadonlyArray<{ readonly id?: string; readonly qty?: unknown; readonly unit?: string } | null | undefined> | null | undefined,
  draftEntries?: DraftLines,
): { applied: Array<{ id: string; qty: number; unit?: string }>; skipped: Array<{ id: string; qty: unknown; existing: number }> } {
  const applied: Array<{ id: string; qty: number; unit?: string }> = [];
  const skipped: Array<{ id: string; qty: unknown; existing: number }> = [];

  (items || []).forEach(item => {
    if (!item?.id) return;
    const existing = wholeNumber(draftEntries?.[item.id]?.qty);
    if (existing > 0) skipped.push({ id: item.id, qty: item.qty, existing });
    else applied.push({ id: item.id, qty: wholeNumber(item.qty), ...(item.unit ? { unit: item.unit } : {}) });
  });

  return { applied, skipped };
}

// Everything ordered before this week that nobody has answered for, oldest first.
//
// ⚠️⚠️ THIS IS THE OTHER HALF OF THE WINDOW, AND WITHOUT IT THE WINDOW IS A LEAK. Federico asked for «only the current week» AND
// «an obligation to tick»: a strict window makes an order that never arrived vanish on the day the week turns, unanswered. So the
// list is the week and THIS is the debt. An order leaves the app's attention when somebody has said what happened to it, never
// because a date passed.
export function unansweredBefore<R>(
  orders: readonly R[] | null | undefined,
  today: string | null | undefined,
  { weekStartsOn = DEFAULT_WEEK_START }: { weekStartsOn?: string } = {},
): R[] {
  if (!today) return [];
  return (orders || [])
    .filter(o => o && !isLegacyRecord(o) && !isDelivered(o)
      && beforeCurrentWeek(recordDate(o), today, weekStartsOn))
    // Oldest first: the one that has been waiting longest is the one to settle first, and the one nobody can still remember.
    .sort((a, b) => String(recordDate(a)).localeCompare(String(recordDate(b))));
}
