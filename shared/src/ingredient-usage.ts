// ingredient-usage.ts — the ingredient book: where each ingredient is used.
//
// NEW IN MISE 2 (14 Nov 2026, part 2 of the owner's plan), NO ORIGINAL in js/: the current app has no such page, so nothing is
// paired in parity.spec.ts and ingredient-usage.spec.ts runs against this file alone.
//
// Pure: the recipes and the ingredients as the database holds them in, the book out. Nothing here reads a price (the recipe
// book's ingredients carry none) and nothing here writes.
//
// ⚠️ ONLY LINKED ROWS COUNT. A recipe row is «this ingredient» when it is LINKED to it (`kind` 'ingredient' and its `refId`,
// the link the recipe editor writes). A row typed by name and never linked is not matched by its words: «Burro» typed in one
// recipe and the ingredient «Burro salato» are not the same thing, and a guess would put a wrong recipe under an ingredient.
// ⚠️ DIRECT USES ONLY. Butter in a cream that is itself a row of the brioche lists the cream, not the brioche: the amount of
// butter in the brioche depends on how much cream it takes, which is the cream's own page.

import { baseAmounts, linkOf, normalizeCatalogueRecipe, normalizeSearchText, unitOf } from './catalogue-model';
import type { CatalogueUnit } from './catalogue-model';
import { ingredientDisplayName, ingredientNameMatches } from './ingredient-name';
import { isPackaging } from './ingredient-kind';
import { isArchivedRecipe } from './recipe-shelf';

// One recipe that uses an ingredient, and the rows that do (a recipe can list the same ingredient twice, e.g. water in two
// stages), each in the row's own unit, as written in the recipe (the base recipe, never a batch).
// ⚠️ THE AMOUNT IS THE ONE THE RECIPE SCREEN SHOWS (baseAmounts, the function it draws the recipe as written with), not the stored
// number: in an all-grams recipe the rows are rounded so they add up to the total, and the difference goes on the largest row —
// Flour 1000 g, Water 600 g, Yeast 2.5 g, Salt 20.5 g reads «Flour 999 g» there, and must read the same here. A «to taste» row
// keeps its stored number (it shows none).
export interface IngredientUse {
  readonly recipeId: string;
  readonly recipeName: string;
  readonly archived: boolean;
  readonly rows: readonly { readonly amount: number; readonly unit: CatalogueUnit }[];
}

export interface IngredientEntry {
  readonly id: string;
  // What a person reads: the short name when there is one, else the name (ingredientDisplayName).
  readonly name: string;
  // The ingredient is marked «not in use» in Ingredients & suppliers (`active === false`).
  readonly inactive: boolean;
  // The recipes that use it: the ones in use first, then the archived ones, each group by name.
  readonly uses: readonly IngredientUse[];
}

type Doc = { readonly id: string } & Record<string, unknown>;

const byName = (locale: string) => {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  return (a: string, b: string) => collator.compare(a, b);
};

// The whole book: every FOOD ingredient (packaging never goes in a recipe), by name in the interface language's order, each
// with the recipes that use it. `locale` is the interface's (useT().locale), for the alphabetical order only.
export function ingredientBook(recipes: readonly unknown[], ingredients: readonly unknown[], locale = 'en'): IngredientEntry[] {
  const compare = byName(locale);
  // Every ingredient id → the uses found for it, recipe by recipe.
  const usesOf = new Map<string, IngredientUse[]>();
  for (const raw of Array.isArray(recipes) ? recipes : []) {
    const recipe = normalizeCatalogueRecipe(raw);
    const id = raw && typeof raw === 'object' ? (raw as { id?: unknown }).id : undefined;
    if (recipe === null || typeof id !== 'string' || id === '') continue;
    const rowsByIngredient = new Map<string, { amount: number; unit: CatalogueUnit }[]>();
    const shown = baseAmounts(recipe);
    recipe.ingredients.forEach((row, index) => {
      const link = linkOf(row);
      if (link === null || link.kind !== 'ingredient') return;
      const list = rowsByIngredient.get(link.refId) ?? [];
      list.push({ amount: shown[index] ?? row.grams, unit: unitOf(row) });
      rowsByIngredient.set(link.refId, list);
    });
    for (const [ingredientId, rows] of rowsByIngredient) {
      const list = usesOf.get(ingredientId) ?? [];
      list.push({ recipeId: id, recipeName: recipe.name, archived: isArchivedRecipe(raw), rows });
      usesOf.set(ingredientId, list);
    }
  }

  const entries: IngredientEntry[] = [];
  for (const raw of Array.isArray(ingredients) ? ingredients : []) {
    if (!raw || typeof raw !== 'object') continue;
    const doc = raw as Doc;
    if (typeof doc.id !== 'string' || doc.id === '' || isPackaging(doc)) continue;
    const uses = (usesOf.get(doc.id) ?? []).slice().sort((a, b) => (
      a.archived === b.archived ? compare(a.recipeName, b.recipeName) : a.archived ? 1 : -1
    ));
    entries.push({ id: doc.id, name: ingredientDisplayName(doc).trim(), inactive: doc.active === false, uses });
  }
  return entries.sort((a, b) => compare(a.name, b.name));
}

// The entries a search keeps: by any of the ingredient's three names (name, short name, the invoice's name), folded for case and
// accents like every other search of the app. `ingredients` is the same list handed to ingredientBook, for those names. An empty
// search keeps everything (the very same array).
export function searchBook(book: readonly IngredientEntry[], ingredients: readonly unknown[], query: unknown): readonly IngredientEntry[] {
  const q = normalizeSearchText(query);
  if (!q) return book;
  const byId = new Map<string, unknown>();
  for (const raw of Array.isArray(ingredients) ? ingredients : []) {
    if (raw && typeof raw === 'object' && typeof (raw as Doc).id === 'string') byId.set((raw as Doc).id, raw);
  }
  return book.filter(entry => ingredientNameMatches(byId.get(entry.id) ?? { name: entry.name }, q, normalizeSearchText));
}
