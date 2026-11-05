// Which roads a label can take to a printer, and why there is none (print-roads.ts) — the pure half of
// js/catalogue/print-transports.js. Mirrors the roads tests of tests/label-print.test.mjs: 'every transport
// declares the whole interface', 'available() is a FUNCTION' (here: the device is an INPUT), 'under Node only
// the road that needs neither exists', 'with no computer listening the agent road is not offered', 'a road the
// venue’s printer cannot read is not offered', '«will not fit» and «no printer here» are told apart', 'a
// transport can be found again by the id that was stored'.
//
// HOW IT IS COMPARED WITH THE ORIGINAL. The original reads the device itself (window.print, navigator.clipboard)
// and imports its own `zplFits` from label-zpl.js. So for the cross-check the device is staged with
// vi.stubGlobal, and the port is handed the SAME `zplFits` the original uses (js/catalogue/label-zpl.js, imported
// here) and the matching `device`: then every decision, over every combination below, must be the original’s.
// What the port decides on its own — a missing `zplFits` meaning «does not fit» — is pinned separately, below,
// because the original has no such case (it always has the function). The ZPL writer itself is step 3d-4.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { ROADS, ROAD_IDS, roadById, roadsFor, whyNoRoad } from './print-roads';
import type { PrintDevice, RoadContext } from './print-roads';
import { DEFAULT_PROFILE, resolveLabel } from './label-template-model';
import * as legacyTransports from '../../js/catalogue/print-transports.js';
import { zplFits as legacyZplFits } from '../../js/catalogue/label-zpl.js';

type Obj = Record<string, any>;

const ing = (name: string, emphasise = false): Obj => ({ id: name, name, grams: 100, allergens: [], emphasise });
const sample = (over: Obj = {}): Obj => ({
  ok: true, reason: null, shows: 'allergens', name: 'Focaccia',
  ingredients: [ing('Flour', true), ing('Water'), ing('Olive oil'), ing('Salt')],
  allergens: ['gluten-wheat'], mayContain: [], nutrition: null, nutritionMissing: false, ...over,
});
const longLabel = (): Obj => sample({
  ingredients: Array.from({ length: 90 }, (_, i) => ing(`Ingrediente numero ${i}`)),
});

const os = resolveLabel(sample(), DEFAULT_PROFILE, {}, 'en');
const zpl = resolveLabel(sample(), { ...DEFAULT_PROFILE, printerLanguage: 'zpl' }, {}, 'en');
const zplTooBig = resolveLabel(longLabel(), { ...DEFAULT_PROFILE, printerLanguage: 'zpl' }, {}, 'it');
const osTooBig = resolveLabel(longLabel(), DEFAULT_PROFILE, {}, 'it');

const ids = (roads: readonly { id: string }[]): string[] => roads.map(road => road.id);

afterEach(() => { vi.unstubAllGlobals(); });

// ── The registry ─────────────────────────────────────────────────────────────

describe('the roads', () => {
  test('every road declares the whole interface, so a screen can ask any of them', () => {
    for (const road of ROADS) {
      expect(typeof road.id).toBe('string');
      expect(typeof road.labelKey).toBe('string');
      expect(['html', 'zpl']).toContain(road.renderer);
      expect(typeof road.needsPrinterReady).toBe('boolean');
    }
  });

  test('the ids are in offer order: the agent, then the system dialog, then the clipboard', () => {
    // ⚠️ The first available one is what the button does: when the shop computer is listening, queueing the job
    // is what somebody wants; copying ZPL by hand is the fallback for proving a printer.
    expect([...ROAD_IDS]).toStrictEqual(['agent', 'os-print', 'zpl-clipboard']);
    expect(ids(ROADS)).toStrictEqual(['agent', 'os-print', 'zpl-clipboard']);
    expect(ids(legacyTransports.TRANSPORTS)).toStrictEqual([...ROAD_IDS]);
  });

  test('⚠️ labelKey is a KEY, never a word — a translated word at load would freeze a language', () => {
    for (const road of ROADS) expect(road.labelKey).toMatch(/^[a-z][\w.]+$/);
    expect(ROADS.map(road => road.labelKey)).toStrictEqual(legacyTransports.TRANSPORTS.map(road => road.labelKey));
  });

  test('renderer and the need for the shop computer are the original’s, road for road', () => {
    for (const road of ROADS) {
      const theirs = legacyTransports.transportById(road.id) as Obj;
      expect(road.renderer, road.id).toBe(theirs['renderer']);
      expect(road.needsPrinterReady, road.id).toBe(!!theirs['needsPrinterReady']);
    }
  });

  test('a road can be found again by the id that was stored', () => {
    expect(roadById(ROADS[0]?.id)).toBe(ROADS[0]);
    expect(roadById('carrier-pigeon')).toBe(null);
    expect(roadById(undefined)).toBe(null);
  });

  test('the registry is frozen', () => {
    expect(Object.isFrozen(ROADS)).toBe(true);
    expect(Object.isFrozen(ROAD_IDS)).toBe(true);
    for (const road of ROADS) expect(Object.isFrozen(road), road.id).toBe(true);
  });
});

// ── The decisions, by hand ───────────────────────────────────────────────────

describe('roadsFor', () => {
  const fits = (): boolean => true;
  const device: PrintDevice = { canPrint: true, hasClipboard: true };

  test('under Node — nothing said about the device — only the road that needs nothing from it can exist', () => {
    // ⚠️ THE AGENT ROAD NEEDS NOTHING FROM THE DEVICE, and that is the point of it: it writes a job to the
    // database, which any device can do. What it needs is a computer at the other end, and that is asked
    // separately.
    expect(ids(roadsFor(zpl, { printerReady: true, zplFits: fits }))).toStrictEqual(['agent']);
  });

  test('⚠️ and with no computer listening, the agent road is not offered either', () => {
    // A queue nobody is reading is a tap that appears to work and produces nothing until somebody walks over and
    // finds the machine switched off.
    expect(roadsFor(zpl, { printerReady: false, zplFits: fits })).toStrictEqual([]);
    expect(ids(roadsFor(zpl, { printerReady: true, zplFits: fits }))).toStrictEqual(['agent']);
    // The default is the safe one: a caller that forgets to ask offers nothing.
    expect(roadsFor(zpl, { zplFits: fits })).toStrictEqual([]);
    expect(roadsFor(zpl)).toStrictEqual([]);
  });

  test('a ZPL venue on a device that can do everything is offered the agent, then the clipboard — never the system dialog', () => {
    expect(ids(roadsFor(zpl, { printerReady: true, zplFits: fits, device }))).toStrictEqual(['agent', 'zpl-clipboard']);
    expect(ids(roadsFor(zpl, { printerReady: false, zplFits: fits, device }))).toStrictEqual(['zpl-clipboard']);
  });

  test('⚠️ an ordinary-printer venue is offered the system dialog and nothing in ZPL', () => {
    // Handing somebody with an ordinary printer a page of ^XA codes teaches them the app is broken. Handing a
    // Zebra a rasterised page wastes the reason to own one.
    expect(ids(roadsFor(os, { printerReady: true, zplFits: fits, device }))).toStrictEqual(['os-print']);
    expect(roadsFor(os, { printerReady: true, zplFits: fits, device }).filter(road => road.renderer === 'zpl')).toStrictEqual([]);
    expect(roadsFor(zpl, { printerReady: true, zplFits: fits, device }).filter(road => road.renderer === 'html')).toStrictEqual([]);
  });

  test('a device that cannot print or copy is not offered those roads', () => {
    expect(roadsFor(os, { zplFits: fits, device: { canPrint: false, hasClipboard: true } })).toStrictEqual([]);
    expect(ids(roadsFor(zpl, { zplFits: fits, device: { hasClipboard: true } }))).toStrictEqual(['zpl-clipboard']);
    expect(roadsFor(zpl, { zplFits: fits, device: { canPrint: true } })).toStrictEqual([]);
  });

  test('⚠️⚠️ a ZPL road is refused outright when the label would not fit, and the HTML road is not affected', () => {
    const never = (): boolean => false;
    expect(roadsFor(zplTooBig, { printerReady: true, zplFits: never, device })).toStrictEqual([]);
    expect(ids(roadsFor(osTooBig, { printerReady: true, zplFits: never, device }))).toStrictEqual(['os-print']);
  });

  test('⚠️ with no way to tell whether the ZPL fits, the ZPL roads are refused (the safe direction)', () => {
    // The original always has the function; the port is handed it by the caller until step 3d-4 ports the ZPL
    // writer. A caller that hands none must not get a road that could print a label cut off.
    expect(roadsFor(zpl, { printerReady: true, device })).toStrictEqual([]);
    expect(ids(roadsFor(os, { printerReady: true, device }))).toStrictEqual(['os-print']);
  });

  test('the answer is asked at paint time: the same label, a different device, a different answer', () => {
    expect(roadsFor(os, { device: { canPrint: false } })).toStrictEqual([]);
    expect(ids(roadsFor(os, { device: { canPrint: true } }))).toStrictEqual(['os-print']);
  });

  test('a label that is not an answer of resolveLabel() is treated as an ordinary-printer venue', () => {
    for (const odd of [null, undefined, {}, 'label', { printerLanguage: '' }, { printerLanguage: 'escpos' }]) {
      expect(ids(roadsFor(odd, { printerReady: true, zplFits: fits, device })), JSON.stringify(odd)).toStrictEqual(['os-print']);
    }
  });
});

describe('whyNoRoad', () => {
  const never = (): boolean => false;
  const fits = (): boolean => true;

  test('⚠️⚠️ «will not fit» and «no printer here» are told apart', () => {
    // One is about the label and one is about the device in your hand. Telling somebody the wrong one sends them
    // to buy bigger labels when the answer was «walk to the computer», or the reverse.
    expect(whyNoRoad(zplTooBig, { zplFits: never })).toBe('too-big-for-printer');
    // A short label on a ZPL venue has no road here only because this device has no clipboard and no computer
    // is answering — which is the OTHER reason, and it must say so.
    expect(whyNoRoad(zpl, { zplFits: fits })).toBe('no-device');
    expect(whyNoRoad(zpl, { zplFits: fits, printerReady: false, device: {} })).toBe('no-device');
  });

  test('there is no reason when there is a road', () => {
    expect(whyNoRoad(zpl, { zplFits: fits, printerReady: true })).toBe(null);
    expect(whyNoRoad(os, { device: { canPrint: true } })).toBe(null);
  });

  test('an ordinary-printer venue with no print dialog is a device problem, never a size problem', () => {
    expect(whyNoRoad(osTooBig, { zplFits: never })).toBe('no-device');
  });

  test('a ZPL venue handed no way to tell is told «too big», never «no device»', () => {
    expect(whyNoRoad(zpl, { printerReady: true })).toBe('too-big-for-printer');
  });
});

// ── Against the original ─────────────────────────────────────────────────────

describe('the original, decision for decision', () => {
  const labels: readonly [string, unknown][] = [
    ['ordinary printer', os], ['ordinary printer, too long', osTooBig], ['ZPL printer', zpl], ['ZPL printer, too long', zplTooBig],
    ['no label', null], ['not ok', { ok: false }], ['junk', 'label'],
    ['small ZPL paper', resolveLabel(sample(), { ...DEFAULT_PROFILE, printerLanguage: 'zpl', widthMm: 57, heightMm: 32 }, {}, 'en')],
  ];
  const devices: readonly PrintDevice[] = [{}, { canPrint: true }, { hasClipboard: true }, { canPrint: true, hasClipboard: true }];
  const readies: readonly (boolean | undefined)[] = [undefined, false, true];

  // The original asks the global scope; stage it to match the device handed to the port.
  const stage = (device: PrintDevice): void => {
    vi.stubGlobal('window', device.canPrint ? { print: () => undefined } : undefined);
    vi.stubGlobal('navigator', device.hasClipboard ? { clipboard: {} } : {});
  };

  test('roadsFor and whyNoRoad answer the same for every label × device × computer-listening', () => {
    const disagreements: string[] = [];
    let compared = 0;
    for (const [name, resolved] of labels) {
      for (const device of devices) {
        for (const printerReady of readies) {
          stage(device);
          const context: RoadContext = { zplFits: legacyZplFits as (r: unknown) => boolean, device, ...(printerReady === undefined ? {} : { printerReady }) };
          const legacyContext = printerReady === undefined ? {} : { printerReady };
          const mine = [ids(roadsFor(resolved, context)), whyNoRoad(resolved, context)];
          const theirs = [ids((legacyTransports.roadsFor as (r: unknown, c: unknown) => { id: string }[])(resolved, legacyContext)), (legacyTransports.whyNoRoad as (r: unknown, c: unknown) => unknown)(resolved, legacyContext)];
          compared++;
          if (JSON.stringify(mine) !== JSON.stringify(theirs)) {
            disagreements.push(`${name} / ${JSON.stringify(device)} / ready ${String(printerReady)}: ported ${JSON.stringify(mine)} / current ${JSON.stringify(theirs)}`);
          }
        }
      }
    }
    expect(compared).toBe(labels.length * devices.length * readies.length);
    expect(disagreements).toStrictEqual([]);
  });

  test('and the original, with this staging, really does offer the roads the staging says', () => {
    // Guards the cross-check itself: if the stubs stopped reaching the original, the test above would compare
    // two empty lists and pass.
    stage({ canPrint: true, hasClipboard: true });
    expect(ids((legacyTransports.roadsFor as (r: unknown, c: unknown) => { id: string }[])(zpl, { printerReady: true }))).toStrictEqual(['agent', 'zpl-clipboard']);
    expect(ids((legacyTransports.roadsFor as (r: unknown, c: unknown) => { id: string }[])(os, { printerReady: true }))).toStrictEqual(['os-print']);
  });
});
