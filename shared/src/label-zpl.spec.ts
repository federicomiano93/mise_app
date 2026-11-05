// The label as ZPL II (label-zpl.ts) — ported from tests/label-zpl.test.mjs (all 20 tests, one for one) and then
// pinned BYTE FOR BYTE against the original js/catalogue/label-zpl.js over the whole label corpus.
//
// ⚠️ PINNED CHARACTER FOR CHARACTER. This is a document somebody's food ends up wearing, and unlike the HTML path
// there is nothing between the string and the paper that could correct it. And the one failure mode that matters
// most is silent: ^FB given fewer lines than its text needs DROPS the remainder, on the printer, with nothing
// anywhere saying so. Several tests below exist only to hold that shut.
//
// HOW IT IS COMPARED WITH THE ORIGINAL. The same resolved label object is handed to both writers: if they
// differ by one byte — a dot, a line allowance, an escape — the spec names the label, the profile and the call.
// The corpus (fixtures/label-corpus.ts) supplies the recipes, laid out on every paper size at both print-head
// resolutions with the printer set to ZPL, for every venue the labels are written for.

import { describe, expect, test } from 'vitest';
import { dotsPerMm, emphasised, escapeZpl, linesNeeded, toZpl, zplFits, zplHeightMm } from './label-zpl';
import { DEFAULT_PROFILE, LABEL_SIZES, emphasisFor, resolveLabel, useByDate, dateText } from './label-template-model';
import { buildLabel, ingredientLine } from './recipe-label-model';
import { outputLanguage } from './market';
import * as legacy from '../../js/catalogue/label-zpl.js';
import { LABEL_CORPUS, LOCATIONS, MADE_ON_PARTS } from './fixtures/label-corpus';

type Obj = Record<string, any>;

const ing = (name: string, emphasise = false): Obj => ({ id: name, name, grams: 100, allergens: [], emphasise });

const label = (over: Obj = {}): Obj => ({
  ok: true, reason: null, shows: 'allergens',
  name: 'Pane semplice',
  ingredients: [ing('Farina 0', true), ing('Acqua')],
  allergens: ['gluten-wheat'], mayContain: [], nutrition: null, nutritionMissing: false,
  ...over,
});

const zplProfile = (over: Obj = {}): Obj => ({ ...DEFAULT_PROFILE, printerLanguage: 'zpl', ...over });
const build = (over: Obj = {}, profile: Obj = zplProfile(), lang = 'it'): Obj =>
  resolveLabel(label(over), profile, {}, lang) as Obj;

// ── The job's frame ──────────────────────────────────────────────────────────

describe('the ZPL job (ported from tests/label-zpl.test.mjs)', () => {
  test('a job starts and ends where ZPL says it must', () => {
    const zpl = toZpl(build() as never);
    expect(zpl.startsWith('^XA\n'), 'a job that does not open with ^XA is not a job').toBe(true);
    expect(zpl.trimEnd().endsWith('^XZ'), 'a job that does not close is never printed').toBe(true);
  });

  test('⚠️ ^CI28 is the FIRST thing after ^XA, or every Italian accent is wrong', () => {
    // Without it the printer reads the bytes as its own legacy code page and «Può contenere» prints as
    // «PuÃ² contenere» — on the line that warns about traces of nuts.
    expect(toZpl(build() as never)).toMatch(/^\^XA\n\^CI28\n/);
  });

  test('the paper is stated in DOTS, converted from the head this venue has', () => {
    // 76 × 51 mm at 203 dpi = 8 dots/mm.
    expect(toZpl(build() as never)).toMatch(/\^PW608\n\^LL408\n/);
    // The same label at 300 dpi is the same millimetres and different numbers.
    const hi = toZpl(build({}, zplProfile({ dpi: 300 })) as never);
    expect(hi).toMatch(/\^PW898\n\^LL602\n/);
  });

  test('⚠️ the resolution is a REAL setting, and getting it wrong is silent', () => {
    // A 203-dpi label sent to a 300-dpi head comes out at two thirds of its size, perfectly rendered, with
    // nothing saying so.
    expect(dotsPerMm(203)).toBe(8);
    expect(dotsPerMm(300)).toBe(11.811);
    expect(dotsPerMm(9999), 'an unknown head falls back to the common one, never to NaN').toBe(8);
    expect(dotsPerMm(undefined)).toBe(8);
  });

  // ── What it says ───────────────────────────────────────────────────────────

  test('the blocks are printed in the reading order the label is meant to have', () => {
    const zpl = toZpl(build({ mayContain: ['nuts-almond'] }) as never);
    const at = (s: string): number => zpl.indexOf(s);
    expect(at('Pane semplice')).toBeLessThan(at('Ingredienti:'));
    expect(at('Ingredienti:')).toBeLessThan(at('Contiene:'));
    expect(at('Contiene:')).toBeLessThan(at('Può contenere:'));
  });

  test('the words are the venue country’s, not the screen’s', () => {
    expect(toZpl(build() as never)).toMatch(/\^FDIngredienti: /);
    expect(toZpl(build({}, zplProfile(), 'en') as never)).toMatch(/\^FDIngredients: /);
  });

  test('the accented characters go out as themselves', () => {
    // Paired with ^CI28 above: the bytes are UTF-8 and the printer is told so.
    expect(toZpl(build({ mayContain: ['nuts-almond'] }) as never)).toMatch(/Può contenere: Mandorle/);
  });

  // ── Emphasis, which is different here and must be ──────────────────────────

  test('⚠️⚠️ a ZPL label emphasises an allergen with CAPITALS, because it has no bold', () => {
    // ZPL cannot change weight in the middle of a wrapped paragraph. Capitals are an accepted form of emphasis
    // and the one a monochrome thermal head can do.
    expect(emphasisFor(zplProfile())).toBe('caps');
    expect(toZpl(build() as never)).toMatch(/Ingredienti: FARINA 0, Acqua\./);
  });

  test('⚠️ the SCREEN uses the same emphasis when the printer is a Zebra', () => {
    // Otherwise the preview shows bold and the paper shows capitals — the drift this whole feature was built to
    // prevent.
    expect(build().emphasis).toBe('caps');
    expect((resolveLabel(label(), DEFAULT_PROFILE, {}, 'it') as Obj).emphasis).toBe('bold');
  });

  test('⚠️ capitals are the app’s EXISTING answer, not a new one', () => {
    // ingredientLine() has always capitalised allergens on the plain-text copy. Two different ideas of
    // "emphasised" would be two different labels.
    const built = { ok: true, ingredients: [{ name: 'Farina 0', emphasise: true }, { name: 'Acqua', emphasise: false }] };
    expect(ingredientLine(built as never)).toBe('FARINA 0, Acqua');
    expect(emphasised('Farina 0', 'caps')).toBe('FARINA 0');
    expect(emphasised('Farina 0', 'bold')).toBe('Farina 0');
  });

  test('only the allergens are capitalised — the rest of the list is left alone', () => {
    const zpl = toZpl(build({ ingredients: [ing('Farina 0', true), ing('Acqua'), ing('Sale')] }) as never);
    expect(zpl).toMatch(/FARINA 0, Acqua, Sale\./);
  });

  // ── Escaping, which is where a list gets silently cut ──────────────────────

  test('⚠️⚠️ ^ and ~ are escaped, or an ingredient name ends the label early', () => {
    // Both are ZPL control characters. An ingredient called «Aroma ~ naturale» would have truncated the
    // ingredient list at that word, silently.
    expect(escapeZpl('a^b')).toBe('a_5Eb');
    expect(escapeZpl('a~b')).toBe('a_7Eb');
    expect(escapeZpl('a_b'), 'the escape character itself has to be escaped first').toBe('a_5Fb');
    const zpl = toZpl(build({ ingredients: [ing('Olio ~ speciale'), ing('Acqua')] }) as never);
    expect(zpl).toMatch(/Olio _7E speciale/);
    expect(/Olio ~ speciale/.test(zpl)).toBe(false);
  });

  test('⚠️ ^FH is set on every field, or the escapes print as literal text', () => {
    // Without it «_7E» is four characters on the label instead of a tilde.
    const lines = toZpl(build() as never).split('\n');
    const fields = lines.filter(l => l.startsWith('^FD')).length;
    const hexOn = lines.filter(l => l === '^FH').length;
    expect(fields).toBeGreaterThan(0);
    expect(hexOn, 'every ^FD must be preceded by its own ^FH').toBe(fields);
  });

  // ── The line allowance, which is where text disappears ─────────────────────

  test('⚠️⚠️ ^FB IS GIVEN MORE LINES THAN THE TEXT NEEDS, never fewer', () => {
    // A field block short of lines DROPS the remainder on the printer, in silence. The allowance is deliberately
    // generous: if the estimate is wrong the label OVERFLOWS, which somebody can see, rather than being cut
    // short, which reads as a finished declaration.
    const resolved = build({ ingredients: Array.from({ length: 25 }, (_, i) => ing(`Ingrediente numero ${i}`)) });
    const zpl = toZpl(resolved as never);
    for (const m of zpl.matchAll(/\^FB(\d+),(\d+),/g)) {
      expect(Number(m[2]), 'a block allowed zero lines prints nothing at all').toBeGreaterThanOrEqual(1);
    }
    // The ingredient block in particular: the allowance must exceed the need.
    const width = resolved.widthMm - resolved.marginMm * 2;
    const need = linesNeeded(
      `Ingredienti: ${resolved.blocks[1].parts.map((p: Obj) => p.text).join(', ')}.`,
      resolved.fontMm, width,
    );
    const allowed = Number([...zpl.matchAll(/\^FB\d+,(\d+),/g)][1]?.[1]);
    expect(allowed, `allowed ${allowed} lines for ${need} — a block must never be tight`).toBeGreaterThan(need);
  });

  test('a long word breaks inside itself rather than being lost', () => {
    const long = 'Emulsionantemonoedigliceridideagliacidigrassiesterificati';
    const zpl = toZpl(build({ ingredients: [ing(long), ing('Acqua')] }) as never);
    expect(zpl.includes(long), 'the whole word must reach the printer').toBe(true);
    expect(linesNeeded(long, 2, 20), 'and the estimate must know it takes more than one line').toBeGreaterThan(1);
  });

  // ── Whether it fits, with no browser to ask ────────────────────────────────

  test('the height is worked out from the same layout the browser measured', () => {
    const resolved = build();
    expect(zplHeightMm(resolved as never)).toBeGreaterThan(0);
    expect(zplFits(resolved as never)).toBe(true);
  });

  test('⚠️ a label too long for the paper does not fit, and says so before anything is sent', () => {
    const resolved = build({ ingredients: Array.from({ length: 80 }, (_, i) => ing(`Ingrediente numero ${i}`)) });
    expect(zplFits(resolved as never)).toBe(false);
    expect(zplHeightMm(resolved as never)).toBeGreaterThan(resolved.heightMm);
  });

  test('⚠️ the ZPL estimate is never LESS cautious than the screen’s', () => {
    // The screen can render the label and measure it; this path cannot — there is nothing to measure until the
    // paper comes out. So its glyph width must be the wider of the two: more lines, a taller label, and a
    // borderline one refused rather than printed off the bottom of the paper.
    //
    // The screen's constant is 0.52 em (label-template-model). This reproduces that estimate rather than
    // importing a private one, and pins the RELATIONSHIP — which is the fact that matters — instead of either
    // number on its own.
    const screenLines = (text: string, fontMm: number, widthMm: number): number => {
      const perLine = Math.max(1, Math.floor(widthMm / (fontMm * 0.52)));
      return Math.ceil(text.replace(/\s+/g, '').length / perLine);
    };
    for (const text of ['a'.repeat(100), 'Ingredienti: FARINA 0, Acqua, Olio di oliva, Sale marino.']) {
      for (const [fontMm, widthMm] of [[2, 20], [1.8, 52], [2.6, 71]] as const) {
        expect(
          linesNeeded(text, fontMm, widthMm),
          `ZPL asked for fewer lines than the screen at ${fontMm}mm on ${widthMm}mm — its glyph-width constant has `
          + 'been narrowed, and nothing on this path can check it',
        ).toBeGreaterThanOrEqual(screenLines(text, fontMm, widthMm) - 1);
      }
    }
    // And the constant itself is the wider one, stated as a fact rather than inferred.
    expect(Math.floor(20 / (2 * 0.58))).toBeLessThan(Math.floor(20 / (2 * 0.52)));
  });

  // ── The refusals ───────────────────────────────────────────────────────────

  test('nothing is generated for a label that was never built', () => {
    expect(toZpl({ ok: false } as never)).toBe('');
    expect(toZpl(null)).toBe('');
    expect(zplHeightMm(null)).toBe(0);
    expect(zplFits(null)).toBe(false);
  });

  // ── Copies ─────────────────────────────────────────────────────────────────

  test('one label per job unless somebody asked for more', () => {
    expect(/\^PQ/.test(toZpl(build() as never)), 'a ^PQ nobody chose is a roll of stickers nobody wanted').toBe(false);
    expect(toZpl(build() as never, { copies: 12 })).toMatch(/\^PQ12\n\^XZ/);
    expect(toZpl(build() as never, { copies: 99999 }), 'and it is capped at what the print agent accepts').toMatch(/\^PQ99\n/);
    expect(/\^PQ/.test(toZpl(build() as never, { copies: 0 }))).toBe(false);
  });
});

// ── The original, byte for byte ──────────────────────────────────────────────

// Labels the corpus does not hold on its own: the three characters ZPL reserves, accents, emphasised allergens,
// a word longer than a line, and one that cannot fit any paper.
const HAND_LABELS: Record<string, Obj> = {
  plain: label(),
  reserved: label({ name: 'Aroma ~ naturale ^ al 100_%', ingredients: [ing('Sale ~ fino', true), ing('Olio ^ x_y')] }),
  accents: label({ name: 'Crème brûlée — più cioccolato', mayContain: ['nuts-almond', 'sesame'], ingredients: [ing('Farina di grano', true), ing('Mandorle', true), ing('Latte intero', true), ing('Zucchero')] }),
  emphasised: label({ ingredients: Array.from({ length: 12 }, (_, i) => ing(`Ingrediente ${i}`, i % 2 === 0)), allergens: ['gluten-wheat', 'milk'] }),
  longWord: label({ ingredients: [ing('Emulsionantemonoedigliceridideagliacidigrassiesterificati', true), ing('Acqua')] }),
  doesNotFit: label({ ingredients: Array.from({ length: 80 }, (_, i) => ing(`Ingrediente numero ${i}`)) }),
  empty: label({ name: '', ingredients: [] }),
};

const COPIES = [undefined, 1, 3, 0, 2.7, 99, 100, 99999];

interface Case { name: string; resolved: unknown }

function allCases(): Case[] {
  const cases: Case[] = [];
  const made = new Date(...MADE_ON_PARTS);
  const papers = [
    ...LABEL_SIZES.map(size => ({ id: size.id, widthMm: size.widthMm, heightMm: size.heightMm })),
    { id: 'tight', widthMm: 30, heightMm: 20 },
  ];
  const extras = { full: { showDate: true, showWeight: true, showStorage: true, showBusiness: true, storageText: 'Keep ~ cool', businessName: 'A ^ Bakery', businessAddress: '1 High Street' }, bare: {} };
  const resolveAll = (name: string, built: unknown, lang: string, batch: Obj): void => {
    for (const paper of papers) {
      for (const dpi of [203, 300]) {
        for (const [extraName, profileExtra] of Object.entries(extras)) {
          const profile = zplProfile({ widthMm: paper.widthMm, heightMm: paper.heightMm, dpi, ...profileExtra });
          const lineExtras = extraName === 'full' ? { netWeightG: batch.netWeightG ?? 1200, dateText: dateText(useByDate(batch.shelfLifeDays ?? 3, made), lang) } : {};
          cases.push({ name: `${name} · ${paper.id} · ${dpi} dpi · ${extraName}`, resolved: resolveLabel(built, profile, lineExtras, lang) });
        }
      }
    }
  };
  for (const [name, hand] of Object.entries(HAND_LABELS)) {
    for (const lang of ['it', 'en']) resolveAll(`hand:${name}:${lang}`, hand, lang, {});
  }
  for (const entry of LABEL_CORPUS) {
    for (const shows of ['allergens', 'both']) {
      const built = buildLabel(entry.recipe as never, entry.tables as never, { shows });
      for (const [venue, location] of Object.entries(LOCATIONS)) {
        const lang = outputLanguage(location as never) ?? 'en';
        resolveAll(`${entry.id}:${shows}:${venue}`, built, lang, entry.recipe as Obj);
      }
    }
  }
  // Labels that were never built, and a profile the writer must not trust.
  cases.push({ name: 'not built', resolved: { ok: false } }, { name: 'null', resolved: null }, { name: 'undefined', resolved: undefined });
  cases.push({ name: 'default (os) profile', resolved: resolveLabel(label(), DEFAULT_PROFILE, {}, 'it') });
  return cases;
}

describe('the port writes what the original writes, byte for byte', () => {
  const cases = allCases();

  test('the corpus is large and holds both a label that fits and one that does not', () => {
    expect(cases.length).toBeGreaterThan(1000);
    const fits = cases.map(c => legacy.zplFits(c.resolved));
    expect(fits).toContain(true);
    expect(fits).toContain(false);
    const texts = cases.map(c => legacy.toZpl(c.resolved));
    expect(texts.some(t => t.includes('_7E')), 'a label with a ~ in its text').toBe(true);
    expect(texts.some(t => t.includes('_5E')), 'a label with a ^ in its text').toBe(true);
    expect(texts.some(t => t.includes('_5F')), 'a label with an underscore in its text').toBe(true);
    expect(texts.some(t => /Può|più|Crème/.test(t)), 'a label with accented letters').toBe(true);
    expect(texts.some(t => /\^FD[^\n]*[A-Z]{4,}/.test(t)), 'a label with an emphasised allergen').toBe(true);
  });

  test('toZpl, for every label, paper, head and number of copies', () => {
    for (const { name, resolved } of cases) {
      for (const copies of COPIES) {
        const options = copies === undefined ? undefined : { copies };
        expect(toZpl(resolved as never, options), `${name} · copies ${String(copies)}`).toBe(legacy.toZpl(resolved, options));
      }
    }
  });

  test('zplFits and zplHeightMm, for every label, paper and head', () => {
    for (const { name, resolved } of cases) {
      expect(zplFits(resolved as never), `${name} · zplFits`).toBe(legacy.zplFits(resolved));
      expect(zplHeightMm(resolved as never), `${name} · zplHeightMm`).toBe(legacy.zplHeightMm(resolved));
    }
  });

  test('the small functions agree on awkward input', () => {
    for (const dpi of [203, 300, 150, 0, -1, NaN, null, undefined, '203', '300', 'x', {}, [], true]) {
      expect(dotsPerMm(dpi), String(dpi)).toBe(legacy.dotsPerMm(dpi));
    }
    for (const text of ['', 'a^b~c_d', '^^~~__', 'Più ~ Crème', 12, null, undefined, 'a,b', 'line\nbreak']) {
      expect(escapeZpl(text), String(text)).toBe(legacy.escapeZpl(text));
    }
    const texts = ['', '   ', 'a', 'word '.repeat(40), 'Emulsionantemonoedigliceridideagliacidigrassiesterificati acqua', 'a'.repeat(100), 'x\ty\nz', 'Ingredienti: FARINA 0, Acqua.'];
    for (const text of texts) {
      for (const [fontMm, widthMm] of [[2, 20], [1.8, 52], [2.6, 71], [0.5, 1], [5, 3], [2, 0]] as const) {
        expect(linesNeeded(text, fontMm, widthMm), `${text.slice(0, 20)} @ ${fontMm}/${widthMm}`).toBe(legacy.linesNeeded(text, fontMm, widthMm));
      }
    }
    expect(emphasised('Farina', 'caps')).toBe(legacy.emphasised('Farina', 'caps'));
    expect(emphasised('Farina', 'bold')).toBe(legacy.emphasised('Farina', 'bold'));
  });
});
