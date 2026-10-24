// category-batches.ts — how «delete a category» is split into Firestore batches, and what one
// ingredient write carries. PURE: no SDK import.
//
// TypeScript port of js/orders/category-batches.js for Mise 2. Behaviour is identical, input for
// input: category-batches.spec.ts runs every test against BOTH files, parity.spec.ts compares
// their exports and odd-inputs.spec.ts feeds both the same strange values.
//
// ⚠️ WHY THE BATCHES ARE SMALL. Firestore's production limit is 20 document-access calls
// per batched write, and the rules make ~2 get() calls for each ingredient write (its own
// membership and role) and ~3 for the config/orders write. The 500-writes-per-batch limit
// the SDK documents is NOT the one that bites: 6 ingredient writes (~12 calls) plus the
// config write (~3) stay well under 20, while 500 would be refused. The emulator does not
// enforce it, so only this cap keeps a venue with many ingredients in one category working.

import { INGREDIENT_DRAINED_FIELDS } from './price-model';

export const INGREDIENT_WRITES_PER_BATCH = 6;

export interface BatchStep {
  config: boolean;
  ids: string[];
}

// ids        — the ingredients to change
// perBatch   — the most WRITES in one batch (the config write counts as one)
// withConfig — the venue's category list rides in the FIRST batch, so the list and the
//              first ingredients change together or not at all
// -> [{ config: boolean, ids: string[] }], in commit order
export function planBatches(ids?: unknown, perBatch: unknown = INGREDIENT_WRITES_PER_BATCH, withConfig: unknown = false): BatchStep[] {
  const list: string[] = Array.isArray(ids) ? ids.filter(Boolean) : [];
  const size = Math.max(1, Math.floor(Number(perBatch)) || INGREDIENT_WRITES_PER_BATCH);
  const plan: BatchStep[] = [];
  let index = 0;
  if (withConfig) {
    const first: BatchStep = { config: true, ids: list.slice(0, size - 1) };
    plan.push(first);
    index = first.ids.length;
  }
  while (index < list.length) {
    plan.push({ config: false, ids: list.slice(index, index + size) });
    index += size;
  }
  return plan;
}

// One ingredient's write: the category, plus every legacy price key set to null.
// ⚠️ The ingredients rule validates the FULL MERGED document, and an old ingredient may still
// carry legacy numeric price keys, which it allows ONLY as null — a write of the category
// alone is refused on such a document and takes the whole batch with it. Every ordinary
// ingredient save already drains them the same way (price-model).
export function categoryPatch(value?: unknown): Record<string, unknown> {
  const patch: Record<string, unknown> = { category: value };
  INGREDIENT_DRAINED_FIELDS.forEach(key => { patch[key] = null; });
  return patch;
}
