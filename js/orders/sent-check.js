// sent-check.js — the pure rules of «Did you send the order?», asked after the
// review screen is confirmed and BEFORE anything is archived. Opening WhatsApp is
// not sending, so the question is always asked, the post-send prompt included.
// The dialog is sent-check-dialog.js; the wiring is orders-main.js.

import { orderedItems } from './order-text.js';

// An order recorded for an order that ALREADY went out (the «placed yesterday»
// banner) is never asked: «did you send it?» would be a silly question. Neither is
// a recording whose caller already asked once for several suppliers
// (`confirm: false`, which is how recordSuppliers calls placeOrder).
export function shouldAskSent({ confirm = true, alreadySent = false } = {}) {
  return confirm === true && alreadySent !== true;
}

// The dictionary keys and variables for one supplier or several. `names` is the
// already-joined list for several (the caller owns the language of the «and»).
export function sentCheckPhrases(count, names) {
  const many = count > 1;
  return {
    titleKey: many ? 'orders.sentCheck.many' : 'orders.sentCheck.one',
    titleVars: many ? { names } : { name: names },
    yesKey: many ? 'orders.sentCheck.yesMany' : 'orders.sentCheck.yes',
    sendNowKey: many ? 'orders.sentCheck.sendNowMany' : 'orders.sentCheck.sendNow',
  };
}

// What an answer means for the order.
//   'yes'     → record it now.
//   'sendNow' → send first; record only the suppliers whose send was launched.
//   anything else (cancel, Escape, backdrop) → nothing is recorded.
export function outcomeOf(answer) {
  if (answer === 'yes') return { record: true, sendFirst: false };
  if (answer === 'sendNow') return { record: true, sendFirst: true };
  return { record: false, sendFirst: false };
}

// Of the suppliers asked about, the ones to record after a send was attempted:
// exactly those the road reached (a per-supplier road skips a supplier it has no
// number for), in their original order. A send backed out of reaches none.
export function suppliersToRecord(supplierIds, sentIds) {
  const sent = new Set(sentIds || []);
  return (supplierIds || []).filter(id => sent.has(id));
}

// The rows «Send it now» hands to the send road, for exactly the numbers the review screen
// confirmed. ⚠️ BUILT WITH THE NORMAL SEND SCREEN'S OWN SELECTION (orderedItems → lineUnit),
// over entries made from the confirmed quantities and units — so the message is
// byte-identical to what the send screen would write for the same numbers. The confirmed
// units are the unit EVERY row showed (the card's own unit included); lineUnit() is what
// drops it again where the card offers no choice. Never itemsFromQuantities: that one is for
// the FROZEN units of a recorded order and would put a unit on every line.
//   suppliers: [{ id, name }]; ingredientsBySupplier: { id: [ingredient] };
//   confirmed: { quantities: { supplierId: { ingredientId: qty } }, units: same shape }.
export function confirmedRows(suppliers, ingredientsBySupplier, confirmed) {
  const entries = {};
  (suppliers || []).forEach(s => {
    const quantities = confirmed?.quantities?.[s.id] || {};
    Object.keys(quantities).forEach(id => {
      entries[id] = { qty: quantities[id], unit: confirmed?.units?.[s.id]?.[id] || '' };
    });
  });
  return (suppliers || [])
    .map(s => ({ id: s.id, name: s.name, items: orderedItems(ingredientsBySupplier?.[s.id] || [], entries) }))
    .filter(row => row.items.length);
}
