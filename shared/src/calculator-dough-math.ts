// calculator-dough-math.ts — the pure dough-scaling math of the Calculator. PURE: no DOM, no storage.
//
// TypeScript FULL port of js/calculator-dough-math.js for Mise 2. Behaviour is identical, input for input:
// calculator-dough-math.spec.ts runs every test against BOTH files, parity.spec.ts compares their exports
// and odd-inputs.spec.ts feeds both the same strange values.
//
// Each function takes a recipe object and a target raw weight (grams) and returns the per-ingredient
// grams as an array, rounded so the displayed integers sum EXACTLY to Math.round(target).
//
// The three named recipes (focaccia, brioche, sourdough) are thin wrappers over `scaleRecipe`. They are
// kept because the original exports them and the tests of the current app call them; the live app's
// recipes are all configurable and go through `scaleRecipe` directly.
//
// QUIRK COPIED, not tidied: `fixRounding` of an empty list with a non-zero difference writes to index -1
// (a property named "-1" on the array, with value NaN) and returns the still-empty list, as the original
// does. Odd-input specs demand that both files agree on what such calls return or throw.

// Sum of all ingredient amounts in a recipe object.
export function recipeTotal(r: Record<string, number>): number {
  return Object.values(r).reduce((s, v) => s + v, 0);
}

// Rounds an array of gram values so their displayed integers sum exactly to Math.round(total). Assigns
// any ±1-2g rounding residual to the largest ingredient.
export function fixRounding(amounts: number[], total: number): number[] {
  const rounded = amounts.map(Math.round);
  const diff = Math.round(total) - rounded.reduce((a, b) => a + b, 0);
  if (diff !== 0) {
    const maxIdx = rounded.indexOf(Math.max(...rounded));
    rounded[maxIdx] = (rounded[maxIdx] as number) + diff;
  }
  return rounded;
}

// What `scaleRecipe` reads. `amounts` keeps insertion order = output order.
export interface ScaleSpec {
  amounts: Record<string, number>;
  leaveningKey: string | null;
  baselinePct: number | null;
}

// The recipe objects of the three named wrappers: their fields are read straight off.
type Fields = Record<string, number>;

// Focaccia. Returns [flourBlu, flourT65, malt, sugar, salt, yeast, oil, water1, water2].
export function scaleFocaccia(recipe: Fields, target: number, yeastPct: number): number[] {
  const R = recipe as Record<string, number>;
  const totalFlour = (R['flourBlu'] as number) + (R['flourT65'] as number);
  return scaleRecipe({
    amounts: {
      flourBlu: R['flourBlu'] as number, flourT65: R['flourT65'] as number, malt: R['malt'] as number, sugar: R['sugar'] as number,
      salt: R['salt'] as number, yeast: R['yeast'] as number, oil: R['oil'] as number, water1: R['water1'] as number,
      water2: R['water2'] as number,
    },
    leaveningKey: 'yeast',
    baselinePct: totalFlour ? (R['yeast'] as number) / totalFlour * 100 : null,
  }, target, yeastPct);
}

// Brioche. Returns [flour, yeast, water].
export function scaleBrioche(recipe: Fields, target: number, yeastPct: number): number[] {
  const R = recipe as Record<string, number>;
  return scaleRecipe({
    amounts: { flour: R['flour'] as number, yeast: R['yeast'] as number, water: R['water'] as number },
    leaveningKey: 'yeast',
    baselinePct: 4,
  }, target, yeastPct);
}

// Sourdough. Returns [flourBlu, flourT65, flourWhole, water1, starter, malt, salt, water2].
export function scaleSourdough(recipe: Fields, target: number, starterPct: number): number[] {
  const R = recipe as Record<string, number>;
  return scaleRecipe({
    amounts: {
      flourBlu: R['flourBlu'] as number, flourT65: R['flourT65'] as number, flourWhole: R['flourWhole'] as number,
      water1: R['water1'] as number, starter: R['starter'] as number, malt: R['malt'] as number, salt: R['salt'] as number,
      water2: R['water2'] as number,
    },
    leaveningKey: 'starter',
    baselinePct: 18,
  }, target, starterPct);
}

// Generic recipe scaler — the single, unified dough math that every recipe uses.
//
//   spec.amounts      { key: grams, ... }  insertion order = output order
//   spec.leaveningKey which ingredient is the yeast/starter, or null
//   spec.baselinePct  the leavening percentage at which the recipe values sit "at rest", or null
//   target            desired total raw weight in grams
//   leaveningPct      the chosen leavening percentage (from the knob, or the default)
//
// Returns the per-ingredient grams as an array (same order as spec.amounts keys), rounded so the integers
// sum EXACTLY to Math.round(target) — see fixRounding.
//
// Why baselinePct is STORED, not derived from leavening/flour: brioche's yeast is exactly 4% of its flour,
// but sourdough's starter is 18% by design while starter/flour = 1024/5690 = 17.996%. Deriving it would
// drift sourdough off its locked values; storing the intended baseline keeps both byte-identical to their
// original functions.
export function scaleRecipe(spec: ScaleSpec, target: number, leaveningPct: number): number[] {
  const { amounts, leaveningKey, baselinePct } = spec;
  const keys = Object.keys(amounts);
  const totalBase = keys.reduce((s, k) => s + (amounts[k] as number), 0);

  // No designated leavening (or no baseline) → pure pro-rata scaling.
  if (leaveningKey == null || !baselinePct) {
    if (totalBase <= 0) return keys.map(() => 0);
    const factor = target / totalBase;
    return fixRounding(keys.map(k => (amounts[k] as number) * factor), target);
  }

  // Bring the leavening to its share for the chosen percentage, then scale the whole recipe uniformly to
  // hit the target.
  const base = (amounts[leaveningKey] as number) * (leaveningPct / baselinePct);
  const provisional = totalBase - (amounts[leaveningKey] as number) + base;
  if (provisional <= 0) return keys.map(() => 0);
  const factor = target / provisional;
  return fixRounding(
    keys.map(k => (k === leaveningKey ? base : (amounts[k] as number)) * factor),
    target,
  );
}
