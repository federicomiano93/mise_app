import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ChartPie, Download, Import, Maximize2, Pencil, Trash2 } from 'lucide-react';
import { firstRowNotInGrams, importFailureKey, weighableTotalGrams } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { resolveRecipe } from '@mise/shared/calculator-recipe-source';
import { FROM_RECIPE_LINK, foodCostForRecipePath, mayOpenFoodCost } from '@mise/shared/recipe-link';
import { isSectionAllowed } from '@mise/shared/sections';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { useExportSheet } from '../ui/ExportSheet';
import { FormBar } from '../ui/FormBar';
import { RecipeFullScreen } from '../ui/RecipeFullScreen';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { CATALOGUE_ZOOM_KEY } from '../ui/zoomStorage';
import { AllergenCard } from './AllergenCard';
import { BatchCard } from './BatchCard';
import { DeclarationCard } from './DeclarationCard';
import { ProcedureCard } from './ProcedureCard';
import { useRecipes, useRecipesStore } from './RecipesContext';
import { amountText, recipeAmounts } from './recipeAmounts';
import { recipeExportModel } from './recipeExportModel';
import { useRecipeReturn } from './recipeReturn';
import { FROM_RECIPE, cameFromList, cameFromSheet } from './recipesNav';
import { editPath } from './recipesPath';
import { useDeleteRecipe } from './useDeleteRecipe';
import styles from './RecipeView.module.css';

type Props = {
  recipe: CatalogueRecipe;
  titleRef: Ref<HTMLHeadingElement>;
  onBack: () => void;
};

// One recipe: the bar with Back and its name, then the cards in this order (his decisions, 14-15 Oct 2026): the
// ingredient list, the batch, «Food cost» (a door, only for whoever may open Food cost), the allergens and the
// declaration, the mixing procedure (3d-8), then Export, then «Import into Calculator» with its hint (a write, only where
// the venue uses the Calculator), and last the small Delete icon.
//
// «Edit» is the bar's one action, for everybody who sees the section (employees write recipes too). Delete is a small
// icon at the very end of the page, for whoever runs the place only.
//
// ⚠️ THE TWO ALLERGEN CARDS FOLLOW THE LIVE DATA ON THEIR OWN (they read the store), so an ingredient
// declared on another phone reaches this screen without it being closed and reopened.
//
// It is keyed on the recipe's id by the caller, so a batch typed for one recipe never carries over
// to another; a live change of the SAME recipe redraws it in place and keeps what is typed.
export function RecipeView({ recipe, titleRef, onBack }: Props) {
  const { t } = useT();
  const store = useRecipesStore();
  // Read for its side effect: a batch set or cleared changes the snapshot, and this redraws.
  useRecipes();
  const titleId = useId();
  const target = store.scaledTarget(recipe.id);
  const hasWeight = weighableTotalGrams(recipe) > 0;
  const { canManage, location } = useSession();
  const navigate = useNavigate();
  const { state } = useLocation();
  const recipeReturn = useRecipeReturn();
  const [runDelete, deleteDialog] = useDeleteRecipe();
  const editButton = useRef<HTMLButtonElement>(null);

  // ⚠️ BACK FROM THIS RECIPE'S EDITOR the focus is on «Edit», where the person left (recipeReturn.ts); the recipe screen
  // then has nothing left to focus.
  useLayoutEffect(() => {
    if (!recipeReturn.pendingEdit(recipe.id) || editButton.current === null) return;
    editButton.current.focus({ preventScroll: true });
    recipeReturn.markDelivered();
  }, []);

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={onBack}
        title={recipe.name === '' ? t('cat.noName') : recipe.name}
        titleId={titleId}
        titleRef={titleRef}
        action={
          <Button
            ref={editButton}
            variant="secondary"
            onPress={() => {
              recipeReturn.remember(recipe.id, 'edit');
              void navigate(editPath(recipe.id), { state: { ...FROM_RECIPE, recipeFromList: cameFromList(state) && !cameFromSheet(state) } });
            }}
          >
            <Pencil aria-hidden="true" />
            {t('ui.edit')}
          </Button>
        }
      />
      <div className={styles.body}>
        <IngredientsCard recipe={recipe} target={target} />
        {/* A recipe of pieces and «to taste» has nothing to scale by weight: the whole card goes. */}
        {hasWeight ? <BatchCard recipe={recipe} target={target} /> : null}
        {/* ⚠️ A DOOR: drawn only for whoever Food cost lets in — the very question its own gate asks (shared recipe-link), asked on
            every draw, so a session that arrives late or changes venue redraws it. Absent, not disabled, for anyone else. */}
        {mayOpenFoodCost(location, canManage) ? <FoodCostCard recipe={recipe} /> : null}
        <AllergenCard recipe={recipe} />
        <DeclarationCard recipe={recipe} />
        {/* The mixing procedure (step 3d-8): after the declaration and before Export, the current app's order. */}
        <ProcedureCard recipe={recipe} target={target} />
        <ExportAction recipe={recipe} target={target} />
        {/* A WRITE, NOT A DOOR: judged by the venue's section only (the Calculator card being hidden from staff does not matter). */}
        {isSectionAllowed(location, 'calculator') ? <ImportAction recipe={recipe} /> : null}
        {/* ⚠️ THE VERY END OF THE PAGE, after Export and Import: small, low-key, icon only. Absent — not disabled — for an employee. */}
        {canManage ? (
          <button
            type="button"
            className={styles.deleteIcon}
            aria-label={t('cat.deleteRecipe')}
            title={t('cat.deleteRecipe')}
            onClick={() => { void runDelete({ id: recipe.id, name: recipe.name }, onBack); }}
          >
            <Trash2 aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {deleteDialog}
    </section>
  );
}

// «Export» as PDF or Excel: ⚠️ THE LAST THING ON THE PAGE, by Federico's choice (14 Oct 2026, «non è un'azione che si
// fa tutti i giorni»). Under the ingredient table it pushed the batch box — what this screen is opened for — further
// down. The file is made by recipeAmounts() from the same recipe, batch target and locale the table is drawn with, so
// it holds the very amounts on screen. Nothing to export without ingredients.
function ExportAction({ recipe, target }: { recipe: CatalogueRecipe; target: number | null }) {
  const { t, locale } = useT();
  const [openExport, exportSheet, closeExport] = useExportSheet();

  // ⚠️ THE EXPORT SHEET HOLDS A COPY of the amounts drawn when Export was tapped: a recipe that changes under it
  // (a live update) or a batch target that is applied or cleared closes it, so no stale file is downloaded.
  useEffect(() => { closeExport(); }, [recipe, target, closeExport]);

  if (recipe.ingredients.length === 0) return null;
  return (
    <>
      <button
        type="button"
        className={styles.export}
        onClick={() => {
          openExport({ model: recipeExportModel(recipe, recipeAmounts(recipe, target, t, locale)), totalLabel: t('cat.total') });
        }}
      >
        <Download aria-hidden="true" />
        {t('export.button')}
      </button>
      {exportSheet}
    </>
  );
}

// «Open in Food cost»: a card like the others, with the one button. It hands Food cost the recipe in the address and
// says in the navigation state that this recipe screen is the history entry behind it (Food cost's Back then steps
// to it instead of piling a second copy on).
function FoodCostCard({ recipe }: { recipe: CatalogueRecipe }) {
  const { t } = useT();
  const navigate = useNavigate();
  const recipeReturn = useRecipeReturn();
  const headingId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const path = foodCostForRecipePath(recipe.id);

  // ⚠️ BACK FROM FOOD COST the recipe comes back as it was left: the focus on this button and the scroll where it was
  // (recipeReturn.ts); the recipe screen then has nothing left to focus.
  useLayoutEffect(() => {
    if (!recipeReturn.pendingCost(recipe.id) || button.current === null) return;
    recipeReturn.restoreScroll(recipe.id);
    button.current.focus({ preventScroll: true });
    recipeReturn.markDelivered();
  }, []);
  // ⚠️ AGAIN AFTER THE SHELL'S OWN RESET: the shell puts its scroll area back at the top when the section changes, in an
  // effect that runs after this card's. With the recipe already in the store (no wait for the data) that reset would win,
  // so the place is put back once every effect of this commit is done.
  useEffect(() => {
    if (recipeReturn.pendingCost(recipe.id)) queueMicrotask(() => { recipeReturn.restoreScroll(recipe.id); });
  }, []);

  if (path === null) return null;
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.cardHead}>{t('cat.fc.title')}</h3>
      <p className={styles.note}>{t('cat.fc.note')}</p>
      <Button
        ref={button}
        variant="secondary"
        onPress={() => {
          recipeReturn.remember(recipe.id, 'cost');
          void navigate(path, { state: FROM_RECIPE_LINK });
        }}
      >
        <ChartPie aria-hidden="true" />
        {t('cat.fc.open')}
      </Button>
    </section>
  );
}

// «Import into Calculator» (from importRecipe of js/catalogue/catalogue-main.js, which COPIES; owner's decision, 18 Oct 2026:
// here it LINKS, so the Calculator follows the recipe): nothing to do for a recipe with no rows, a refusal that names the
// row for one the grams-only Calculator cannot follow, otherwise one question, then the transaction of the store. The
// answer is said in the section's status message.
//
// ⚠️ THE REFUSAL ASKS THE VERY FUNCTION THE CALCULATOR WILL ASK (`resolveRecipe` on a tab linked to this recipe): a linked
// tab with ANY row that is not in grams (pieces, spoons, «to taste», or 0 g) calculates nothing — decided 1 Aug 2026,
// because a dough quietly light by one ingredient is the one direction a recipe must not be wrong in. So the link is not
// made at all, rather than made into a tab that only says «cannot calculate».
//
// ⚠️ A SECOND TAP DURING THE QUESTION OR THE WRITE IS IGNORED, and markBusy is held until the store's promise has settled
// — NOT until this component goes away: the person can leave the recipe while the transaction is in the air, and a reload
// the app starts by itself must still wait for it. The button says it is busy meanwhile (aria-busy, and aria-disabled
// rather than the disabled attribute, so a keyboard user's focus stays on it).
function ImportAction({ recipe }: { recipe: CatalogueRecipe }) {
  const { t } = useT();
  const store = useRecipesStore();
  const say = useStatusMessage();
  const [confirm, confirmDialog] = useConfirm();
  const running = useRef(false);
  const [writing, setWriting] = useState(false);

  async function run() {
    if (running.current) return;
    const resolved = resolveRecipe({ catalogueId: recipe.id }, { [recipe.id]: recipe });
    if (resolved.problem === 'empty') {
      say(t('cat.nothingToImport'));
      return;
    }
    // ⚠️ AND A ROW IN KILOS OR LITRES: the Calculator would read «1 kg» as 1 g (firstRowNotInGrams says why).
    const notInGrams = resolved.problem === 'unweighable' ? resolved.problemRow : firstRowNotInGrams(recipe);
    if (notInGrams !== null) {
      say(t('cat.rowNotInGrams', { row: notInGrams }));
      return;
    }
    running.current = true;
    try {
      const ok = await confirm({
        title: t('cat.importIntoCalculator2'),
        message: t('cat.linkIntoCalculator', { name: recipe.name }),
        okLabel: t('ui.import'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok) return;
      setWriting(true);
      const release = markBusy();
      try {
        const action = await store.importIntoCalculator(recipe, t('calc.marketOrderTitle'));
        say(t(action === 'updated' ? 'cat.nowFollowedByCalculator' : 'cat.linkedToCalculator', { name: recipe.name }));
      } catch (err) {
        console.error('Import into Calculator failed:', err);
        say(t(importFailureKey(err)));
      } finally {
        release();
        setWriting(false);
      }
    } finally {
      running.current = false;
    }
  }

  return (
    <div className={styles.importBlock}>
      <button
        type="button"
        className={styles.importAction}
        aria-busy={writing || undefined}
        aria-disabled={writing || undefined}
        onClick={() => { void run(); }}
      >
        <Import aria-hidden="true" />
        {t('cat.importIntoCalculator')}
      </button>
      <p className={styles.note}>{t('cat.linksToCalculator')}</p>
      {confirmDialog}
    </div>
  );
}

// The ingredient list: each row's label and its amount in two aligned columns (numbers right-aligned,
// units left-aligned), whole numbers, «to taste» with no number, and a Total of the weighable rows.
// A batch applied shows the SCALED amounts.
//
// A tap anywhere on the list opens it full screen, as in the current app; the button in the head is
// the way in for a keyboard and a screen reader (the list itself stays readable as a table, which a
// list made into one big button would not be).
function IngredientsCard({ recipe, target }: { recipe: CatalogueRecipe; target: number | null }) {
  const { t, locale } = useT();
  const headingId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const amounts = recipeAmounts(recipe, target, t, locale);
  const { rows, total } = amounts;

  // ⚠️ THE FOCUS GOES BACK ONLY ONCE THE DIALOG IS CLOSED. While a modal <dialog> is open everything
  // outside it is inert and focus() on the opener does nothing; the dialog closes itself first
  // (ui/RecipeFullScreen), and this effect runs after it has been taken away.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !fullScreen && opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    wasOpen.current = fullScreen;
  }, [fullScreen]);

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <header className={styles.cardHeadRow}>
        <h3 id={headingId} className={styles.cardHead}>{t('cat.ingredients')}</h3>
        <button
          ref={opener}
          type="button"
          className={styles.fullScreen}
          aria-label={t('cat.viewRecipeFullScreen')}
          title={t('cat.viewRecipeFullScreen')}
          onClick={() => { setFullScreen(true); }}
        >
          <Maximize2 aria-hidden="true" />
        </button>
      </header>

      {/* The table is tapped as a whole; the button above is the keyboard's way in. */}
      <table className={styles.table} aria-labelledby={headingId} onClick={() => { setFullScreen(true); }}>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              <th scope="row" className={styles.label}>{row.label}</th>
              <td className={styles.num}>{row.num}</td>
              <td className={styles.unit}>{row.unit}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={styles.totalRow}>
            <th scope="row" className={styles.label}>{t('cat.total')}</th>
            <td className={styles.num}>{total.num}</td>
            <td className={styles.unit}>{total.unit}</td>
          </tr>
        </tfoot>
      </table>

      {fullScreen ? (
        <RecipeFullScreen
          name={recipe.name === '' ? t('cat.noName') : recipe.name}
          rows={rows.map(row => ({ name: row.label, amount: amountText(row) }))}
          total={{ name: t('cat.total'), amount: amountText(total) }}
          storageKey={CATALOGUE_ZOOM_KEY}
          onClose={() => { setFullScreen(false); }}
        />
      ) : null}
    </section>
  );
}
