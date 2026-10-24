// priceSave.ts — what an ingredient card's save does to the MONEY (step 3e-3). Pure: the store calls it, the specs pin it.
//
// The card hands in the price as it opened (`before`: the ingredient with its price document laid on) and the price patch
// it built from its boxes (@mise/shared/price-model pricePatch — every price key, as a value or as null). This decides,
// rule by rule of the current app's save (js/ingredient-record-form.js), what reaches the database:
//
//   • The price's DATE moves only with the money (keepPriceDate, his decision F4 — parity C23): a rename keeps the date
//     the invoice import reads to decide whether an invoice is newer than the price in force.
//   • A history entry is written only when the price is complete and the MONEY changed (priceChanged — parity C23, C24):
//     never for a rename, a Cartone → Singola, a basis-only tap or a retyped identical price.
//   • ⚠️ DIFFERENT FROM THE CURRENT APP, ON PURPOSE: the price document is written only when one of its keys would
//     change. The current app writes it on every manager save, the same values back when nothing was touched. Mise 2
//     saves local-first (decision T3), so a card opened on a phone whose copy of the prices is a little old would, on an
//     ordinary rename, put that old price back over a newer one written meanwhile on another phone — or from an invoice.
//     Untouched means unchanged, at the database too. The retired pack keys (packPrice, packSize) do not count as a
//     change on their own: they are drained by the next save that does move the price, as everything else of it is.
//   • ⚠️ A SAVE THAT DID NOT MOVE THE MONEY WRITES ONLY THE KEYS IT CHANGED (review of 22 Oct 2026). The patch is rebuilt
//     from the copy the card opened on, so writing all of it would put that copy's money back over a newer price written
//     meanwhile (an invoice import on the PC while a tablet changes only the VAT), under the old date and with no history.
//     A number equal to the stored one within rounding is not a change (pricePatch rounds a 6-decimal rate to 4), and the
//     date is never written on its own: an undated price stays undated until its money moves.

import { keepPriceDate, priceChanged, priceRecord, PRICE_FIELDS } from '@mise/shared/price-model';
import type { PricePatch } from '@mise/shared/price-model';
import type { IngredientPriceWrite } from './suppliersSource';

// Keys whose difference alone is not worth a write (header).
const RETIRED = new Set<string>(['packPrice', 'packSize']);

const same = (a: unknown, b: unknown): boolean => (a ?? null) === (b ?? null);
// The same within rounding — the tolerance price-model's priceChanged uses for the money.
const sameValue = (a: unknown, b: unknown): boolean =>
  typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) <= Math.max(1e-6, Math.abs(a) * 1e-4)
    : same(a, b);

// Whether writing `patch` would change any price key of `before` (a missing key and a null one are the same absence).
// `priceBasis` counts only when the patch carries it: a patch without it leaves the stored basis alone (merge).
export function priceDiffers(before: Readonly<Record<string, unknown>> | null, patch: Readonly<Record<string, unknown>>): boolean {
  const stored = before ?? {};
  return (PRICE_FIELDS as readonly string[]).some(key =>
    !RETIRED.has(key) && key in patch && !same(stored[key], patch[key]));
}

// The money half of a save, or null when the save must not touch the price document at all.
// `supplierId` is the supplier being SAVED (the history answers «what did we pay, to whom»), '' for none.
export function priceWriteOf(
  before: Readonly<Record<string, unknown>> | null,
  patch: PricePatch,
  supplierId: string,
  nowIso: string,
): IngredientPriceWrite | null {
  // One clock for the price's date and the history entry: the store's, at the moment of saving.
  const stamped = patch.priceUpdatedAt == null ? patch : { ...patch, priceUpdatedAt: nowIso };
  const dated = keepPriceDate(before, stamped);
  if (!priceDiffers(before, dated)) return null;
  if (before !== null && !priceChanged(before, dated)) {
    const stored: Readonly<Record<string, unknown>> = before;
    const changed = (PRICE_FIELDS as readonly string[]).filter(key =>
      !RETIRED.has(key) && key !== 'priceUpdatedAt' && key in dated && !sameValue(stored[key], (dated as Record<string, unknown>)[key]));
    if (changed.length === 0) return null;
    const doc: Record<string, unknown> = {};
    for (const key of changed) doc[key] = (dated as Record<string, unknown>)[key];
    for (const key of RETIRED) if (key in dated) doc[key] = null;
    return { doc, history: null };
  }
  const record = dated.pricePerUnit !== null && priceChanged(before, dated);
  return {
    doc: dated,
    history: record ? priceRecord({ supplierId }, dated, nowIso) : null,
  };
}
