// Tests for the unified dough math (P15 — the owner cannot read code).
//
// Stage 0 added a generic scaleRecipe; Stage 1 made scaleFocaccia/Brioche/Sourdough
// thin wrappers over it. To stay a REAL anti-regression guard (not a tautology that
// compares a function to itself), these tests keep an INDEPENDENT copy of the dough
// math exactly as it was BEFORE unification — the legacy* functions below — and
// assert the live functions against it:
//   • Brioche and Sourdough must equal the legacy math EXACTLY, even on edited
//     recipes and across the full knob range.
//   • Focaccia, intentionally moved onto the clean method, must stay within a tiny
//     tolerance of the legacy focaccia math (and is exactly equal at the 0.65%
//     default) — the small drift is a correction at high yeast %, see the project plan.
//
// The recipes are the invented fixture bakery's (tests/fixtures/bakery-config.mjs),
// copied here so the test stays pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scaleRecipe,
  scaleFocaccia,
  scaleBrioche,
  scaleSourdough,
} from '../js/calculator-dough-math.js';

const FOCACCIA = { flourBlu: 260, flourT65: 290, malt: 4, sugar: 10, salt: 12, yeast: 3.4, oil: 50, water1: 340, water2: 30 };
const BRIOCHE = { flour: 3000, yeast: 120, water: 1500 };
const SOURDOUGH = { flourBlu: 2400, flourT65: 2400, flourWhole: 600, water1: 3700, starter: 980, malt: 25, salt: 115, water2: 250 };

const sum = (arr) => arr.reduce((a, b) => a + b, 0);

// ── Legacy reference math (verbatim copy of the pre-unification functions) ───────
const legacyTotal = (r) => Object.values(r).reduce((s, v) => s + v, 0);
function legacyFixRounding(amounts, total) {
  const rounded = amounts.map(Math.round);
  const diff = Math.round(total) - rounded.reduce((a, b) => a + b, 0);
  if (diff !== 0) { const m = rounded.indexOf(Math.max(...rounded)); rounded[m] += diff; }
  return rounded;
}
function legacyFocaccia(R, target, yeastPct) {
  const baseTotal = legacyTotal(R), scale = target / baseTotal, totalFlour = R.flourBlu + R.flourT65;
  const yeast = totalFlour * scale * (yeastPct / 100), remaining = target - yeast, nonYeastBase = baseTotal - R.yeast;
  return legacyFixRounding([
    R.flourBlu * remaining / nonYeastBase, R.flourT65 * remaining / nonYeastBase,
    R.malt * remaining / nonYeastBase, R.sugar * remaining / nonYeastBase, R.salt * remaining / nonYeastBase,
    yeast, R.oil * remaining / nonYeastBase, R.water1 * remaining / nonYeastBase, R.water2 * remaining / nonYeastBase,
  ], target);
}
function legacyBrioche(R, target, yeastPct) {
  const yeastBase = R.yeast * (yeastPct / 4), prov = R.flour + yeastBase + R.water, f = target / prov;
  return legacyFixRounding([R.flour * f, yeastBase * f, R.water * f], target);
}
function legacySourdough(R, target, starterPct) {
  const sb = R.starter * (starterPct / 18);
  const prov = R.flourBlu + R.flourT65 + R.flourWhole + R.water1 + sb + R.malt + R.salt + R.water2, f = target / prov;
  return legacyFixRounding([R.flourBlu * f, R.flourT65 * f, R.flourWhole * f, R.water1 * f, sb * f, R.malt * f, R.salt * f, R.water2 * f], target);
}

// Edited-recipe variants — what a user might save after changing a recipe. Brioche
// and Sourdough must still match the legacy math on ALL of these.
const mul = (o, fn) => Object.fromEntries(Object.entries(o).map(([k, v], i) => [k, Math.max(0.1, fn(v, i, k))]));
const variants = (base) => [
  base,
  mul(base, (v) => v * 1.37),
  mul(base, (v) => v * 0.6),
  mul(base, (v, i) => v * (1 + 0.2 * ((i % 3) - 1))),
  mul(base, (v, i, k) => (k.startsWith('flour') ? v * 1.5 : v * 0.8)),
];

// Focaccia divergence budget (measured, not guessed): ≤2 g at normal settings,
// ≤6 g across the full knob range on the default recipe; exact at the 0.65% default.
const FOCACCIA_TOLERANCE_NORMAL_G = 2;
const FOCACCIA_TOLERANCE_FULL_G = 6;

// ── Brioche: byte-identical to the legacy math, even on edited recipes ───────────

test('scaleBrioche equals the legacy math across the full knob range and edited recipes', () => {
  // Brioche yeast knob: min 0.1, max 6 (calculator.html #b-yeast-pct).
  for (const R of variants(BRIOCHE)) {
    // Fractional targets (4620.6, 9240.4) keep a case where Math.round(target) differs from the target.
    for (const target of [2000, 4620, 4620.6, 9000, 9240, 9240.4, 18000]) {
      for (const pct of [0.1, 2, 4, 6]) {
        assert.deepEqual(
          scaleBrioche(R, target, pct),
          legacyBrioche(R, target, pct),
          `brioche mismatch at target=${target}, pct=${pct}`
        );
      }
    }
  }
});

// ── Sourdough: byte-identical to the legacy math, even on edited recipes ─────────

test('scaleSourdough equals the legacy math across the full knob range and edited recipes', () => {
  // Sourdough starter knob: min 5, max 40 (calculator.html #s-starter-pct).
  for (const R of variants(SOURDOUGH)) {
    for (const target of [5000, 9000, 18100]) {
      for (const pct of [5, 12, 18, 25, 40]) {
        assert.deepEqual(
          scaleSourdough(R, target, pct),
          legacySourdough(R, target, pct),
          `sourdough mismatch at target=${target}, pct=${pct}`
        );
      }
    }
  }
});

// ── Focaccia: exact at the default, within tolerance elsewhere ───────────────────

test('scaleFocaccia equals the legacy math exactly at the shipped default (5000 g, 0.65%)', () => {
  assert.deepEqual(scaleFocaccia(FOCACCIA, 5000, 0.65), legacyFocaccia(FOCACCIA, 5000, 0.65));
});

function focacciaMaxDiff(targets, pcts) {
  let maxDiff = 0, worst = null;
  for (const target of targets) {
    for (const pct of pcts) {
      const a = scaleFocaccia(FOCACCIA, target, pct);
      const b = legacyFocaccia(FOCACCIA, target, pct);
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i]);
        if (d > maxDiff) { maxDiff = d; worst = { target, pct, i, unified: a[i], legacy: b[i] }; }
      }
    }
  }
  return { maxDiff, worst };
}

test('scaleFocaccia stays within 2 g of the legacy math at normal settings (yeast 0.5–1.5%)', () => {
  const { maxDiff, worst } = focacciaMaxDiff([1000, 3217, 5000, 9000, 15000], [0.5, 0.65, 1, 1.5]);
  assert.ok(maxDiff <= FOCACCIA_TOLERANCE_NORMAL_G, `focaccia diverged by ${maxDiff} g at ${JSON.stringify(worst)}`);
});

test('scaleFocaccia stays within 6 g of the legacy math across the full knob range (yeast 0.1–3%, ≤25 kg)', () => {
  // Focaccia yeast knob: min 0.1, max 3, step 0.05 (calculator.html #f-yeast-pct).
  const targets = [], pcts = [];
  for (let t = 300; t <= 25000; t += 100) targets.push(t);
  for (let p = 0.1; p <= 3.0001; p += 0.05) pcts.push(Math.round(p * 100) / 100);
  const { maxDiff, worst } = focacciaMaxDiff(targets, pcts);
  assert.ok(maxDiff <= FOCACCIA_TOLERANCE_FULL_G, `focaccia diverged by ${maxDiff} g at ${JSON.stringify(worst)}`);
});

// ── scaleRecipe's own properties (the engine behind the wrappers) ────────────────

test('scaleRecipe with no leavening scales pro-rata and sums to the target', () => {
  const base = { a: 100, b: 200, c: 300 };
  const spec = { amounts: base, leaveningKey: null, baselinePct: null };
  const ideal = (target) => Object.values(base).map(g => g * target / 600);
  for (const target of [600, 1234, 9999]) {
    const out = scaleRecipe(spec, target, 0);
    assert.equal(sum(out), Math.round(target), `no-leavening sum at ${target}`);
    ideal(target).forEach((v, i) => {
      assert.ok(Math.abs(out[i] - v) <= 2, `no-leavening proportion at ${target}, i=${i}: ${out[i]} vs ${v}`);
    });
  }
});

test('scaleRecipe never produces NaN on a zero-mass recipe', () => {
  const spec = { amounts: { a: 0, b: 0 }, leaveningKey: null, baselinePct: null };
  assert.deepEqual(scaleRecipe(spec, 1000, 0), [0, 0]);
});

test('scaleRecipe output always sums exactly to Math.round(target)', () => {
  const cases = [
    [{ amounts: FOCACCIA, leaveningKey: 'yeast', baselinePct: 3.4 / 550 * 100 }, 5000, 0.65],
    [{ amounts: BRIOCHE, leaveningKey: 'yeast', baselinePct: 4 }, 9240, 4],
    [{ amounts: SOURDOUGH, leaveningKey: 'starter', baselinePct: 18 }, 9000, 18],
    [{ amounts: SOURDOUGH, leaveningKey: 'starter', baselinePct: 18 }, 18100, 25],
  ];
  for (const [spec, target, pct] of cases) {
    assert.equal(sum(scaleRecipe(spec, target, pct)), Math.round(target));
  }
});
