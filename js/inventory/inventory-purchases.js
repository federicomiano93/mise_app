// inventory-purchases.js — what a month's orders say was bought.
//
// PURE, ZERO IMPORTS: given the order-history records of one month, it answers
// "how many of each product came in". The screen then PROPOSES that as the
// month's purchases, and every row stays correctable — which is the whole design:
// the app fills in what it already knows, the person fixes what it got wrong.
//
// ⚠️⚠️ WHAT THIS CAN AND CANNOT KNOW, AND IT HAS TO BE SAID OUT LOUD. The app
// records what was ORDERED. It knows what did NOT arrive only where somebody
// ticked it as missing on the delivery. So a supplier who quietly short-delivers a
// sack, unrecorded, makes this number too HIGH — and a too-high "bought" makes the
// consumption too high in exactly the same amount. That is why the figure is a
// proposal on an editable row and never a fact written straight into the month.
//
// ⚠️ THE UNIT IS THE SAME ONE THE ORDER USES, and that is what makes the
// subtraction legitimate. `quantities` counts whatever the ingredient is ordered
// in — sacks, cases, boxes — and the stocktake counts the same thing, so
// "had + bought − left" never crosses a unit boundary. Nothing here converts
// anything into kilos; that belongs to the money, not to the count.

// A quantity as the Orders feature stores it. Deliberately the same shape as
// wholeNumber() in js/orders/archive.js — copied rather than imported, because a
// feature never imports from another feature's folder, and this is four lines.
function quantity(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// The date an order record belongs to.
//
// ⚠️ A RECORD WITH NO `date` IS DROPPED, and that is correct rather than
// defensive: the one such document in production is the retired weekly archive
// (`2026-W28`, July 2026), which merges every supplier into one map and belongs to
// no single day. A month's question cannot be answered from it, and guessing a
// date for it would put somebody else's July into somebody's September.
function dateOf(record) {
  const date = record && record.date;
  return typeof date === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) ? date : null;
}

export function isInMonth(record, monthId) {
  const date = dateOf(record);
  return !!date && date.slice(0, 7) === monthId;
}

// What one order record actually brought in: everything ordered, minus the lines
// somebody marked as never delivered.
//
// ⚠️ `missing` IS READ THROUGH `quantities`, NEVER ALONE. A missing entry for
// something the order never contained is meaningless — the same guard
// js/orders/deliveries.js shortfall() applies, and for the same reason.
// ⚠️ MISSING IS ALL-OR-NOTHING PER LINE, because that is what the Orders screen
// records: a tick, not a quantity. Half a delivery that arrived short by one sack
// is not expressible there, and inventing a fraction here would be worse than the
// honest whole number the person can correct.
export function receivedFrom(record) {
  const quantities = (record && record.quantities) || {};
  const missing = (record && record.missing) || {};
  const out = {};
  for (const [id, value] of Object.entries(quantities)) {
    const qty = quantity(value);
    if (qty <= 0) continue;
    if (missing[id] === true) continue;
    out[id] = qty;
  }
  return out;
}

// Every order of the month, added up per product.
//
// ⚠️ TWO ORDERS TO THE SAME SUPPLIER ON THE SAME DAY ARE ALREADY ONE RECORD —
// js/orders/archive.js merges them when the second is placed — so adding the
// records up here cannot double count. Two DIFFERENT suppliers selling the same
// product do add up, which is right: it is one shelf either way.
export function purchasesInMonth(records, monthId) {
  const list = Array.isArray(records) ? records : [];
  const totals = {};
  let counted = 0;

  list.filter(record => isInMonth(record, monthId)).forEach(record => {
    counted += 1;
    for (const [id, qty] of Object.entries(receivedFrom(record))) {
      totals[id] = (totals[id] || 0) + qty;
    }
  });

  // Float dust: 0.1 + 0.2 must read as 0.3 beside a delivery note.
  for (const id of Object.keys(totals)) {
    totals[id] = Math.round((totals[id] + Number.EPSILON) * 1000) / 1000;
  }

  return { totals, orders: counted, products: Object.keys(totals).length };
}
