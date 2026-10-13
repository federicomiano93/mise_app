import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router';
import { KEEP_FOCUS } from '../shell/Page';
import { useT } from '../i18n/useT';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { AllergenSheet } from './AllergenSheet';
import { LabelScreen } from './LabelScreen';
import { useRecipes } from './RecipesContext';
import { RecipeView } from './RecipeView';
import { cameFromList, cameFromRecipe, cameFromSheet, useLeave } from './recipesNav';
import { RECIPES_PATH, recipePath } from './recipesPath';
import type { ShownView } from './recipesPath';
import { ALLERGENS_OPENER, recipeOpener, sheetOpener, useHandBack } from './handBack';
import styles from './RecipesDetail.module.css';

// The right-hand side of the split — and, on a phone, the whole screen when a recipe is open. With
// nothing chosen it says what to do.
//
// (No `key` on the recipe screen here: the section keeps one screen from one recipe to the next on
// the split, so the focus stays on the row that was pressed.)
export function RecipesDetail({ view, onOpenFromSheet }: { view: ShownView; onOpenFromSheet: (id: string) => void }) {
  if (view.kind === 'list') return <Prompt />;
  if (view.kind === 'allergens') return <SheetScreen onOpenRecipe={onOpenFromSheet} />;
  // Keyed on the KIND, so a recipe and its label are two screens (each puts the focus on its own title when it opens)
  // while another recipe picked beside an open one stays the same screen, as before.
  return <RecipeScreen key={view.kind} id={view.id} label={view.kind === 'label'} />;
}

// The Allergen sheet (its gate, allergens on, is checked by the section before it gets here). Back steps up to the list
// and hands the focus back to the door that opened it; a recipe opened from a row comes back to that row.
function SheetScreen({ onOpenRecipe }: { onOpenRecipe: (id: string) => void }) {
  const { state } = useLocation();
  const navigationType = useNavigationType();
  const handBack = useHandBack();
  const title = useRef<HTMLHeadingElement>(null);
  const leave = useLeave(RECIPES_PATH, () => { handBack.expect(ALLERGENS_OPENER); });

  // Opened from the list the page does not move the focus (FROM_LIST): it goes to this title. Not when Back from a
  // recipe brings the sheet again (POP): the row that opened that recipe is owed the focus.
  useEffect(() => {
    if (cameFromList(state) && navigationType !== 'POP') title.current?.focus();
  }, []);

  return <AllergenSheet titleRef={title} onBack={leave} onOpenRecipe={onOpenRecipe} />;
}

// Only the split draws this (a phone hides the right-hand side while the list is the screen).
//
// ⚠️ NOT BESIDE «NO RECIPES YET»: a prompt to tap a recipe, next to a list that says there are none,
// would send somebody looking for what is not there.
function Prompt() {
  const { t } = useT();
  const { recipes } = useRecipes();
  if (recipes.length === 0) return null;
  return (
    <div className={styles.prompt}>
      <p className={styles.promptTitle}>{t('cat.split.empty.title')}</p>
      <p>{t('cat.split.empty.text')}</p>
    </div>
  );
}

// A recipe by its address, followed live — and, one level below it, the recipe's label (`label`).
//
// ⚠️ A RECIPE ADDRESS WAITS FOR THE SERVER'S FIRST ANSWER (`recipesFromServer`) — or the stream
// breaking — before it says the recipe does not exist: the local copy can be a stale partial one, and
// «this recipe no longer exists» about a recipe that does is worse than a moment of «Loading…».
//
// ⚠️ A RECIPE DELETED ELSEWHERE WHILE IT IS OPEN leaves for the list and says so (the status
// message); one changed elsewhere is simply redrawn by RecipeView, in place: nothing here touches the
// scroll or the focus.
function RecipeScreen({ id, label }: { id: string; label: boolean }) {
  const navigate = useNavigate();
  const { t } = useT();
  const { state } = useLocation();
  const handBack = useHandBack();
  const say = useStatusMessage();
  const { recipes, recipesFromServer, streamBroken } = useRecipes();
  const title = useRef<HTMLHeadingElement>(null);

  const recipe = recipes.find(candidate => candidate.id === id) ?? null;

  // The id whose recipe has been on screen: one that leaves the list afterwards was deleted.
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (recipe !== null && shownFor !== id) setShownFor(id);
  const settled = recipesFromServer || streamBroken;
  // ⚠️ «DELETED» ONLY ON THE SERVER'S WORD (or a dead stream), like «does not exist» below: before it,
  // an answer from the browser's own database can lack a recipe that exists (it may hold only the few
  // the Calculator read one by one), and the screen then waits on «Loading…» instead.
  const gone = recipe === null && shownFor === id && settled;

  // A recipe opened from the Allergen sheet gives the focus back to the sheet's row, not the list's.
  const leave = useLeave(RECIPES_PATH, () => { handBack.expect(cameFromSheet(state) ? sheetOpener(id) : recipeOpener(id)); });
  // The label steps up ONE level, to its recipe (the browser's Back when the recipe is the entry behind it).
  const leaveLabel = useLeave(recipePath(id), () => undefined, cameFromRecipe);

  useEffect(() => {
    if (!gone) return;
    say(t('cat.recipeDeleted'));
    // The row of a deleted recipe is gone: the hand-back then falls to the search box (handBack.ts).
    if (label) {
      // A label's Back would land on the recipe that is gone: a deleted recipe has no label either, so it goes to the list.
      handBack.expect(recipeOpener(id));
      void navigate(RECIPES_PATH, { replace: true, state: KEEP_FOCUS });
    } else {
      leave();
    }
  }, [gone]);

  // Opened from the list, the page does not move the focus (FROM_LIST): it goes to this title. Only
  // when the screen first appears — picking another recipe beside it (the split) keeps the focus on
  // the row that was pressed.
  // A label opened from its recipe the same, but not when Back from the recipe above it brings it again (a POP).
  const navigationType = useNavigationType();
  const shown = recipe !== null;
  useEffect(() => {
    if (!shown) return;
    if (label ? cameFromRecipe(state) && navigationType !== 'POP' : cameFromList(state)) title.current?.focus();
  }, [shown]);

  if (recipe !== null && label) {
    return <LabelScreen key={recipe.id} recipe={recipe} titleRef={title} onBack={leaveLabel} />;
  }
  if (recipe !== null) {
    return <RecipeView key={recipe.id} recipe={recipe} titleRef={title} onBack={leave} />;
  }
  if (gone || !settled) {
    return (
      <section className={styles.waiting} aria-busy="true">
        <p className={styles.loading}>{t('session.loading')}</p>
      </section>
    );
  }
  return (
    <section className={styles.missing} aria-label={t('recipes.notFound')}>
      <FormBar backLabel={t('ui.back')} onBack={label ? leaveLabel : leave} title={t('recipes.notFound')} titleRef={title} />
    </section>
  );
}
