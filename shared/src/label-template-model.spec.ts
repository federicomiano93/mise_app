// How a label is laid out on a piece of paper: what fits, at what size, and what happens when it does not
// fit — run against BOTH implementations: the TypeScript port in shared/ and js/catalogue/label-template-model.js,
// which the live app uses today. Ported from tests/label-template-model.test.mjs (every test). The two must
// stay equal until the switch to Mise 2; label-template-model.ts is a full port, so parity.spec.ts pairs it and
// odd-inputs.spec.ts feeds both the same strange values.
//
// ⚠️ ONE RULE GOVERNS EVERY TEST HERE: nothing is ever silently shortened. Text
// shrinks down to the floor the law sets, and past that floor the answer is «this
// does not fit» — never a list with the end missing. A truncated allergen line
// reads as a finished declaration and is a lie about what is in somebody's food.
//
// ⚠️ AND THE SECOND RULE, which is about this file's own limits: the fit maths is
// an ESTIMATE (there is no browser under Node), so `fits` is an early warning and
// the screen's own measurement is the gate. These tests pin the estimate's SHAPE —
// that it shrinks, that it stops at the floor, that it never drops a word — not
// millimetre-exact answers a real typeface would move.
//
// The clock is never read: every date below is built from a fixed day (the module works in local time, so
// the day is built in local time too).

import { describe, expect, test } from 'vitest';
import * as ported from './label-template-model';
import * as legacyJs from '../../js/catalogue/label-template-model.js';

const legacy = legacyJs as unknown as typeof ported;

type Obj = Record<string, any>;

const ing = (name: string, emphasise = false): Obj => ({ id: name, name, grams: 100, allergens: [], emphasise });

const label = (over: Obj = {}): Obj => ({
  ok: true,
  reason: null,
  shows: 'allergens',
  name: 'Focaccia',
  ingredients: [ing('Flour', true), ing('Water'), ing('Olive oil'), ing('Salt')],
  allergens: ['gluten-wheat'],
  mayContain: [],
  nutrition: null,
  nutritionMissing: false,
  ...over,
});

// A list long enough that no sane font size will fit it on a small label.
const longList = (n: number): Obj[] => Array.from({ length: n }, (_, i) => ing(`Ingredient number ${i}`));

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const { DEFAULT_PROFILE, LABEL_SIZES, DEFAULT_SIZE_ID, BLOCK_ROLES, PRINTER_LANGUAGES, DPI_CHOICES, DATE_KINDS } = m;
  const { normalizeLabelProfile, minFontMm, sizeIdFor, blockText, netWeightText, useByDate } = m;
  const dateTextOf = m.dateText;
  // A resolved label as the screens read it: the ok branch, indexed freely.
  const resolve = (l: unknown, p?: unknown, extras?: Obj, lang?: string): Obj => m.resolveLabel(l, p, extras, lang) as unknown as Obj;
  const roles = (out: Obj): string[] => out['blocks'].map((b: Obj) => b['role']);
  const block = (out: Obj, role: string): Obj => out['blocks'].find((b: Obj) => b['role'] === role);

  // ── The refusals ───────────────────────────────────────────────────────────

  test('a label that was never built produces nothing to lay out', () => {
    // buildLabel() has already refused the recipe; laying out its parts anyway would
    // be building a declaration out of a recipe with holes in it.
    expect(m.resolveLabel({ ok: false, reason: 'not-declared' })).toStrictEqual({ ok: false, reason: 'not-ok' });
    expect(m.resolveLabel(null)).toStrictEqual({ ok: false, reason: 'not-ok' });
    expect(m.resolveLabel(undefined)).toStrictEqual({ ok: false, reason: 'not-ok' });
  });

  // ── The floor the law sets ─────────────────────────────────────────────────

  test('the floor comes from the x-height the regulation names, not from a point size', () => {
    // 1.2 mm of x-height, or 0.9 mm when the largest surface is under 80 cm².
    // 76 × 51 mm is 38.8 cm², so the smaller floor applies to the stock in use.
    expect(minFontMm({ widthMm: 76, heightMm: 51 })).toBe(1.73);
    // 120 × 80 mm is 96 cm² — over the threshold, so the full 1.2 mm is required.
    expect(minFontMm({ widthMm: 120, heightMm: 80 })).toBe(2.31);
  });

  test('the threshold is the label AREA, and it is crossed at 80 cm²', () => {
    // Just under and just over, so a change to the constant is caught rather than rounded past.
    expect(minFontMm({ widthMm: 100, heightMm: 79 })).toBe(1.73);   // 79.0 cm²
    expect(minFontMm({ widthMm: 100, heightMm: 81 })).toBe(2.31);   // 81.0 cm²
  });

  // ── Shrinking, and where it stops ──────────────────────────────────────────

  test('a label that fits is printed at the size the venue chose, not shrunk anyway', () => {
    const out = resolve(label(), DEFAULT_PROFILE, {}, 'en');
    expect(out['ok']).toBe(true);
    expect(out['fits']).toBe(true);
    expect(out['fontMm'], 'nothing forced it smaller, so nothing should have made it smaller').toBe(DEFAULT_PROFILE.baseFontMm);
  });

  test('a longer list shrinks the text rather than losing any of it', () => {
    const short = resolve(label(), DEFAULT_PROFILE, {}, 'en');
    const long = resolve(label({ ingredients: longList(30) }), DEFAULT_PROFILE, {}, 'en');
    expect(long['fontMm'], 'the longer list must be set smaller').toBeLessThan(short['fontMm']);
    const printed = blockText(block(long, 'ingredients'));
    for (let i = 0; i < 30; i++) {
      expect(printed.includes(`Ingredient number ${i}`), `ingredient ${i} left the label — nothing may ever be dropped to make it fit`).toBe(true);
    }
  });

  test('⚠️ shrinking STOPS at the legal floor and reports that it does not fit', () => {
    // The failure this whole file exists to prevent: a list too long for the paper
    // must produce a refusal, never a smaller-and-smaller unreadable line and never
    // a shortened one.
    const out = resolve(label({ ingredients: longList(80) }), DEFAULT_PROFILE, {}, 'en');
    expect(out['ok'], 'there is still something to draw — that is how a person sees the problem').toBe(true);
    expect(out['fits'], 'and it must say, out loud, that it does not fit').toBe(false);
    expect(out['fontMm'], `set at ${out['fontMm']} mm, below the legal floor of ${out['minFontMm']} mm`).toBeGreaterThanOrEqual(out['minFontMm']);
  });

  test('every ingredient survives even when the label reports it does not fit', () => {
    // ⚠️ THE ONE THAT MATTERS. A refusal that quietly dropped the tail would be worse
    // than the overflow it was avoiding, because the label would look complete.
    const out = resolve(label({ ingredients: longList(80) }), DEFAULT_PROFILE, {}, 'en');
    const parts = block(out, 'ingredients')['parts'];
    expect(parts.length).toBe(80);
    expect(parts[79].text).toBe('Ingredient number 79');
  });

  test('a bigger piece of paper fits what a smaller one refused', () => {
    const rows = label({ ingredients: longList(30) });
    const small = resolve(rows, { ...DEFAULT_PROFILE, widthMm: 57, heightMm: 32 }, {}, 'en');
    const big = resolve(rows, { ...DEFAULT_PROFILE, widthMm: 102, heightMm: 76 }, {}, 'en');
    expect(small['fits']).toBe(false);
    expect(big['fits'], 'the advice the screen gives — use a bigger label — has to be true').toBe(true);
  });

  // ── The blocks ─────────────────────────────────────────────────────────────

  test('the blocks come out in the reading order the label is meant to have', () => {
    const out = resolve(label({ mayContain: ['nuts-almond'] }), DEFAULT_PROFILE, {}, 'en');
    expect(roles(out)).toStrictEqual(['name', 'ingredients', 'contains', 'mayContain']);
    for (const role of roles(out)) expect(BLOCK_ROLES.includes(role as never)).toBe(true);
  });

  test('an allergen is emphasised WHERE IT APPEARS, not only summarised underneath', () => {
    // The regulation asks for the allergen to stand out inside the list. A block
    // carrying one flat string could not say which words those are.
    const out = resolve(label(), DEFAULT_PROFILE, {}, 'en');
    expect(block(out, 'ingredients')['parts'].map((p: Obj) => p['emphasise'])).toStrictEqual([true, false, false, false]);
  });

  test('«may contain» is its own block and is never folded into «contains»', () => {
    // A warning that something MIGHT be present is a different statement from a
    // declaration that it IS, and the law treats them differently.
    const out = resolve(label({ mayContain: ['nuts-almond'] }), DEFAULT_PROFILE, {}, 'en');
    const contains = block(out, 'contains')['text'];
    const may = block(out, 'mayContain')['text'];
    expect(contains).toMatch(/Contains/);
    expect(may).toMatch(/May contain/);
    expect(contains.includes('Almond'), 'a trace must never be declared as an ingredient').toBe(false);
  });

  test('with no allergens at all there is no «contains» line to print', () => {
    // "Contains: nothing" is not a sentence anybody prints.
    const out = resolve(label({ ingredients: [ing('Water')], allergens: [] }), DEFAULT_PROFILE, {}, 'en');
    expect(roles(out)).toStrictEqual(['name', 'ingredients']);
  });

  test('the label words follow the language it is asked in, which is the country s', () => {
    const en = resolve(label(), DEFAULT_PROFILE, {}, 'en');
    const it = resolve(label(), DEFAULT_PROFILE, {}, 'it');
    expect(block(en, 'ingredients')['prefix']).toMatch(/^Ingredients: /);
    expect(block(it, 'ingredients')['prefix']).toMatch(/^Ingredienti: /);
    expect(block(en, 'contains')['text']).toMatch(/^Contains: /);
    expect(block(it, 'contains')['text']).toMatch(/^Contiene: /);
  });

  test('⚠️ the date needs BOTH the switch and a date for this batch', () => {
    // The switch says «this venue prints a date»; the date itself belongs to the
    // morning. Either one alone prints nothing, which is the point of both.
    const dated = { ...DEFAULT_PROFILE, showDate: true };
    expect(roles(resolve(label(), DEFAULT_PROFILE, { dateText: '12/09/2026' }, 'en')), 'no switch, no date').not.toContain('date');
    expect(roles(resolve(label(), dated, {}, 'en')), 'no date, no line').not.toContain('date');
    const both = resolve(label(), dated, { dateText: '12/09/2026' }, 'en');
    expect(block(both, 'date')['text']).toBe('Use by 12/09/2026');
  });

  test('⚠️⚠️ «use by» and «best before» are not interchangeable, in either language', () => {
    // One is a SAFETY statement and one is about quality. A quality date read as a
    // safety one wastes food; a safety date read as a quality one is somebody eating
    // something they should not have.
    const useBy = { ...DEFAULT_PROFILE, showDate: true, dateKind: 'useBy' };
    const best = { ...DEFAULT_PROFILE, showDate: true, dateKind: 'bestBefore' };
    const line = (p: Obj, lang: string): string => block(resolve(label(), p, { dateText: '12/09/2026' }, lang), 'date')['text'];
    expect(line(useBy, 'en')).toBe('Use by 12/09/2026');
    expect(line(best, 'en')).toBe('Best before 12/09/2026');
    expect(line(useBy, 'it')).toBe('Da consumarsi entro il 12/09/2026');
    expect(line(best, 'it')).toBe('Da consumarsi preferibilmente entro il 12/09/2026');
    // And the stricter one is what an unset venue would get, if it ever switched the
    // block on without choosing.
    expect(normalizeLabelProfile({}).dateKind).toBe('useBy');
    expect(normalizeLabelProfile({ dateKind: 'whenever' }).dateKind).toBe('useBy');
    expect([...DATE_KINDS]).toStrictEqual(['useBy', 'bestBefore']);
  });

  // ── The particulars a full label carries ───────────────────────────────────

  test('⚠️⚠️ EVERY full-label block is off and empty until somebody switches it on', () => {
    // This is what let the whole thing ship without asking anybody a question: a venue
    // that sells over its own counter needs the PPDS minimum, and its labels come out
    // byte-identical to the day before.
    const plain = resolve(label(), DEFAULT_PROFILE, { netWeightG: 500, dateText: '12/09/2026' }, 'en');
    expect(roles(plain)).toStrictEqual(['name', 'ingredients', 'contains']);
    for (const key of ['showWeight', 'showDate', 'showStorage', 'showBusiness'] as const) {
      expect(DEFAULT_PROFILE[key], `${key} must default to off`).toBe(false);
      expect(normalizeLabelProfile({ [key]: 'yes' })[key], `${key} must need a real true`).toBe(false);
      expect(normalizeLabelProfile({ [key]: 1 })[key]).toBe(false);
      expect(normalizeLabelProfile({ [key]: true })[key]).toBe(true);
    }
  });

  test('⚠️⚠️ a block switched on with nothing behind it prints NOTHING, not a heading', () => {
    // «Peso netto:» followed by nothing is a mandatory particular that LOOKS declared
    // and is not — worse than its absence. The switch says «print this if you have
    // it», never «print this heading».
    const all = { ...DEFAULT_PROFILE, showWeight: true, showDate: true, showStorage: true, showBusiness: true };
    expect(roles(resolve(label(), all, {}, 'en'))).toStrictEqual(['name', 'ingredients', 'contains']);
  });

  test('the full label reads in the order a label is read in', () => {
    const all = {
      ...DEFAULT_PROFILE,
      showWeight: true, showDate: true, showStorage: true, showBusiness: true,
      storageText: 'Keep refrigerated', businessName: 'A Bakery', businessAddress: '1 High Street',
    };
    const out = resolve(label({ mayContain: ['nuts-almond'] }), all, { netWeightG: 500, dateText: '12/09/2026' }, 'en');
    expect(roles(out)).toStrictEqual(['name', 'ingredients', 'contains', 'mayContain', 'netWeight', 'date', 'storage', 'business']);
    for (const role of roles(out)) expect(BLOCK_ROLES.includes(role as never)).toBe(true);
    expect(block(out, 'netWeight')['text']).toMatch(/: 500 g$/);
    expect(block(out, 'storage')['text']).toMatch(/: Keep refrigerated$/);
  });

  test('⚠️ the name and the address are ONE block — a name with no address identifies nobody', () => {
    const of = (over: Obj): string | null => {
      const out = block(resolve(label(), { ...DEFAULT_PROFILE, showBusiness: true, ...over }, {}, 'en'), 'business');
      return out ? out['text'] : null;
    };
    expect(of({ businessName: 'A Bakery', businessAddress: '1 High Street' })).toBe('A Bakery, 1 High Street');
    // Half of it is still more than none on a label somebody has to trace back.
    expect(of({ businessName: 'A Bakery' })).toBe('A Bakery');
    expect(of({ businessAddress: '1 High Street' })).toBe('1 High Street');
    expect(of({})).toBe(null);
  });

  test('⚠️⚠️ the weight is written the way the COUNTRY writes numbers', () => {
    // «1.2 kg» in Italy is «1,2 kg», and a decimal point read as a thousands separator
    // is a label claiming a thousand times the weight.
    expect(netWeightText(500, 'en')).toBe('500 g');
    expect(netWeightText(500, 'it')).toBe('500 g');
    expect(netWeightText(1200, 'en')).toBe('1.2 kg');
    expect(netWeightText(1200, 'it')).toBe('1,2 kg');
    expect(netWeightText(1000, 'en')).toBe('1 kg');
    expect(netWeightText(2500, 'it')).toBe('2,5 kg');
  });

  test('a weight nobody weighed prints nothing at all', () => {
    for (const bad of [0, -1, null, undefined, 'heavy', NaN]) {
      expect(netWeightText(bad, 'en'), `${JSON.stringify(bad)} should print nothing`).toBe('');
    }
    const out = resolve(label(), { ...DEFAULT_PROFILE, showWeight: true }, { netWeightG: 0 }, 'en');
    expect(roles(out)).not.toContain('netWeight');
  });

  test('⚠️ the date is worked out from the day it is PRINTED, never stored on a recipe', () => {
    // A recipe knows how long the food keeps; only the morning knows when it was made.
    const made = new Date(2026, 8, 3, 12, 0, 0);
    expect(dateTextOf(useByDate(3, made), 'en')).toBe('06/09/2026');
    expect(dateTextOf(useByDate(0, made), 'en')).toBe('03/09/2026');
    expect(dateTextOf(useByDate(365, made), 'en')).toBe('03/09/2027');
    // A shelf life nobody set is not a date.
    for (const bad of [null, undefined, -1, 'soon', NaN, 99999]) {
      expect(useByDate(bad, made), `${JSON.stringify(bad)} is not a shelf life`).toBe(null);
    }
    // …and neither is an empty box, which Number() would read as zero days.
    expect(useByDate('', made)).toBe(null);
    expect(useByDate('   ', made)).toBe(null);
    expect(useByDate(3, new Date(NaN))).toBe(null);
  });

  test('⚠️ the date is written the way the COUNTRY writes dates, four-digit year', () => {
    const d = new Date(2026, 8, 3, 12, 0, 0);
    expect(dateTextOf(d, 'en')).toBe('03/09/2026');
    expect(dateTextOf(d, 'it')).toBe('03/09/2026');
    expect(dateTextOf(null, 'en')).toBe('');
    expect(dateTextOf(new Date('nonsense'), 'en')).toBe('');
  });

  test('the measured text is what is actually drawn, separators included', () => {
    // If blockText() and the renderer disagreed about the punctuation, the estimate
    // would be measuring a string nobody prints.
    const out = resolve(label(), DEFAULT_PROFILE, {}, 'en');
    expect(blockText(block(out, 'ingredients'))).toBe('Ingredients: Flour, Water, Olive oil, Salt.');
  });

  test('the measured text carries the emphasis too, because capitals are wider', () => {
    const out = resolve(label(), { ...DEFAULT_PROFILE, printerLanguage: 'zpl' }, {}, 'en');
    expect(out['emphasis']).toBe('caps');
    expect(blockText(block(out, 'ingredients'), out['emphasis'])).toBe('Ingredients: FLOUR, Water, Olive oil, Salt.');
    expect(blockText(block(out, 'ingredients'))).toBe('Ingredients: Flour, Water, Olive oil, Salt.');
    expect(m.emphasisFor(DEFAULT_PROFILE)).toBe('bold');
    expect(m.emphasised('Farina 0', 'caps')).toBe('FARINA 0');
    expect(m.emphasised('Farina 0', 'bold')).toBe('Farina 0');
  });

  // ── The profile ────────────────────────────────────────────────────────────

  test('an unwritten profile answers with the stock this venue actually uses', () => {
    expect(normalizeLabelProfile(null)).toStrictEqual({ ...DEFAULT_PROFILE });
    expect(normalizeLabelProfile(undefined)).toStrictEqual({ ...DEFAULT_PROFILE });
    expect(normalizeLabelProfile({})).toStrictEqual({ ...DEFAULT_PROFILE });
  });

  test('a corrupt measurement falls back to the default rather than to zero', () => {
    // A 0 mm label is not a smaller answer, it is no label — and it would be drawn
    // as an empty rectangle with no error anywhere.
    for (const bad of [0, -5, 'wide', NaN, Infinity, 9999, null, {}, []]) {
      expect(normalizeLabelProfile({ widthMm: bad }).widthMm, `widthMm: ${JSON.stringify(bad)} should not have been accepted`).toBe(DEFAULT_PROFILE.widthMm);
    }
  });

  test('a boolean is refused as a measurement, because Number(true) is 1', () => {
    expect(normalizeLabelProfile({ widthMm: true }).widthMm).toBe(DEFAULT_PROFILE.widthMm);
    expect(normalizeLabelProfile({ baseFontMm: true }).baseFontMm).toBe(DEFAULT_PROFILE.baseFontMm);
  });

  test('the date block stays OFF unless somebody switched it on', () => {
    // ⚠️ The opposite direction from the allergen switches, on purpose: this is the
    // one block that can print something FALSE — a shelf life nobody chose.
    expect(normalizeLabelProfile({}).showDate).toBe(false);
    expect(normalizeLabelProfile({ showDate: 'yes' }).showDate).toBe(false);
    expect(normalizeLabelProfile({ showDate: 1 }).showDate).toBe(false);
    expect(normalizeLabelProfile({ showDate: true }).showDate).toBe(true);
  });

  test('an unknown printer language or dpi falls back rather than reaching the printer', () => {
    expect(normalizeLabelProfile({ printerLanguage: 'escpos' }).printerLanguage).toBe('os');
    expect(normalizeLabelProfile({ dpi: 600 }).dpi).toBe(203);
    for (const l of PRINTER_LANGUAGES) expect(normalizeLabelProfile({ printerLanguage: l }).printerLanguage).toBe(l);
    for (const d of DPI_CHOICES) expect(normalizeLabelProfile({ dpi: d }).dpi).toBe(d);
  });

  test('every preset size maps to a named page, and a custom one maps to none', () => {
    // label-print.css carries one static @page rule per preset; only a size that is
    // not on the list needs one built at runtime.
    for (const size of LABEL_SIZES) {
      expect(sizeIdFor({ widthMm: size.widthMm, heightMm: size.heightMm })).toBe(size.id);
    }
    expect(sizeIdFor({ widthMm: 80, heightMm: 40 })).toBe(null);
    expect(LABEL_SIZES.some(s => s.id === DEFAULT_SIZE_ID)).toBe(true);
  });

  test('the default profile IS the default preset — the two cannot drift apart', () => {
    const preset = LABEL_SIZES.find(s => s.id === DEFAULT_SIZE_ID) as { widthMm: number; heightMm: number };
    expect(DEFAULT_PROFILE.widthMm).toBe(preset.widthMm);
    expect(DEFAULT_PROFILE.heightMm).toBe(preset.heightMm);
    expect(sizeIdFor(DEFAULT_PROFILE)).toBe(DEFAULT_SIZE_ID);
  });

  test('the venue s chosen size is never overridden by a bigger default', () => {
    const out = resolve(label(), { ...DEFAULT_PROFILE, widthMm: 102, heightMm: 76 }, {}, 'en');
    expect(out['widthMm']).toBe(102);
    expect(out['heightMm']).toBe(76);
  });
});
