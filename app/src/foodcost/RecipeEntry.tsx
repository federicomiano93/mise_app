import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { draftFromRecipe, productsUsingRecipe, sortByMargin } from '@mise/shared/foodcost-model';
import { useT } from '../i18n/useT';
import { SPLIT_QUERY } from '../ui/split';
import { useMediaQuery } from '../ui/useMediaQuery';
import { useFoodcost } from './FoodcostContext';
import { useCopyWait } from './copyWait';
import { FOODCOST_PATH, newForRecipePath, productPath, usingPath } from './foodcostPath';
import { entryState } from './foodcostNav';
import styles from './ProductEditor.module.css';

// `/food-cost?recipe=<id>`: where a recipe's «Open in Food cost» button lands. It draws only «Loading…» and
// REPLACES itself, once, with where the recipe really goes:
//   one product uses it   → that product (its Back returns to the recipe);
//   several               → the list narrowed to them — and, beside it on the split, the product that list shows first;
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
  const { products, productsFromServer, recipes, recipesFromServer, recipesLoaded, ingredientsLoaded, tables } = useFoodcost();
  const split = useMediaQuery(SPLIT_QUERY);
  // ⚠️ THE RANKING NEEDS THE PRICES (found by the emulator drive): the section starts its listeners when it mounts, so on
  // the first tap from a recipe the tables were still empty, every product ranked by name, and the split opened a product
  // that was not the list's first. So it also waits for what the list waits for before it draws (all the recipes, the
  // ingredients); not for the labour rate, which never enters the food cost % the list ranks by. COPY_WAIT_MS stays the
  // offline fallback. Known and harmless: the ingredients answer with whatever prices have come (a separate stream), and a
  // local copy answers at once with yesterday's — the product opened may then not be the top row a moment later.
  const priced = recipesLoaded && ingredientsLoaded;
  const ready = useCopyWait(productsFromServer && (recipes[recipeId] !== undefined || recipesFromServer) && priced);
  // StrictMode runs the effect twice with the same refs: the move is made once.
  const decided = useRef(false);

  useEffect(() => {
    if (!ready || decided.current) return;
    decided.current = true;
    const using = productsUsingRecipe(products, recipeId);
    let to = FOODCOST_PATH;
    if (using.length === 1) to = productPath(using[0]!.id, { recipe: recipeId, using: null });
    else if (using.length > 1) {
      // ⚠️ Federico, 4 Nov 2026 (current app 35b1f3e0): «forse non mostra subito la scheda food cost». Beside the list the
      // pane was left empty («Choose a product»), so on the split the product the narrowed list ranks FIRST (the list sorts
      // with sortByMargin too) opens at once, the narrowed list still on the left to switch. A phone keeps the list alone.
      const first = split ? sortByMargin(using, tables)[0]?.product : undefined;
      to = first === undefined ? usingPath(recipeId) : productPath(first.id, { recipe: null, using: recipeId });
    }
    else if (draftFromRecipe(recipes[recipeId]) !== null) to = newForRecipePath(recipeId);
    void navigate(to, { replace: true, state: entryState(state) });
  }, [ready]);

  return (
    <section className={styles.editor} aria-busy="true">
      <p className={styles.loading}>{t('session.loading')}</p>
    </section>
  );
}
