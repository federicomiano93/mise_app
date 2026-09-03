// How a label is laid out on a piece of paper: what fits, at what size, and what
// happens when it does not fit.
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveLabel, normalizeLabelProfile, minFontMm, sizeIdFor, blockText,
  DEFAULT_PROFILE, LABEL_SIZES, DEFAULT_SIZE_ID, BLOCK_ROLES,
  PRINTER_LANGUAGES, DPI_CHOICES,
} from '../js/catalogue/label-template-model.js';

const ing = (name, emphasise = false) => ({ id: name, name, grams: 100, allergens: [], emphasise });

const label = (over = {}) => ({
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
const longList = n => Array.from({ length: n }, (_, i) => ing(`Ingredient number ${i}`));

// ── The refusals ─────────────────────────────────────────────────────────────

test('a label that was never built produces nothing to lay out', () => {
  // buildLabel() has already refused the recipe; laying out its parts anyway would
  // be building a declaration out of a recipe with holes in it.
  assert.deepEqual(resolveLabel({ ok: false, reason: 'not-declared' }), { ok: false, reason: 'not-ok' });
  assert.deepEqual(resolveLabel(null), { ok: false, reason: 'not-ok' });
  assert.deepEqual(resolveLabel(undefined), { ok: false, reason: 'not-ok' });
});

// ── The floor the law sets ───────────────────────────────────────────────────

test('the floor comes from the x-height the regulation names, not from a point size', () => {
  // 1.2 mm of x-height, or 0.9 mm when the largest surface is under 80 cm².
  // 76 × 51 mm is 38.8 cm², so the smaller floor applies to the stock in use.
  assert.equal(minFontMm({ widthMm: 76, heightMm: 51 }), 1.73);
  // 120 × 80 mm is 96 cm² — over the threshold, so the full 1.2 mm is required.
  assert.equal(minFontMm({ widthMm: 120, heightMm: 80 }), 2.31);
});

test('the threshold is the label AREA, and it is crossed at 80 cm²', () => {
  // Just under and just over, so a change to the constant is caught rather than
  // rounded past.
  assert.equal(minFontMm({ widthMm: 100, heightMm: 79 }), 1.73);   // 79.0 cm²
  assert.equal(minFontMm({ widthMm: 100, heightMm: 81 }), 2.31);   // 81.0 cm²
});

// ── Shrinking, and where it stops ────────────────────────────────────────────

test('a label that fits is printed at the size the venue chose, not shrunk anyway', () => {
  const out = resolveLabel(label(), DEFAULT_PROFILE, {}, 'en');
  assert.equal(out.ok, true);
  assert.equal(out.fits, true);
  assert.equal(out.fontMm, DEFAULT_PROFILE.baseFontMm,
    'nothing forced it smaller, so nothing should have made it smaller');
});

test('a longer list shrinks the text rather than losing any of it', () => {
  const short = resolveLabel(label(), DEFAULT_PROFILE, {}, 'en');
  const long = resolveLabel(label({ ingredients: longList(30) }), DEFAULT_PROFILE, {}, 'en');
  assert.ok(long.fontMm < short.fontMm, 'the longer list must be set smaller');
  const printed = blockText(long.blocks.find(b => b.role === 'ingredients'));
  for (let i = 0; i < 30; i++) {
    assert.ok(printed.includes(`Ingredient number ${i}`),
      `ingredient ${i} left the label — nothing may ever be dropped to make it fit`);
  }
});

test('⚠️ shrinking STOPS at the legal floor and reports that it does not fit', () => {
  // The failure this whole file exists to prevent: a list too long for the paper
  // must produce a refusal, never a smaller-and-smaller unreadable line and never
  // a shortened one.
  const out = resolveLabel(label({ ingredients: longList(80) }), DEFAULT_PROFILE, {}, 'en');
  assert.equal(out.ok, true, 'there is still something to draw — that is how a person sees the problem');
  assert.equal(out.fits, false, 'and it must say, out loud, that it does not fit');
  assert.ok(out.fontMm >= out.minFontMm,
    `set at ${out.fontMm} mm, below the legal floor of ${out.minFontMm} mm`);
});

test('every ingredient survives even when the label reports it does not fit', () => {
  // ⚠️ THE ONE THAT MATTERS. A refusal that quietly dropped the tail would be worse
  // than the overflow it was avoiding, because the label would look complete.
  const out = resolveLabel(label({ ingredients: longList(80) }), DEFAULT_PROFILE, {}, 'en');
  const parts = out.blocks.find(b => b.role === 'ingredients').parts;
  assert.equal(parts.length, 80);
  assert.equal(parts[79].text, 'Ingredient number 79');
});

test('a bigger piece of paper fits what a smaller one refused', () => {
  const rows = label({ ingredients: longList(30) });
  const small = resolveLabel(rows, { ...DEFAULT_PROFILE, widthMm: 57, heightMm: 32 }, {}, 'en');
  const big = resolveLabel(rows, { ...DEFAULT_PROFILE, widthMm: 102, heightMm: 76 }, {}, 'en');
  assert.equal(small.fits, false);
  assert.equal(big.fits, true, 'the advice the screen gives — use a bigger label — has to be true');
});

// ── The blocks ───────────────────────────────────────────────────────────────

test('the blocks come out in the reading order the label is meant to have', () => {
  const out = resolveLabel(label({ mayContain: ['nuts-almond'] }), DEFAULT_PROFILE, {}, 'en');
  assert.deepEqual(out.blocks.map(b => b.role), ['name', 'ingredients', 'contains', 'mayContain']);
  for (const role of out.blocks.map(b => b.role)) assert.ok(BLOCK_ROLES.includes(role));
});

test('an allergen is emphasised WHERE IT APPEARS, not only summarised underneath', () => {
  // The regulation asks for the allergen to stand out inside the list. A block
  // carrying one flat string could not say which words those are.
  const out = resolveLabel(label(), DEFAULT_PROFILE, {}, 'en');
  const parts = out.blocks.find(b => b.role === 'ingredients').parts;
  assert.deepEqual(parts.map(p => p.emphasise), [true, false, false, false]);
});

test('«may contain» is its own block and is never folded into «contains»', () => {
  // A warning that something MIGHT be present is a different statement from a
  // declaration that it IS, and the law treats them differently.
  const out = resolveLabel(label({ mayContain: ['nuts-almond'] }), DEFAULT_PROFILE, {}, 'en');
  const contains = out.blocks.find(b => b.role === 'contains').text;
  const may = out.blocks.find(b => b.role === 'mayContain').text;
  assert.match(contains, /Contains/);
  assert.match(may, /May contain/);
  assert.ok(!contains.includes('Almond'), 'a trace must never be declared as an ingredient');
});

test('with no allergens at all there is no «contains» line to print', () => {
  // "Contains: nothing" is not a sentence anybody prints.
  const out = resolveLabel(label({ ingredients: [ing('Water')], allergens: [] }), DEFAULT_PROFILE, {}, 'en');
  assert.deepEqual(out.blocks.map(b => b.role), ['name', 'ingredients']);
});

test('the label words follow the language it is asked in, which is the country s', () => {
  const en = resolveLabel(label(), DEFAULT_PROFILE, {}, 'en');
  const it = resolveLabel(label(), DEFAULT_PROFILE, {}, 'it');
  assert.match(en.blocks.find(b => b.role === 'ingredients').prefix, /^Ingredients: /);
  assert.match(it.blocks.find(b => b.role === 'ingredients').prefix, /^Ingredienti: /);
  assert.match(en.blocks.find(b => b.role === 'contains').text, /^Contains: /);
  assert.match(it.blocks.find(b => b.role === 'contains').text, /^Contiene: /);
});

test('the date is printed only when one is given for this batch', () => {
  const without = resolveLabel(label(), DEFAULT_PROFILE, {}, 'en');
  assert.ok(!without.blocks.some(b => b.role === 'date'));
  const withDate = resolveLabel(label(), DEFAULT_PROFILE, { dateText: 'Use by 12/09/2026' }, 'en');
  assert.equal(withDate.blocks.at(-1).text, 'Use by 12/09/2026');
});

test('the measured text is what is actually drawn, separators included', () => {
  // If blockText() and the renderer disagreed about the punctuation, the estimate
  // would be measuring a string nobody prints.
  const out = resolveLabel(label(), DEFAULT_PROFILE, {}, 'en');
  assert.equal(blockText(out.blocks.find(b => b.role === 'ingredients')),
    'Ingredients: Flour, Water, Olive oil, Salt.');
});

// ── The profile ──────────────────────────────────────────────────────────────

test('an unwritten profile answers with the stock this venue actually uses', () => {
  assert.deepEqual(normalizeLabelProfile(null), { ...DEFAULT_PROFILE });
  assert.deepEqual(normalizeLabelProfile(undefined), { ...DEFAULT_PROFILE });
  assert.deepEqual(normalizeLabelProfile({}), { ...DEFAULT_PROFILE });
});

test('a corrupt measurement falls back to the default rather than to zero', () => {
  // A 0 mm label is not a smaller answer, it is no label — and it would be drawn
  // as an empty rectangle with no error anywhere.
  for (const bad of [0, -5, 'wide', NaN, Infinity, 9999, null, {}, []]) {
    assert.equal(normalizeLabelProfile({ widthMm: bad }).widthMm, DEFAULT_PROFILE.widthMm,
      `widthMm: ${JSON.stringify(bad)} should not have been accepted`);
  }
});

test('a boolean is refused as a measurement, because Number(true) is 1', () => {
  assert.equal(normalizeLabelProfile({ widthMm: true }).widthMm, DEFAULT_PROFILE.widthMm);
  assert.equal(normalizeLabelProfile({ baseFontMm: true }).baseFontMm, DEFAULT_PROFILE.baseFontMm);
});

test('the date block stays OFF unless somebody switched it on', () => {
  // ⚠️ The opposite direction from the allergen switches, on purpose: this is the
  // one block that can print something FALSE — a shelf life nobody chose.
  assert.equal(normalizeLabelProfile({}).showDate, false);
  assert.equal(normalizeLabelProfile({ showDate: 'yes' }).showDate, false);
  assert.equal(normalizeLabelProfile({ showDate: 1 }).showDate, false);
  assert.equal(normalizeLabelProfile({ showDate: true }).showDate, true);
});

test('an unknown printer language or dpi falls back rather than reaching the printer', () => {
  assert.equal(normalizeLabelProfile({ printerLanguage: 'escpos' }).printerLanguage, 'os');
  assert.equal(normalizeLabelProfile({ dpi: 600 }).dpi, 203);
  for (const l of PRINTER_LANGUAGES) assert.equal(normalizeLabelProfile({ printerLanguage: l }).printerLanguage, l);
  for (const d of DPI_CHOICES) assert.equal(normalizeLabelProfile({ dpi: d }).dpi, d);
});

test('every preset size maps to a named page, and a custom one maps to none', () => {
  // label-print.css carries one static @page rule per preset; only a size that is
  // not on the list needs one built at runtime.
  for (const size of LABEL_SIZES) {
    assert.equal(sizeIdFor({ widthMm: size.widthMm, heightMm: size.heightMm }), size.id);
  }
  assert.equal(sizeIdFor({ widthMm: 80, heightMm: 40 }), null);
  assert.ok(LABEL_SIZES.some(s => s.id === DEFAULT_SIZE_ID));
});

test('the default profile IS the default preset — the two cannot drift apart', () => {
  const preset = LABEL_SIZES.find(s => s.id === DEFAULT_SIZE_ID);
  assert.equal(DEFAULT_PROFILE.widthMm, preset.widthMm);
  assert.equal(DEFAULT_PROFILE.heightMm, preset.heightMm);
  assert.equal(sizeIdFor(DEFAULT_PROFILE), DEFAULT_SIZE_ID);
});

test('the venue s chosen size is never overridden by a bigger default', () => {
  const out = resolveLabel(label(), { ...DEFAULT_PROFILE, widthMm: 102, heightMm: 76 }, {}, 'en');
  assert.equal(out.widthMm, 102);
  assert.equal(out.heightMm, 76);
});
