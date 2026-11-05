// untold-changes.ts — what has actually been COMMUNICATED about the order in
// progress. PURE: no DOM, no Firestore, so every rule here is asserted by a unit
// test rather than read back out of a rendered screen (P15).
//
// TypeScript PARTIAL port of js/orders/untold-changes.js for Mise 2. PORTED, identical input for input:
// confirmedEntries — the rule «what counts is what the person who places the order confirms». NOT PORTED
// (the reminders and the untold-changes banner, which come with the screens that draw them): askedToday,
// orderedToday and untoldChanges. untold-changes.spec.ts runs the original's confirmedEntries tests
// against both files; parity.spec.ts does not pair it (partial).
//
// ⚠️⚠️ THE QUESTION THE ORIGINAL EXISTS FOR. Orders has ONE shared order per venue,
// live on every phone, and TWO ways for it to leave the building: somebody sends a
// frozen list to whoever orders (order-requests), or somebody records an order that
// has been placed (orders-history). Both are photographs; the shared order carries
// on moving underneath them. So a number can sit in the order that NOBODY has ever
// been told about — and the person who would buy it has no way to know.

import { wholeNumber as num } from './archive';

// A draft row once confirmed: its quantity is always a clean number; whatever else it carried (stock, a unit, an
// override) rides along.
export interface ConfirmedRow { qty: number; unit?: string; [key: string]: unknown }

// The entries to hand the archive when somebody has CONFIRMED an order: the shared
// draft, with this supplier's quantities replaced by the confirmed ones.
//
// ⚠️⚠️ THIS FUNCTION IS THE RULE. "What counts is what the person who places the
// order confirms" is true because of these few lines and nowhere else — remove them
// and the app is back to recording whatever the shared order happened to say at the
// instant the button was tapped, which is the defect the confirmation screen exists
// to close.
//
// ⚠️ A COPY, NEVER THE CALLER'S OBJECT. A debounced draft save holds the live
// entries BY REFERENCE, so mutating them here would write the confirmed numbers back
// into the shared order everybody else is typing into. A confirmation is an order,
// not an edit of somebody else's screen.
//
// ⚠️ EVERY ROW OF THE SUPPLIER IS REWRITTEN, not only the ones that came back. A row
// the confirmer set to 0 is simply ABSENT from `quantities`, and leaving it alone
// would record the live quantity they had just refused — the exact opposite of what
// they said. `supplierIngredients` is this supplier's slice, filtered by the caller
// with the same lens buildSupplierArchive uses, so the two cannot disagree about
// which rows belong to whom.
//
// ⚠️ THE STOCK READING IS CARRIED THROUGH UNTOUCHED. Counting the shelves is work
// already done, and it is not what anybody confirmed.
//
// ⚠️ THE UNIT IS CONFIRMED TOO. `units` ({ [id]: unit }) is what the confirmation screen
// SHOWED beside each quantity; it replaces the live unit of that row, so a change made on
// another phone while the screen was open cannot record a unit nobody was shown.
export function confirmedEntries(
  entries?: Record<string, Record<string, unknown> | undefined> | null,
  supplierIngredients?: readonly unknown[] | null,
  quantities?: Record<string, unknown> | null,
  units: Record<string, unknown> | null = null,
): Record<string, ConfirmedRow> {
  const out: Record<string, Record<string, unknown> | undefined> = { ...(entries || {}) };
  (supplierIngredients || []).forEach(ing => {
    const id = (ing as { id?: string } | null)?.id;
    if (!ing || !id) return;
    const row: ConfirmedRow = { ...(out[id] || {}), qty: num(quantities?.[id]) };
    const unit = units?.[id];
    if (units && typeof unit === 'string') row.unit = unit;
    out[id] = row;
  });
  return out as Record<string, ConfirmedRow>;
}
