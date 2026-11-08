// line-quantity.js — a recipe line's amount, typed in grams or kilos, stored in KILOS.
// PURE: no DOM, so a test RUNS the conversion instead of reading the editor for it (P15).
//
// Federico, Nov 2026: «nella casella composto da il peso non si vede tutto» — and a recipe
// line should take grams the way an ingredient line does. ⚠️ WHAT IS STORED DID NOT MOVE:
// `qtyKg`, in kilos, is what the rules, the cost model and every saved product already
// carry, so the unit chosen here only changes how the number is TYPED and SHOWN. It is
// never saved: a product always opens on GRAMS (since 8 Nov 2026 — see the editor's lineRow).

export const KILO_LINE_UNITS = Object.freeze(['g', 'kg']);

// At most six decimals, so 522 g is stored as 0.522 and never 0.5220000000001 — the float
// noise that dividing by 1000 can leave, and that would then be shown back in the box.
const round6 = n => Math.round(n * 1e6) / 1e6;

// What a person typed, in the unit on the box → the kilos to store.
// ⚠️ NOT CLAMPED, exactly as the box always was. product-limits.js (firstInvalidNumber) judges
// only the product's own number boxes, never a component line, so an impossible amount here
// is the box's and the database's to refuse, not this conversion's.
export function kilosFromTyped(text, unit) {
  const n = Number(text) || 0;
  return unit === 'g' ? round6(n / 1000) : n;
}

// A recipe line is «too much» when it is more than this many whole batches of the recipe.
// A slip of ×1000 (grams typed into the kilos box) is always far beyond 20×; a real double or
// triple batch is well under it. Only a NOTE under the line, it never blocks Save.
export const TOO_MUCH_RECIPE_FACTOR = 20;

// True only when both numbers are real, one whole recipe makes something, and the line
// asks for more than TOO_MUCH_RECIPE_FACTOR of it. A recipe of pieces only (wholeKg 0) never warns.
export function tooMuchOfRecipe(qtyKg, wholeKg) {
  if (typeof qtyKg !== 'number' || typeof wholeKg !== 'number') return false;
  if (!Number.isFinite(qtyKg) || !Number.isFinite(wholeKg)) return false;
  return wholeKg > 0 && qtyKg > TOO_MUCH_RECIPE_FACTOR * wholeKg;
}

// The stored kilos → the text the box shows in the unit on it. '' for nothing yet, so the
// placeholder shows instead of a 0.
export function typedFromKilos(kilos, unit) {
  const n = Number(kilos) || 0;
  if (!n) return '';
  return String(unit === 'g' ? round6(n * 1000) : n);
}
