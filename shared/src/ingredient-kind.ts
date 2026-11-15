// ingredient-kind.ts — is an item in «Fornitori e ingredienti» food, packaging, resale or other?
//
// TypeScript port of js/ingredient-kind.js for Mise 2, with ONE DELIBERATE DIFFERENCE (14 Nov 2026, below).
// ingredient-kind.spec.ts runs the old values against BOTH files, parity.spec.ts compares their exports (the Mise 2
// additions are listed there as such) and odd-inputs.spec.ts feeds both the same strange values. PURE, ZERO IMPORTS.
//
// A box, a bag or a label is bought from a supplier, ordered, priced and counted in the stocktake
// exactly like flour — so it lives in the same `ingredients` collection, told apart by
// `kind: 'packaging'`.
//
// ⚠️ MISE 2 ONLY (14 Nov 2026, «tutti i prodotti delle fatture in Mise»): two more kinds, so that EVERY product of an
// invoice can be kept — 'resale' («Rivendita»: sold as it arrives — water, Coca Cola, beer) and 'other' («Altro»:
// cleaning, tools, clothing). They are priced, ordered and counted like any item, and NEVER offered where food is
// chosen (a recipe row, Food cost's ingredients, allergens, labels, nutrition). The current app is frozen and never
// writes them: its `kindOf` reads them as 'ingredient'; this one keeps them.
//
// ⚠️ SHARED because several features ask the question: the registry files it, the Catalogue must never
// link a recipe row to anything but food, and Food cost offers packaging only as packaging.
// ⚠️ ABSENT MEANS FOOD. Every item written before this existed has no `kind`, and every one of them is
// an ingredient — so only a literal 'packaging', 'resale' or 'other' is anything else.

// MISE 2: four kinds (the original's list is ['ingredient', 'packaging']). Closed, like the rules' list.
export const INGREDIENT_KINDS = Object.freeze(['ingredient', 'packaging', 'resale', 'other'] as const);

export type IngredientKind = (typeof INGREDIENT_KINDS)[number];

const kindValue = (item: unknown): unknown => (!!item && typeof item === 'object' ? (item as { kind?: unknown }).kind : undefined);

export function isPackaging(item: unknown): boolean {
  return !!item && typeof item === 'object' && (item as { kind?: unknown }).kind === 'packaging';
}

// MISE 2 ONLY: goods sold as they arrive (drinks).
export function isResale(item: unknown): boolean {
  return kindValue(item) === 'resale';
}

// MISE 2 ONLY: neither food nor packaging nor resale (cleaning, tools, clothing).
export function isOther(item: unknown): boolean {
  return kindValue(item) === 'other';
}

// What a form writes: the item's own kind when it is one of the four, 'ingredient' for anything else (absent, null,
// a value nobody writes — the rules refuse those).
// MISE 2: 'resale' and 'other' are KEPT (the original turns them into 'ingredient').
export function kindOf(item: unknown): IngredientKind {
  if (isPackaging(item)) return 'packaging';
  if (isResale(item)) return 'resale';
  if (isOther(item)) return 'other';
  return 'ingredient';
}

// MISE 2 ONLY: is this item FOOD — the only kind a recipe row, Food cost's ingredient list, an allergen declaration,
// a label or a nutrition table may use? An item whose kind is absent, null or 'ingredient' (every old item). Exactly
// the items kindOf calls 'ingredient', so the two never disagree; something that is not an item at all is not food.
// ⚠️ Where the code used to ask «!isPackaging» to mean «is food», it must ask this, or resale and other leak in.
export function isFood(item: unknown): boolean {
  return !!item && typeof item === 'object' && kindOf(item) === 'ingredient';
}
