import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS } from '../shell/Page';
import { FormBar } from '../ui/FormBar';
import { RecipeEditor } from './RecipeEditor';
import { useRecipes } from './RecipesContext';
import { recipeOpener, useHandBack } from './handBack';
import { cameFromList, cameFromRecipe } from './recipesNav';
import { RECIPES_PATH } from './recipesPath';
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
  // ⚠️ A FORM OPENED FROM THE PHONE'S COPY (after COPY_WAIT_MS, or offline) MUST STILL LEARN WHAT THE SERVER SAYS: when its
  // first answer arrives and the recipe differs from the copy the form was made from, a form with NOTHING typed is made
  // again from the newer one. Typing is never replaced (the current app does not warn either). Only this first answer is
  // watched: later changes on other phones never replace an open form (RecipeEditor).
  const [base, setBase] = useState<{ id: string; json: string; early: boolean } | null>(null);
  if (canOpen && recipe !== null && base?.id !== id) setBase({ id: id as string, json: JSON.stringify(recipe), early: !recipesFromServer });
  const typed = useRef(false);
  const [version, setVersion] = useState(0);
  useEffect(() => { typed.current = false; }, [id]);
  useEffect(() => {
    if (base === null || !base.early || !recipesFromServer || base.id !== id) return;
    const json = recipe === null ? base.json : JSON.stringify(recipe);
    if (!typed.current && json !== base.json) setVersion(current => current + 1);
    setBase({ ...base, early: false, json });
  }, [recipesFromServer]);
  const hasForm = id === null || canOpen || shownFor === id;
  const gone = !hasForm && recipe === null && settled;
  const waiting = !hasForm && !gone;

  // Opened from a tap (the list's button, the recipe's «Edit»), the page does not move the focus: it goes to this title.
  // Not on a POP (Back arriving here again).
  useEffect(() => {
    if (waiting || gone) return;
    if ((cameFromList(state) || cameFromRecipe(state)) && navigationType !== 'POP') title.current?.focus();
  }, [waiting, gone]);

  const navigate = useNavigate();
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
        <FormBar backLabel={t('ui.back')} onBack={() => {
          // ⚠️ THE RECIPE IS GONE, so is its page: Back goes to the list, not to an address that says the same again.
          handBack.expect(recipeOpener(id as string));
          void navigate(RECIPES_PATH, { replace: true, state: KEEP_FOCUS });
        }}
        title={t('recipes.notFound')} titleId={titleId} titleRef={title} />
      </section>
    );
  }
  return <RecipeEditor key={`${id ?? 'new'}:${version}`} id={id} recipe={recipe} titleRef={title} onTyped={() => { typed.current = true; }} />;
}
