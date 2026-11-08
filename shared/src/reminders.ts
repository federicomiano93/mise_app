// reminders.ts — the two things the Orders screen must tell you the moment it opens. Pure: no Firestore, no DOM.
// TypeScript port of js/orders/reminders.js for Mise 2 (step 3f-6, Reminders). Behaviour is identical, input for input:
// reminders.spec.ts runs every test against BOTH files and parity.spec.ts pairs them.
//
//   1. todayOrders      — which suppliers are ordered TODAY, and which of them you have already placed (the record
//                         {today}_{supplier} exists) or closed as not ordered (drafts/current.skipped).
//   2. pendingSuppliers — an order you typed on an earlier day and never marked as placed. It must be filed under the day it
//                         was WRITTEN, not today, so the day is carried per supplier in the draft (drafts/current.days).
//
// Since 8 Nov 2026 (checklist item 3 of docs/mise2-port-owed.md) it knows the suppliers CLOSED AS NOT ORDERED today, as the current
// app has since v1.143.0: `skippedOn`, the `skipped` argument of suppliersStillToOrder and todayOrders, and `closeOffer`.
// ⚠️ LEFT OUT, so the port is not full again yet: `dueTodayIds`, which only the «Order today» tag in the two supplier lists reads
// (checklist item 12, deferred until after the switch). parity.spec.ts keeps that one missing name marked PORT OWED.

import { isBefore, weekdayOf } from './day';
import { ingredientsOf, supplierHasItems } from './archive';
import { supplierLabel } from './supplier-label';

// The fields of a supplier these rules read. A stored document is whatever was written, so everything is optional.
export interface ReminderSupplier {
  readonly id?: string;
  readonly active?: boolean;
  readonly orderDays?: readonly unknown[] | null;
}

export interface PlacedRecord { readonly date?: string; readonly supplierId?: string }
// `skipped`: closed as «not ordered» today — never true together with `placed` (a real order wins).
export interface TodayOrder<S> { supplier: S; placed: boolean; skipped: boolean }
// drafts/current.skipped as stored, { supplierId: 'YYYY-MM-DD' } — whatever was written, so skippedOn reads it defensively.
export type SkippedMap = Readonly<Record<string, unknown>>;
export interface PendingSupplier<S> { supplier: S; day: string; itemCount: number }

// Sorted by the label the screen SHOWS, so the list reads A–Z as drawn.
const byName = (a: unknown, b: unknown): number => supplierLabel(a).localeCompare(supplierLabel(b));

// The suppliers an order was already recorded for on `today`.
//
// One definition of "already ordered", used by the Orders screen (which ticks them off) AND by the Home badge (which must not
// count them). Two copies would drift, and the drift would show as the Home nagging about an order the Orders screen has
// already ticked off.
export function placedOn(history: readonly PlacedRecord[] | null | undefined, today: string): Set<string> {
  return new Set(
    (history || [])
      .filter(r => r.date === today && r.supplierId)
      .map(r => r.supplierId as string),
  );
}

// The suppliers closed as «non ordinato» on `today` (drafts/current.skipped, Federico's tablet note of 3 Nov 2026: «fammi chiudere un
// fornitore come non ordinato quando non mi serve niente»). `skipped` is { supplierId: 'YYYY-MM-DD' }; a key for any OTHER day means
// nothing, so last week's close never hides this week's order and no clean-up is ever needed. One definition, for the same reason as
// placedOn: the «Order today» strip, the Home badge and the kiosk must agree.
export function skippedOn(skipped: unknown, today: string): Set<string> {
  const ids = new Set<string>();
  if (!today || !skipped || typeof skipped !== 'object') return ids;
  Object.entries(skipped as Record<string, unknown>).forEach(([id, day]) => { if (day === today) ids.add(id); });
  return ids;
}

// The suppliers still waiting for an order today: everything except what has already been recorded, or closed as not ordered. Left
// deliberately unfiltered by weekday — the caller decides whether it cares about order days (computeAlerts does).
export function suppliersStillToOrder<S extends { readonly id?: string }>(
  suppliers: readonly S[] | null | undefined,
  history: readonly PlacedRecord[] | null | undefined,
  today: string,
  skipped: SkippedMap | null | undefined = null,
): S[] {
  const placed = placedOn(history, today);
  const closed = skippedOn(skipped, today);
  return (suppliers || []).filter(s => !placed.has(s.id as string) && !closed.has(s.id as string));
}

// Suppliers whose ORDER day is today → [{ supplier, placed, skipped }], sorted by name. `placed` is true once an order for that
// supplier exists under today's date; `skipped` once it was closed as not ordered today — and ⚠️ NEVER BOTH: a real order recorded
// after the close is what happened, so `placed` wins.
export function todayOrders<S extends ReminderSupplier>({ suppliers, history, today, skipped = null }: {
  suppliers?: readonly S[] | null;
  history?: readonly PlacedRecord[] | null;
  today?: string;
  skipped?: SkippedMap | null;
}): TodayOrder<S>[] {
  if (!today) return [];
  const weekday = weekdayOf(today);

  const placed = placedOn(history, today);
  const closed = skippedOn(skipped, today);

  return (suppliers || [])
    .filter(s => s.active !== false && (s.orderDays || []).includes(weekday))
    .sort(byName)
    .map(supplier => {
      const isPlaced = placed.has(supplier.id as string);
      return { supplier, placed: isPlaced, skipped: !isPlaced && closed.has(supplier.id as string) };
    });
}

// What the order summary may offer about TODAY for one supplier:
//   'skip'   — its order day is today, nothing recorded or closed yet: «Close as not ordered» (drawn only with nothing typed);
//   'reopen' — closed as not ordered today: «Reopen»;
//   ''       — nothing to offer (not due today, already ordered, or inactive).
// With quantities typed the summary offers «Order placed…» instead; a supplier closed and THEN given quantities still shows 'reopen', so
// the close is never invisible.
export type CloseOffer = 'skip' | 'reopen' | '';
export function closeOffer<S extends ReminderSupplier>({ supplier, history, today, skipped = null }: {
  supplier?: S | null;
  history?: readonly PlacedRecord[] | null;
  today?: string;
  skipped?: SkippedMap | null;
}): CloseOffer {
  if (!supplier || !today) return '';
  const row = todayOrders({ suppliers: [supplier], history, today, skipped })[0];
  if (!row || row.placed) return '';
  return row.skipped ? 'reopen' : 'skip';
}

// Suppliers carrying quantities typed on an EARLIER day and never placed → [{ supplier, day, itemCount }], oldest first.
//
// `days` is the draft's per-supplier stamp. A draft written before this feature existed has no stamp at all, so `fallbackDay`
// (the local day of the draft's own updatedAt) stands in — otherwise the very orders this is meant to rescue would be the only
// ones it could not see. A supplier that has been deleted or deactivated is ignored: its stamp can linger forever and nagging
// about rows nobody can see would never stop.
export function pendingSuppliers<S extends ReminderSupplier>({ suppliers, ingredients, entries, days, fallbackDay, today }: {
  suppliers?: readonly S[] | null;
  ingredients?: readonly unknown[] | null;
  entries?: Readonly<Record<string, { readonly qty?: unknown } | undefined>> | null;
  days?: Readonly<Record<string, string | undefined>> | null;
  fallbackDay?: string;
  today?: string;
}): PendingSupplier<S>[] {
  if (!today) return [];

  return (suppliers || [])
    .filter(s => s.active !== false)
    .map(supplier => {
      const day = days?.[supplier.id as string] || fallbackDay || '';
      if (!isBefore(day, today)) return null;
      if (!supplierHasItems(supplier.id, ingredients, entries)) return null;

      const itemCount = ingredientsOf(supplier.id, ingredients)
        .filter(i => (Number(entries?.[(i as { id: string }).id]?.qty) || 0) > 0).length;

      return { supplier, day, itemCount };
    })
    .filter((row): row is PendingSupplier<S> => row !== null)
    .sort((a, b) => a.day.localeCompare(b.day) || byName(a.supplier, b.supplier));
}
