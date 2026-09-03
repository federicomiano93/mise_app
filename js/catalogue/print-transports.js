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
import { toZpl, zplFits } from './label-zpl.js';
import { copyToClipboard } from '../share.js';

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

// The printer's own language, handed over by hand.
//
// ⚠️ THIS IS THE PROVING ROAD, AND IT IS DELIBERATELY CRUDE. Before a print queue
// and an always-on agent are built on top of ZPL, somebody has to see ZPL come out
// of the real printer crisp — and this costs nothing to offer: the text goes to the
// clipboard, and on the shop PC it is dropped onto the printer. If the ZPL were
// wrong it is found here, for free, instead of underneath a second program.
//
// ⚠️ NO FILE DOWNLOAD. Blob, createObjectURL and `download=` are absent from this
// whole repo and the CSP is `default-src 'self'`; introducing one is a decision of
// its own, not a detail of this road. The clipboard is enough to prove a printer.
//
// ⚠️ IT IS OFFERED ONLY WHEN THE VENUE HAS SAID ITS PRINTER SPEAKS ZPL. Handing
// somebody with a normal printer a page of `^XA^CI28…` teaches them the app is
// broken.
const zplClipboard = {
  id: 'zpl-clipboard',
  labelKey: 'label.print.zplCopy',
  renderer: 'zpl',
  // ⚠️ THE CLIPBOARD AND NOTHING ELSE. The first version also accepted the platform
  // share sheet as a fallback, and tests/one-send-arrow.test.mjs refused it — rightly:
  // that sheet is banned app-wide by Federico's own decision, and a feature test that
  // merely NAMES it is the wire by which it comes back. The check now asks for exactly
  // what this road uses.
  available: () => typeof navigator !== 'undefined' && !!navigator.clipboard,
  send: async (payload) => {
    const zpl = toZpl(payload.resolved, { copies: payload.copies || 1 });
    if (!zpl) return { ok: false, reason: 'nothing-to-print' };
    // ⚠️ copyToClipboard FROM js/share.js, never navigator.clipboard directly:
    // tests/one-send-arrow.test.mjs forbids any other file calling writeText, and
    // that helper is the one that races the write against a clock — the API can
    // hang for ever when the page is not focused.
    const copied = await copyToClipboard(zpl);
    return { ok: copied, reason: copied ? null : 'copy-failed' };
  },
};

// ⚠️ ORDER IS OFFER ORDER. The first available one is what the button does when
// there is only one road worth showing.
export const TRANSPORTS = Object.freeze([osPrint, zplClipboard]);

// ⚠️ THE VENUE'S PRINTER DECIDES WHICH ROADS EXIST, NOT ONLY THE DEVICE. A road
// whose renderer the venue's printer cannot read is not a road; offering it is how
// somebody ends up with a page of ZPL codes on a sheet of A4.
//
// ⚠️ AND A ZPL ROAD IS REFUSED OUTRIGHT WHEN THE LABEL WOULD NOT FIT. The HTML path
// has a browser to measure it; this one has only an estimate, so the refusal has to
// happen before anything is sent rather than being noticed on the paper.
export function roadsFor(resolved) {
  const wants = (resolved && resolved.printerLanguage) || 'os';
  return availableTransports().filter((road) => {
    if (road.renderer === 'zpl') return wants === 'zpl' && zplFits(resolved);
    return wants !== 'zpl';
  });
}

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

// WHY there is no road, when there is none — because the two reasons send somebody
// to fix completely different things.
//
//   'too-big-for-printer'  the label will not fit the paper this printer holds
//   'no-device'            this device cannot reach a printer at all
//
// ⚠️ THE FIRST IS ABOUT THE LABEL AND THE SECOND IS ABOUT THE PHONE IN YOUR HAND.
// Telling somebody the wrong one sends them to buy bigger labels when the real
// answer was «walk to the computer», or the reverse.
export function whyNoRoad(resolved) {
  if (roadsFor(resolved).length) return null;
  const wants = (resolved && resolved.printerLanguage) || 'os';
  if (wants === 'zpl' && !zplFits(resolved)) return 'too-big-for-printer';
  return 'no-device';
}
