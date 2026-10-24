import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { draftFromRecipe, productsUsingRecipe } from '@mise/shared/foodcost-model';
import { useT } from '../i18n/useT';
import { useFoodcost } from './FoodcostContext';
import { useCopyWait } from './copyWait';
import { FOODCOST_PATH, newForRecipePath, productPath, usingPath } from './foodcostPath';
import { entryState } from './foodcostNav';
import styles from './ProductEditor.module.css';

// `/food-cost?recipe=<id>`: where a recipe's «Open in Food cost» button lands. It draws only «Loading…» and
// REPLACES itself, once, with where the recipe really goes:
//   one product uses it   → that product (its Back returns to the recipe);
//   several               → the list narrowed to them;
//   none                  → a new product prefilled from the recipe;
//   no such recipe        → the plain list (there is nothing to return to).
//
// ⚠️ IT DECIDES ON THE SERVER'S WORD, NOT ON THE LOCAL COPY ALONE: the products have answered from the
// server AND the recipe is known (or the recipes have answered too) — a stale partial copy would offer a
// duplicate draft for a product that exists. With no answer (offline, a slow line) it decides after
// COPY_WAIT_MS, counted from here, with what this phone has.
//
// It is always replaced, so Back from the product is the recipe and not this address.
export function RecipeEntry({ recipeId }: { recipeId: string }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { state } = useLocation();
  const { products, productsFromServer, recipes, recipesFromServer } = useFoodcost();
  const ready = useCopyWait(productsFromServer && (recipes[recipeId] !== undefined || recipesFromServer));
  // StrictMode runs the effect twice with the same refs: the move is made once.
  const decided = useRef(false);

  useEffect(() => {
    if (!ready || decided.current) return;
    decided.current = true;
    const using = productsUsingRecipe(products, recipeId);
    let to = FOODCOST_PATH;
    if (using.length === 1) to = productPath(using[0]!.id, { recipe: recipeId, using: null });
    else if (using.length > 1) to = usingPath(recipeId);
    else if (draftFromRecipe(recipes[recipeId]) !== null) to = newForRecipePath(recipeId);
    void navigate(to, { replace: true, state: entryState(state) });
  }, [ready]);

  return (
    <section className={styles.editor} aria-busy="true">
      <p className={styles.loading}>{t('session.loading')}</p>
    </section>
  );
}
