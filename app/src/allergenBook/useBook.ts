import { useMemo } from 'react';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { canPrintLabel, outputLanguage } from '@mise/shared/market';
import { allergensOn } from '@mise/shared/venue-features';
import { useT } from '../i18n/useT';
import { useAllergenTables } from '../recipes/allergenTables';
import type { AllergenTables } from '../recipes/allergenTables';
import { useRecipes } from '../recipes/RecipesContext';
import { useSession } from '../session/SessionContext';
import { bookShelf } from './bookShelf';
import type { ShelfGroup } from './bookShelf';
import { isBookComplete } from './bookEntry';

// What the book screen and its title band both need, worked out once per change of the data: why the book cannot be drawn (the
// label's own two refusals, in the label's order), whether the recipes and ingredients have answered, and the shelf.
//
// ⚠️ NOT A LABEL FILE: it decides nothing about food words. «Complete» is bookEntry.ts's decision (isBookComplete), and the
// refusals are the label's (allergens switched off, no country), asked here as yes / no.
export type BookBlock = 'allergens-off' | 'no-country' | null;

export type BookView = {
  readonly block: BookBlock;
  readonly loaded: boolean;
  readonly tables: AllergenTables;
  readonly groups: readonly ShelfGroup<CatalogueRecipe>[];
  readonly incomplete: readonly CatalogueRecipe[];
  readonly count: number;
  readonly categories: readonly string[];
  readonly locale: string;
};

export function useBook(): BookView {
  const { locale } = useT();
  const { location } = useSession();
  const { recipes, recipesLoaded, ingredients, ingredientsLoaded, categories } = useRecipes();
  const tables = useAllergenTables(recipes, ingredients);
  const block: BookBlock = !allergensOn(location)
    ? 'allergens-off'
    : outputLanguage(location) === null || !canPrintLabel(location) ? 'no-country' : null;
  const loaded = recipesLoaded && ingredientsLoaded;
  const shelf = useMemo(
    () => (block === null && loaded
      ? bookShelf(recipes, categories, locale, recipe => isBookComplete(recipe, tables))
      : { groups: [], incomplete: [], count: 0 }),
    [block, loaded, recipes, categories, locale, tables],
  );
  return { block, loaded, tables, categories, locale, ...shelf };
}
