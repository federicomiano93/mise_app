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

import { wholeNumber as num, ingredientsOf, ingredientLabel, historyDocId } from './archive.js';
import { supplierLabel } from '../supplier-label.js';
import { sameUnit, recordUnit, entryUnit } from '../order-unit.js';

// Was this line of a list / record made in the unit the row means now? Rows with no
// `live` entry (or no live filter at all) are not judged — the old behaviour.
function inLiveUnit(source, id, live) {
  const row = live?.[id];
  return !row || sameUnit(recordUnit(source, id, row.ing), row.unit);
}

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
//
// ⚠️ `live` (optional, { [id]: { ing, unit } } — the unit each row means NOW) keeps the
// answer to ONE unit: a line told in another unit is not counted, never converted, so
// the row then reads as untold — an alarm that may be spurious, never a silence that
// hides a quantity the buyer was not told in the unit it will be bought in.
export function askedToday(requests, supplierId, today, live = null) {
  const day = String(today || '');
  const out = {};
  (requests || []).forEach(request => {
    if (!request || String(request.date || '') !== day) return;
    const quantities = request.quantities || {};
    const supplierOf = request.supplierOf || {};
    Object.keys(quantities).forEach(id => {
      if (supplierOf[id] !== supplierId) return;
      if (!inLiveUnit(request, id, live)) return;
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
//
// ⚠️ THE UNIT IS CONFIRMED TOO. `units` ({ [id]: unit }) is what the confirmation screen
// SHOWED beside each quantity; it replaces the live unit of that row, so a change made on
// another phone while the screen was open cannot record a unit nobody was shown.
export function confirmedEntries(entries, supplierIngredients, quantities, units = null) {
  const out = { ...(entries || {}) };
  (supplierIngredients || []).forEach(ing => {
    if (!ing || !ing.id) return;
    const row = { ...(out[ing.id] || {}), qty: num(quantities?.[ing.id]) };
    if (units && typeof units[ing.id] === 'string') row.unit = units[ing.id];
    out[ing.id] = row;
  });
  return out;
}

// What today's recorded orders hold, for ONE supplier → { ingredientId: qty }.
//
// ⚠️ ONE RECORD PER DAY PER SUPPLIER, and a second order the same day is MERGED into
// it (archive.js mergeArchives), so this is the day's TOTAL for that supplier. For the
// question being asked here — "has anybody been told about this?" — the total is
// exactly the right answer.
//
// `live` as in askedToday: lines recorded in another unit than the row's are left out.
export function orderedToday(history, supplierId, today, live = null) {
  const id = historyDocId(today, supplierId);
  const record = (history || []).find(r => r && r.id === id);
  const quantities = record?.quantities || {};
  if (!live) return quantities;
  const out = {};
  Object.keys(quantities).forEach(key => {
    if (inLiveUnit(record, key, live)) out[key] = quantities[key];
  });
  return out;
}

// ⚠️⚠️ THE QUESTION: does the shared order hold more than anybody has been told about?
//
// Orders has ONE shared order per venue, live on every phone, and two ways for it to
// leave the building — a frozen list sent to whoever orders, and a recorded order.
// Both are photographs. So somebody can add to the order after both were taken, and
// the person who would BUY it has no way to know.
//
// For each ingredient: `told` is the most any of today's sent lists asked for,
// `ordered` is what today's record holds, `live` is what the shared order says now.
// Anything above the larger of the two has been seen by nobody.
//
// ⚠️ THE GATE IS WHAT KEEPS THIS QUIET. The question is only asked for suppliers that
// today have EITHER a sent list OR a recorded order. Before that, an order being
// typed is simply an order being typed — everything in it is "untold" and saying so
// would be an alarm that is always on, which is an alarm nobody reads.
//
// ⚠️ AND IT GOES QUIET BY ITSELF, for the two reasons that mean the job is done:
// sending the list again raises `told`, and recording the order raises `ordered` AND
// clears the rows. Never because time passed, and never because somebody dismissed
// it — there is nothing to dismiss.
export function untoldChanges({
  suppliers, ingredients, entries, requests, history, today,
} = {}) {
  const out = [];
  (suppliers || []).forEach(supplier => {
    if (!supplier || !supplier.id) return;
    const supplierIngredients = ingredientsOf(supplier.id, ingredients);
    // The unit each of this supplier's rows means now: told and ordered amounts count
    // only when they were in it.
    const liveUnits = Object.fromEntries(supplierIngredients.map(ing =>
      [ing.id, { ing, unit: entryUnit(entries?.[ing.id], ing) }]));
    const asked = askedToday(requests, supplier.id, today, liveUnits);
    const ordered = orderedToday(history, supplier.id, today, liveUnits);
    const orderedAnyUnit = orderedToday(history, supplier.id, today);
    // The gate is «was anything told at all today», in any unit — a list that named
    // only the OTHER unit is exactly the case that must alarm.
    const askedAnyUnit = askedToday(requests, supplier.id, today);
    if (!Object.keys(askedAnyUnit).length && !Object.keys(orderedAnyUnit).length) return;

    const rows = supplierIngredients.map(ing => {
      const live = num(entries?.[ing.id]?.qty);
      const told = num(asked[ing.id]);
      const done = num(ordered[ing.id]);
      const extra = live - Math.max(told, done);
      if (extra <= 0) return null;
      // ⚠️⚠️ `alreadyOrdered` IS THE ONE THE APP CANNOT PUT RIGHT. Everything else is
      // an addition somebody still has time to act on; this one has already been
      // said down a telephone, so it is separated here and shown differently — the
      // app must say what happened and who to ring, never pretend it can fix it.
      return {
        id: ing.id,
        name: ingredientLabel(ing),
        live, told, ordered: done, extra,
        // In ANY unit: a busta line after 2 cartoni were phoned in is still «already
        // said down a telephone», and the wording for that case is the honest one.
        alreadyOrdered: num(orderedAnyUnit[ing.id]) > 0,
      };
    }).filter(Boolean);

    if (rows.length) {
      out.push({
        supplierId: supplier.id,
        supplierName: supplierLabel(supplier),
        rows,
        // Split once, here, so no screen has to work it out again and get it wrong.
        added: rows.filter(r => !r.alreadyOrdered),
        afterOrdering: rows.filter(r => r.alreadyOrdered),
      });
    }
  });
  return out;
}
