// row-actions-model.ts — the two judgements behind a recipe row's menu (Federico, 7 Nov 2026): can the row's amount be split in
// two, and can the row be ordered. PURE: no DOM, no dictionary — the screen turns a reason into words.
//
// FULL port of js/catalogue/row-actions-model.js (current app 70325def, PR #481; item 32 of docs/mise2-port-owed.md). The input is
// the same, the output is the same, odd values included — parity.spec.ts pairs the exports and odd-inputs.spec.ts feeds both files
// the same junk.

import { linkOf, roundInUnit } from './catalogue-model';

// What a record (an ingredient, a supplier) is, as far as this file reads it: whatever the database holds, trusted for nothing.
type Loose = Record<string, unknown>;

// The amount as two parts in the row's OWN unit, or null. The first part is rounded to what the unit can show and the second is the
// rest, so the two always add up to the amount on screen (1251 g -> 626 + 625). Null for «to taste» (no amount), a non-number, zero,
// or an amount so small that one part would show as nothing (1 g, 1 piece).
export function splitAmount(value: unknown, unit: unknown): { a: number; b: number } | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const a = roundInUnit(n / 2, unit as string);
  const b = roundInUnit(n - a, unit as string);
  if (!(a > 0) || !(b > 0)) return null;
  return { a, b };
}

// Why a row cannot be split: null when it can, 'toTaste' when there is no amount, else 'tooSmall'.
export function splitBlockReason(value: unknown, unit: unknown): 'toTaste' | 'tooSmall' | null {
  if (value === null || value === undefined || unit === 'to taste') return 'toTaste';
  return splitAmount(value, unit) ? null : 'tooSmall';
}

export type OrderTarget =
  | { ok: true; ingredientId: string }
  | { ok: false; reason: 'recipe' | 'notInUse' | 'noSupplier' };

// Whether a row can be ordered: `{ ok: true, ingredientId }`, or `{ ok: false, reason }` with 'recipe' (the row is another recipe of
// the Recipe book), 'notInUse' (its ingredient is marked not in use) or 'noSupplier' (no link, the ingredient is gone, or it has no
// active supplier). A supplier counts only when `active !== false`, like everywhere else in the app.
export function orderTargetOf(row: unknown, ingredients: unknown, suppliers: unknown): OrderTarget {
  const link = linkOf(row);
  if (!link) return { ok: false, reason: 'noSupplier' };
  if (link.kind === 'recipe') return { ok: false, reason: 'recipe' };
  const ing = ingredients ? (ingredients as Record<string, Loose | undefined>)[link.refId] : undefined;
  if (!ing) return { ok: false, reason: 'noSupplier' };
  if (ing.active === false) return { ok: false, reason: 'notInUse' };
  const supplier = ing.supplierId && suppliers ? (suppliers as Record<string, Loose | undefined>)[String(ing.supplierId)] : undefined;
  if (!supplier || supplier.active === false) return { ok: false, reason: 'noSupplier' };
  return { ok: true, ingredientId: link.refId };
}

// One key per recipe row that stays with its INGREDIENT, not its position, so a split shown on screen survives a live redraw where a
// row was added or removed above it on another phone (and, in Mise 2, the trip to Orders and back). The key is the linked record
// (else the typed name), plus how many times that same one came before, for a row listed twice.
export function rowKeysOf(rows: unknown): string[] {
  const seen = new Map<string, number>();
  return (Array.isArray(rows) ? rows as unknown[] : []).map(row => {
    const link = linkOf(row);
    const base = link ? `${link.kind}:${link.refId}` : `name:${String((row as Loose | null)?.label || '').trim()}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return `${base}#${n}`;
  });
}
