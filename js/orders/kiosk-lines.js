// kiosk-lines.js — the Orders sections on the kiosk rest screen (js/kiosk.js asks any page
// for them with a window event; this is the pure half that builds them). No DOM, no
// Firestore: the callers hand in data they already hold.
//
// Two sections, in this order: what is still to be ordered today, and which deliveries
// arrive today. Each is a title KEY plus supplier NAMES; the title is translated by the
// drawing code (never here, never at module load), and a section with no names is left out.

import { supplierLabel } from '../supplier-label.js';
import { todayOrders } from './reminders.js';
import { pendingDeliveries } from './deliveries.js';

// More than this many suppliers and the rest become «+N» (a resting screen is read from
// across the room).
export const MAX_SUPPLIERS_SHOWN = 4;

export const TO_ORDER_TITLE_KEY = 'kiosk.rest.toOrderTitle';
export const ARRIVING_TITLE_KEY = 'kiosk.rest.arrivingTitle';

// One section: the first MAX_SUPPLIERS_SHOWN labels and how many were cut. Suppliers that
// are missing (null — a deleted one an old order still points at) are skipped, and so is
// the same supplier twice. Names are data and go through supplierLabel().
function section(titleKey, suppliers) {
  const seen = new Set();
  const labels = [];
  (Array.isArray(suppliers) ? suppliers : []).forEach(s => {
    if (!s || typeof s !== 'object') return;
    const key = s.id ?? supplierLabel(s);
    if (seen.has(key)) return;
    seen.add(key);
    const label = supplierLabel(s);
    if (label) labels.push(label);
  });
  return {
    titleKey,
    names: labels.slice(0, MAX_SUPPLIERS_SHOWN),
    more: Math.max(0, labels.length - MAX_SUPPLIERS_SHOWN),
  };
}

// toOrder / arriving: lists of supplier objects → the sections to draw (empty ones dropped).
export function kioskOrderSections({ toOrder, arriving } = {}) {
  return [
    section(TO_ORDER_TITLE_KEY, toOrder),
    section(ARRIVING_TITLE_KEY, arriving),
  ].filter(s => s.names.length > 0);
}

// The same, straight from Orders data: suppliers + orders-history records. `today` is
// "YYYY-MM-DD". Reuses the screen's own rules (todayOrders, pendingDeliveries) so the
// rest screen can never disagree with the banners.
export function kioskSectionsFromData({ suppliers, history, today, weekStartsOn }) {
  const toOrder = todayOrders({ suppliers, history, today })
    .filter(row => !row.placed).map(row => row.supplier);
  const byId = {};
  (suppliers || []).forEach(s => { byId[s.id] = s; });
  const arriving = pendingDeliveries(history, byId, today, { weekStartsOn })
    .dueToday.map(entry => entry.supplier);
  return kioskOrderSections({ toOrder, arriving });
}
