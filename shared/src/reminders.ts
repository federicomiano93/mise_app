// reminders.ts — the two things the Orders screen must tell you the moment it opens. Pure: no Firestore, no DOM.
// TypeScript FULL port of js/orders/reminders.js for Mise 2 (step 3f-6, Reminders). Behaviour is identical, input for
// input: reminders.spec.ts runs every test against BOTH files and parity.spec.ts pairs them.
//
//   1. todayOrders      — which suppliers are ordered TODAY, and which of them you have already placed (the record
//                         {today}_{supplier} exists).
//   2. pendingSuppliers — an order you typed on an earlier day and never marked as placed. It must be filed under the day it
//                         was WRITTEN, not today, so the day is carried per supplier in the draft (drafts/current.days).
//
// (Also, since the current app's PR #470 — item 3 of docs/mise2-port-owed.md: skippedOn, a supplier closed as «not ordered»
// today in drafts/current.skipped; closeOffer, what the order summary may offer about today; and dueTodayIds, the still-open
// subset of 1, which highlights the supplier lists.)

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
export interface TodayOrder<S> { supplier: S; placed: boolean; skipped: boolean }
// drafts/current.skipped as stored: { supplierId: 'YYYY-MM-DD' }. Anything else reads as «nobody closed».
export type SkippedMap = Readonly<Record<string, unknown>> | null | undefined;
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

// The suppliers closed as «not ordered» on `today` (drafts/current.skipped, his tablet note of 3 Nov 2026: «fammi chiudere un
// fornitore come non ordinato quando non mi serve niente»). `skipped` is { supplierId: 'YYYY-MM-DD' }; a key for any OTHER day
// means nothing, so last week's close never hides this week's order and no clean-up is ever needed. One definition, for the
// same reason as placedOn: the Orders strip, the Home and the kiosk must agree.
export function skippedOn(skipped: unknown, today: string | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!today || !skipped || typeof skipped !== 'object') return ids;
  for (const [id, day] of Object.entries(skipped as Record<string, unknown>)) if (day === today) ids.add(id);
  return ids;
}

// The suppliers still waiting for an order today: everything except what has already been recorded, or closed as not
// ordered. Left deliberately unfiltered by weekday — the caller decides whether it cares about order days (computeAlerts does).
export function suppliersStillToOrder<S extends { readonly id?: string }>(
  suppliers: readonly S[] | null | undefined,
  history: readonly PlacedRecord[] | null | undefined,
  today: string,
  skipped: SkippedMap = null,
): S[] {
  const placed = placedOn(history, today);
  const closed = skippedOn(skipped, today);
  return (suppliers || []).filter(s => !placed.has(s.id as string) && !closed.has(s.id as string));
}

// Suppliers whose ORDER day is today → [{ supplier, placed, skipped }], sorted by name. `placed` is true once an order for that
// supplier exists under today's date; `skipped` once it was closed as not ordered today — and ⚠️ NEVER BOTH: a real order
// recorded after the close is what happened, so `placed` wins.
export function todayOrders<S extends ReminderSupplier>({ suppliers, history, today, skipped = null }: {
  suppliers?: readonly S[] | null;
  history?: readonly PlacedRecord[] | null;
  today?: string;
  skipped?: SkippedMap;
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

// The ids of the suppliers STILL to order today: order day today, active, nothing recorded, not closed. ONE definition on
// purpose — the «Order today» strip's open chips and the highlight in both supplier lists must agree, or a supplier would be
// lit in one place and ticked off in another.
export function dueTodayIds<S extends ReminderSupplier>({ suppliers, history, today, skipped = null }: {
  suppliers?: readonly S[] | null;
  history?: readonly PlacedRecord[] | null;
  today?: string;
  skipped?: SkippedMap;
}): Set<string> {
  return new Set(
    todayOrders({ suppliers, history, today, skipped })
      .filter(r => !r.placed && !r.skipped)
      .map(r => r.supplier.id as string),
  );
}

// What the order summary sheet may offer about TODAY for one supplier, with nothing typed for it:
//   'skip'   — its order day is today, nothing recorded or closed yet: «Close as not ordered»;
//   'reopen' — closed as not ordered today: «Reopen»;
//   ''       — nothing to offer (not due today, already ordered, or inactive).
// With quantities typed the sheet offers «Order done» instead; a supplier closed and THEN given quantities still shows
// 'reopen', so the close is never invisible.
export function closeOffer<S extends ReminderSupplier>({ supplier, history, today, skipped = null }: {
  supplier?: S | null;
  history?: readonly PlacedRecord[] | null;
  today?: string;
  skipped?: SkippedMap;
}): '' | 'skip' | 'reopen' {
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
