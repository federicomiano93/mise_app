// clean-step.ts — how a SCALED weight in grams is rounded in the recipe book: once, to a clean step that a scale can
// weigh and a baker can read, never more than about 1% away from the exact amount.
//
// NEW IN MISE 2 (the owner's decision, 16 Nov 2026), NO ORIGINAL in js/: the current app rounds a scaled row to the whole
// gram and, only in the PDF, by its own «lab» rule (`roundLabWeight` of js/recipe-export.js, which stays there untouched as
// the rollback copy's). Nothing here is paired in parity.spec.ts; clean-step.spec.ts runs against this file alone.
//
// ⚠️ THE STEP IS CHOSEN BY THE TOLERANCE, NOT BY A TABLE. Half a step is the most a rounding can move a weight, so the step is
// the largest of 10, 5 and 1 g whose half is at most TOLERANCE of the weight: 10 g from 500 g up (5 g on 500 g is 1%), 5 g from
// 250 g (2.5 g on 250 g is 1%), 1 g below. One number to change if the owner ever wants the rule tighter or looser.
//
// Pure: numbers in, numbers out. The Calculator does NOT use this yet (its own scaling keeps whole grams until a later PR).

// The most a rounded weight may differ from the exact one, as a share of the exact one.
export const TOLERANCE = 0.01;

// Largest first: the first that fits wins.
const STEPS = [10, 5, 1] as const;

// The weight as a whole number of grams. ⚠️ FLOATING-POINT NOISE IS TRIMMED FIRST: a scaling can compute 12.499999999999998 for
// what is really 12.5, and «half up» must then still go up. Twelve significant digits keep every real gram value intact.
function wholeGrams(grams: number): number {
  return Math.round(Number(grams.toPrecision(12)));
}

// The step a weight is rounded to, chosen on its WHOLE-GRAM value (so 249.5 g, which reads 250 g, is weighed in steps of 5 g).
// 0, junk and negatives have the 1 g step.
export function cleanStepOf(grams: unknown): number {
  const g = Number(grams);
  if (!Number.isFinite(g) || g <= 0) return 1;
  const whole = wholeGrams(g);
  if (whole <= 0) return 1;
  return STEPS.find(step => step / 2 / whole <= TOLERANCE) ?? 1;
}

// A scaled weight in grams, rounded ONCE: first to the whole gram (half up), then that whole number to its clean step (half up).
// 12.5 → 13, 249.5 → 250, 252 → 250, 253 → 255, 499.5 → 500, 504 → 500, 505 → 510. Junk or a negative → 0, never NaN.
export function roundToCleanStep(grams: unknown): number {
  const g = Number(grams);
  if (!Number.isFinite(g) || g <= 0) return 0;
  const whole = wholeGrams(g);
  const step = cleanStepOf(whole);
  return Math.floor(whole / step + 0.5) * step;
}
