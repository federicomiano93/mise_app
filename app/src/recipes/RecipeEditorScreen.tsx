import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { useT } from '../i18n/useT';
import { FormBar } from '../ui/FormBar';
import { RecipeEditor } from './RecipeEditor';
import { useRecipes } from './RecipesContext';
import { NEW_OPENER, recipeOpener, useHandBack } from './handBack';
import { cameFromList, cameFromRecipe, useLeave } from './recipesNav';
import { RECIPES_PATH, recipePath } from './recipesPath';
import styles from './RecipesDetail.module.css';

// How long a recipe found only in this phone's local copy waits for the server before its editor opens anyway (the
// Food cost editor's rule). Offline the server never answers, and the copy is all there will be.
export const COPY_WAIT_MS = 1200;

// The editor's own screen: a new recipe (`id` null), or a recipe by its address.
//
// ⚠️ AN EXISTING RECIPE OPENS ON THE SERVER'S WORD, NOT ON THE LOCAL COPY ALONE: the editor copies the recipe once and
// Save writes it whole, so a form opened from a copy a week old would write last week's amounts back over another phone's
// changes. It waits for the server's first answer — or, with no signal (or none after COPY_WAIT_MS), opens what this phone
// has. «This recipe no longer exists» is said only on the server's word (or a dead stream), like the recipe page.
//
// ⚠️ A RECIPE THAT LEAVES THE LIST WHILE ITS EDITOR IS OPEN (deleted on another phone) KEEPS THE EDITOR ON SCREEN: the
// editor holds the person's typing, and Save puts the recipe back (the current app does the same).
//
// The editor is keyed on the id: picking another recipe beside an open one is a new copy, not the old one re-labelled.
export function RecipeEditorScreen({ id }: { id: string | null }) {
  const { t } = useT();
  const { state } = useLocation();
  const navigationType = useNavigationType();
  const handBack = useHandBack();
  const { recipes, recipesFromServer, streamBroken } = useRecipes();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const recipe = id === null ? null : recipes.find(candidate => candidate.id === id) ?? null;

  const settled = recipesFromServer || streamBroken;
  const [patienceOver, setPatienceOver] = useState(false);
  useEffect(() => {
    if (id === null || settled || patienceOver) return undefined;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setPatienceOver(true);
      return undefined;
    }
    const timer = window.setTimeout(() => { setPatienceOver(true); }, COPY_WAIT_MS);
    return () => { window.clearTimeout(timer); };
  }, [id, settled, patienceOver]);
  const canOpen = recipe !== null && (settled || patienceOver);

  // The id whose editor has been shown: a recipe that leaves the list afterwards is not «gone» for this screen.
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (canOpen && shownFor !== id) setShownFor(id);
  const hasForm = id === null || canOpen || shownFor === id;
  const gone = !hasForm && recipe === null && settled;
  const waiting = !hasForm && !gone;

  // Opened from a tap (the list's button, the recipe's «Edit»), the page does not move the focus: it goes to this title.
  // Not on a POP (Back arriving here again).
  useEffect(() => {
    if (waiting || gone) return;
    if ((cameFromList(state) || cameFromRecipe(state)) && navigationType !== 'POP') title.current?.focus();
  }, [waiting, gone]);

  const leave = useLeave(
    id === null ? RECIPES_PATH : recipePath(id),
    () => { handBack.expect(id === null ? NEW_OPENER : recipeOpener(id)); },
    id === null ? cameFromList : cameFromRecipe,
  );

  if (waiting) {
    return (
      <section className={styles.waiting} aria-busy="true">
        <p className={styles.loading}>{t('session.loading')}</p>
      </section>
    );
  }
  if (gone) {
    return (
      <section className={styles.missing} aria-labelledby={titleId}>
        <FormBar backLabel={t('ui.back')} onBack={leave} title={t('recipes.notFound')} titleId={titleId} titleRef={title} />
      </section>
    );
  }
  return <RecipeEditor key={id ?? 'new'} id={id} recipe={recipe} titleRef={title} />;
}
