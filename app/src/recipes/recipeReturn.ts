import { createContext, useContext } from 'react';

// Back from a recipe's label returns to the recipe AS IT WAS LEFT: the allergen card's fold open, the focus on «Make a
// label», and the scroll where it was. The recipe screen is a different screen from the label (keyed on the kind), so
// it is drawn again from nothing; this is what carries the three things across.
//
// The section writes the place down when «Make a label» is pressed (it owns the scroll, and reads both scroll boxes),
// the card reads `pending()` while drawing its first time to open its fold, and takes the focus back with
// `delivered()` so the recipe screen does not also move the focus to its title. The section forgets the place at the
// next move that is not the return, so a recipe opened afresh later does not reopen its fold.

export interface RecipeReturn {
  // «Make a label» of this recipe is about to open: write down where the screen is.
  remember(recipeId: string): void;
  // Is this recipe being returned to from its label? Read while drawing; it changes nothing.
  pending(recipeId: string): boolean;
  // The card has put the focus back on the button: the recipe screen has nothing left to focus.
  markDelivered(): void;
  wasDelivered(): boolean;
}

const NOTHING: RecipeReturn = {
  remember() { /* no section around: nothing to come back to */ },
  pending: () => false,
  markDelivered() { /* ditto */ },
  wasDelivered: () => false,
};

const RecipeReturnContext = createContext<RecipeReturn>(NOTHING);
export const RecipeReturnProvider = RecipeReturnContext.Provider;

export function useRecipeReturn(): RecipeReturn {
  return useContext(RecipeReturnContext);
}

// The place written down: the recipe, how far the shell's scroll area and the split's right-hand side were scrolled.
export interface Place {
  readonly id: string;
  readonly area: number | null;
  readonly detail: number | null;
  delivered: boolean;
}
