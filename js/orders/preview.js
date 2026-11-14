// preview.js — "Send order on WhatsApp" for the order IN PROGRESS.
//
// Opened by the header WhatsApp button. Shows a tick per supplier that has items in
// the current draft, builds ONE message grouped by supplier, and opens WhatsApp with
// NO recipient — the operator picks the chat himself (the whole app sends this way;
// see js/whatsapp.js and js/orders/order-text.js).
//
// The screen itself is supplier-picker.js and the text is order-text.js, both shared
// with the bulk "Order placed" flow and with re-sending an order from History. What
// is left here is the one thing specific to sending a DRAFT: reporting which
// suppliers went out, with the quantities that went, so the caller can ask — on every
// device (awaiting-sent.js) — whether they really left, and record exactly those.

import { t } from '../i18n.js';
import { supplierLabel } from '../supplier-label.js';
import { buildSupplierPicker } from './supplier-picker.js';
import { chooseAndSend } from './send-chooser.js';
import { currentSession } from '../firebase.js';
import { orderedItems } from './order-text.js';
import { outputLanguage } from '../market.js';
import { draftQuantities } from './awaiting-sent.js';

// suppliers: array; ingredientsBySupplier: { supplierId: [ingredient] };
// entries: { ingredientId: { qty, stock } }; callbacks: { onBack, onSent(ids, { handOff, rows }), beforeSend };
// format: { grouped, onChange } — the remembered message-format choice, owned by
// orders-main so every send path reads the same one.
export function buildSendScreen(suppliers, ingredientsBySupplier, entries, callbacks, format) {
  // Only suppliers with at least one ordered item can be sent. orderedItems()
  // is the ONE selection this app uses for "what is in this supplier's order
  // right now" — js/orders/order-summary.js (the tablet summary sheet) calls
  // the exact same function, so the two can never quietly disagree.
  //
  // Each row also carries the quantities its message is built from (awaiting-sent.js
  // draftQuantities, the same lens at the same moment): once the order is handed over, those are
  // what «did it go?» records — never the draft as it may read by the time somebody answers.
  const rows = suppliers.map(supplier => ({
    id: supplier.id,
    name: supplierLabel(supplier),
    items: orderedItems(ingredientsBySupplier[supplier.id] || [], entries),
    ...draftQuantities(ingredientsBySupplier[supplier.id] || [], entries),
  })).filter(row => row.items.length);

  return buildSupplierPicker(rows, {
    title: t('orders.sendOrder'),
    // ⚠️ "Send", not "Send on WhatsApp". The button no longer names one road: it
    // asks which of the open ones to take, and goes straight there when only one
    // is open — a question with a single answer is a tap wasted on every order.
    actionLabel: t('ui.send'),
    emptyText: t('orders.noItemsInThis'),
    format,
    // A message goes to one chat: who it is for is a decision, not a default.
    preselect: false,
    // ⚠️ THE SECOND BUTTON IS GONE, and "to the manager" did not go with it — it
    // became one of the four roads in the chooser. A footer that grew a button per
    // destination would be four buttons wide by now, and the two that address a
    // supplier directly need a sentence under them anyway.
  }, {
    onBack: () => callbacks.onBack(),
    onConfirm: (selected, { grouped }) => {
      // ⚠️ NOT async, and the unit check is not here: chooseAndSend runs `beforeSend` once the
      // road is known (an in-app list to a manager needs no check), and synchronously when
      // nothing clashes, so WhatsApp still opens inside the tap.
      return chooseAndSend({
        beforeSend: callbacks.beforeSend,
        rows: selected,
        settings: callbacks.sendSettings,
        canManage: callbacks.canManage === true,
        // ⚠️ ONLY THE PICKED SUPPLIERS, matched by ID. The chooser has to know which
        // of them can actually be reached, and by name they could not be told apart.
        suppliers: selected.map(r => suppliers.find(s => s.id === r.id)).filter(Boolean),
        locationName: currentSession().name,
        language: outputLanguage(currentSession().location),
        grouped,
        onSendToManager: callbacks.onSendToManager,
        // The rows that went, with their quantities: callbacks.onSent(ids, { handOff, rows }).
        onSent: (ids, info) => callbacks.onSent(ids, { ...info, rows: selected.filter(r => ids.includes(r.id)) }),
      });
    },
  });
}
