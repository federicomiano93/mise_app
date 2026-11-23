import { useMemo } from 'react';
import { cakeLabel } from '@mise/shared/cake-label-model';
import type { CakeLabelAnswer } from '@mise/shared/cake-label-model';
import type { Cake } from '@mise/shared/cake-model';
import type { CostTables } from '@mise/shared/foodcost-model';
import { useFoodcost } from '../foodcost/FoodcostContext';

export interface CakeLabelState {
  readonly answer: CakeLabelAnswer;
  readonly tables: CostTables;
  // The cards, the recipes and the ingredients have all answered: until then no verdict is drawn (every row would read «not declared» only
  // because nothing had come yet).
  readonly loaded: boolean;
  // The recipes or the ingredients cannot be read by this person: never a label drawn from whatever happened to be held.
  readonly unreadable: boolean;
}

// What the whole cake's label says about the cake as it is NOW on screen (the working copy, saved or not), from the tables Food cost already
// listens to — the cards, the recipes and the ingredients with their allergens. No second reading of the database (P14).
export function useCakeLabel(cake: Cake): CakeLabelState {
  const snap = useFoodcost();
  const answer = useMemo(() => cakeLabel(cake, snap.tables), [cake, snap.tables]);
  return {
    answer,
    tables: snap.tables,
    loaded: snap.productsLoaded && snap.recipesLoaded && snap.ingredientsLoaded,
    unreadable: snap.recipesFailed || snap.ingredientsFailed,
  };
}
