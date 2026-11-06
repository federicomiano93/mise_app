// row-actions-model.js — the two judgements behind a recipe row's menu (Federico, 7 Nov 2026):
// can the row's amount be split in two, and can the row be ordered. Pure: no DOM, no t() — the
// screen (catalogue-detail.js) turns a reason into words.

import { roundInUnit, linkOf } from './catalogue-model.js';

// The amount as two parts in the row's OWN unit, or null. The first part is rounded to what the
// unit can show and the second is the rest, so the two always add up to the amount on screen
// (1251 g -> 626 + 625). Null for «to taste» (no amount), a non-number, zero, or an amount so small
// that one part would show as nothing (1 g, 1 piece).
export function splitAmount(value, unit) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const a = roundInUnit(n / 2, unit);
  const b = roundInUnit(n - a, unit);
  if (!(a > 0) || !(b > 0)) return null;
  return { a, b };
}

// Why a row cannot be split: null when it can, 'toTaste' when there is no amount, else 'tooSmall'.
export function splitBlockReason(value, unit) {
  if (value === null || value === undefined || unit === 'to taste') return 'toTaste';
  return splitAmount(value, unit) ? null : 'tooSmall';
}

// Whether a row can be ordered: `{ ok: true, ingredientId }`, or `{ ok: false, reason }` with
// 'recipe' (the row is another recipe of the Recipe book), 'notInUse' (its ingredient is marked
// not in use) or 'noSupplier' (no link, the ingredient is gone, or it has no active supplier).
// A supplier counts only when `active !== false`, like everywhere else in the app.
export function orderTargetOf(row, ingredients, suppliers) {
  const link = linkOf(row);
  if (!link) return { ok: false, reason: 'noSupplier' };
  if (link.kind === 'recipe') return { ok: false, reason: 'recipe' };
  const ing = ingredients ? ingredients[link.refId] : undefined;
  if (!ing) return { ok: false, reason: 'noSupplier' };
  if (ing.active === false) return { ok: false, reason: 'notInUse' };
  const supplier = ing.supplierId && suppliers ? suppliers[ing.supplierId] : undefined;
  if (!supplier || supplier.active === false) return { ok: false, reason: 'noSupplier' };
  return { ok: true, ingredientId: link.refId };
}
