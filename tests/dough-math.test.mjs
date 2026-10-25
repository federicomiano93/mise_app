// Unit tests for the dough-scaling math (P15 — the owner cannot read code, so
// these tests are the safety net for the most important calculation in the app).
// They lock the exact per-ingredient grams for the shipped default recipes, and
// the core invariant: the rounded integers shown on screen always sum EXACTLY to
// the target raw weight. If a future change drifts the math by even a gram, these
// fail.
//
// The recipes below are the shipped defaults (RECIPE_DEFAULTS in recipes.js),
// copied here so the test stays self-contained and pure (recipes.js itself reads
// localStorage on import and cannot be loaded under Node).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recipeTotal,
  fixRounding,
  scaleFocaccia,
  scaleBrioche,
  scaleSourdough,
} from '../js/calculator-dough-math.js';

const FOCACCIA = { flourBlu: 260, flourT65: 290, malt: 4, sugar: 10, salt: 12, yeast: 3.4, oil: 50, water1: 340, water2: 30 };
const BRIOCHE = { flour: 3000, yeast: 120, water: 1500 };
const SOURDOUGH = { flourBlu: 2400, flourT65: 2400, flourWhole: 600, water1: 3700, starter: 980, malt: 25, salt: 115, water2: 250 };

const sum = (arr) => arr.reduce((a, b) => a + b, 0);

// ── recipeTotal ───────────────────────────────────────────────────────────────

test('recipeTotal sums every ingredient amount', () => {
  assert.equal(recipeTotal({ a: 1, b: 2, c: 3 }), 6);
  assert.equal(recipeTotal(BRIOCHE), 3000 + 120 + 1500);
});

// ── fixRounding (the rounding fairness rule) ────────────────────────────────────

test('fixRounding leaves already-exact integers untouched', () => {
  assert.deepEqual(fixRounding([10, 20, 30], 60), [10, 20, 30]);
});

test('fixRounding gives a positive residual to the largest ingredient', () => {
  // [1,1,1] sums to 3 but the target rounds to 4 → the extra gram goes to the first largest.
  assert.deepEqual(fixRounding([1.4, 1.4, 1.4], 4), [2, 1, 1]);
});

test('fixRounding takes a negative residual off the largest ingredient', () => {
  // [2,2] sums to 4 but the target rounds to 3 → remove a gram from the largest.
  assert.deepEqual(fixRounding([1.6, 1.6], 3), [1, 2]);
});

test('fixRounding output always sums exactly to Math.round(total)', () => {
  const cases = [
    [[1.1, 2.2, 3.3, 4.4], 11],
    [[100.5, 0.5, 0.5], 101],
    [[33.3, 33.3, 33.3], 100],
  ];
  for (const [amounts, total] of cases) {
    assert.equal(sum(fixRounding(amounts, total)), Math.round(total));
  }
});

// ── Focaccia ────────────────────────────────────────────────────────────────────

test('scaleFocaccia matches the locked golden breakdown (5000 g, 0.65%)', () => {
  // [flourBlu, flourT65, malt, sugar, salt, yeast, oil, water1, water2]
  assert.deepEqual(scaleFocaccia(FOCACCIA, 5000, 0.65), [1301, 1451, 20, 50, 60, 18, 250, 1700, 150]);
});

test('scaleFocaccia ingredients always sum to the target', () => {
  for (const target of [1000, 3217, 5000, 12345]) {
    assert.equal(sum(scaleFocaccia(FOCACCIA, target, 0.65)), Math.round(target));
  }
});

// ── Brioche ──────────────────────────────────────────────────────────────────────

test('scaleBrioche at the recipe baseline returns the rounded recipe itself', () => {
  // target = provisional total (4620) and yeast 4% → factor 1 → the recipe values.
  assert.deepEqual(scaleBrioche(BRIOCHE, 4620, 4), [3000, 120, 1500]);
});

test('scaleBrioche matches the locked golden breakdown (9240 g, 4%)', () => {
  assert.deepEqual(scaleBrioche(BRIOCHE, 9240, 4), [6000, 240, 3000]);
});

test('scaleBrioche ingredients always sum to the target', () => {
  for (const target of [2000, 4620, 9240]) {
    assert.equal(sum(scaleBrioche(BRIOCHE, target, 4)), Math.round(target));
  }
});

test('a higher yeast percentage raises the yeast share', () => {
  const low = scaleBrioche(BRIOCHE, 9000, 4);
  const high = scaleBrioche(BRIOCHE, 9000, 8);
  assert.ok(high[1] > low[1], 'yeast (index 1) should grow with the percentage');
});

// ── Sourdough ─────────────────────────────────────────────────────────────────────

test('scaleSourdough matches the locked golden breakdown (9000 g, 18%)', () => {
  // [flourBlu, flourT65, flourWhole, water1, starter, malt, salt, water2]
  assert.deepEqual(scaleSourdough(SOURDOUGH, 9000, 18), [2063, 2063, 516, 3181, 842, 21, 99, 215]);
});

test('scaleSourdough ingredients always sum to the target', () => {
  for (const target of [5000, 9000, 18100]) {
    assert.equal(sum(scaleSourdough(SOURDOUGH, target, 18)), Math.round(target));
  }
});

test('a higher starter percentage raises the starter share', () => {
  const low = scaleSourdough(SOURDOUGH, 9000, 18);
  const high = scaleSourdough(SOURDOUGH, 9000, 25);
  assert.ok(high[4] > low[4], 'starter (index 4) should grow with the percentage');
});
