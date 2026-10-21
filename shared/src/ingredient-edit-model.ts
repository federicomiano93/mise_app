// ingredient-edit-model.ts — the pure decisions behind editing and deleting an EXISTING
// ingredient from a screen that is not «Fornitori e ingredienti» (Orders, 1 Oct 2026).
//
// TypeScript port of js/ingredient-edit-model.js for Mise 2. Behaviour is identical, input for input:
// ingredient-edit-model.spec.ts runs every test against BOTH files, parity.spec.ts compares their exports and
// odd-inputs.spec.ts feeds both the same strange values. The comments below are the ones the original paid for in bugs.
//
// Pure and import-light on purpose: the data layer talks to Firestore and cannot be loaded in a test, so the
// judgements it relies on live here, where a test can prove them.

import { withPrices } from './price-model';
import type { PriceField, PriceFieldValues } from './price-model';

// A stored ingredient, as far as this file reads it: the id is the only field it looks at.
export interface IngredientLike {
  id?: string;
}

// The ingredient merged with its price: every price field is whatever the price document holds (or null).
export type ItemWithPrice<T extends IngredientLike> = Omit<T, PriceField> & PriceFieldValues;

// The ingredient as the card must open it: the document MERGED with its price document.
//
// ⚠️ A CARD OPENED WITHOUT THE PRICE IS A TRAP, NOT JUST A GAP. The price boxes would be empty,
// and an untouched Save then writes «no price» (pricePatch → nulls, merged over the stored
// price): the card would quietly erase what it failed to show. Orders already holds both
// collections and merges them (withPrices); this exists for the moment one of them has not
// arrived yet, when the caller reads the price document itself and merges it the same way.
export function itemWithPrice<T extends IngredientLike>(ingredient: T, priceDoc?: object | null): ItemWithPrice<T>;
export function itemWithPrice(ingredient: null | undefined, priceDoc?: object | null): typeof ingredient;
export function itemWithPrice(ingredient: IngredientLike | null | undefined, priceDoc?: object | null): unknown {
  if (!ingredient) return ingredient;
  return withPrices([ingredient], priceDoc ? { [ingredient.id as string]: priceDoc } : {})[0];
}

// Whether the price still has to be fetched before the card may open: only for somebody who
// may see and write money, and only while the live price snapshot has not answered.
// (Somebody who may not write prices gets no price block at all, so nothing can be erased.)
export function needsPriceRead({ mayPrice, pricesLoaded }: { mayPrice?: unknown; pricesLoaded?: unknown }): boolean {
  return mayPrice === true && pricesLoaded !== true;
}

// One document a delete removes.
export interface DeleteStep {
  collection: 'ingredients' | 'ingredient-prices';
  id: string;
}

// The documents a delete removes, as [{ collection, id }], in one batch.
//
// ⚠️ THE PRICE DOCUMENT ONLY WHEN THE PERSON MAY WRITE PRICES. A batch is all-or-nothing:
// ingredient-prices is deletable by canManage(lid, 'foodcost') alone (firestore.rules), so for
// an owner of a venue with Food cost switched off a delete of it would have the DATABASE refuse
// the whole batch — and the ingredient with it. Same reasoning as saveIngredientWithPrice's
// `writePrice`.
// ⚠️ THE APPEND-ONLY `ingredients/{id}/prices` HISTORY IS NOT IN THE LIST, and cannot be: the
// rules forbid deleting it. It stays behind, unreachable (nothing lists a subcollection whose
// parent is gone), which is what append-only means.
export function deletePlan({ id, mayPrice }: { id: string; mayPrice?: unknown }): DeleteStep[] {
  return [
    { collection: 'ingredients', id },
    ...(mayPrice === true ? [{ collection: 'ingredient-prices' as const, id }] : []),
  ];
}

// The field path of an ingredient's quantity in the shared order draft (`drafts/current`).
// Cleared when the ingredient is deleted, or its quantity would sit in the draft, invisible
// and uncounted — leftover data, never ordered, since nothing walks an ingredient that is gone.
export function draftEntryPath(id: unknown): string {
  return `entries.${id}`;
}

export interface ConfirmAndDeleteInput {
  item?: { id?: string } | null;
  ask: () => Promise<boolean>;
  remove: (id: string) => Promise<unknown>;
  onStart?: () => void;
  onDone?: () => void;
  onFail?: (err: unknown) => void;
}

// The bin's whole flow, with its collaborators handed in so it can be run without a screen:
// ask first, delete only on «yes», and say so on failure without having changed anything.
//
//   ask()       → Promise<boolean>   the danger confirmation
//   remove(id)  → Promise            the feature's delete (the batch, the draft clean-up)
//   onStart()   — lock the card while the write runs (a second tap must not delete twice)
//   onDone()    — the card closes
//   onFail(err) — unlock the card and say what went wrong; the card stays open, as typed
//
// Resolves true only when the ingredient was deleted. ⚠️ `onDone` runs ONLY after `remove`
// succeeded: closing the card on a refused delete would look like it had worked.
export async function confirmAndDelete({ item, ask, remove, onStart, onDone, onFail }: ConfirmAndDeleteInput): Promise<boolean> {
  if (!item || !item.id) return false;
  if (!(await ask())) return false;
  onStart?.();
  try {
    await remove(item.id);
  } catch (err) {
    onFail?.(err);
    return false;
  }
  onDone?.();
  return true;
}
