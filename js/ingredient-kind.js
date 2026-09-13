// ingredient-kind.js — is an item in «Fornitori e ingredienti» food, or packaging?
// PURE, ZERO IMPORTS.
//
// Federico, 13 Sep 2026: «la voce imballaggio deve puntare ad imballaggio che aggiungerei
// dentro fornitori ed ingredienti». A box, a bag or a label is bought from a supplier,
// ordered, priced and counted in the stocktake exactly like flour — so it lives in the
// same `ingredients` collection, told apart by `kind: 'packaging'`.
//
// ⚠️ IN js/ ROOT because three features ask the question: the registry files it, the
// Catalogue must never link a recipe row to it, and Food cost offers it only as packaging.
// ⚠️ ABSENT MEANS FOOD. Every item written before this existed has no `kind`, and every
// one of them is an ingredient — so only a literal 'packaging' is packaging.

export const INGREDIENT_KINDS = Object.freeze(['ingredient', 'packaging']);

export function isPackaging(item) {
  return !!item && typeof item === 'object' && item.kind === 'packaging';
}

// What a form writes: 'packaging', or 'ingredient' for anything else.
export function kindOf(item) {
  return isPackaging(item) ? 'packaging' : 'ingredient';
}
