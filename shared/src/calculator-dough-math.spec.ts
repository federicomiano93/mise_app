// Unit tests for the dough-scaling math (P15 — the owner cannot read code, so these tests are the safety net
// for the most important calculation in the app), run against BOTH implementations: the TypeScript port in
// shared/ and js/calculator-dough-math.js, which the live app uses today. Ported from
// tests/dough-math.test.mjs and tests/unified-scaler.test.mjs; the two must stay equal until the switch to
// Mise 2.
//
// They lock the exact per-ingredient grams for the shipped default recipes, and the core invariant: the
// rounded integers shown on screen always sum EXACTLY to the target raw weight. If a future change drifts the
// math by even a gram, these fail.
//
// calculator-dough-math.ts is a FULL port, so parity.spec.ts pairs it (same names, same function shapes).
//
// PORTED from tests/dough-math.test.mjs: all 14 tests. From tests/unified-scaler.test.mjs: all 8 tests.
// The recipes are the shipped defaults, copied here so the specs stay self-contained and pure.

import { describe, expect, test } from 'vitest';
import * as ported from './calculator-dough-math';
import * as legacyJs from '../../js/calculator-dough-math.js';

const legacy = legacyJs as unknown as typeof ported;

const FOCACCIA = { flourBlu: 278, flourT65: 278, malt: 3, sugar: 8, salt: 11, yeast: 3.6, oil: 56, water1: 334, water2: 24 };
const BRIOCHE = { flour: 3185, yeast: 127.4, water: 1575 };
const SOURDOUGH = { flourBlu: 2560, flourT65: 2560, flourWhole: 570, water1: 3800, starter: 1024, malt: 30, salt: 124, water2: 300 };

const sum = (arr: readonly number[]): number => arr.reduce((a, b) => a + b, 0);

// ── Legacy reference math (verbatim copy of the pre-unification functions, from unified-scaler.test.mjs) ──
// An INDEPENDENT copy of the dough math as it was before unification, so the live functions are compared with
// something that is not themselves.
type Amounts = Record<string, number>;
const legacyTotal = (r: Amounts): number => Object.values(r).reduce((s, v) => s + v, 0);
function legacyFixRounding(amounts: number[], total: number): number[] {
  const rounded = amounts.map(Math.round);
  const diff = Math.round(total) - rounded.reduce((a, b) => a + b, 0);
  if (diff !== 0) { const m = rounded.indexOf(Math.max(...rounded)); rounded[m] = (rounded[m] as number) + diff; }
  return rounded;
}
function legacyFocaccia(R: Amounts, target: number, yeastPct: number): number[] {
  const f = R as Record<string, number> & { flourBlu: number; flourT65: number; yeast: number };
  const baseTotal = legacyTotal(R), scale = target / baseTotal, totalFlour = f.flourBlu + f.flourT65;
  const yeast = totalFlour * scale * (yeastPct / 100), remaining = target - yeast, nonYeastBase = baseTotal - f.yeast;
  const r = (k: string): number => (R[k] as number) * remaining / nonYeastBase;
  return legacyFixRounding([r('flourBlu'), r('flourT65'), r('malt'), r('sugar'), r('salt'), yeast, r('oil'), r('water1'), r('water2')], target);
}
function legacyBrioche(R: Amounts, target: number, yeastPct: number): number[] {
  const flour = R['flour'] as number, water = R['water'] as number;
  const yeastBase = (R['yeast'] as number) * (yeastPct / 4), prov = flour + yeastBase + water, f = target / prov;
  return legacyFixRounding([flour * f, yeastBase * f, water * f], target);
}
function legacySourdough(R: Amounts, target: number, starterPct: number): number[] {
  const g = (k: string): number => R[k] as number;
  const sb = g('starter') * (starterPct / 18);
  const prov = g('flourBlu') + g('flourT65') + g('flourWhole') + g('water1') + sb + g('malt') + g('salt') + g('water2'), f = target / prov;
  return legacyFixRounding([g('flourBlu') * f, g('flourT65') * f, g('flourWhole') * f, g('water1') * f, sb * f, g('malt') * f, g('salt') * f, g('water2') * f], target);
}

// Edited-recipe variants — what a user might save after changing a recipe.
const mul = (o: Amounts, fn: (v: number, i: number, k: string) => number): Amounts =>
  Object.fromEntries(Object.entries(o).map(([k, v], i) => [k, Math.max(0.1, fn(v, i, k))]));
const variants = (base: Amounts): Amounts[] => [
  base,
  mul(base, (v) => v * 1.37),
  mul(base, (v) => v * 0.6),
  mul(base, (v, i) => v * (1 + 0.2 * ((i % 3) - 1))),
  mul(base, (v, i, k) => (k.startsWith('flour') ? v * 1.5 : v * 0.8)),
];

// Focaccia divergence budget (measured, not guessed): ≤2 g at normal settings, ≤6 g across the full knob range
// on the default recipe; exact at the 0.65% default.
const FOCACCIA_TOLERANCE_NORMAL_G = 2;
const FOCACCIA_TOLERANCE_FULL_G = 6;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  // ── recipeTotal ───────────────────────────────────────────────────────────

  test('recipeTotal sums every ingredient amount', () => {
    expect(m.recipeTotal({ a: 1, b: 2, c: 3 })).toBe(6);
    expect(m.recipeTotal(BRIOCHE)).toBe(3185 + 127.4 + 1575);
  });

  // ── fixRounding (the rounding fairness rule) ──────────────────────────────

  test('fixRounding leaves already-exact integers untouched', () => {
    expect(m.fixRounding([10, 20, 30], 60)).toStrictEqual([10, 20, 30]);
  });

  test('fixRounding gives a positive residual to the largest ingredient', () => {
    // [1,1,1] sums to 3 but the target rounds to 4 → the extra gram goes to the first largest.
    expect(m.fixRounding([1.4, 1.4, 1.4], 4)).toStrictEqual([2, 1, 1]);
  });

  test('fixRounding takes a negative residual off the largest ingredient', () => {
    // [2,2] sums to 4 but the target rounds to 3 → remove a gram from the largest.
    expect(m.fixRounding([1.6, 1.6], 3)).toStrictEqual([1, 2]);
  });

  test('fixRounding output always sums exactly to Math.round(total)', () => {
    const cases: [number[], number][] = [
      [[1.1, 2.2, 3.3, 4.4], 11],
      [[100.5, 0.5, 0.5], 101],
      [[33.3, 33.3, 33.3], 100],
    ];
    for (const [amounts, total] of cases) {
      expect(sum(m.fixRounding(amounts, total))).toBe(Math.round(total));
    }
  });

  // ── Focaccia ──────────────────────────────────────────────────────────────

  test('scaleFocaccia matches the locked golden breakdown (5000 g, 0.65%)', () => {
    // [flourBlu, flourT65, malt, sugar, salt, yeast, oil, water1, water2]
    expect(m.scaleFocaccia(FOCACCIA, 5000, 0.65)).toStrictEqual([1396, 1396, 15, 40, 55, 18, 281, 1678, 121]);
  });

  test('scaleFocaccia ingredients always sum to the target', () => {
    for (const target of [1000, 3217, 5000, 12345]) {
      expect(sum(m.scaleFocaccia(FOCACCIA, target, 0.65))).toBe(Math.round(target));
    }
  });

  // ── Brioche ───────────────────────────────────────────────────────────────

  test('scaleBrioche at the recipe baseline returns the rounded recipe itself', () => {
    // target = provisional total (4887.4) and yeast 4% → factor 1 → the recipe values.
    expect(m.scaleBrioche(BRIOCHE, 4887.4, 4)).toStrictEqual([3185, 127, 1575]);
  });

  test('scaleBrioche matches the locked golden breakdown (9774.8 g, 4%)', () => {
    expect(m.scaleBrioche(BRIOCHE, 9774.8, 4)).toStrictEqual([6370, 255, 3150]);
  });

  test('scaleBrioche ingredients always sum to the target', () => {
    for (const target of [2000, 4887, 9775]) {
      expect(sum(m.scaleBrioche(BRIOCHE, target, 4))).toBe(Math.round(target));
    }
  });

  test('a higher yeast percentage raises the yeast share', () => {
    const low = m.scaleBrioche(BRIOCHE, 9000, 4);
    const high = m.scaleBrioche(BRIOCHE, 9000, 8);
    expect(high[1] as number, 'yeast (index 1) should grow with the percentage').toBeGreaterThan(low[1] as number);
  });

  // ── Sourdough ─────────────────────────────────────────────────────────────

  test('scaleSourdough matches the locked golden breakdown (9000 g, 18%)', () => {
    // [flourBlu, flourT65, flourWhole, water1, starter, malt, salt, water2]
    expect(m.scaleSourdough(SOURDOUGH, 9000, 18)).toStrictEqual([2101, 2101, 468, 3117, 840, 25, 102, 246]);
  });

  test('scaleSourdough ingredients always sum to the target', () => {
    for (const target of [5000, 9000, 18100]) {
      expect(sum(m.scaleSourdough(SOURDOUGH, target, 18))).toBe(Math.round(target));
    }
  });

  test('a higher starter percentage raises the starter share', () => {
    const low = m.scaleSourdough(SOURDOUGH, 9000, 18);
    const high = m.scaleSourdough(SOURDOUGH, 9000, 25);
    expect(high[4] as number, 'starter (index 4) should grow with the percentage').toBeGreaterThan(low[4] as number);
  });

  // ── Brioche: byte-identical to the legacy math, even on edited recipes ────

  test('scaleBrioche equals the pre-unification math across the full knob range and edited recipes', () => {
    // Brioche yeast knob: min 0.1, max 6.
    for (const R of variants(BRIOCHE)) {
      for (const target of [2000, 4887.4, 9000, 9774.8, 18000]) {
        for (const pct of [0.1, 2, 4, 6]) {
          expect(m.scaleBrioche(R, target, pct), `brioche mismatch at target=${target}, pct=${pct}`)
            .toStrictEqual(legacyBrioche(R, target, pct));
        }
      }
    }
  });

  // ── Sourdough: byte-identical to the legacy math, even on edited recipes ──

  test('scaleSourdough equals the pre-unification math across the full knob range and edited recipes', () => {
    // Sourdough starter knob: min 5, max 40.
    for (const R of variants(SOURDOUGH)) {
      for (const target of [5000, 9000, 18100]) {
        for (const pct of [5, 12, 18, 25, 40]) {
          expect(m.scaleSourdough(R, target, pct), `sourdough mismatch at target=${target}, pct=${pct}`)
            .toStrictEqual(legacySourdough(R, target, pct));
        }
      }
    }
  });

  // ── Focaccia: exact at the default, within tolerance elsewhere ────────────

  test('scaleFocaccia equals the pre-unification math exactly at the shipped default (5000 g, 0.65%)', () => {
    expect(m.scaleFocaccia(FOCACCIA, 5000, 0.65)).toStrictEqual(legacyFocaccia(FOCACCIA, 5000, 0.65));
  });

  function focacciaMaxDiff(targets: number[], pcts: number[]): { maxDiff: number; worst: unknown } {
    let maxDiff = 0, worst: unknown = null;
    for (const target of targets) {
      for (const pct of pcts) {
        const a = m.scaleFocaccia(FOCACCIA, target, pct);
        const b = legacyFocaccia(FOCACCIA, target, pct);
        for (let i = 0; i < a.length; i++) {
          const d = Math.abs((a[i] as number) - (b[i] as number));
          if (d > maxDiff) { maxDiff = d; worst = { target, pct, i, unified: a[i], legacy: b[i] }; }
        }
      }
    }
    return { maxDiff, worst };
  }

  test('scaleFocaccia stays within 2 g of the pre-unification math at normal settings (yeast 0.5–1.5%)', () => {
    const { maxDiff, worst } = focacciaMaxDiff([1000, 3217, 5000, 9000, 15000], [0.5, 0.65, 1, 1.5]);
    expect(maxDiff, `focaccia diverged by ${maxDiff} g at ${JSON.stringify(worst)}`).toBeLessThanOrEqual(FOCACCIA_TOLERANCE_NORMAL_G);
  });

  test('scaleFocaccia stays within 6 g of the pre-unification math across the full knob range (yeast 0.1–3%, ≤25 kg)', () => {
    // Focaccia yeast knob: min 0.1, max 3, step 0.05.
    const targets: number[] = [], pcts: number[] = [];
    for (let t = 300; t <= 25000; t += 100) targets.push(t);
    for (let p = 0.1; p <= 3.0001; p += 0.05) pcts.push(Math.round(p * 100) / 100);
    const { maxDiff, worst } = focacciaMaxDiff(targets, pcts);
    expect(maxDiff, `focaccia diverged by ${maxDiff} g at ${JSON.stringify(worst)}`).toBeLessThanOrEqual(FOCACCIA_TOLERANCE_FULL_G);
  });

  // ── scaleRecipe's own properties (the engine behind the wrappers) ─────────

  test('scaleRecipe with no leavening scales pro-rata and sums to the target', () => {
    const base = { a: 100, b: 200, c: 300 };
    const spec = { amounts: base, leaveningKey: null, baselinePct: null };
    const ideal = (target: number): number[] => Object.values(base).map(g => g * target / 600);
    for (const target of [600, 1234, 9999]) {
      const out = m.scaleRecipe(spec, target, 0);
      expect(sum(out), `no-leavening sum at ${target}`).toBe(Math.round(target));
      ideal(target).forEach((v, i) => {
        expect(Math.abs((out[i] as number) - v), `no-leavening proportion at ${target}, i=${i}: ${out[i]} vs ${v}`).toBeLessThanOrEqual(2);
      });
    }
  });

  test('scaleRecipe never produces NaN on a zero-mass recipe', () => {
    const spec = { amounts: { a: 0, b: 0 }, leaveningKey: null, baselinePct: null };
    expect(m.scaleRecipe(spec, 1000, 0)).toStrictEqual([0, 0]);
  });

  test('scaleRecipe output always sums exactly to Math.round(target)', () => {
    const cases: [ported.ScaleSpec, number, number][] = [
      [{ amounts: FOCACCIA, leaveningKey: 'yeast', baselinePct: 3.6 / 556 * 100 }, 5000, 0.65],
      [{ amounts: BRIOCHE, leaveningKey: 'yeast', baselinePct: 4 }, 9774.8, 4],
      [{ amounts: SOURDOUGH, leaveningKey: 'starter', baselinePct: 18 }, 9000, 18],
      [{ amounts: SOURDOUGH, leaveningKey: 'starter', baselinePct: 18 }, 18100, 25],
    ];
    for (const [spec, target, pct] of cases) {
      expect(sum(m.scaleRecipe(spec, target, pct))).toBe(Math.round(target));
    }
  });
});
