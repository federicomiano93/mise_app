// bookShelf.ts — which recipes the allergen book holds, and how both of its screens lay them out. Pure: no React, no words.
//
// ⚠️ NOT A LABEL FILE (label-separation.spec.ts): it composes no food word. «Is this product complete?» is a LABEL decision, so it is
// taken as a callback from the caller and lives only in bookEntry.ts; this file never imports buildLabel.
//
// Order is the Recipe book's own: the venue's categories alphabetical in the interface language (`sortedCategories`), the recipes
// in no category last, and inside each group the recipes alphabetical by name. `shelveRecipes` keeps the order it is handed, so the
// recipes are sorted BEFORE they are shelved.
import { filterByName } from '@mise/shared/catalogue-model';
import { shelveRecipes, sortedCategories, withoutArchived } from '@mise/shared/recipe-shelf';
import { isInBook } from '../recipes/labelTexts';

// One category's recipes. '' is «no category».
export type ShelfGroup<T> = { readonly category: string; readonly recipes: readonly T[] };

type Named = { readonly id: string; readonly name: string };

function byName<T extends Named>(list: readonly T[], locale: string): T[] {
  return list.slice().sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: 'base' }));
}

function shelve<T extends Named>(list: readonly T[], categories: readonly string[], locale: string): ShelfGroup<T>[] {
  return shelveRecipes(byName(list, locale), sortedCategories(categories, locale)).groups;
}

// The book: the recipes that are in it (`inBook`) and not archived (an archived recipe keeps its flag but is hidden, in the count too).
// The ones whose allergens cannot be declared yet (`complete` false) are pulled out of the groups into `incomplete`, alphabetical,
// to be shown on top; `count` is every product in the book, complete or not.
export function bookShelf<T extends Named>(
  recipes: readonly T[],
  categories: readonly string[],
  locale: string,
  complete: (recipe: T) => boolean,
): { groups: ShelfGroup<T>[]; incomplete: T[]; count: number } {
  const held = byName(withoutArchived(recipes).filter(isInBook), locale);
  const done: T[] = [];
  const incomplete: T[] = [];
  for (const recipe of held) (complete(recipe) ? done : incomplete).push(recipe);
  return { groups: shelve(done, categories, locale), incomplete, count: held.length };
}

// The pencil screen's list: every recipe that is not archived, filtered by what was typed, laid out the same way.
export function chooseShelf<T extends Named>(
  recipes: readonly T[],
  categories: readonly string[],
  locale: string,
  query: unknown,
): ShelfGroup<T>[] {
  return shelve(filterByName(withoutArchived(recipes), query), categories, locale);
}
