// kiosk-lines.js — the Orders lines on the kiosk rest screen (js/kiosk.js asks any page
// for extra lines with a window event; this is the pure half that builds them). No DOM,
// no Firestore: the caller hands in values the Orders screen has already computed.

import { supplierLabel } from '../supplier-label.js';

// More than this many suppliers and the rest become «+N» (a resting screen is read from
// across the room).
export const MAX_SUPPLIERS_SHOWN = 4;

// toOrder: the suppliers still to be ordered today (objects); deliveriesToday: a count.
// `say` is the interface translator (t from js/i18n.js), passed in so this file stays pure. Supplier names are
// data and go through supplierLabel(), as on every other screen.
export function kioskOrderLines({ toOrder, deliveriesToday }, say) {
  const lines = [];
  const suppliers = Array.isArray(toOrder) ? toOrder : [];
  if (suppliers.length) {
    const shown = suppliers.slice(0, MAX_SUPPLIERS_SHOWN).map(s => supplierLabel(s));
    const more = suppliers.length - shown.length;
    const names = more > 0 ? `${shown.join(', ')} +${more}` : shown.join(', ');
    lines.push(say('kiosk.orders.toOrder', { names }));
  }
  const n = Number(deliveriesToday) || 0;
  if (n > 0) lines.push(say('kiosk.orders.deliveries', { n }));
  return lines;
}
