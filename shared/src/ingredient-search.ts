// ingredient-search.ts — the rows behind the "All ingredients" view, the text folding and the supplier search
// of the Orders lists. PURE: no DOM, no Firestore, so it can be asserted in a unit test instead of read back
// out of rendered markup (P15).
//
// TypeScript FULL port of js/orders/ingredient-search.js for Mise 2 (a partial one — `normalizeText` and
// `filterSuppliers` only — until step 3f-1). Behaviour is identical, input for input:
// ingredient-search.spec.ts runs every test against BOTH files, parity.spec.ts compares their exports and
// odd-inputs.spec.ts feeds both the same strange values.
//
// The view it feeds answers one question the by-supplier screen cannot: "where do I type the Bacon?" — without
// already knowing that Bacon comes from Cielo. With 6 suppliers and 65 ingredients that meant opening and
// closing cards until it turned up.
//
// There is no second list of quantities anywhere: entries are keyed by INGREDIENT ({ id: { qty, stock } }), so
// the flat list and the supplier cards are two windows onto the same data. Typing 4 on Bacon here IS typing 4
// in Cielo's order.

import { itemLabel } from './order-text';
import { supplierLabel, supplierMatches } from './supplier-label';
import { ingredientDisplayName, ingredientNameMatches } from './ingredient-name';

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

// The letter a row is filed under. Anything not a letter — a number, a symbol —
// goes under "#" rather than inventing a divider per character.
export function letterOf(label?: unknown): string {
  const first = normalizeText(label).charAt(0);
  return first >= 'a' && first <= 'z' ? first.toUpperCase() : '#';
}

// One row of the «All ingredients» view.
export interface FlatRow {
  ingredient: { id?: unknown; supplierId?: unknown; active?: unknown; weight?: unknown; brand?: unknown };
  supplier: unknown;
  supplierName: string;
  label: string;
  letter?: string;
}

// Does this row match what was typed? Name, weight, brand AND supplier name, so
// "alba" lists everything bought from Alba and "no supplier" everything bought
// without one — which is the point of having the search at all.
export function matchesQuery(row: { label?: unknown; ingredient?: unknown; supplierName?: unknown; supplier?: unknown }, query?: unknown): boolean {
  const q = normalizeText(query);
  if (!q) return true;
  return [row.label, (row.ingredient as { brand?: unknown } | null | undefined)?.brand, row.supplierName]
    .some(field => normalizeText(field).includes(q))
    // the invoice name too: a supplier is found by either of its names
    || supplierMatches(row.supplier, q, normalizeText)
    // an ingredient too: found by the name to show AND by the invoice name
    || ingredientNameMatches(row.ingredient, q, normalizeText);
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

// Ingredients that belong to one of the given suppliers, A→Z by displayed label.
//
// An ingredient whose supplier is not in the list is left OUT, exactly as the
// by-supplier view leaves it out: that is how a DEACTIVATED supplier's products
// stay hidden. Callers pass the resolved supplier list (no-supplier.ts), so
// "belongs to nobody" is already "belongs to No supplier" by the time we get here.
//
// `only` is an optional Set of ingredient ids — the "just what I'm ordering" filter.
// It is a FROZEN set, decided by the caller when the filter is entered, never
// recomputed from the quantities: if it were, typing 0 into a row would delete that
// row from under the finger correcting it.
//
// Returns { rows, total }: `total` is everything orderable, `rows` only what the
// filter and the search left standing — the counter needs both to say "12 of 65".
export function flatRows(
  { ingredients, suppliers, query, only }: { ingredients?: readonly unknown[] | null; suppliers?: readonly unknown[] | null; query?: unknown; only?: { has(id: unknown): boolean } | null },
): { rows: FlatRow[]; total: number } {
  const byId = new Map((suppliers || []).map(s => [(s as { id?: unknown }).id, s]));

  const all: FlatRow[] = (ingredients || [])
    .filter(ing => (ing as { active?: unknown }).active !== false && byId.has((ing as { supplierId?: unknown }).supplierId))
    .map(ing => {
      const i = ing as FlatRow['ingredient'];
      return {
        ingredient: i,
        supplier: byId.get(i.supplierId),
        supplierName: supplierLabel(byId.get(i.supplierId)),
        label: itemLabel(ingredientDisplayName(ing), i.weight),
      };
    })
    // By label, then by id: without the tie-break two products with identical
    // labels could swap places between repaints and the rows would jump.
    .sort((a, b) =>
      a.label.localeCompare(b.label)
      || String(a.ingredient.id).localeCompare(String(b.ingredient.id)));

  const rows = all
    .filter(row => !only || only.has(row.ingredient.id))
    .filter(row => matchesQuery(row, query));

  // The letter is carried on the FIRST row of each run only, so the view can draw a
  // divider without re-deriving where the groups start. It is computed after
  // filtering: a search that leaves only Mozzarella must show an "M", not a stale "A".
  let previous: string | null = null;
  rows.forEach(row => {
    const letter = letterOf(row.label);
    row.letter = letter === previous ? '' : letter;
    previous = letter;
  });

  return { rows, total: all.length };
}

// What is currently being ordered, across every supplier → { itemCount,
// supplierCount, ids }.
//
// The problem it solves: with 65 ingredients the typed quantities are SCATTERED —
// inside closed supplier cards in one view, among 65 rows in the other — and there is
// nowhere that says "this is the whole order".
//
// Only rows with a real, positive quantity count. A corrupt stored value ("4 " from a
// bad write, or NaN) counts as nothing rather than poisoning the total — the same
// defensive reading computeSuggestion had to adopt in v1.11.0.
export function orderSummary(
  { ingredients, suppliers, entries }: { ingredients?: readonly unknown[] | null; suppliers?: readonly unknown[] | null; entries?: unknown },
): { itemCount: number; supplierCount: number; ids: unknown[] } {
  const known = new Set((suppliers || []).map(s => (s as { id?: unknown }).id));
  const ids: unknown[] = [];
  const suppliersUsed = new Set<unknown>();
  const byId = entries as Record<string, { qty?: unknown } | undefined> | null | undefined;

  (ingredients || []).forEach(ing => {
    const i = ing as { id: string; active?: unknown; supplierId?: unknown };
    if (i.active === false || !known.has(i.supplierId)) return;
    const qty = Number(byId?.[i.id]?.qty);
    if (!Number.isFinite(qty) || qty <= 0) return;
    ids.push(i.id);
    suppliersUsed.add(i.supplierId);
  });

  return { itemCount: ids.length, supplierCount: suppliersUsed.size, ids };
}
