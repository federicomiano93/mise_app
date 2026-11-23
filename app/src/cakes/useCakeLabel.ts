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
// listens to — the cards, the recipes and the ingredients with their allergens. The row reads nothing of its own; the full-screen view, and
// only while it is open, starts the Recipes' store (the label settings, the paper, the shop computer's heartbeat) on top of that (P14).
//
// ⚠️ WORKED OUT FROM WHAT THE LABEL DEPENDS ON ONLY: the lines, the tiers and the tables. Typing in any other field (the price, a note) hands
// this hook a new `cake` object every keystroke and must not redo the walk through every card; the name is the title's business and the
// synthetic recipe is given the name only after the heavy part.
export function useCakeLabel(cake: Cake): CakeLabelState {
  const snap = useFoodcost();
  const { lines, tiers, diameterCm, discs, discHeightCm, ref, id } = cake;
  const worked = useMemo(
    () => cakeLabel({ ...cake, lines, tiers, diameterCm, discs, discHeightCm, ref, id, name: '' }, snap.tables),
    // The rest of `cake` (price, notes, name) does not enter the label.
    [lines, tiers, diameterCm, discs, discHeightCm, ref, id, snap.tables],
  );
  const name = cake.name.trim();
  const answer = useMemo(() => withName(worked, name), [worked, name]);
  return {
    answer,
    tables: snap.tables,
    loaded: snap.productsLoaded && snap.recipesLoaded && snap.ingredientsLoaded,
    unreadable: snap.recipesFailed || snap.ingredientsFailed,
  };
}

// The cake's name goes in after the heavy part: it is on the synthetic recipe and on the label, nowhere else.
function withName(answer: CakeLabelAnswer, name: string): CakeLabelAnswer {
  const build = { ...answer.build, recipe: { ...answer.build.recipe, name } };
  if (answer.label === null) return { ...answer, build } as CakeLabelAnswer;
  return { ...answer, build, label: answer.label.ok ? { ...answer.label, name } : answer.label } as CakeLabelAnswer;
}
