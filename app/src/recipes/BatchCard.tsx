import { useEffect, useId, useRef, useState } from 'react';
import { BookCheck } from 'lucide-react';
import { batchWarning, formatWeight, rebaseAmounts, weighableTotalGrams } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { useRecipesStore } from './RecipesContext';
import { amountText, recipeAmounts, wholeNumber } from './recipeAmounts';
import styles from './RecipeView.module.css';

type Props = {
  recipe: CatalogueRecipe;
  // The batch applied now, in grams, or null for the recipe as written.
  target: number | null;
  // Whether this person may change the recipe: the very flag that draws the recipe's «Edit» pencil (RecipeView). «Use as base
  // recipe» is a save of the recipe, so it is offered to exactly the same people.
  canEdit: boolean;
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
//
// «Use as base recipe» (NEW IN MISE 2, 14 Nov 2026; the owner: «I calculate 4500 g of a recipe and I want those 4500 g to become
// the default recipe»): under «Clear», only while a batch is applied and only for whoever may edit the recipe. It asks first, with
// both totals, then saves the recipe with exactly the amounts on screen (see useAsBase below).
export function BatchCard({ recipe, target, canEdit }: Props) {
  const { t, locale } = useT();
  const store = useRecipesStore();
  const say = useStatusMessage();
  const [confirm, confirmDialog] = useConfirm();
  const [confirmBase, baseDialog, dismissBase] = useConfirm();
  const headingId = useId();
  const box = useRef<HTMLInputElement>(null);
  const askingBase = useRef(false);
  // What is typed. It starts from the batch that is applied; a live redraw of the recipe keeps it.
  const [text, setText] = useState(target !== null ? String(Math.round(target)) : '');

  // ⚠️ THE QUESTION NAMES NUMBERS, SO A CHANGE UNDER IT CLOSES IT: the recipe changed on another phone, or the batch was cleared
  // or changed, while «Use as base?» was open — its totals are no longer what would be saved. Answering «no» saves nothing, and
  // the person asks again over what the screen shows now (as the Export sheet closes on the same change).
  useEffect(() => { dismissBase(); }, [recipe, target, dismissBase]);

  // ⚠️ THE AMOUNTS SAVED ARE THE AMOUNTS SHOWN: rebaseAmounts answers each row's number from the very function the table draws
  // from (scaleCatalogue), in the row's own unit and with the same rounding — pieces, ml, kg and sub-recipe rows alike; a «to
  // taste» row keeps its amount. ONLY `grams` CHANGES on each row (its name, unit, link, row id and divider are spread through),
  // and the save goes through the editor's own store write: local-first, and a refusal puts the recipe back and is said by the
  // section (recipesMessages.ts, «Couldn’t save …»), as for the editor. What the editor does not own stays as stored: the oven
  // loss and its weighings, the steps, the category, the label texts and the archived flag are not sent at all (recipesStore,
  // KEPT_FIELDS and the patches), and the label weight and shelf life are sent back as they are.
  // Then the batch is cleared — the recipe as written now IS what was on screen — and «Recipe saved.» is said.
  async function useAsBase() {
    if (askingBase.current || target === null) return;
    const amounts = rebaseAmounts(recipe, target);
    if (amounts === null) return;
    askingBase.current = true;
    try {
      const ingredients = recipe.ingredients.map((row, index) => ({ ...row, grams: amounts[index] ?? row.grams }));
      // {new} is the total the recipe WILL have, as the screen will show it after the save: the rows as shown, added up. All in
      // grams it is the batch itself (the rows were rounded to add up to it); with kg, litres or ml rows each row is rounded in
      // its own unit, so it can differ from the batch typed by a gram or two — the question says what is saved, not what was typed.
      const now = recipeAmounts({ ...recipe, ingredients }, null, t, locale).total;
      const before = recipeAmounts(recipe, null, t, locale).total;
      const ok = await confirmBase({
        title: t('cat.base.title'),
        message: t('cat.base.message', { new: amountText(now), old: amountText(before) }),
        okLabel: t('cat.base.ok'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok) return;
      store.saveRecipe({
        id: recipe.id,
        name: recipe.name,
        ingredients,
        netWeightG: recipe.netWeightG,
        shelfLifeDays: recipe.shelfLifeDays,
      });
      store.clearScaledTarget(recipe.id);
      setText('');
      say(t('cat.recipeSaved'));
      // The button pressed is gone with the batch: the focus goes to the batch box, where a next batch would be typed. Once more
      // after the closing dialog has handed it back to the button that opened it (no longer there).
      const field = box.current;
      if (field !== null) {
        field.focus({ preventScroll: true });
        requestAnimationFrame(() => { if (field.isConnected && document.activeElement !== field) field.focus({ preventScroll: true }); });
      }
    } finally {
      askingBase.current = false;
    }
  }

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
            ref={box}
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
      {target !== null && canEdit ? (
        <Button variant="quiet" className={styles.useAsBase} onPress={() => { void useAsBase(); }}>
          <BookCheck aria-hidden="true" />
          {t('cat.base.button')}
        </Button>
      ) : null}
      {confirmDialog}
      {baseDialog}
    </section>
  );
}
