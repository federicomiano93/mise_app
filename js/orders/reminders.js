// reminders.js — the two things the Orders screen must tell you the moment it
// opens. Pure: no Firestore, no DOM. (Also: dueTodayIds, the still-open subset of 1, which
// highlights the supplier lists.)
//
//   1. todayOrders      — which suppliers are ordered TODAY, and which of them
//                         you have already placed (the record {today}_{supplier}
//                         exists). Before the per-day model there was no way to
//                         know the second half, so this reminder was switched off.
//   2. pendingSuppliers — an order you typed on an earlier day and never marked
//                         as placed. It must be filed under the day it was
//                         WRITTEN, not today, so the day is carried per supplier
//                         in the draft (drafts/current.days).

import { isBefore, weekdayOf } from './day.js';
import { ingredientsOf, supplierHasItems } from './archive.js';
import { supplierLabel } from '../supplier-label.js';

// Sorted by the label the screen SHOWS, so the list reads A–Z as drawn.
const byName = (a, b) => supplierLabel(a).localeCompare(supplierLabel(b));

// The suppliers an order was already recorded for on `today`.
//
// One definition of "already ordered", used by the Orders screen (which ticks them
// off) AND by the Home badge (which must not count them). Two copies of this would
// drift, and the drift would show as the Home nagging about an order the Orders
// screen has already ticked off.
export function placedOn(history, today) {
  return new Set(
    (history || [])
      .filter(r => r.date === today && r.supplierId)
      .map(r => r.supplierId),
  );
}

// The suppliers closed as «non ordinato» on `today` (drafts/current.skipped, Federico's tablet
// note of 3 Nov 2026: «fammi chiudere un fornitore come non ordinato quando non mi serve niente»).
// `skipped` is { supplierId: 'YYYY-MM-DD' }; a key for any OTHER day means nothing, so last
// week's close never hides this week's order and no clean-up is ever needed. One definition, for
// the same reason as placedOn: the Orders strip, the Home badge and the kiosk must agree.
export function skippedOn(skipped, today) {
  const ids = new Set();
  if (!today || !skipped || typeof skipped !== 'object') return ids;
  Object.entries(skipped).forEach(([id, day]) => { if (day === today) ids.add(id); });
  return ids;
}

// The suppliers still waiting for an order today: everything except what has already
// been recorded, or closed as not ordered. Left deliberately unfiltered by weekday — the
// caller decides whether it cares about order days (computeAlerts does).
export function suppliersStillToOrder(suppliers, history, today, skipped = null) {
  const placed = placedOn(history, today);
  const closed = skippedOn(skipped, today);
  return (suppliers || []).filter(s => !placed.has(s.id) && !closed.has(s.id));
}

// Suppliers whose ORDER day is today → [{ supplier, placed, skipped }], sorted by name.
// `placed` is true once an order for that supplier exists under today's date; `skipped` once
// it was closed as not ordered today — and ⚠️ NEVER BOTH: a real order recorded after the
// close is what happened, so `placed` wins.
export function todayOrders({ suppliers, history, today, skipped = null }) {
  if (!today) return [];
  const weekday = weekdayOf(today);

  const placed = placedOn(history, today);
  const closed = skippedOn(skipped, today);

  return (suppliers || [])
    .filter(s => s.active !== false && (s.orderDays || []).includes(weekday))
    .sort(byName)
    .map(supplier => {
      const isPlaced = placed.has(supplier.id);
      return { supplier, placed: isPlaced, skipped: !isPlaced && closed.has(supplier.id) };
    });
}

// The ids of the suppliers STILL to order today: order day today, active, nothing recorded, not
// closed. ONE definition on purpose — the «Ordina oggi» strip's open chips and the highlight in
// both supplier lists (Orders, Fornitori) must agree, or a supplier would be lit in one place and
// ticked off in another.
export function dueTodayIds({ suppliers, history, today, skipped = null }) {
  return new Set(
    todayOrders({ suppliers, history, today, skipped })
      .filter(r => !r.placed && !r.skipped)
      .map(r => r.supplier.id),
  );
}

// What the order summary sheet may offer about TODAY for one supplier, with nothing typed for it:
//   'skip'   — its order day is today, nothing recorded or closed yet: «Chiudi come non ordinato»;
//   'reopen' — closed as not ordered today: «Riapri»;
//   ''       — nothing to offer (not due today, already ordered, or inactive).
// With quantities typed the sheet offers «Ordine fatto» instead; a supplier closed and THEN
// given quantities still shows 'reopen', so the close is never invisible.
export function closeOffer({ supplier, history, today, skipped = null }) {
  if (!supplier || !today) return '';
  const row = todayOrders({ suppliers: [supplier], history, today, skipped })[0];
  if (!row || row.placed) return '';
  return row.skipped ? 'reopen' : 'skip';
}

// Suppliers carrying quantities typed on an EARLIER day and never placed →
// [{ supplier, day, itemCount }], oldest first.
//
// `days` is the draft's per-supplier stamp. A draft written before this feature
// existed has no stamp at all, so `fallbackDay` (the local day of the draft's own
// updatedAt) stands in — otherwise the very orders this is meant to rescue would
// be the only ones it could not see. A supplier that has been deleted or
// deactivated is ignored: its stamp can linger forever and nagging about rows
// nobody can see would never stop.
export function pendingSuppliers({ suppliers, ingredients, entries, days, fallbackDay, today }) {
  if (!today) return [];

  return (suppliers || [])
    .filter(s => s.active !== false)
    .map(supplier => {
      const day = days?.[supplier.id] || fallbackDay || '';
      if (!isBefore(day, today)) return null;
      if (!supplierHasItems(supplier.id, ingredients, entries)) return null;

      const itemCount = ingredientsOf(supplier.id, ingredients)
        .filter(i => (Number(entries?.[i.id]?.qty) || 0) > 0).length;

      return { supplier, day, itemCount };
    })
    .filter(Boolean)
    .sort((a, b) => a.day.localeCompare(b.day) || byName(a.supplier, b.supplier));
}
