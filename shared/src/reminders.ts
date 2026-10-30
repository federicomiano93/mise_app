// reminders.ts — the two things the Orders screen must tell you the moment it opens. Pure: no Firestore, no DOM.
// TypeScript FULL port of js/orders/reminders.js for Mise 2 (step 3f-6, Reminders). Behaviour is identical, input for
// input: reminders.spec.ts runs every test against BOTH files and parity.spec.ts pairs them.
//
//   1. todayOrders      — which suppliers are ordered TODAY, and which of them you have already placed (the record
//                         {today}_{supplier} exists).
//   2. pendingSuppliers — an order you typed on an earlier day and never marked as placed. It must be filed under the day it
//                         was WRITTEN, not today, so the day is carried per supplier in the draft (drafts/current.days).

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
export interface TodayOrder<S> { supplier: S; placed: boolean }
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

// The suppliers still waiting for an order today: everything except what has already been recorded. Left deliberately
// unfiltered by weekday — the caller decides whether it cares about order days (computeAlerts does).
export function suppliersStillToOrder<S extends { readonly id?: string }>(
  suppliers: readonly S[] | null | undefined,
  history: readonly PlacedRecord[] | null | undefined,
  today: string,
): S[] {
  const placed = placedOn(history, today);
  return (suppliers || []).filter(s => !placed.has(s.id as string));
}

// Suppliers whose ORDER day is today → [{ supplier, placed }], sorted by name. `placed` is true once an order for that supplier
// exists under today's date.
export function todayOrders<S extends ReminderSupplier>({ suppliers, history, today }: {
  suppliers?: readonly S[] | null;
  history?: readonly PlacedRecord[] | null;
  today?: string;
}): TodayOrder<S>[] {
  if (!today) return [];
  const weekday = weekdayOf(today);

  const placed = placedOn(history, today);

  return (suppliers || [])
    .filter(s => s.active !== false && (s.orderDays || []).includes(weekday))
    .sort(byName)
    .map(supplier => ({ supplier, placed: placed.has(supplier.id as string) }));
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
