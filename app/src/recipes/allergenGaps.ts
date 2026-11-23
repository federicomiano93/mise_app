import { linkOf } from '@mise/shared/catalogue-model';
import type { AllergenReason, AllergenRow } from '@mise/shared/recipe-allergen-model';

// Where a tap on one of the allergen card's gaps goes. The shared model reports a gap as a bare `AllergenRow` (label, reason) with no
// link back to the recipe's row, and it is pinned against the rollback copy's file, so the way back is worked out here.
//
// ⚠️ THE ALIGNMENT THIS RESTS ON: `recipeAllergens()` returns `rows` with ONE ENTRY PER RECIPE ROW, IN THE SAME ORDER (it is a `map`
// over `recipe.ingredients`), and `gaps` is exactly `rows.filter(row => !row.declared && row.label)`. So the gaps are found again
// here by the model's own filter, each with the index of its recipe row, and the row's link is read from `recipe.ingredients[index]`.
// allergenGaps.spec.ts pins that this list and the model's `gaps` are the same rows.
export type GapTarget =
  // A linked ingredient nobody has declared: its card in Suppliers.
  | { readonly kind: 'ingredient'; readonly refId: string }
  // A linked sub-recipe that is not fully declared: that recipe's own screen.
  | { readonly kind: 'recipe'; readonly refId: string }
  // Everything else is a row of THIS recipe to put right: the recipe's editor.
  | { readonly kind: 'editor' };

export interface GapEntry {
  // The row's place in the recipe, and the stable name the focus is handed back by when the person returns.
  readonly index: number;
  readonly key: string;
  readonly label: string;
  readonly reason: AllergenReason;
  readonly target: GapTarget;
}

export const gapKey = (index: number): string => `gap:${index}`;

export function gapEntries(recipeRows: readonly unknown[], rows: readonly AllergenRow[]): GapEntry[] {
  const out: GapEntry[] = [];
  rows.forEach((row, index) => {
    if (row.declared || !row.label || row.reason === null) return;
    out.push({ index, key: gapKey(index), label: row.label, reason: row.reason, target: targetOf(row.reason, recipeRows[index]) });
  });
  return out;
}

function targetOf(reason: AllergenReason, recipeRow: unknown): GapTarget {
  const link = linkOf(recipeRow);
  if (reason === 'not-declared' && link !== null && link.kind !== 'recipe') return { kind: 'ingredient', refId: link.refId };
  if (reason === 'sub-incomplete' && link !== null && link.kind === 'recipe') return { kind: 'recipe', refId: link.refId };
  return { kind: 'editor' };
}
