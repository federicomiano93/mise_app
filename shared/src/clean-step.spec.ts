// The recipe book's clean-step rounding (Mise 2 only, the owner's decision of 16 Nov 2026): no original in js/, so this runs
// against the port alone. Every weight here is invented.

import { describe, expect, test } from 'vitest';
import { TOLERANCE, cleanStepOf, roundToCleanStep } from './clean-step';

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
