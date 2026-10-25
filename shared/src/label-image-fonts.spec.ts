// Measuring like Pillow: every width the owner's script measured for the golden corpus must come out of the font
// table to the 64th of a pixel (the table and the corpus: label-image-fonts.ts, label-image-layout.spec.ts).

import { describe, expect, test } from 'vitest';
import { ascentOf, kernSixtyFourths, measureLikePillow, unsupportedChars } from './label-image-fonts';
import type { LabelFont } from './label-image-layout';
import { labelMetrics } from './label-image-metrics';
import { golden } from './fixtures/label-image-golden';

describe('measuring like Pillow', () => {
  const m = labelMetrics();
  const all = golden.products.flatMap(p => Object.entries(p.widths));

  test('every width the script measured', () => {
    expect(all.length).toBeGreaterThan(400);
    for (const [key, width] of all) {
      const [font, px, ...rest] = key.split('|');
      expect([key, measureLikePillow(m, rest.join('|'), font as LabelFont, Number(px))]).toEqual([key, width]);
    }
  });

  test('kerning is FreeType’s rounding, added as 64ths (the pair that rounds the other way at exactly half)', () => {
    // DejaVu Sans Bold «L”»: −491 units at 73 px is −17.5015 px, FreeType gives −17 (its fixed point), never −18.
    expect(kernSixtyFourths(-491, 73, 2048)).toBe(-17);
    expect(kernSixtyFourths(-55, 56, 2048)).toBe(-1);
    expect(kernSixtyFourths(57, 73, 2048)).toBe(2);
  });

  test('a character the font does not hold is NaN, never a guess, and is named once', () => {
    expect(measureLikePillow(m, 'pane ☃', 'regular', 73)).toBeNaN();
    expect(unsupportedChars(m, 'pane ☃ e ☃ e 🍞', 'regular', 73)).toEqual(['☃', '🍞']);
    expect(unsupportedChars(m, 'farina di GRANO, più già d’AVENA — 5° € “x”', 'regular', 73)).toEqual([]);
    expect(measureLikePillow(m, 'pane', 'regular', 999)).toBeNaN();
  });

  test('the ascent Pillow anchors text by', () => {
    expect(ascentOf(m, 'regular', 73)).toBe(68);
    expect(ascentOf(m, 'title', 128)).toBeGreaterThan(100);
    expect(ascentOf(m, 'title', 1)).toBe(0);
  });
});
