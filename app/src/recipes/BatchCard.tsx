import { useId, useState } from 'react';
import { batchWarning, formatWeight, weighableTotalGrams } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useConfirm } from '../ui/useConfirm';
import { useRecipesStore } from './RecipesContext';
import { wholeNumber } from './recipeAmounts';
import styles from './RecipeView.module.css';

type Props = {
  recipe: CatalogueRecipe;
  // The batch applied now, in grams, or null for the recipe as written.
  target: number | null;
};

// «Batch weight»: the dough the baker wants, in GRAMS, and the recipe scaled to it.
//
// ⚠️ THE BOX TAKES GRAMS, NEVER KILOS. The kilo box once turned «17500» into a 17.5-tonne batch.
// ⚠️ THE CONFIRM ALWAYS SPELLS THE AMOUNT BOTH WAYS («17500 g (17.5 kg)»), so a wrong order of
// magnitude is caught by eye before anything is scaled; a batch past 100 kg, or past 50 times the
// recipe, gets a louder title and a sentence saying so. NEVER A HARD BLOCK: it is the baker's call.
// An empty box or a 0 takes the recipe back to its base. The batch is remembered for 12 hours on this
// device (the store), so reopening the recipe shows the same amounts.
//
// Hidden by the caller when nothing in the recipe can be weighed (pieces and «to taste» only): a
// headed card standing empty reads as something broken rather than as something that does not apply.
export function BatchCard({ recipe, target }: Props) {
  const { t } = useT();
  const store = useRecipesStore();
  const [confirm, confirmDialog] = useConfirm();
  const headingId = useId();
  // What is typed. It starts from the batch that is applied; a live redraw of the recipe keeps it.
  const [text, setText] = useState(target !== null ? String(Math.round(target)) : '');

  const calculate = async () => {
    const grams = parseFloat(text);
    if (!Number.isFinite(grams) || grams <= 0) {
      // Empty or 0: back to the base recipe.
      store.clearScaledTarget(recipe.id);
      setText('');
      return;
    }
    const warning = batchWarning(grams, weighableTotalGrams(recipe), t);
    const readable = `${wholeNumber(grams)} g (${formatWeight(grams)})`;
    const question = t('cat.calculateFor', { recipe: recipe.name, amount: readable });
    const ok = await confirm({
      title: warning === null ? t('cat.calculateRecipe') : t('cat.thatIsAVery'),
      message: warning === null ? question : [warning, question],
      okLabel: t('cat.calculate'),
      cancelLabel: t('common.cancel'),
    });
    if (ok) store.setScaledTarget(recipe.id, grams);
  };

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.cardHead}>{t('cat.section.batch')}</h3>
      <div className={styles.batchRow}>
        <div className={styles.field}>
          <input
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            className={styles.grams}
            aria-label={t('cat.totalDoughWeightIn')}
            placeholder="0"
            value={text}
            onChange={event => { setText(event.target.value); }}
          />
          <span className={styles.gUnit} aria-hidden="true">g</span>
        </div>
        <Button variant="primary" onPress={() => { void calculate(); }}>{t('cat.calculate')}</Button>
      </div>
      {target !== null ? (
        <Button
          variant="secondary"
          className={styles.clear}
          onPress={() => { store.clearScaledTarget(recipe.id); setText(''); }}
        >
          {t('cat.clearBackToBase')}
        </Button>
      ) : null}
      {confirmDialog}
    </section>
  );
}
