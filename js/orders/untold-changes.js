// untold-changes.js — what has actually been COMMUNICATED about the order in
// progress. PURE: no DOM, no Firestore, so every rule here is asserted by a unit
// test rather than read back out of a rendered screen (P15).
//
// ⚠️⚠️ THE QUESTION THIS FILE EXISTS FOR. Orders has ONE shared order per venue,
// live on every phone, and TWO ways for it to leave the building: somebody sends a
// frozen list to whoever orders (order-requests), or somebody records an order that
// has been placed (orders-history). Both are photographs; the shared order carries
// on moving underneath them. So a number can sit in the order that NOBODY has ever
// been told about — and the person who would buy it has no way to know.
//
// ⚠️ IT IS DERIVED, NEVER STORED, and that is the whole safety argument. There is
// no "I have told them" flag to set, so there is nothing that can be left switched
// on by a failed write or switched off by a successful one. Same choice as
// isRequestDone() next door (finished is deduced from the ticks and never stored)
// and as isDelivered() in deliveries.js. It goes quiet only for the two reasons
// that mean the job is done: the list was sent again, or the order was recorded.

import { wholeNumber as num } from './archive.js';

// What today's sent lists asked for, for ONE supplier → { ingredientId: qty }.
//
// ⚠️ THE HIGHEST OF THE DAY, NOT THE LATEST. Two lists can be sent for the same
// supplier — the second is how somebody adds a forgotten item, because a sent list
// is frozen and cannot be edited (firestore.rules allows only the ticks). Reading
// only the newest would answer "asked for 2" when an earlier list had already asked
// for 6 and both are still on the manager's screen.
//
// ⚠️ `today` IS PASSED IN, never read from a clock here: the caller pins the day
// (an order can be recorded under an earlier day) and a pure function must not
// disagree with it.
export function askedToday(requests, supplierId, today) {
  const day = String(today || '');
  const out = {};
  (requests || []).forEach(request => {
    if (!request || String(request.date || '') !== day) return;
    const quantities = request.quantities || {};
    const supplierOf = request.supplierOf || {};
    Object.keys(quantities).forEach(id => {
      if (supplierOf[id] !== supplierId) return;
      out[id] = Math.max(num(out[id]), num(quantities[id]));
    });
  });
  return out;
}

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
export function confirmedEntries(entries, supplierIngredients, quantities) {
  const out = { ...(entries || {}) };
  (supplierIngredients || []).forEach(ing => {
    if (!ing || !ing.id) return;
    out[ing.id] = { ...(out[ing.id] || {}), qty: num(quantities?.[ing.id]) };
  });
  return out;
}
