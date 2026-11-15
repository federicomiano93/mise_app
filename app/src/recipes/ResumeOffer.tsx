import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { normalizeSteps, progressText } from '@mise/shared/guided-model';
import { useT } from '../i18n/useT';
import { useConfirm } from '../ui/useConfirm';
import { useRecipes } from './RecipesContext';
import { recipeOpener, useHandBack } from './handBack';
import { resumableSession } from './guidedSession';
import { FROM_LIST, FROM_RECIPE } from './recipesNav';
import { mixPath, recipePath } from './recipesPath';

// «Carry on mixing?» — offered AT MOST ONCE PER APP OPENING, when the list is on screen, the recipes are in and a whole, recent
// mix of a recipe still held is saved (a port of offerResume in js/catalogue/catalogue-main.js).
//
// ⚠️ A MODULE VARIABLE, NOT STATE: «once per app opening» outlives this component, which is drawn again every time the list
// comes back. It is set when the question has been ANSWERED, not when it is asked: under StrictMode every effect runs twice
// and the first run's question is abandoned, and a flag set at the asking would swallow the offer in development.
let offered = false;

// For the specs: a new app opening.
export function resetResumeOffer(): void {
  offered = false;
}

// ⚠️ «NOT NOW» KEEPS THE SESSION: it answers where to go next, never whether the dough exists. The recipe's own card still
// offers to resume it.
export function ResumeOffer() {
  const { t } = useT();
  const navigate = useNavigate();
  const handBack = useHandBack();
  const [confirm, confirmDialog] = useConfirm();
  const { recipes, recipesLoaded } = useRecipes();

  // The effect depends on WHICH mix is offered, not on the recipes: a snapshot arriving while the question is open must not
  // ask it again.
  const candidate = recipesLoaded && !offered ? resumableSession(recipes) : null;
  const key = candidate === null ? '' : `${candidate.recipeId}:${candidate.startedAt}`;

  useEffect(() => {
    if (key === '') return undefined;
    const saved = resumableSession(recipes);
    if (saved === null) return undefined;
    const recipe = recipes.find(candidateRecipe => candidateRecipe.id === saved.recipeId);
    if (recipe === undefined) return undefined;
    let live = true;
    void (async () => {
      const ok = await confirm({
        title: t('cat.carryOnMixing'),
        message: t('cat.partWayThrough', {
          name: saved.snapshot.name === '' ? recipe.name : saved.snapshot.name,
          progress: progressText(saved.stepIndex, normalizeSteps(saved.snapshot.steps).length, { inline: true }, t),
        }),
        okLabel: t('cat.carryOn'),
        cancelLabel: t('cat.notNow'),
      });
      // The list went away (or this run of the effect was abandoned) while the question was open: not an answer.
      if (!live) return;
      offered = true;
      if (!ok) return;
      // The recipe first, then the run on top of it: Back from the run is the recipe, and Back from the recipe the list.
      handBack.expect(recipeOpener(recipe.id));
      void navigate(recipePath(recipe.id), { state: FROM_LIST });
      void navigate(mixPath(recipe.id), { state: FROM_RECIPE });
    })();
    return () => { live = false; };
  }, [key]);

  return confirmDialog;
}
