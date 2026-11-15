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
// The step's half is at most 1% of the WHOLE gram, so the shown weight is within 1% of it, and a hair more of the exact weight
// where the whole gram tipped it (504.6 g reads 505, then 510: 1.07%) — the owner's order, whole gram first.
// 12.5 → 13, 249.5 → 250, 252 → 250, 253 → 255, 499.5 → 500, 504 → 500, 505 → 510. Junk or a negative → 0, never NaN.
export function roundToCleanStep(grams: unknown): number {
  const g = Number(grams);
  if (!Number.isFinite(g) || g <= 0) return 0;
  const whole = wholeGrams(g);
  const step = cleanStepOf(whole);
  return Math.floor(whole / step + 0.5) * step;
}

// ── The one correction of the total (scale by TOTAL weight, every weighable row in grams) ─────────────────────────────────────

// Why the rows could not be made to add up to the typed total: `diff` is the typed total less the rows shown, in grams (positive:
// the rows are short of it). The screen says it under the Total; nothing is said in a file.
export interface TotalWarning {
  readonly diff: number;
}

export interface TargetTotalResult {
  // The rows as shown, aligned with the exact ones handed in.
  readonly amounts: number[];
  readonly warning: TotalWarning | null;
}

// The relative error a row would have at `shown`: |shown − exact| ÷ exact.
const relativeError = (shown: number, exact: number): number => Math.abs(shown - exact) / exact;

// The row to move by `delta`, among those `eligible` lets move: the one whose relative error AFTER the move is smallest, and only if
// that is within TOLERANCE; -1 when none is. A tie goes to the larger row (a gram weighs less on it), then to the earlier one.
function bestMove(exact: readonly number[], shown: readonly number[], delta: number, eligible: (i: number) => boolean): number {
  let best = -1;
  let bestError = Infinity;
  for (let i = 0; i < exact.length; i++) {
    if (!eligible(i) || !(exact[i]! > 0)) continue;
    const error = relativeError(shown[i]! + delta, exact[i]!);
    if (error > TOLERANCE + 1e-12) continue;
    if (error < bestError - 1e-12 || (Math.abs(error - bestError) <= 1e-12 && exact[i]! > exact[best]!)) {
      best = i;
      bestError = error;
    }
  }
  return best;
}

// The gram rows of a recipe scaled by its TOTAL, rounded to clean steps and then corrected ONCE so they add up to the typed total
// (the owner's decision, 16 Nov 2026). `exact` are the unrounded scaled grams; `target` the total typed, in grams.
//   1. Protections first: when the gap is larger than the rounding could ever have made (Σ half a step + half a gram per row), or a
//      correction would bring a row to 0 g or below, NOTHING is corrected and a warning is returned: the screen says the total is
//      off, rather than hide a wrong recipe behind a right-looking total.
//   2. One gram at a time on the rows weighed to the gram, each to the row it hurts least (smallest relative error after the move),
//      only while that stays within 1%: a 5 g vanilla row never takes a gram (+20%). A row may take more than one.
//   3. Then whole steps (5 or 10 g) on the rows weighed in steps, the same way, while the gap is at least that step.
//   4. A few grams still left (rare): on the largest row, which then loses its round number — the typed total wins.
export function applyTargetTotal(exact: readonly number[], target: unknown): TargetTotalResult {
  const rows = exact.map(value => (Number.isFinite(value) && value > 0 ? value : 0));
  const rounded = rows.map(roundToCleanStep);
  const steps = rows.map(cleanStepOf);
  const total = Number(target);
  if (!Number.isFinite(total) || rows.length === 0) return { amounts: rounded, warning: null };
  const sumOf = (list: readonly number[]): number => list.reduce((a, b) => a + b, 0);
  const gap = Math.round(total) - sumOf(rounded);
  if (gap === 0) return { amounts: rounded, warning: null };
  const refused: TargetTotalResult = { amounts: rounded, warning: { diff: gap } };
  if (Math.abs(gap) > sumOf(steps.map(step => step / 2 + 0.5))) return refused;

  const shown = rounded.slice();
  let left = gap;
  const sign = Math.sign(left);
  // 2. Gram by gram on the 1 g rows.
  while (left !== 0) {
    const i = bestMove(rows, shown, sign, index => steps[index] === 1);
    if (i < 0) break;
    shown[i]! += sign;
    left -= sign;
  }
  // 3. Whole steps on the 5 g and 10 g rows, while the gap holds a whole step.
  while (left !== 0) {
    // The 10 g rows and the 5 g rows compete: the move that leaves the smaller relative error wins.
    let pick = -1;
    let pickError = Infinity;
    for (const step of [10, 5]) {
      if (Math.abs(left) < step) continue;
      const j = bestMove(rows, shown, sign * step, index => steps[index] === step);
      if (j < 0) continue;
      const error = relativeError(shown[j]! + sign * step, rows[j]!);
      if (error < pickError) { pick = j; pickError = error; }
    }
    if (pick < 0) break;
    shown[pick]! += sign * steps[pick]!;
    left -= sign * steps[pick]!;
  }
  // 4. What is left goes on the largest row.
  if (left !== 0) {
    let largest = 0;
    for (let i = 1; i < rows.length; i++) if (rows[i]! > rows[largest]!) largest = i;
    shown[largest]! += left;
  }
  // A correction may never empty a row (or push it below 0) that had something to weigh.
  if (shown.some((value, i) => value <= 0 && value !== rounded[i])) return refused;
  return { amounts: shown, warning: null };
}
