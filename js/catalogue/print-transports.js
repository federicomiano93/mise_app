// print-transports.js — the ways a label can reach a printer, behind one interface.
//
// ⚠️ WHY A REGISTRY FOR A SINGLE ENTRY. Federico's printer is a Zebra ZD620 on a USB
// cable today and may not be tomorrow, and the connection decides the road: a USB
// printer on a PC goes through the operating system's own print dialog, a networked
// one may need an agent, a Bluetooth one needs Web Bluetooth and is Android-only.
// None of that changes what the label SAYS or how it is LAID OUT. Keeping the road
// separate means the next printer costs a file, not surgery on the label screen.
//
// Each transport is:
//   { id, labelKey, renderer, available(), send(payload) }
//
// ⚠️ available() IS A FUNCTION, NOT A VALUE. The same shape as photoOn in
// catalogue-main.js and for the same reason: what a device can do has to be asked
// when the screen is drawn, not frozen when the module was first imported.
//
// ⚠️ AND labelKey IS A KEY, NOT A WORD. A t() here would be evaluated before any
// venue is open and would answer in whatever language the app started in — the
// v1.57.0 defect. The screen looks it up when it paints.

import { printSheet } from './label-print.js';

// The operating system's own print dialog. It works with WHATEVER printer the
// machine already has installed — USB, network, AirPrint, Bluetooth, a PDF writer —
// because the translating is the driver's job, not ours. That makes it the only
// road that is independent of the printer's make.
//
// ⚠️ ON A PHONE IT CAN ONLY REACH A PRINTER THE PHONE ITSELF CAN SEE. A USB printer
// attached to a PC is not one of those, and no browser can make it one. That is a
// fact about phones, not a gap in this file.
const osPrint = {
  id: 'os-print',
  labelKey: 'label.print.viaSystem',
  renderer: 'html',
  available: () => typeof window !== 'undefined' && typeof window.print === 'function',
  send: (payload) => printSheet(payload.resolved, {
    sizeId: payload.sizeId,
    fontMm: payload.fontMm,
  }),
};

// ⚠️ ORDER IS OFFER ORDER. The first available one is what the button does when
// there is only one road worth showing.
export const TRANSPORTS = Object.freeze([osPrint]);

// Which roads exist on THIS device, right now.
//
// ⚠️ ASKED AT PAINT TIME, never cached. A page can be open while the device changes
// underneath it, and a road offered that is not there is a button that fails on tap
// — which teaches people the app is broken rather than that the road is missing.
export function availableTransports() {
  return TRANSPORTS.filter(t => {
    try { return t.available() === true; } catch (e) { return false; }
  });
}

export function transportById(id) {
  return TRANSPORTS.find(t => t.id === id) || null;
}
