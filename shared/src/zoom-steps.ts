// zoom-steps.ts — the six text sizes of a full-screen recipe view, and the arithmetic of stepping through
// them with the «−» / «+» pair. PURE: no DOM, no storage.
//
// TypeScript PARTIAL port of js/zoom-steps.js for Mise 2 (js/catalogue/zoom-steps.js is a byte copy of it,
// pinned by tests/copie-allineate.test.mjs, so there is ONE port). Behaviour is identical, input for input,
// for everything ported: zoom-steps.spec.ts runs every test against BOTH files and compares each ported
// export with the js/ file itself; odd-inputs.spec.ts feeds both the same strange values. It is NOT paired
// in parity.spec.ts, because of what is left out.
//
// PORTED: `ZOOM_SCALES`, `DEFAULT_ZOOM_STEP`, `clampStep`, `parseStep`, `stepBy`, `canStep`, `scaleOf`.
//
// LEFT OUT: `readZoomStep` / `saveZoomStep` (they touch `localStorage`; shared/ has no DOM, so the app reads
// and writes the key `mise.calcZoomStep` itself and runs the stored text through `parseStep`, and the value
// through `clampStep`, exactly as the original does) and `buildZoomControls` (it builds DOM; the Mise 2
// screen draws its own pair of buttons from the same arithmetic).
//
// ⚠️ A STORED STEP THAT IS NOT A SINGLE DIGIT 0–5 READS AS THE DEFAULT, never as the nearest end: garbage
// would otherwise become the biggest text on the screen. `mise.calcZoomStep` is shared with the current app
// (same origin), so both must read the same text the same way.

// Multipliers of the view's own base size. 1× is step 1, so the first tap on «+» already makes the text
// bigger and the first tap on «−» smaller.
export const ZOOM_SCALES: readonly number[] = Object.freeze([0.8, 1, 1.2, 1.45, 1.75, 2.1]);
export const DEFAULT_ZOOM_STEP = 1;
const LAST_STEP = ZOOM_SCALES.length - 1;

// A step the buttons computed: held inside the range, a non-number answers the default.
export function clampStep(step: unknown): number {
  const isNumber = typeof step === 'number';
  const isDigits = typeof step === 'string' && /^-?\d+$/.test(step.trim());
  if (!isNumber && !isDigits) return DEFAULT_ZOOM_STEP;
  const n = Number(step);
  if (!Number.isInteger(n)) return DEFAULT_ZOOM_STEP;
  return Math.min(LAST_STEP, Math.max(0, n));
}

// A step read back from storage. Anything that is not a whole number inside the range is corrupt (a
// hand-edited value, another app's key) and answers the default.
export function parseStep(raw: unknown): number {
  if (typeof raw !== 'string' || !/^\d$/.test(raw.trim())) return DEFAULT_ZOOM_STEP;
  const n = Number(raw.trim());
  return n >= 0 && n <= LAST_STEP ? n : DEFAULT_ZOOM_STEP;
}

export const stepBy = (step: unknown, delta: number): number => clampStep(clampStep(step) + delta);
export const canStep = (step: unknown, delta: number): boolean => stepBy(step, delta) !== clampStep(step);
export const scaleOf = (step: unknown): number => ZOOM_SCALES[clampStep(step)] as number;
