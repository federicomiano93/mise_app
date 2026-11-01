// calculator-dough-math.js — the pure dough-scaling math, extracted from calc.js
// so it can be unit-tested in isolation (P15 — the owner cannot read code).
//
// Each function takes a recipe object and a target raw weight (grams) and returns
// the per-ingredient grams as an array, rounded so the displayed integers sum
// EXACTLY to Math.round(target). No DOM, no storage — pure arithmetic. The numbers
// are identical to the former inline math in calc.js; only their home changed.

// Sum of all ingredient amounts in a recipe object.
export function recipeTotal(r) {
  return Object.values(r).reduce((s, v) => s + v, 0);
}

// Rounds an array of gram values so their displayed integers sum exactly to
// Math.round(total). Assigns any ±1-2g rounding residual to the largest ingredient.
export function fixRounding(amounts, total) {
  const rounded = amounts.map(Math.round);
  const diff = Math.round(total) - rounded.reduce((a, b) => a + b, 0);
  if (diff !== 0) {
    const maxIdx = rounded.indexOf(Math.max(...rounded));
    rounded[maxIdx] += diff;
  }
  return rounded;
}

// The three named recipes are now thin wrappers over the unified scaleRecipe
// (defined below; hoisted). Their signatures and returned array order are
// UNCHANGED, so calc.js and log-model.js call them exactly as before.
//
// baselinePct is FIXED for brioche (4) and sourdough (18) — matching their original
// hard-coded baselines — so they stay byte-identical even if the recipe is edited.
// For focaccia it is DERIVED from the current flour (yeast / total flour), which
// makes the unified method coincide with the old focaccia math at the recipe's
// natural ratio and stay within a few grams elsewhere (see unified-scaler tests).

// Focaccia. Returns [flourBlu, flourT65, malt, sugar, salt, yeast, oil, water1, water2].
export function scaleFocaccia(recipe, target, yeastPct) {
  const R = recipe;
  const totalFlour = R.flourBlu + R.flourT65;
  return scaleRecipe({
    amounts: {
      flourBlu: R.flourBlu, flourT65: R.flourT65, malt: R.malt, sugar: R.sugar,
      salt: R.salt, yeast: R.yeast, oil: R.oil, water1: R.water1, water2: R.water2,
    },
    leaveningKey: 'yeast',
    baselinePct: totalFlour ? R.yeast / totalFlour * 100 : null,
  }, target, yeastPct);
}

// Brioche. Returns [flour, yeast, water].
export function scaleBrioche(recipe, target, yeastPct) {
  const R = recipe;
  return scaleRecipe({
    amounts: { flour: R.flour, yeast: R.yeast, water: R.water },
    leaveningKey: 'yeast',
    baselinePct: 4,
  }, target, yeastPct);
}

// Sourdough. Returns [flourBlu, flourT65, flourWhole, water1, starter, malt, salt, water2].
export function scaleSourdough(recipe, target, starterPct) {
  const R = recipe;
  return scaleRecipe({
    amounts: {
      flourBlu: R.flourBlu, flourT65: R.flourT65, flourWhole: R.flourWhole,
      water1: R.water1, starter: R.starter, malt: R.malt, salt: R.salt, water2: R.water2,
    },
    leaveningKey: 'starter',
    baselinePct: 18,
  }, target, starterPct);
}

// Generic recipe scaler — the single, unified dough math that every recipe can use.
// It reproduces scaleBrioche and scaleSourdough EXACTLY (byte-for-byte) and brings
// focaccia onto the same clean method (sub-gram differences vs the old focaccia
// math at normal settings; coincides exactly at the default 0.65%). Equivalence is
// proven in tests/unified-scaler.test.mjs.
//
// spec = {
//   amounts:      { key: grams, ... }  // insertion order = output order
//   leaveningKey: string | null        // which ingredient is the yeast/starter
//   baselinePct:  number | null        // the leavening percentage at which the
//                                       // recipe values sit "at rest"
// }
// target       = desired total raw weight in grams
// leaveningPct = the chosen leavening percentage (from the knob, or the default)
//
// Returns the per-ingredient grams as an array (same order as spec.amounts keys),
// rounded so the integers sum EXACTLY to Math.round(target) — see fixRounding.
//
// Why baselinePct is STORED, not derived from leavening/flour: brioche's yeast is
// exactly 4% of its flour, but a sourdough's starter can be 18% by design while
// its starter/flour ratio sits a little off 18%. Deriving it would drift sourdough off
// its locked values; storing the intended baseline (brioche 4, sourdough 18, focaccia
// its own yeast/flour) keeps both byte-identical to their original functions.
export function scaleRecipe(spec, target, leaveningPct) {
  const { amounts, leaveningKey, baselinePct } = spec;
  const keys = Object.keys(amounts);
  const totalBase = keys.reduce((s, k) => s + amounts[k], 0);

  // No designated leavening (or no baseline) → pure pro-rata scaling.
  if (leaveningKey == null || !baselinePct) {
    if (totalBase <= 0) return keys.map(() => 0);
    const factor = target / totalBase;
    return fixRounding(keys.map(k => amounts[k] * factor), target);
  }

  // Bring the leavening to its share for the chosen percentage, then scale the
  // whole recipe uniformly to hit the target.
  const base = amounts[leaveningKey] * (leaveningPct / baselinePct);
  const provisional = totalBase - amounts[leaveningKey] + base;
  if (provisional <= 0) return keys.map(() => 0);
  const factor = target / provisional;
  return fixRounding(
    keys.map(k => (k === leaveningKey ? base : amounts[k]) * factor),
    target
  );
}
