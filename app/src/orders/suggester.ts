// suggester.ts — the suggestion engine bound to the order records this phone holds (step 3f-2b; parity L27–L29). Pure: the
// store builds one per snapshot of the history and the cards (ordersStore.ts), and every row, the Stock box and the confirm
// screen ask the SAME one — so the number a row shows, the number the Stock box fills and the «usually about N» the confirm
// screen quotes are the same number (js/orders/orders-main.js suggestFor / usualFor).
//
// ⚠️ NONE OF IT FOR A LINE IN ANOTHER UNIT THAN ITS CARD'S: the history the par level is worked out from counts the card's
// unit, so «Suggested: 4» under a line of buste — or 4 typed into it from the Stock box — would be a number of the wrong thing
// (js/orders/ingredients.js updateHint). Switching back to the card's unit brings them back.
//
// The history is cut into one list per ingredient on the FIRST question, not when the records arrive: a snapshot nobody asks
// about costs nothing.

import { wholeNumber } from '@mise/shared/archive';
import { isDefaultUnit } from '@mise/shared/order-unit';
import { computeSuggestion, indexHistoryByIngredient, isUnusualQuantity } from '@mise/shared/suggestions';
import type { Suggestion } from '@mise/shared/suggestions';

type Line = { readonly id: string };
type Entry = { readonly qty?: unknown; readonly stock?: unknown; readonly unit?: unknown } | undefined;

// What the line under a row's name says. The warning outranks the suggestion and takes the line over: the two never show
// together (parity L29) — «Suggested: 8» beside «much more than usual» would say the same thing twice.
export type RowHint =
  | { readonly kind: 'none' }
  | { readonly kind: 'suggested'; readonly n: number }
  | { readonly kind: 'unusual'; readonly usual: number };

export interface Suggester {
  // The row's line, from the quantity it shows and the stock the order holds. A row whose line is in another supplier's
  // order this time is the caller's to silence (it shows an empty box).
  hint(line: Line, entry: Entry): RowHint;
  // ⚠️ DECISION 1 OF 3f-2b (Federico, 28 Oct 2026), a DIFFERENCE from the current app: a Stock reading fills the Order box
  // with the suggestion ONLY when the box is empty or still holds the suggestion of the previous reading — a number typed by
  // hand is never overwritten (the row's hint then shows the new suggestion beside it). The current app overwrites always.
  // Returns the quantity to put in the box, or null to leave it (also when it already holds that number: no write for it).
  fillFor(line: Line, entry: Entry, stock: number): number | null;
  // The usual amount for a confirm-screen row whose quantity looks like a typing mistake, else null. `unit` is the unit the
  // row SHOWS (frozen when the screen opened). Stock plays no part: «did you mean to order this much» is about the order.
  usualFor(line: Line, unit: string, qty: number): number | null;
}

const INACTIVE: Suggestion = { active: false, ordersRemaining: 0 };

export function createSuggester(history: readonly unknown[], cards: readonly Line[]): Suggester {
  let index: Map<string, unknown[]> | null = null;
  let cardById: Map<string, Line> | null = null;
  const cardOf = (id: string): Line | null => {
    if (!cardById) {
      cardById = new Map();
      // The first, as the current app's find() answered.
      for (const card of cards) if (!cardById.has(card.id)) cardById.set(card.id, card);
    }
    return cardById.get(id) ?? null;
  };
  const suggest = (id: string, stock: unknown): Suggestion => {
    index ??= indexHistoryByIngredient(history);
    return computeSuggestion(id, stock, index.get(id) ?? [], cardOf(id));
  };
  // The unit check against the CARD (its unit as stored), as the current app's rows do — not the lens's copy of the line.
  const inCardUnit = (line: Line, entry: Entry) => isDefaultUnit(entry, cardOf(line.id) ?? line);

  return {
    hint(line, entry) {
      if (!inCardUnit(line, entry)) return { kind: 'none' };
      const result = suggest(line.id, entry?.stock ?? 0);
      if (!result.active) return { kind: 'none' };
      if (isUnusualQuantity(entry?.qty ?? 0, result.par)) return { kind: 'unusual', usual: result.par };
      return { kind: 'suggested', n: result.suggestion };
    },

    fillFor(line, entry, stock) {
      if (!inCardUnit(line, entry)) return null;
      const after = suggest(line.id, stock);
      if (!after.active) return null;
      const qty = wholeNumber(entry?.qty);
      const before = qty === 0 ? INACTIVE : suggest(line.id, entry?.stock ?? 0);
      const untouched = qty === 0 || (before.active && qty === before.suggestion);
      return untouched && after.suggestion !== qty ? after.suggestion : null;
    },

    usualFor(line, unit, qty) {
      if (!inCardUnit(line, { unit })) return null;
      const result = suggest(line.id, 0);
      return result.active && isUnusualQuantity(qty, result.par) ? result.par : null;
    },
  };
}

// No history yet: nothing to say.
export const NO_SUGGESTIONS: Suggester = createSuggester([], []);
