import { useId, useLayoutEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { ListOrdered, Pencil } from 'lucide-react';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { formatDuration, normalizeSteps, unassignedRows } from '@mise/shared/guided-model';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useRecipeReturn } from './recipeReturn';
import { FROM_RECIPE } from './recipesNav';
import { stepsPath } from './recipesPath';
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
export function ProcedureCard({ recipe }: { recipe: CatalogueRecipe }) {
  const { t } = useT();
  const navigate = useNavigate();
  const recipeReturn = useRecipeReturn();
  const headingId = useId();
  const opener = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!recipeReturn.pendingSteps(recipe.id) || opener.current === null) return;
    opener.current.focus({ preventScroll: true });
    recipeReturn.markDelivered();
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
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.head}>{t('cat.section.procedure')}</h3>
      {/* Slice B of step 3d-8 puts here, at the top of this state: «Resume — step N of M» when a mix was left unfinished, and the
          «Guided mixing» / «Start again from the beginning» buttons. */}
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
