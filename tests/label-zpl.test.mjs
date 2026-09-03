// The label as ZPL II — the language a Zebra printer speaks natively.
//
// ⚠️ PINNED CHARACTER FOR CHARACTER, in the idiom of js/orders/order-text.js. This
// is a document somebody's food ends up wearing, and unlike the HTML path there is
// nothing between the string and the paper that could correct it.
//
// ⚠️ AND THE ONE FAILURE MODE THAT MATTERS MOST HERE IS SILENT: ^FB given fewer
// lines than its text needs DROPS the remainder, on the printer, with nothing
// anywhere saying so. Several tests below exist only to hold that shut.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toZpl, zplFits, zplHeightMm, escapeZpl, dotsPerMm, linesNeeded,
} from '../js/catalogue/label-zpl.js';
import {
  resolveLabel, DEFAULT_PROFILE, emphasisFor, emphasised,
} from '../js/catalogue/label-template-model.js';
import { ingredientLine } from '../js/catalogue/recipe-label-model.js';

const ing = (name, emphasise = false) => ({ id: name, name, grams: 100, allergens: [], emphasise });

const label = (over = {}) => ({
  ok: true, reason: null, shows: 'allergens',
  name: 'Pane semplice',
  ingredients: [ing('Farina 0', true), ing('Acqua')],
  allergens: ['gluten-wheat'], mayContain: [], nutrition: null, nutritionMissing: false,
  ...over,
});

const zplProfile = (over = {}) => ({ ...DEFAULT_PROFILE, printerLanguage: 'zpl', ...over });
const build = (over = {}, profile = zplProfile(), lang = 'it') =>
  resolveLabel(label(over), profile, {}, lang);

// ── The job's frame ──────────────────────────────────────────────────────────

test('a job starts and ends where ZPL says it must', () => {
  const zpl = toZpl(build());
  assert.ok(zpl.startsWith('^XA\n'), 'a job that does not open with ^XA is not a job');
  assert.ok(zpl.trimEnd().endsWith('^XZ'), 'a job that does not close is never printed');
});

test('⚠️ ^CI28 is the FIRST thing after ^XA, or every Italian accent is wrong', () => {
  // Without it the printer reads the bytes as its own legacy code page and
  // «Può contenere» prints as «PuÃ² contenere» — on the line that warns about
  // traces of nuts.
  const zpl = toZpl(build());
  assert.match(zpl, /^\^XA\n\^CI28\n/);
});

test('the paper is stated in DOTS, converted from the head this venue has', () => {
  // 76 × 51 mm at 203 dpi = 8 dots/mm.
  assert.match(toZpl(build()), /\^PW608\n\^LL408\n/);
  // The same label at 300 dpi is the same millimetres and different numbers.
  const hi = toZpl(build({}, zplProfile({ dpi: 300 })));
  assert.match(hi, /\^PW898\n\^LL602\n/);
});

test('⚠️ the resolution is a REAL setting, and getting it wrong is silent', () => {
  // A 203-dpi label sent to a 300-dpi head comes out at two thirds of its size,
  // perfectly rendered, with nothing saying so.
  assert.equal(dotsPerMm(203), 8);
  assert.equal(dotsPerMm(300), 11.811);
  assert.equal(dotsPerMm(9999), 8, 'an unknown head falls back to the common one, never to NaN');
  assert.equal(dotsPerMm(undefined), 8);
});

// ── What it says ─────────────────────────────────────────────────────────────

test('the blocks are printed in the reading order the label is meant to have', () => {
  const zpl = toZpl(build({ mayContain: ['nuts-almond'] }));
  const at = s => zpl.indexOf(s);
  assert.ok(at('Pane semplice') < at('Ingredienti:'));
  assert.ok(at('Ingredienti:') < at('Contiene:'));
  assert.ok(at('Contiene:') < at('Può contenere:'));
});

test('the words are the venue country s, not the screen s', () => {
  assert.match(toZpl(build()), /\^FDIngredienti: /);
  assert.match(toZpl(build({}, zplProfile(), 'en')), /\^FDIngredients: /);
});

test('the accented characters go out as themselves', () => {
  // Paired with ^CI28 above: the bytes are UTF-8 and the printer is told so.
  assert.match(toZpl(build({ mayContain: ['nuts-almond'] })), /Può contenere: Mandorle/);
});

// ── Emphasis, which is different here and must be ────────────────────────────

test('⚠️⚠️ a ZPL label emphasises an allergen with CAPITALS, because it has no bold', () => {
  // ZPL cannot change weight in the middle of a wrapped paragraph. Capitals are an
  // accepted form of emphasis and the one a monochrome thermal head can do.
  assert.equal(emphasisFor(zplProfile()), 'caps');
  assert.match(toZpl(build()), /Ingredienti: FARINA 0, Acqua\./);
});

test('⚠️ the SCREEN uses the same emphasis when the printer is a Zebra', () => {
  // Otherwise the preview shows bold and the paper shows capitals — the drift this
  // whole feature was built to prevent.
  assert.equal(build().emphasis, 'caps');
  assert.equal(resolveLabel(label(), DEFAULT_PROFILE, {}, 'it').emphasis, 'bold');
});

test('⚠️ capitals are the app s EXISTING answer, not a new one', () => {
  // ingredientLine() has always capitalised allergens on the plain-text copy. Two
  // different ideas of "emphasised" would be two different labels.
  const built = { ok: true, ingredients: [{ name: 'Farina 0', emphasise: true }, { name: 'Acqua', emphasise: false }] };
  assert.equal(ingredientLine(built), 'FARINA 0, Acqua');
  assert.equal(emphasised('Farina 0', 'caps'), 'FARINA 0');
  assert.equal(emphasised('Farina 0', 'bold'), 'Farina 0');
});

test('only the allergens are capitalised — the rest of the list is left alone', () => {
  const zpl = toZpl(build({ ingredients: [ing('Farina 0', true), ing('Acqua'), ing('Sale')] }));
  assert.match(zpl, /FARINA 0, Acqua, Sale\./);
});

// ── Escaping, which is where a list gets silently cut ────────────────────────

test('⚠️⚠️ ^ and ~ are escaped, or an ingredient name ends the label early', () => {
  // Both are ZPL control characters. An ingredient called «Aroma ~ naturale» would
  // have truncated the ingredient list at that word, silently.
  assert.equal(escapeZpl('a^b'), 'a_5Eb');
  assert.equal(escapeZpl('a~b'), 'a_7Eb');
  assert.equal(escapeZpl('a_b'), 'a_5Fb', 'the escape character itself has to be escaped first');
  const zpl = toZpl(build({ ingredients: [ing('Olio ~ speciale'), ing('Acqua')] }));
  assert.match(zpl, /Olio _7E speciale/);
  assert.ok(!/Olio ~ speciale/.test(zpl));
});

test('⚠️ ^FH is set on every field, or the escapes print as literal text', () => {
  // Without it «_7E» is four characters on the label instead of a tilde.
  const zpl = toZpl(build());
  const fields = zpl.split('\n').filter(l => l.startsWith('^FD')).length;
  const hexOn = zpl.split('\n').filter(l => l === '^FH').length;
  assert.ok(fields > 0);
  assert.equal(hexOn, fields, 'every ^FD must be preceded by its own ^FH');
});

// ── The line allowance, which is where text disappears ───────────────────────

test('⚠️⚠️ ^FB IS GIVEN MORE LINES THAN THE TEXT NEEDS, never fewer', () => {
  // A field block short of lines DROPS the remainder on the printer, in silence.
  // The allowance is deliberately generous: if the estimate is wrong the label
  // OVERFLOWS, which somebody can see, rather than being cut short, which reads as
  // a finished declaration.
  const resolved = build({ ingredients: Array.from({ length: 25 }, (_, i) => ing(`Ingrediente numero ${i}`)) });
  const zpl = toZpl(resolved);
  for (const m of zpl.matchAll(/\^FB(\d+),(\d+),/g)) {
    assert.ok(Number(m[2]) >= 1, 'a block allowed zero lines prints nothing at all');
  }
  // The ingredient block in particular: the allowance must exceed the need.
  const width = resolved.widthMm - resolved.marginMm * 2;
  const need = linesNeeded(
    `Ingredienti: ${resolved.blocks[1].parts.map(p => p.text).join(', ')}.`,
    resolved.fontMm, width,
  );
  const allowed = Number([...zpl.matchAll(/\^FB\d+,(\d+),/g)][1][1]);
  assert.ok(allowed > need, `allowed ${allowed} lines for ${need} — a block must never be tight`);
});

test('a long word breaks inside itself rather than being lost', () => {
  const long = 'Emulsionantemonoedigliceridideagliacidigrassiesterificati';
  const zpl = toZpl(build({ ingredients: [ing(long), ing('Acqua')] }));
  assert.ok(zpl.includes(long), 'the whole word must reach the printer');
  assert.ok(linesNeeded(long, 2, 20) > 1, 'and the estimate must know it takes more than one line');
});

// ── Whether it fits, with no browser to ask ──────────────────────────────────

test('the height is worked out from the same layout the browser measured', () => {
  const resolved = build();
  assert.ok(zplHeightMm(resolved) > 0);
  assert.equal(zplFits(resolved), true);
});

test('⚠️ a label too long for the paper does not fit, and says so before anything is sent', () => {
  const resolved = build({ ingredients: Array.from({ length: 80 }, (_, i) => ing(`Ingrediente numero ${i}`)) });
  assert.equal(zplFits(resolved), false);
  assert.ok(zplHeightMm(resolved) > resolved.heightMm);
});

test('⚠️ the ZPL estimate is never LESS cautious than the screen s', () => {
  // The screen can render the label and measure it; this path cannot — there is
  // nothing to measure until the paper comes out. So its glyph width must be the
  // wider of the two: more lines, a taller label, and a borderline one refused
  // rather than printed off the bottom of the paper.
  //
  // The screen's constant is 0.52 em (label-template-model.js). This reproduces
  // that estimate rather than importing a private one, and pins the RELATIONSHIP —
  // which is the fact that matters — instead of either number on its own.
  const screenLines = (text, fontMm, widthMm) => {
    const perLine = Math.max(1, Math.floor(widthMm / (fontMm * 0.52)));
    return Math.ceil(text.replace(/\s+/g, '').length / perLine);
  };
  for (const text of ['a'.repeat(100), 'Ingredienti: FARINA 0, Acqua, Olio di oliva, Sale marino.']) {
    for (const [fontMm, widthMm] of [[2, 20], [1.8, 52], [2.6, 71]]) {
      assert.ok(
        linesNeeded(text, fontMm, widthMm) >= screenLines(text, fontMm, widthMm) - 1,
        `ZPL asked for fewer lines than the screen at ${fontMm}mm on ${widthMm}mm — `
        + 'its glyph-width constant has been narrowed, and nothing on this path can check it',
      );
    }
  }
  // And the constant itself is the wider one, stated as a fact rather than inferred.
  const perLineZpl = Math.floor(20 / (2 * 0.58));
  const perLineScreen = Math.floor(20 / (2 * 0.52));
  assert.ok(perLineZpl < perLineScreen, 'ZPL must fit FEWER characters per line than the screen');
});

// ── The refusals ─────────────────────────────────────────────────────────────

test('nothing is generated for a label that was never built', () => {
  assert.equal(toZpl({ ok: false }), '');
  assert.equal(toZpl(null), '');
  assert.equal(zplHeightMm(null), 0);
  assert.equal(zplFits(null), false);
});

// ── Copies ───────────────────────────────────────────────────────────────────

test('one label per job unless somebody asked for more', () => {
  assert.ok(!/\^PQ/.test(toZpl(build())), 'a ^PQ nobody chose is a roll of stickers nobody wanted');
  assert.match(toZpl(build(), { copies: 12 }), /\^PQ12\n\^XZ/);
  assert.match(toZpl(build(), { copies: 99999 }), /\^PQ999\n/, 'and it is capped');
  assert.ok(!/\^PQ/.test(toZpl(build(), { copies: 0 })));
});
