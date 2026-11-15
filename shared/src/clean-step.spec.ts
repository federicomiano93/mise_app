// The recipe book's clean-step rounding (Mise 2 only, the owner's decision of 16 Nov 2026): no original in js/, so this runs
// against the port alone. Every weight here is invented.

import { describe, expect, test } from 'vitest';
import { TOLERANCE, applyTargetTotal, cleanStepOf, roundToCleanStep } from './clean-step';

describe('roundToCleanStep: once, to 1 g under 250 g, 5 g up to 499 g, 10 g from 500 g', () => {
  test('the tolerance is 1%, and it is what chooses the step', () => {
    expect(TOLERANCE).toBe(0.01);
    // Half a step is the most a rounding moves a weight: 5 g on 500 g, 2.5 g on 250 g, both exactly 1%.
    expect(cleanStepOf(500)).toBe(10);
    expect(cleanStepOf(499)).toBe(5);
    expect(cleanStepOf(250)).toBe(5);
    expect(cleanStepOf(249)).toBe(1);
    expect(cleanStepOf(1)).toBe(1);
    expect(cleanStepOf(48000)).toBe(10);
  });

  test('the thresholds 249 / 250 and 499 / 500 g', () => {
    expect(roundToCleanStep(249)).toBe(249);
    expect(roundToCleanStep(250)).toBe(250);
    expect(roundToCleanStep(251)).toBe(250);
    expect(roundToCleanStep(253)).toBe(255);
    expect(roundToCleanStep(497)).toBe(495);
    expect(roundToCleanStep(498)).toBe(500);
    expect(roundToCleanStep(499)).toBe(500);
    expect(roundToCleanStep(500)).toBe(500);
    expect(roundToCleanStep(504)).toBe(500);
    expect(roundToCleanStep(505)).toBe(510);
  });

  test('.5 always goes UP, first to the whole gram, then on the step (chosen on that whole gram)', () => {
    expect(roundToCleanStep(12.5)).toBe(13);
    expect(roundToCleanStep(104.5)).toBe(105);
    expect(roundToCleanStep(249.5), '250 g, so the 5 g step').toBe(250);
    expect(roundToCleanStep(252.5), '253 g on the 5 g step').toBe(255);
    expect(roundToCleanStep(499.5), '500 g, so the 10 g step').toBe(500);
    expect(roundToCleanStep(1234.5)).toBe(1240);
    expect(roundToCleanStep(12.4999)).toBe(12);
  });

  test('floating-point noise does not stop a real .5 from going up', () => {
    expect(roundToCleanStep(12.499999999999998)).toBe(13);
    expect(roundToCleanStep(0.1 * 3 * 1000)).toBe(300);
  });

  test('never more than 1% away from the exact weight once past a gram', () => {
    for (let tenths = 10; tenths <= 200000; tenths += 7) {
      const exact = tenths / 10;
      const shown = roundToCleanStep(exact);
      // The whole-gram rounding adds up to half a gram on top of the step: 1% of the weight plus that half gram.
      expect(Math.abs(shown - exact), String(exact)).toBeLessThanOrEqual(TOLERANCE * exact + 0.5 + 1e-9);
    }
  });

  test('junk, 0 and negatives → 0, never NaN', () => {
    for (const junk of [0, -5, NaN, Infinity, -Infinity, undefined, null, 'abc', {}]) {
      expect(roundToCleanStep(junk), String(junk)).toBe(0);
      expect(cleanStepOf(junk), String(junk)).toBe(1);
    }
    expect(roundToCleanStep('260')).toBe(260);
    expect(roundToCleanStep(0.4)).toBe(0);
  });
});

describe('applyTargetTotal: one correction so the rows add up to the typed total', () => {
  const sum = (list: readonly number[]): number => list.reduce((a, b) => a + b, 0);

  test('nothing to correct: the clean steps already add up', () => {
    expect(applyTargetTotal([600, 300, 40], 940)).toStrictEqual({ amounts: [600, 300, 40], warning: null });
  });

  test('step 2: gram by gram where it hurts least, never past 1%, a small row never touched', () => {
    // 150.4 + 80.4 + 40.4 + 5.4 = 276.6 → 277; the steps give 150 + 80 + 40 + 5 = 275. The first gram on the 150 g row (+0.4%),
    // the second on the 80 g row (the 150 g row would be +1.06%); 40 g would be +1.5% and the 5 g row +11%.
    const out = applyTargetTotal([150.4, 80.4, 40.4, 5.4], 276.6);
    expect(out).toStrictEqual({ amounts: [151, 81, 40, 5], warning: null });
  });

  test('step 2: a row may take more than one gram while it stays within 1%', () => {
    const out = applyTargetTotal([240.45, 5.45, 5.45, 5.45, 5.45], 262.25);
    expect(out).toStrictEqual({ amounts: [242, 5, 5, 5, 5], warning: null });
  });

  test('step 2 downwards: a gram taken off where it hurts least', () => {
    // 120.6 → 121, 60.6 → 61, 5.6 → 6: 188 for 186.8 → 187.
    expect(applyTargetTotal([120.6, 60.6, 5.6], 186.8)).toStrictEqual({ amounts: [120, 61, 6], warning: null });
  });

  test('step 3: a whole 5 g step, up and down, when no gram row can take it', () => {
    // 497.4 → 495 twice, 5.2 → 5: 995 for 1000. +5 on the first 495 g row (0.5%); the 5 g row would be +15%.
    expect(applyTargetTotal([497.4, 497.4, 5.2], 1000)).toStrictEqual({ amounts: [500, 495, 5], warning: null });
    // 497.6 → 500 twice, 4.8 → 5: 1005 for 1000.
    expect(applyTargetTotal([497.6, 497.6, 4.8], 1000)).toStrictEqual({ amounts: [495, 500, 5], warning: null });
  });

  test('step 3 then step 4: a 10 g step where it hurts least, then the few grams left on the largest row', () => {
    // 604.4 → 600, 704.4 → 700, 804.4 → 800: 2100 for 2113. +10 hurts the 804.4 g row least (0.70%), then 3 g are left.
    const out = applyTargetTotal([604.4, 704.4, 804.4], 2113.2);
    expect(out).toStrictEqual({ amounts: [600, 700, 813], warning: null });
  });

  test('step 4 alone: a few grams no row can take within 1% go on the largest row, which loses its round number', () => {
    // 603.9 → 600, 252.6 → 255, 40 → 40: 895 for 897. 41 g would be +2.5%, and 2 g is less than a step.
    expect(applyTargetTotal([603.9, 252.6, 40], 896.5)).toStrictEqual({ amounts: [602, 255, 40], warning: null });
  });

  test('protection: a gap larger than the rounding could ever make → nothing corrected, a warning', () => {
    // At most half a step plus half a gram per row: 0.5 + 0.5 twice = 2 g. 100 g off is not a rounding.
    expect(applyTargetTotal([100, 200], 400)).toStrictEqual({ amounts: [100, 200], warning: { diff: 100 } });
    expect(applyTargetTotal([100, 200], 297)).toStrictEqual({ amounts: [100, 200], warning: { diff: -3 } });
  });

  test('protection: a correction that would bring a row to 0 g or below → nothing corrected, a warning', () => {
    // Five rows of 0.6 g read 1 g each: 5 g for 3 g. No row can lose a gram within 1%, and the largest would go to −1 g.
    expect(applyTargetTotal([0.6, 0.6, 0.6, 0.6, 0.6], 3)).toStrictEqual({ amounts: [1, 1, 1, 1, 1], warning: { diff: -2 } });
  });

  test('the corrected rows always add up to the typed total, or a warning says by how much they do not', () => {
    const rows = [1000, 640, 720, 310, 180, 95, 22, 14, 6, 3];
    const total = sum(rows);
    for (let target = 500; target <= 30000; target += 7) {
      const exact = rows.map(g => g * target / total);
      const out = applyTargetTotal(exact, target);
      if (out.warning === null) expect(sum(out.amounts), String(target)).toBe(target);
      else expect(target - sum(out.amounts), String(target)).toBe(out.warning.diff);
      expect(out.amounts.every(v => Number.isInteger(v)), String(target)).toBe(true);
    }
  });

  test('junk in: no NaN, no throw', () => {
    expect(applyTargetTotal([], 100)).toStrictEqual({ amounts: [], warning: null });
    expect(applyTargetTotal([NaN, -5, 10], 10)).toStrictEqual({ amounts: [0, 0, 10], warning: null });
    expect(applyTargetTotal([10, 20], NaN)).toStrictEqual({ amounts: [10, 20], warning: null });
  });
});
