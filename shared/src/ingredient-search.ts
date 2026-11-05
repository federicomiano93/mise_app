// ingredient-search.ts — the text folding and the supplier search of the Orders lists.
//
// TypeScript port of js/orders/ingredient-search.js for Mise 2: ONLY `normalizeText` and
// `filterSuppliers`. Behaviour is identical, input for input: ingredient-search.spec.ts runs every
// test against BOTH files, and odd-inputs.spec.ts feeds both the same strange values.
//
// ⚠️ A PARTIAL PORT, SO parity.spec.ts DOES NOT PAIR IT. NOT PORTED: letterOf, matchesQuery,
// flatRows and the other row builders behind the «All ingredients» view. They build the Orders
// list's rows and use order-text (itemLabel), which is the Orders feature's, not shared logic;
// they come with the screen that draws them.

import { supplierMatches } from './supplier-label';

// Everything NFD splits an accent into: "è" becomes "e" + a combining grave.
const COMBINING_MARKS = /[̀-ͯ]/g;

// Lower-cased and stripped of accents, so "però" is found by typing "pero" and
// "Sale" by typing "sale". Used for BOTH sides of every comparison.
export function normalizeText(value?: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .trim();
}

// The suppliers matching what was typed, in the order they were given.
//
// Name and category, because those are the two things the supplier row shows — a
// search that matches something invisible reads as a bug. Typing "no supplier" finds
// the pseudo-supplier, the same as in the ingredient list.
//
// It does NOT look inside a supplier's ingredients: "where do I find Bacon" is what
// the All-ingredients view is for, and answering it here too would make two searches
// that behave almost-but-not-quite the same.
export function filterSuppliers<T>(suppliers: readonly T[] | null | undefined, query?: unknown): T[] {
  const q = normalizeText(query);
  if (!q) return (suppliers || []).slice();

  return (suppliers || []).filter(s =>
    supplierMatches(s, q, normalizeText) || normalizeText((s as { category?: unknown } | null | undefined)?.category).includes(q));
}
