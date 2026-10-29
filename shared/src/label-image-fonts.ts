// label-image-fonts.ts — measuring text the way the owner's label script measures it, so Mise breaks the ingredients
// into the same lines and shrinks the title to the same size. NEW IN MISE 2.
//
// ⚠️ WHY NOT ASK THE BROWSER. The script measures with Pillow, which asks FreeType for HINTED advances — every letter a
// whole number of pixels at that size — and adds kerning in a way of its own: FreeType's kerning rounded to whole
// pixels, added by Pillow as 64ths of a pixel. A browser measures unhinted, in fractions, with its own kerning. A pixel
// or two over a 2360-pixel line is enough to send a word to the next line, and a label that breaks differently from the
// one on the owner's paper today is not «the same label».
//
// So the label's metrics are a TABLE (fixtures/label-image-metrics.json), written by the golden harness
// (algprobe/label-golden/build_fonts.py, outside the repository) from Pillow itself on the official font files the
// vendored subsets were cut from: each character's advance at each size the layout uses, and each font's kerning pairs
// in font units. The harness checked this file's kerning arithmetic against Pillow on every pair at every size; the
// spec checks it against every width the script reported for the golden corpus.

import type { LabelFont } from './label-image-layout';

// The table as stored: per font, the characters it holds (code points), the kerning pairs [first, second, units], and
// per pixel size the ascent and the advances aligned with `chars`.
export interface StoredFontMetrics {
  readonly upm: number;
  readonly chars: readonly number[];
  readonly kern: readonly (readonly [number, number, number])[];
  readonly sizes: Readonly<Record<string, { readonly ascent: number; readonly adv: readonly number[] }>>;
}
export interface StoredLabelMetrics {
  readonly fonts: Readonly<Record<LabelFont, StoredFontMetrics>>;
}

interface FontTable {
  readonly upm: number;
  readonly kern: ReadonlyMap<number, number>; // first * 0x110000 + second → units
  readonly sizes: ReadonlyMap<number, { readonly ascent: number; readonly adv: ReadonlyMap<number, number> }>;
}
export interface LabelMetrics {
  readonly fonts: Readonly<Record<LabelFont, FontTable>>;
}

const pairKey = (a: number, b: number): number => a * 0x110000 + b;

// The stored table made ready for lookups (once, when the label screen loads it).
export function loadMetrics(stored: StoredLabelMetrics): LabelMetrics {
  const font = (f: StoredFontMetrics): FontTable => ({
    upm: f.upm,
    kern: new Map(f.kern.map(([a, b, v]) => [pairKey(a, b), v])),
    sizes: new Map(Object.entries(f.sizes).map(([px, s]) => [
      Number(px),
      { ascent: s.ascent, adv: new Map(f.chars.map((cp, i) => [cp, s.adv[i] as number])) },
    ])),
  });
  return { fonts: { regular: font(stored.fonts.regular), bold: font(stored.fonts.bold), title: font(stored.fonts.title) } };
}

// FreeType's fixed-point arithmetic (FT_DivFix, FT_MulFix: on magnitudes, rounded, sign put back).
const sign = (x: number): number => (x < 0 ? -1 : 1);
const ftDivFix = (a: number, b: number): number =>
  sign(a) * sign(b) * Math.floor((Math.abs(a) * 65536 + Math.floor(Math.abs(b) / 2)) / Math.abs(b));
const ftMulFix = (a: number, b: number): number =>
  sign(a) * sign(b) * Math.floor((Math.abs(a) * Math.abs(b) + 0x8000) / 65536);

// A pair's kerning as Pillow adds it, in 64ths of a pixel: FT_Get_Kerning (FT_KERNING_DEFAULT: scaled, then rounded
// to whole pixels — FT_PIX_ROUND), whose PIXEL count Pillow adds to a 26.6 advance.
export function kernSixtyFourths(units: number, px: number, upm: number): number {
  const v = ftMulFix(units, ftDivFix(px * 64, upm));
  return Math.floor((v + 32) / 64);
}

// The width of `text`, as Pillow 12's basic layout gives it (ImageDraw.textlength), or NaN when a character has no
// advance in the table at that size (a character the font does not have — see unsupportedChars).
export function measureLikePillow(metrics: LabelMetrics, text: string, font: LabelFont, px: number): number {
  const f = metrics.fonts[font];
  const size = f.sizes.get(px);
  if (size === undefined) return Number.NaN;
  let sixtyFourths = 0;
  let prev: number | null = null;
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    const adv = size.adv.get(cp);
    if (adv === undefined) return Number.NaN;
    sixtyFourths += adv * 64;
    if (prev !== null) {
      const units = f.kern.get(pairKey(prev, cp));
      if (units !== undefined) sixtyFourths += kernSixtyFourths(units, px, f.upm);
    }
    prev = cp;
  }
  return sixtyFourths / 64;
}

// The characters of `text` that a face cannot print at a size (no glyph in the vendored font), each listed once.
// ⚠️ A LABEL WITH ONE OF THESE IS REFUSED: the browser would draw it in another font, or as an empty box, on a
// document somebody's food wears.
export function unsupportedChars(metrics: LabelMetrics, text: string, font: LabelFont, px: number): string[] {
  const adv = metrics.fonts[font].sizes.get(px)?.adv;
  const out: string[] = [];
  for (const ch of text) {
    if (/\s/u.test(ch)) continue;
    if (adv?.get(ch.codePointAt(0) as number) === undefined && !out.includes(ch)) out.push(ch);
  }
  return out;
}

// The top of the ascender above the baseline at that size, in pixels (0 for a size not in the table).
export function ascentOf(metrics: LabelMetrics, font: LabelFont, px: number): number {
  return metrics.fonts[font].sizes.get(px)?.ascent ?? 0;
}
