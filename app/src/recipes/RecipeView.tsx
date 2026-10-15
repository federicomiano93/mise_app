import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Download, Maximize2, Pencil, Trash2 } from 'lucide-react';
import { weighableTotalGrams } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { useExportSheet } from '../ui/ExportSheet';
import { FormBar } from '../ui/FormBar';
import { RecipeFullScreen } from '../ui/RecipeFullScreen';
import { CATALOGUE_ZOOM_KEY } from '../ui/zoomStorage';
import { AllergenCard } from './AllergenCard';
import { BatchCard } from './BatchCard';
import { DeclarationCard } from './DeclarationCard';
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

// One recipe: the bar with Back and its name, then the cards in the current app's order: the ingredient
// list, the batch, the allergens and the declaration.
//
// «Edit» is the bar's one action, for everybody who sees the section (employees write recipes too). Delete is a small
// icon at the very end of the page, for whoever runs the place only. (The Food cost link and the procedure arrive with
// their own steps.)
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
  const { canManage } = useSession();
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
        <AllergenCard recipe={recipe} />
        <DeclarationCard recipe={recipe} />
        <ExportAction recipe={recipe} target={target} />
        {/* ⚠️ THE VERY END OF THE PAGE, after Export: small, low-key, icon only. Absent — not disabled — for an employee. */}
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
