import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS } from '../shell/Page';
import { FormBar } from '../ui/FormBar';
import { COPY_WAIT_MS } from './RecipeEditorScreen';
import { StepsEditor } from './StepsEditor';
import { useRecipes } from './RecipesContext';
import { recipeOpener, useHandBack } from './handBack';
import { cameFromRecipe } from './recipesNav';
import { RECIPES_PATH } from './recipesPath';
import styles from './RecipesDetail.module.css';

// The mixing steps editor's own screen, at /recipes/<id>/steps: it waits for the recipe, then keys `StepsEditor` on the id.
// The same rules as RecipeEditorScreen, for the same reasons:
//
// ⚠️ IT OPENS ON THE SERVER'S WORD, NOT ON THE LOCAL COPY ALONE (or, with no signal, after COPY_WAIT_MS on what this phone
// has): the editor copies the rows once and the ticks name THEIR ids, so a copy a week old would tick against rows that
// another phone has since changed. «This recipe no longer exists» is said only on the server's word (or a dead stream).
//
// ⚠️ A FORM OPENED FROM THE PHONE'S COPY learns what the server says when its first answer arrives: with NOTHING typed it is
// made again from the newer recipe. Typing is never replaced, and later changes on other phones never replace an open form.
//
// ⚠️ A RECIPE THAT LEAVES THE LIST WHILE THE EDITOR IS OPEN keeps the editor on screen: it holds the person's typing.
export function StepsEditorScreen({ id }: { id: string }) {
  const { t } = useT();
  const { state } = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const handBack = useHandBack();
  const { recipes, recipesFromServer, streamBroken } = useRecipes();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const recipe = recipes.find(candidate => candidate.id === id) ?? null;

  const settled = recipesFromServer || streamBroken;
  const [patienceOver, setPatienceOver] = useState(false);
  useEffect(() => {
    if (settled || patienceOver) return undefined;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setPatienceOver(true);
      return undefined;
    }
    const timer = window.setTimeout(() => { setPatienceOver(true); }, COPY_WAIT_MS);
    return () => { window.clearTimeout(timer); };
  }, [settled, patienceOver]);
  const canOpen = recipe !== null && (settled || patienceOver);

  const [shownFor, setShownFor] = useState<string | null>(null);
  if (canOpen && shownFor !== id) setShownFor(id);
  const [base, setBase] = useState<{ id: string; json: string; early: boolean } | null>(null);
  if (canOpen && recipe !== null && base?.id !== id) setBase({ id, json: JSON.stringify(recipe), early: !recipesFromServer });
  const typed = useRef(false);
  const [version, setVersion] = useState(0);
  useEffect(() => { typed.current = false; }, [id]);
  useEffect(() => {
    if (base === null || !base.early || !recipesFromServer || base.id !== id) return;
    const json = recipe === null ? base.json : JSON.stringify(recipe);
    if (!typed.current && json !== base.json) setVersion(current => current + 1);
    setBase({ ...base, early: false, json });
  }, [recipesFromServer]);
  const hasForm = canOpen || shownFor === id;
  const gone = !hasForm && recipe === null && settled;
  const waiting = !hasForm && !gone;

  // Opened from the recipe's button the page does not move the focus: it goes to this title. Not on a POP.
  useEffect(() => {
    if (waiting || gone) return;
    if (cameFromRecipe(state) && navigationType !== 'POP') title.current?.focus();
  }, [waiting, gone]);

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
          handBack.expect(recipeOpener(id));
          void navigate(RECIPES_PATH, { replace: true, state: KEEP_FOCUS });
        }}
        title={t('recipes.notFound')} titleId={titleId} titleRef={title} />
      </section>
    );
  }
  return <StepsEditor key={`${id}:${version}`} id={id} recipe={recipe} titleRef={title} onTyped={() => { typed.current = true; }} />;
}
