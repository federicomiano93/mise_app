// print-roads.ts — which ways a label can reach a printer, and WHY there is none when there is none. The PURE
// half of js/catalogue/print-transports.js: the decisions, with no browser, no clipboard, no print queue.
//
// WHAT WAS SPLIT, AND WHY. print-transports.js holds three things in one file: the registry of roads (which road
// exists, in which order, for which printer), the code that SENDS down each road (printSheet, toZpl, the
// clipboard, the queue) and the questions it asks the device (window.print, navigator.clipboard). Only the
// first is a decision, so only the first is here. The sending stays with the screen that has a browser. And two
// things the original reaches for ITSELF are handed in instead:
//   * `zplFits` — whether the ZPL for this label fits the paper. The ZPL writer comes in step 3d-4; until then
//     the caller decides, and a caller that says nothing gets «does not fit» (see roadsFor): the safe answer.
//   * `device` — what THIS device can do (a print dialog, a clipboard). The original asks `window` and
//     `navigator` at paint time; here the screen reads them and passes the answer, which is what makes the
//     decisions assertable under Node. With nothing said, no device capability exists — the original's answer
//     under Node, where only the road that needs nothing from the device (the agent) exists.
//
// ⚠️ WHY SEVERAL ROADS FOR ONE LABEL. Federico's printer is a Zebra ZD620 on a USB cable today and may not be
// tomorrow, and the connection decides the road: a USB printer on a PC goes through the operating system's own
// print dialog, a networked one may need an agent, a Bluetooth one needs Web Bluetooth and is Android-only.
// None of that changes what the label SAYS or how it is LAID OUT.
//
// ⚠️ labelKey IS A KEY, NOT A WORD. A translated word here would be evaluated before any venue is open and
// would answer in whatever language the app started in — the v1.57.0 defect. The screen looks it up when it
// paints, so this file imports no dictionary.

export type RoadId = 'agent' | 'os-print' | 'zpl-clipboard';

export interface Road {
  readonly id: RoadId;
  readonly labelKey: string;
  // 'html' = the browser draws the sheet and the system dialog prints it; 'zpl' = the printer's own language.
  readonly renderer: 'html' | 'zpl';
  // The shop computer has to be answering for this road to exist (see the agent below).
  readonly needsPrinterReady: boolean;
}

// The operating system's own print dialog. It works with WHATEVER printer the machine already has installed —
// USB, network, AirPrint, Bluetooth, a PDF writer — because the translating is the driver's job, not ours.
//
// ⚠️ ON A PHONE IT CAN ONLY REACH A PRINTER THE PHONE ITSELF CAN SEE. A USB printer attached to a PC is not one
// of those, and no browser can make it one. That is a fact about phones, not a gap in this app.
const OS_PRINT: Road = Object.freeze({ id: 'os-print', labelKey: 'label.print.viaSystem', renderer: 'html', needsPrinterReady: false });

// The printer's own language, handed over by hand: the text goes to the clipboard, and on the shop PC it is
// dropped onto the printer. ⚠️ THIS IS THE PROVING ROAD, AND IT IS DELIBERATELY CRUDE. ⚠️ IT IS OFFERED ONLY WHEN
// THE VENUE HAS SAID ITS PRINTER SPEAKS ZPL: handing somebody with a normal printer a page of `^XA^CI28…`
// teaches them the app is broken.
const ZPL_CLIPBOARD: Road = Object.freeze({ id: 'zpl-clipboard', labelKey: 'label.print.zplCopy', renderer: 'zpl', needsPrinterReady: false });

// The shop computer, through a queue in the database.
//
// ⚠️⚠️ THIS IS THE ONLY ROAD A PHONE HAS TO A PRINTER ON A CABLE. No browser on any phone can reach a printer
// attached to a different machine — that is a fact about phones, not a gap in this app — so the label is
// written to Firestore and a small program on the computer the printer is plugged into takes it and prints it.
//
// ⚠️ IT IS OFFERED ONLY WHILE THAT COMPUTER IS ANSWERING. A queue nobody is listening to is a tap that appears
// to work and produces nothing until somebody walks over and finds the machine switched off. The heartbeat is
// what makes the difference between «printing» and «nothing happened», and the screen says which BEFORE
// anybody taps. ⚠️ AND IT CAN ONLY EVER CONFIRM «SENT», NEVER «PRINTED»: raw bytes to a printer come back with
// nothing, so every word this road puts on screen has to respect that.
const AGENT: Road = Object.freeze({ id: 'agent', labelKey: 'label.print.viaAgent', renderer: 'zpl', needsPrinterReady: true });

// ⚠️ ORDER IS OFFER ORDER. The first available one is what the button does, so the agent comes before the
// clipboard: when the shop computer is listening, queueing the job is what somebody wants — copying ZPL by hand
// is the fallback for proving a printer, not the daily road.
export const ROADS: readonly Road[] = Object.freeze([AGENT, OS_PRINT, ZPL_CLIPBOARD]);

// The ids alone, in offer order.
export const ROAD_IDS: readonly RoadId[] = Object.freeze(ROADS.map(road => road.id));

// What THIS device can do, as the screen reads it when it paints. Nothing said = nothing possible (the agent
// needs nothing from the device and is always possible; whether it is OFFERED is `printerReady`).
export interface PrintDevice {
  // typeof window.print === 'function'
  canPrint?: boolean;
  // !!navigator.clipboard
  hasClipboard?: boolean;
}

export interface RoadContext {
  // Whether the shop computer is answering. The safe default is «no»: a caller that forgets to ask offers nothing.
  printerReady?: boolean;
  // Whether the ZPL for this label fits the paper this printer holds. Handed in because the ZPL writer is
  // another module (step 3d-4); if the caller gives none the answer is «does not fit», which refuses the ZPL
  // roads — the safe direction.
  zplFits?: (resolved: unknown) => boolean;
  device?: PrintDevice;
}

// ⚠️ ASKED AT PAINT TIME, never cached. A page can be open while the device changes underneath it, and a road
// offered that is not there is a button that fails on tap — which teaches people the app is broken rather than
// that the road is missing.
function onThisDevice(road: Road, device: PrintDevice | undefined): boolean {
  if (road.id === 'os-print') return !!(device && device.canPrint);
  if (road.id === 'zpl-clipboard') return !!(device && device.hasClipboard);
  return true;
}

function printerLanguageOf(resolved: unknown): string {
  const language = resolved ? (resolved as { printerLanguage?: string }).printerLanguage : undefined;
  return language || 'os';
}

// ⚠️ THE VENUE'S PRINTER DECIDES WHICH ROADS EXIST, NOT ONLY THE DEVICE. A road whose renderer the venue's
// printer cannot read is not a road; offering it is how somebody ends up with a page of ZPL codes on a sheet of
// A4.
//
// ⚠️ AND A ZPL ROAD IS REFUSED OUTRIGHT WHEN THE LABEL WOULD NOT FIT. The HTML path has a browser to measure
// it; this one has only an estimate, so the refusal has to happen before anything is sent rather than being
// noticed on the paper.
export function roadsFor(resolved: unknown, context: RoadContext = {}): Road[] {
  const { printerReady = false, zplFits, device } = context;
  const wants = printerLanguageOf(resolved);
  return ROADS.filter((road) => {
    if (!onThisDevice(road, device)) return false;
    // ⚠️ A ROAD THAT NEEDS THE SHOP COMPUTER IS NOT A ROAD WHILE IT IS SILENT. Queueing into a queue nobody is
    // reading is a tap that looks like it worked.
    if (road.needsPrinterReady && !printerReady) return false;
    if (road.renderer === 'zpl') return wants === 'zpl' && !!(typeof zplFits === 'function' && zplFits(resolved));
    return wants !== 'zpl';
  });
}

export function roadById(id: unknown): Road | null {
  return ROADS.find(road => road.id === id) || null;
}

// WHY there is no road, when there is none — because the two reasons send somebody to fix completely different
// things.
//
//   'too-big-for-printer'  the label will not fit the paper this printer holds
//   'no-device'            nothing on this device, and no listening computer, can reach a printer at all
//
// ⚠️ THE FIRST IS ABOUT THE LABEL AND THE SECOND IS ABOUT THE PHONE IN YOUR HAND. Telling somebody the wrong
// one sends them to buy bigger labels when the real answer was «walk to the computer», or the reverse.
export type NoRoadReason = 'too-big-for-printer' | 'no-device';

export function whyNoRoad(resolved: unknown, context: RoadContext = {}): NoRoadReason | null {
  if (roadsFor(resolved, context).length) return null;
  const wants = printerLanguageOf(resolved);
  const { zplFits } = context;
  if (wants === 'zpl' && !(typeof zplFits === 'function' && zplFits(resolved))) return 'too-big-for-printer';
  return 'no-device';
}
