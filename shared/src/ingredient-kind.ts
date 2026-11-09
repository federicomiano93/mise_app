// ingredient-kind.ts — is an item in «Fornitori e ingredienti» food, or packaging?
//
// TypeScript port of js/ingredient-kind.js for Mise 2. Behaviour is identical, input for input:
// ingredient-kind.spec.ts runs every test against BOTH files, parity.spec.ts compares their exports and
// odd-inputs.spec.ts feeds both the same strange values. PURE, ZERO IMPORTS.
//
// A box, a bag or a label is bought from a supplier, ordered, priced and counted in the stocktake
// exactly like flour — so it lives in the same `ingredients` collection, told apart by
// `kind: 'packaging'`.
//
// ⚠️ SHARED because three features ask the question: the registry files it, the Catalogue must never
// link a recipe row to it, and Food cost offers it only as packaging.
// ⚠️ ABSENT MEANS FOOD. Every item written before this existed has no `kind`, and every one of them is
// an ingredient — so only a literal 'packaging' is packaging.

export const INGREDIENT_KINDS = Object.freeze(['ingredient', 'packaging'] as const);

export type IngredientKind = (typeof INGREDIENT_KINDS)[number];

export function isPackaging(item: unknown): boolean {
  return !!item && typeof item === 'object' && (item as { kind?: unknown }).kind === 'packaging';
}

// What a form writes: 'packaging', or 'ingredient' for anything else.
export function kindOf(item: unknown): IngredientKind {
  return isPackaging(item) ? 'packaging' : 'ingredient';
}
