// line-quantity.js — a recipe line's amount, typed in grams or kilos, stored in KILOS.
// PURE: no DOM, so a test RUNS the conversion instead of reading the editor for it (P15).
//
// Federico, Nov 2026: «nella casella composto da il peso non si vede tutto» — and a recipe
// line should take grams the way an ingredient line does. ⚠️ WHAT IS STORED DID NOT MOVE:
// `qtyKg`, in kilos, is what the rules, the cost model and every saved product already
// carry, so the unit chosen here only changes how the number is TYPED and SHOWN. It is
// never saved: a product always opens on kilos.

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

// The stored kilos → the text the box shows in the unit on it. '' for nothing yet, so the
// placeholder shows instead of a 0.
export function typedFromKilos(kilos, unit) {
  const n = Number(kilos) || 0;
  if (!n) return '';
  return String(unit === 'g' ? round6(n * 1000) : n);
}
