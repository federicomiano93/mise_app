// What the Calculator's number boxes keep and what they mean. Plain functions, so every rule is a spec
// without a screen.

// ⚠️ THE BOXES ARE `type="number"`, AS IN THE CURRENT APP, and what they keep is the text the current app
// reads back from the same keys. A number box only ever gives a number or an empty string (the browser
// decides what an Italian comma means), so the text kept is always one the other app can read.

// A box's text as a number the maths may use: 0 for anything that is not one, and never below 0 (the current
// app's `+value || 0`, plus a floor: a typed minus sign must not subtract dough).
export function numberOf(text: string | null | undefined): number {
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Whether a box left like this goes back to its default: empty, or not a number at all.
export function isBlank(text: string): boolean {
  return text === '' || Number.isNaN(parseFloat(text));
}

// What a box shows the moment it is tapped: a 0 or an empty box is emptied, ready to type into; any other
// number stays, to be selected.
export function clearsOnFocus(text: string): boolean {
  return text === '0' || text === '';
}

// The leavening % in effect: the knob's number when it has one, else the recipe's default.
export function leaveningPct(knobText: string | null, defaultPct: number): number {
  const fallback = Number(defaultPct) || 0;
  if (knobText === null || knobText === '') return fallback;
  return Number(knobText) || fallback;
}

// The choices of a dropdown product: 0, 20, 40, 60, 80, 100.
export const DROPDOWN_OPTIONS: readonly number[] = [0, 20, 40, 60, 80, 100];

// Sensible leavening-knob range from a recipe's default %, giving any recipe a proportionate scale
// (focaccia 0.65 → 0.1–3, brioche 4 → 0.1–6, sourdough 18 → 5–40).
export function knobRange(defaultPct: number): { min: number; max: number; step: number } {
  const d = Number(defaultPct) || 0;
  if (d >= 5) return { min: 5, max: 40, step: 1 };
  if (d >= 1) return { min: 0.1, max: 6, step: 0.1 };
  return { min: 0.1, max: 3, step: 0.05 };
}
