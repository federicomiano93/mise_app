// suggestions.ts — the order suggestion engine. TypeScript FULL port of js/orders/suggestions.js for Mise 2 (step 3f-2b);
// suggestions.spec.ts runs every test against both files and parity.spec.ts pairs them.
//
// Per Federico: the app learns a target "par" level from history and suggests how much to order so that, after the stock
// on hand, you reach that level — always topping up to your usual amount.
//
//   par         = average, over the recent ORDERS of that ingredient, of (stock on hand + quantity ordered)
//   suggestion  = round( par − current stock ), floored at 0
//
// The window counts ORDERS, not weeks: an order is one day and one supplier, and suppliers are not all weekly. "The last 8
// times you ordered this ingredient" means the same thing for all of them. Records that predate the per-day model (one
// document per ISO week, every supplier merged) still count as one order each: they sort on weekStart instead of date.
//
// Bank holidays do NOT change the suggestion — they are alert-only.

import { sameUnit, recordUnit, isDefaultUnit } from './order-unit';
import { ingredientDisplayName } from './ingredient-name';

const MIN_ORDERS = 4;      // orders of this ingredient before suggestions activate
const WINDOW_ORDERS = 8;   // average over at most this many recent orders

// A history record as this engine reads it; anything else in it is ignored.
type HistoryRecord = {
  readonly date?: unknown;
  readonly weekStart?: unknown;
  readonly quantities?: Readonly<Record<string, unknown>> | null;
  readonly stock?: Readonly<Record<string, unknown>> | null;
  readonly units?: unknown;
};

export type Suggestion =
  | { readonly active: false; readonly ordersRemaining: number }
  | { readonly active: true; readonly suggestion: number; readonly par: number };

// What `unusualQuantities` asks the caller: the same lookup the rows use. Only `active` and `par` are read.
type SuggestLookup = (ingredientId: string, stock: number) => { readonly active?: boolean; readonly par?: number } | null | undefined;

export interface UnusualRow {
  readonly id: string;
  readonly name: string;
  readonly qty: number;
  readonly usual: number;
}

// Read a stored quantity defensively: anything that is not a finite, non-negative number becomes 0. Firestore rules
// cannot check the VALUES inside a map, so this is where the app stops trusting what it reads: a string would CONCATENATE
// in `qty + stock` and put "Suggested: NaN" on screen (P20).
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const hasOwn = (map: unknown, key: string): boolean =>
  typeof map === 'object' && map !== null && Object.prototype.hasOwnProperty.call(map, key);

function newestFirst(a: HistoryRecord, b: HistoryRecord): number {
  return String(b.date || b.weekStart || '').localeCompare(String(a.date || a.weekStart || ''));
}

// The history cut once into one list per ingredient: ingredientId → the records that carry that ingredient in
// `quantities`, newest first (the same order computeSuggestion sorts to). Handing computeSuggestion `index.get(id) || []`
// gives the identical answer for a fraction of the work.
export function indexHistoryByIngredient<T>(history: readonly T[] | null | undefined): Map<string, T[]> {
  const index = new Map<string, T[]>();
  (history || []).forEach(item => {
    const record = item as HistoryRecord | null | undefined;
    if (!record || !record.quantities) return;
    Object.keys(record.quantities).forEach(id => {
      if (!index.has(id)) index.set(id, []);
      index.get(id)!.push(item);
    });
  });
  index.forEach(records => records.sort((a, b) => newestFirst(a as HistoryRecord, b as HistoryRecord)));
  return index;
}

// history: records of { date | weekStart, quantities:{id:qty}, stock:{id:qty} }.
//
// Only records that actually ORDERED this ingredient count: `quantities` holds ordered rows only, so a day the shelf was
// full and nothing was ordered is absent, and correctly does not drag the par level around.
//
// ⚠️ `ing` (the card) makes the par level UNIT-AWARE: an order placed in another unit than the card's is skipped, never
// converted — the average of cartoni and buste is a number of nothing. Without `ing` every order counts.
export function computeSuggestion(
  ingredientId: string,
  currentStock: unknown,
  history: readonly unknown[] | null | undefined,
  ing: unknown = null,
): Suggestion {
  const orders = ((history || []) as readonly HistoryRecord[])
    .filter(r => r.quantities && hasOwn(r.quantities, ingredientId))
    .filter(r => !ing || sameUnit(recordUnit(r, ingredientId, ing), (ing as { unit?: unknown }).unit))
    .sort(newestFirst);

  if (orders.length < MIN_ORDERS) {
    return { active: false, ordersRemaining: MIN_ORDERS - orders.length };
  }

  const recent = orders.slice(0, WINDOW_ORDERS);
  const levels = recent.map(r => num(r.quantities![ingredientId]) + num(r.stock && r.stock[ingredientId]));
  const par = levels.reduce((sum, v) => sum + v, 0) / levels.length;
  const suggestion = Math.max(0, Math.round(par - num(currentStock)));

  return { active: true, suggestion, par: Math.round(par) };
}

// ── Is this quantity a slip of the finger? ───────────────────────────────────
//
// The mistake caught is a missing or extra digit — 300 where 30 was meant. Two conditions, both needed:
//   * FACTOR — several times the usual amount (a typed digit multiplies by ten);
//   * MARGIN — and at least this much more in absolute terms, so an ingredient usually ordered 1 or 2 at a time does not
//     flag 8, an ordinary Saturday.
// Silent when there is no par yet (fewer than 4 past orders).
export const UNUSUAL_FACTOR = 4;
export const UNUSUAL_MARGIN = 10;

export function isUnusualQuantity(qty: unknown, par: unknown): boolean {
  const q = num(qty);
  const p = num(par);
  if (!q || !p) return false;
  return q >= Math.max(p * UNUSUAL_FACTOR, p + UNUSUAL_MARGIN);
}

// Every row of an order that looks like a typing mistake → [{ id, name, qty, usual }], biggest surprise first.
//
// `suggest` is the same lookup the rows use (ingredientId, stock) → { active, par }, injected so this stays pure and the
// caller keeps ONE source of par. Stock is passed as 0: "did you mean to order this much" does not depend on the shelf.
export function unusualQuantities(
  ingredients: readonly unknown[] | null | undefined,
  entries: Readonly<Record<string, unknown>> | null | undefined,
  suggest: SuggestLookup,
): UnusualRow[] {
  return ((ingredients || []) as ReadonlyArray<{ readonly id: string }>)
    .map(ing => {
      const entry = entries?.[ing.id] as { qty?: unknown } | undefined;
      const qty = num(entry?.qty);
      if (!qty) return null;
      // The usual amount counts the card's unit; a line in another unit has none.
      if (!isDefaultUnit(entries?.[ing.id], ing)) return null;
      const result = suggest(ing.id, 0);
      if (!result?.active || !isUnusualQuantity(qty, result.par)) return null;
      return { id: ing.id, name: ingredientDisplayName(ing) || ing.id, qty, usual: result.par as number };
    })
    .filter((row): row is UnusualRow => row !== null)
    .sort((a, b) => (b.qty / b.usual) - (a.qty / a.usual));
}
