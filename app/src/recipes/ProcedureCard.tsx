import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ListOrdered, Pencil, Play, RotateCcw } from 'lucide-react';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { formatDuration, normalizeSteps, progressText, unassignedRows } from '@mise/shared/guided-model';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useStatusMessage } from '../ui/StatusMessage';
import { useRecipes } from './RecipesContext';
import { clearSession, freshSession, resumableSession, writeSession } from './guidedSession';
import type { GuidedSession } from './guidedSession';
import { useRecipeReturn } from './recipeReturn';
import { FROM_RECIPE } from './recipesNav';
import { mixPath, stepsPath } from './recipesPath';
import styles from './ProcedureCard.module.css';

// The recipe's mixing procedure, on the recipe screen (a port of guidedPanel in js/catalogue/catalogue-detail.js): a quiet
// way to write one when there is none, otherwise how many steps it has, what the timers add up to, a warning for the rows
// no step adds, and the way to the steps editor. It reads the recipe it is handed, so a change made on another phone
// redraws it in place.
//
// ⚠️ THE WARNING TRAVELS WITH THE PROCEDURE: it is shown while writing the steps (the editor) and again here, because this is
// where somebody decides whether to trust the procedure.
//
// ⚠️ BACK FROM THE EDITOR the focus is on the button that opened it, where the person left (recipeReturn.ts) — whichever of
// the two the card draws now (saving the first steps turns «Write the mixing steps» into «Edit the steps»).
//
// THE GUIDED MIX (step 3d-8, slice B). With steps, the card's first button is « Guided mixing » — or, when a mix of THIS recipe
// was left unfinished on this phone, « Resume — step N of M » with « Start again from the beginning » under it. ⚠️ BOTH BUTTONS
// GO THROUGH THE SAVED SESSION, so a reload in the middle of a mix lands on the run's address and picks it up: starting writes a
// fresh session (a snapshot of the recipe as shown now, with the batch the page is scaled to) before it navigates, and resuming
// checks the saved one at the tap. A mix that aged out says so and is cleared, here, on the recipe — never a silent fresh start.
// Back from the run puts the focus on the card's FIRST mix button (the one every state has), where the person left.
export function ProcedureCard({ recipe, target = null }: { recipe: CatalogueRecipe; target?: number | null }) {
  const { t } = useT();
  const navigate = useNavigate();
  const say = useStatusMessage();
  const { recipes } = useRecipes();
  const recipeReturn = useRecipeReturn();
  const headingId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const mixOpener = useRef<HTMLButtonElement>(null);
  // Redraws the card after a saved mix was found stale and cleared.
  const [, redraw] = useState(0);

  useLayoutEffect(() => {
    if (recipeReturn.pendingSteps(recipe.id) && opener.current !== null) {
      opener.current.focus({ preventScroll: true });
      recipeReturn.markDelivered();
    } else if (recipeReturn.pendingMix(recipe.id) && mixOpener.current !== null) {
      mixOpener.current.focus({ preventScroll: true });
      recipeReturn.markDelivered();
    }
  }, []);

  const steps = normalizeSteps(recipe.steps);
  const open = () => {
    recipeReturn.remember(recipe.id, 'steps');
    void navigate(stepsPath(recipe.id), { state: FROM_RECIPE });
  };

  if (steps.length === 0) {
    return (
      <section className={styles.card} aria-labelledby={headingId}>
        <h3 id={headingId} className={styles.head}>{t('cat.section.procedure')}</h3>
        <Button ref={opener} variant="secondary" className={styles.action} onPress={open}>
          <ListOrdered aria-hidden="true" />
          {t('cat.writeTheMixingSteps')}
        </Button>
        <p className={styles.note}>{t('cat.aStepAtA')}</p>
      </section>
    );
  }

  const timed = steps.reduce((sum, step) => sum + step.seconds, 0);
  const missed = unassignedRows<CatalogueRecipe['ingredients'][number]>(recipe);

  const saved = resumableSession(recipes);
  const mine = saved !== null && saved.recipeId === recipe.id ? saved : null;
  const openRun = (fresh?: GuidedSession) => {
    recipeReturn.remember(recipe.id, 'mix');
    void navigate(mixPath(recipe.id), { state: fresh === undefined ? FROM_RECIPE : { ...FROM_RECIPE, freshMix: fresh } });
  };
  // ⚠️ A STORAGE THAT REFUSES THE WRITE (full, blocked) must not leave the run to read nothing — or an OLDER mix of this
  // recipe, which «Start again» would then resume at its old step. The fresh mix travels with the move instead.
  const startMix = () => {
    const fresh = freshSession(recipe, target);
    openRun(writeSession(fresh) ? undefined : fresh);
  };
  const resumeMix = () => {
    const still = resumableSession(recipes);
    if (still !== null && still.recipeId === recipe.id) {
      openRun();
      return;
    }
    // ⚠️ NOT SILENTLY SWAPPED FOR A FRESH RUN: the button said «resume», and starting at step 1 instead would look identical and
    // be a different dough. (Another recipe's mix that is still good is left alone.)
    if (still === null) clearSession();
    say(t('cat.thatMixIsNo'));
    redraw(count => count + 1);
  };

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.head}>{t('cat.section.procedure')}</h3>
      <Button ref={mixOpener} variant="primary" className={styles.action} onPress={mine === null ? startMix : resumeMix}>
        <Play aria-hidden="true" />
        {mine === null
          ? t('cat.guidedMixing')
          : t('cat.resumeGuidedMix', { progress: progressText(mine.stepIndex, normalizeSteps(mine.snapshot.steps).length, { inline: true }, t) })}
      </Button>
      {mine === null ? null : (
        <Button variant="secondary" className={styles.action} onPress={startMix}>
          <RotateCcw aria-hidden="true" />
          {t('cat.startAgainFromThe')}
        </Button>
      )}
      <p className={styles.summary}>
        {t('cat.nSteps', { n: steps.length })}
        {timed > 0 ? ` · ${t('cat.ofTimers', { time: formatDuration(timed) })}` : ''}
      </p>
      {missed.length > 0 ? <p className={styles.warn}>{t('cat.notInAnyStep', { list: missed.map(row => row.label).join(', ') })}</p> : null}
      <Button ref={opener} variant="secondary" className={styles.action} onPress={open}>
        <Pencil aria-hidden="true" />
        {t('cat.editTheSteps')}
      </Button>
    </section>
  );
}
