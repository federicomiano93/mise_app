import { useEffect, useId, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Maximize2 } from 'lucide-react';
import { weighableTotalGrams } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { useT } from '../i18n/useT';
import { FormBar } from '../ui/FormBar';
import { RecipeFullScreen } from '../ui/RecipeFullScreen';
import { CATALOGUE_ZOOM_KEY } from '../ui/zoomStorage';
import { AllergenCard } from './AllergenCard';
import { BatchCard } from './BatchCard';
import { DeclarationCard } from './DeclarationCard';
import { useRecipes, useRecipesStore } from './RecipesContext';
import { amountText, recipeAmounts } from './recipeAmounts';
import styles from './RecipeView.module.css';

type Props = {
  recipe: CatalogueRecipe;
  titleRef: Ref<HTMLHeadingElement>;
  onBack: () => void;
};

// One recipe: the bar with Back and its name, then the cards in the current app's order: the ingredient
// list, the batch, the allergens and the declaration.
//
// (The Food cost link, the procedure, the pencil and Delete arrive with their own steps.)
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

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={onBack}
        title={recipe.name === '' ? t('cat.noName') : recipe.name}
        titleId={titleId}
        titleRef={titleRef}
      />
      <div className={styles.body}>
        <IngredientsCard recipe={recipe} target={target} />
        {/* A recipe of pieces and «to taste» has nothing to scale by weight: the whole card goes. */}
        {hasWeight ? <BatchCard recipe={recipe} target={target} /> : null}
        <AllergenCard recipe={recipe} />
        <DeclarationCard recipe={recipe} />
      </div>
    </section>
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
  const { t } = useT();
  const headingId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const { rows, total } = recipeAmounts(recipe, target, t);

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
