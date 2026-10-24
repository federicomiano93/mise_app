import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../i18n/useT';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { useRecipesStore } from './RecipesContext';
import { useRecipeDeletions } from './recipeDeletions';

// Deleting a recipe, ONE function for the recipe page and the editor (a port of confirmAndDelete of
// js/catalogue/catalogue-main.js): the question, with the Calculator warning when the Calculator uses the recipe (a linked
// tab, or an old copy), then the
// delete, «Recipe deleted.» exactly once, and the caller's `after` (leave the screen).
//
// ⚠️ THE CALCULATOR CHECK NEVER BLOCKS THE QUESTION FOR MORE THAN 2.5 s (the store races it): a slow or offline read
// simply does not warn. The recipe is marked as deleted HERE before it goes, so RecipeScreen — which says «Recipe
// deleted.» and leaves when an open recipe disappears — stays quiet (recipeDeletions.ts).
//
// Returns [run, dialog]: `run` resolves true when the recipe was deleted, false when the person said no (or another
// question was already open); `dialog` goes in the component's output.
type Target = { readonly id: string; readonly name: string };

export function useDeleteRecipe(): readonly [(recipe: Target, after: () => void) => Promise<boolean>, ReactNode] {
  const { t } = useT();
  const store = useRecipesStore();
  const say = useStatusMessage();
  const deletions = useRecipeDeletions();
  const [confirm, dialog] = useConfirm();
  const asking = useRef(false);

  async function run(recipe: Target, after: () => void): Promise<boolean> {
    if (asking.current) return false;
    asking.current = true;
    try {
      const calculator = await store.calculatorImportOf(recipe.id);
      const base = t('cat.deleteRecipeQ', { name: recipe.name || t('cat.thisRecipe') });
      // A LINKED tab stops calculating once its recipe is gone; an old copy of the recipe simply stays (see the two sentences).
      const warning = calculator === 'linked' ? t('cat.itIsLinkedToCalculator') : calculator === 'copy' ? t('cat.itWasImportedInto') : '';
      const ok = await confirm({
        title: t('cat.deleteRecipe2'),
        message: base + warning,
        okLabel: t('ui.delete'),
        cancelLabel: t('common.cancel'),
        danger: true,
      });
      if (!ok) return false;
      deletions.mark(recipe.id);
      store.deleteRecipe(recipe.id);
      say(t('cat.recipeDeleted'));
      after();
      return true;
    } finally {
      asking.current = false;
    }
  }

  return [run, dialog];
}
