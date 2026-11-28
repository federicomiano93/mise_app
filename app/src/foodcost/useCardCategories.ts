import { useMemo } from 'react';
import { useT } from '../i18n/useT';
import { cardCategories } from './categoriesModel';
import type { CardCategories } from './categoriesModel';
import { useFoodcost } from './FoodcostContext';

// The categories the cards are grouped, filtered and edited by: the Ricettario's words, alphabetical in the interface language, with the
// card-to-word rules of categoriesModel.ts (a recipe's card follows its recipe). The ONE place the screens get them from, so the list,
// the chooser and the card's editor never disagree.
export function useCardCategories(): CardCategories {
  const { locale } = useT();
  const { recipeWords, categories, recipes } = useFoodcost();
  return useMemo(() => cardCategories({ words: recipeWords, categories, recipes, locale }), [recipeWords, categories, recipes, locale]);
}
