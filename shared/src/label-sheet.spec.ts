// The label as a piece of paper, as plain data, and the two measurement loops (label-sheet.ts) — the pure half of
// js/catalogue/label-print.js. The DOM half (buildSheet, fitSheet, fitPreviewWidth, printSheet) needs a
// browser; the app slice that builds the screen compares its output with `sheetModel()` through jsdom. Here the
// decisions are asserted with the browser replaced by a function that answers «overflows by this many pixels»
// or «how wide is the room now».
//
// Ported from the behaviours tests/label-print.test.mjs pins about these loops: 'an UNMEASURED sheet does not
// read as one that fits', 'the width is measured more than once, because a scrollbar changes it', 'the block
// scales come from the model, not from the stylesheet', 'the allergen emphasis…' (the half that is data).
// The tests there that read the source text of the DOM half are not repeated; they move with that half.

import { describe, expect, test } from 'vitest';
import {
  OVERFLOW_TOLERANCE_PX, PREVIEW_PASSES, STEP_MM, fitFont, fitWidthFactor, overflows, scaledHostHeightPx, sheetBlockText, sheetModel,
} from './label-sheet';
import { DEFAULT_PROFILE, blockText, resolveLabel } from './label-template-model';

type Obj = Record<string, any>;

const ing = (name: string, emphasise = false): Obj => ({ id: name, name, grams: 100, allergens: [], emphasise });
const label = (over: Obj = {}): Obj => ({
  ok: true, reason: null, shows: 'allergens', name: 'Focaccia',
  ingredients: [ing('Flour', true), ing('Water'), ing('Olive oil'), ing('Salt', true)],
  allergens: ['gluten-wheat'], mayContain: ['nuts-almond'], nutrition: null, nutritionMissing: false, ...over,
});
const FULL = { ...DEFAULT_PROFILE, showWeight: true, showDate: true, showStorage: true, showBusiness: true,
  storageText: 'Keep refrigerated', businessName: 'A Bakery', businessAddress: '1 High Street' };
const resolved = (profile: unknown = DEFAULT_PROFILE, lang = 'en'): any =>
  resolveLabel(label(), profile, { netWeightG: 1200, dateText: '06/09/2026' }, lang);

// ── The sheet ────────────────────────────────────────────────────────────────

describe('sheetModel', () => {
  test('is the paper: its size in millimetres, the margin as padding, the font and the line height', () => {
    const r = resolved();
    const sheet = sheetModel(r);
    expect(sheet.widthMm).toBe(76);
    expect(sheet.heightMm).toBe(51);
    expect(sheet.paddingMm).toBe(DEFAULT_PROFILE.marginMm);
    expect(sheet.fontMm).toBe(r.fontMm);
    expect(sheet.lineHeight).toBe(r.lineHeight);
  });

  test('a font size passed in wins over the resolved one, so the fit loop can redraw a step smaller', () => {
    const r = resolved();
    expect(sheetModel(r, 2.15).fontMm).toBe(2.15);
    expect(sheetModel(r, 2.15).blocks).toStrictEqual(sheetModel(r).blocks);
  });

  test('has the blocks in the order the model gives, each with its role', () => {
    const sheet = sheetModel(resolved(FULL));
    expect(sheet.blocks.map(b => b.role)).toStrictEqual(['name', 'ingredients', 'contains', 'mayContain', 'netWeight', 'date', 'storage', 'business']);
  });

  test('⚠️ the scales come from the model, never from the stylesheet', () => {
    const r = resolved(FULL);
    const sheet = sheetModel(r);
    for (const block of sheet.blocks) expect(block.fontEm, block.role).toBe(r.scale[block.role]);
    expect(sheet.blocks[0]?.fontEm, 'the name is set larger').toBeGreaterThan(1);
    // A role the table does not know is set at the sheet's own size.
    const odd = sheetModel({ ...r, scale: {}, blocks: r.blocks });
    for (const block of odd.blocks) expect(block.fontEm).toBe(1);
    expect(sheetModel({ ...r, scale: undefined }).blocks.every(b => b.fontEm === 1)).toBe(true);
  });

  test('every block has the gap under it, the last none', () => {
    const r = resolved(FULL);
    const sheet = sheetModel(r);
    sheet.blocks.forEach((block, i) => expect(block.gapEm, block.role).toBe(i < sheet.blocks.length - 1 ? r.blockGapEm : 0));
    expect(sheetModel(resolveLabel(label({ mayContain: [], allergens: [] }), DEFAULT_PROFILE, {}, 'en') as any).blocks.at(-1)?.gapEm).toBe(0);
  });

  test('a block with one string is that string; the ingredient block is a prefix, parts, a separator and a full stop', () => {
    const sheet = sheetModel(resolved());
    const name = sheet.blocks.find(b => b.role === 'name') as any;
    expect(name).toMatchObject({ text: 'Focaccia', parts: null, prefix: '', separator: '', closing: '' });
    const list = sheet.blocks.find(b => b.role === 'ingredients') as any;
    expect(list.text).toBe('');
    expect(list.prefix).toBe('Ingredients: ');
    expect(list.separator).toBe(', ');
    expect(list.closing).toBe('.');
    expect(list.parts.map((p: Obj) => p['text'])).toStrictEqual(['Flour', 'Water', 'Olive oil', 'Salt']);
  });

  test('⚠️ in bold mode the allergen words are flagged for the bold class and keep their case', () => {
    const list = sheetModel(resolved()).blocks.find(b => b.role === 'ingredients') as any;
    expect(list.parts.map((p: Obj) => p['allergen'])).toStrictEqual([true, false, false, true]);
    expect(list.parts.map((p: Obj) => p['text'])).toStrictEqual(['Flour', 'Water', 'Olive oil', 'Salt']);
  });

  test('⚠️⚠️ in capitals mode (a ZPL printer) the allergen words are CAPITALS and carry no bold class', () => {
    // A preview showing bold where the paper will show capitals is the drift this module exists to prevent.
    const r = resolved({ ...DEFAULT_PROFILE, printerLanguage: 'zpl' });
    expect(r.emphasis).toBe('caps');
    const list = sheetModel(r).blocks.find(b => b.role === 'ingredients') as any;
    expect(list.parts.map((p: Obj) => p['allergen'])).toStrictEqual([false, false, false, false]);
    expect(list.parts.map((p: Obj) => p['text'])).toStrictEqual(['FLOUR', 'Water', 'Olive oil', 'SALT']);
  });

  test('what each block draws is what the model measured, character for character', () => {
    for (const profile of [DEFAULT_PROFILE, FULL, { ...FULL, printerLanguage: 'zpl' }, { ...FULL, widthMm: 57, heightMm: 32, dateKind: 'bestBefore' }]) {
      for (const lang of ['en', 'it']) {
        const r = resolved(profile, lang);
        const sheet = sheetModel(r);
        expect(sheet.blocks.map(b => sheetBlockText(b))).toStrictEqual(r.blocks.map((b: Obj) => blockText(b, r.emphasis)));
      }
    }
  });

  test('the words follow the language the label was resolved in', () => {
    const it = sheetModel(resolved(FULL, 'it'));
    expect(it.blocks.find(b => b.role === 'ingredients')?.prefix).toBe('Ingredienti: ');
    expect(it.blocks.find(b => b.role === 'contains')?.text).toMatch(/^Contiene: /);
  });

  test('a block with no text and no parts draws an empty string, never «null» or «undefined»', () => {
    const r = { ...resolved(), blocks: [{ role: 'name', text: null, prefix: '', parts: null }, { role: 'storage', parts: null }] };
    expect(sheetModel(r).blocks.map(b => b.text)).toStrictEqual(['', '']);
  });
});

// ── Fitting the text ─────────────────────────────────────────────────────────

describe('fitFont', () => {
  // A sheet whose overflow shrinks with the font: 10 px over at 2.60 mm, one pixel less per 0.05 mm... until it
  // fits. `calls` records every font size the screen would have been asked to draw.
  const overflowAt = (needed: number) => (fontMm: number): number => Math.round((fontMm - needed) * 200);

  test('the constants are the original’s', () => {
    expect(OVERFLOW_TOLERANCE_PX).toBe(1);
    expect(STEP_MM).toBe(0.05);
    expect(PREVIEW_PASSES).toBe(3);
  });

  test('a sheet that fits is left at the size it came with, and measured once', () => {
    const calls: number[] = [];
    const out = fitFont({ fontMm: 2.6, minFontMm: 1.73 }, f => { calls.push(f); return 0; });
    expect(out).toStrictEqual({ fontMm: 2.6, fits: true, measured: true });
    expect(calls).toStrictEqual([2.6]);
  });

  test('a sheet that overflows is stepped down by 0.05 mm until it fits, and no further', () => {
    const calls: number[] = [];
    const measure = overflowAt(2.3);
    const out = fitFont({ fontMm: 2.6, minFontMm: 1.73 }, f => { calls.push(f); return measure(f); });
    expect(out.measured).toBe(true);
    expect(out.fits).toBe(true);
    // 2.6 → 2.55 → … : the first size whose overflow is within the tolerance (1 px = 0.005 mm of slack here).
    expect(out.fontMm).toBe(2.3);
    expect(calls[0]).toBe(2.6);
    expect(calls.at(-1)).toBe(2.3);
    for (let i = 1; i < calls.length; i++) expect(Math.round(((calls[i - 1] as number) - (calls[i] as number)) * 100) / 100, `step ${i}`).toBe(0.05);
  });

  test('⚠️ the steps STOP at the legal floor and the answer is «does not fit»', () => {
    const calls: number[] = [];
    const out = fitFont({ fontMm: 2.6, minFontMm: 1.73 }, f => { calls.push(f); return 50; });
    expect(out).toStrictEqual({ fontMm: 1.75, fits: false, measured: true });
    expect(Math.min(...calls), 'never drawn below the floor').toBeGreaterThanOrEqual(1.73);
    expect(calls.at(-1)).toBe(1.75);
  });

  test('a floor above the starting size is not crossed either: one measurement, no steps', () => {
    const calls: number[] = [];
    const out = fitFont({ fontMm: 2.31, minFontMm: 2.31 }, f => { calls.push(f); return 99; });
    expect(out).toStrictEqual({ fontMm: 2.31, fits: false, measured: true });
    expect(calls).toStrictEqual([2.31]);
  });

  test('the tolerance is one pixel: 1 px over fits, a hair more does not', () => {
    expect(overflows(1)).toBe(false);
    expect(overflows(1.01)).toBe(true);
    expect(overflows(0)).toBe(false);
    expect(overflows(-30)).toBe(false);
    expect(fitFont({ fontMm: 2.6, minFontMm: 1.73 }, () => 1).fits).toBe(true);
    expect(fitFont({ fontMm: 1.73, minFontMm: 1.73 }, () => 1.01).fits).toBe(false);
  });

  test('⚠️⚠️ an UNMEASURED sheet does not read as one that fits', () => {
    // A node that is not in the document reports every width and height as zero, and zero-against-zero reads as
    // fitting — for every label ever made, including the ones that do not fit.
    for (const unmeasured of [null, undefined, NaN, Infinity, '0', {}] as unknown[]) {
      const out = fitFont({ fontMm: 2.6, minFontMm: 1.73 }, () => unmeasured as number | null);
      expect(out, String(unmeasured)).toStrictEqual({ fontMm: 2.6, fits: false, measured: false });
    }
    // …and it never starts stepping down on a measurement that did not happen.
    const calls: number[] = [];
    fitFont({ fontMm: 2.6, minFontMm: 1.73 }, f => { calls.push(f); return null; });
    expect(calls).toStrictEqual([2.6]);
  });

  test('a sheet that stops being measurable half-way is not reported as fitting', () => {
    let n = 0;
    const out = fitFont({ fontMm: 2.6, minFontMm: 1.73 }, () => (++n < 3 ? 40 : null));
    expect(out.measured).toBe(false);
    expect(out.fits).toBe(false);
    expect(out.fontMm).toBe(2.5);
  });

  test('a zero overflow is a measurement, not a missing one', () => {
    expect(fitFont({ fontMm: 2.6, minFontMm: 1.73 }, () => 0).measured).toBe(true);
  });
});

// ── Scaling the preview ──────────────────────────────────────────────────────

describe('fitWidthFactor', () => {
  test('a sheet that fits the room is not scaled and nothing is applied', () => {
    const applied: number[] = [];
    expect(fitWidthFactor(287, () => 300, f => applied.push(f))).toBe(1);
    expect(fitWidthFactor(287, () => 287, f => applied.push(f))).toBe(1);
    expect(fitWidthFactor(287, () => 286.6, f => applied.push(f)), 'half a pixel of slack').toBe(1);
    expect(applied).toStrictEqual([]);
  });

  test('a sheet wider than the room is scaled to the room', () => {
    const applied: number[] = [];
    const factor = fitWidthFactor(287, () => 219, f => applied.push(f));
    expect(factor).toBeCloseTo(219 / 287, 10);
    expect(applied).toStrictEqual([219 / 287]);
  });

  test('⚠️ an unmeasurable sheet or room answers 1 and applies nothing', () => {
    const applied: number[] = [];
    expect(fitWidthFactor(0, () => 219, f => applied.push(f))).toBe(1);
    expect(fitWidthFactor(287, () => 0, f => applied.push(f))).toBe(1);
    expect(fitWidthFactor(NaN, () => 219, f => applied.push(f))).toBe(1);
    expect(applied).toStrictEqual([]);
  });

  test('⚠️ the width is measured more than once, because a scrollbar changes it', () => {
    // One pass answered 235, the scrollbar arrived, the column became 219, and the sheet stayed 16 px too wide.
    const rooms = [235, 235, 219, 219];
    let reads = 0;
    const applied: number[] = [];
    const factor = fitWidthFactor(287, () => rooms[Math.min(reads++, rooms.length - 1)] as number, f => applied.push(f));
    expect(applied.length, 'scaled again once the room shrank').toBe(2);
    expect(applied[0]).toBeCloseTo(235 / 287, 10);
    expect(applied[1]).toBeCloseTo(219 / 287, 10);
    expect(factor).toBeCloseTo(219 / 287, 10);
    expect(factor * 287).toBeLessThanOrEqual(219.5);
  });

  test('it stops after three passes however the room moves', () => {
    let room = 280;
    const applied: number[] = [];
    // The room shrinks after every scaling, for ever.
    const factor = fitWidthFactor(287, () => room, f => { applied.push(f); room -= 10; });
    expect(applied.length).toBe(PREVIEW_PASSES);
    expect(factor).toBeCloseTo(260 / 287, 10);
  });

  test('it reads the room at the start and again on every pass', () => {
    let reads = 0;
    fitWidthFactor(287, () => { reads++; return 300; }, () => undefined);
    expect(reads, 'the guard, then one pass that finds it fits').toBe(2);
  });

  test('the host keeps the scaled height, rounded UP so the bottom edge is never clipped', () => {
    expect(scaledHostHeightPx(193, 0.76)).toBe(147);
    expect(scaledHostHeightPx(193, 1)).toBe(193);
    expect(scaledHostHeightPx(100, 0.501)).toBe(51);
  });
});
