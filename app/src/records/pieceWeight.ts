import { typedDecimal } from '@mise/shared/currency';

// ⚠️ THE PIECE WEIGHT IS TYPED IN GRAMS, STORED IN KILOS (port of the current app's #489, 8 Nov 2026). The box said «(kg)» and
// an egg was saved as 50 — fifty kilos — which priced eggs at 0,0033 €/kg in every recipe. A recipe is written in grams and so is
// what a person knows about one piece, so the box speaks grams; `unitWeightKg` and everything that reads it (price-model.ts,
// order-cost.ts, Food cost) stay in kilos, untouched. The conversion lives only in the card, on the new card (priceCardModel.ts)
// and on the card of before (legacyPriceModel.ts): the same two functions as gramsOfKg / kgTextOfGrams in
// js/ingredient-record-form.js, which pieceWeight.spec.ts runs side by side with these.

// Stored kilos → the grams the box shows ('' for none; anything that is not a number is shown as it is).
export function gramsOfKg(kg: unknown): string {
  if (kg === null || kg === undefined || kg === '') return '';
  const n = Number(kg);
  return Number.isFinite(n) ? String(Number((n * 1000).toPrecision(12))) : String(kg);
}

// What a person typed in grams → the kilo TEXT the price model reads (as typedDecimal hands it over). Everything Number() can read
// is converted — «55,», «,5» and «1e2» too, because the price model reads the box with Number() and would otherwise save them as
// KILOS, the very mistake above. Only text Number() cannot read passes through untouched, so Save still refuses it on its box;
// '' stays '' (no weight).
export function kgTextOfGrams(text: unknown): string {
  const typed = typedDecimal(text);
  if (typed.trim() === '') return typed;
  const n = Number(typed);
  if (!Number.isFinite(n)) return typed;
  return String(Number((n / 1000).toPrecision(12)));
}
