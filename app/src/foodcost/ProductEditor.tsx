import { useEffect, useId, useRef, useState } from 'react';
import type { Ref } from 'react';
import { useLocation } from 'react-router';
import { draftFromRecipe } from '@mise/shared/foodcost-model';
import { useT } from '../i18n/useT';
import { FormBar } from '../ui/FormBar';
import { useFoodcost } from './FoodcostContext';
import { useCopyWait } from './copyWait';
import { FOODCOST_PATH, usingPath } from './foodcostPath';
import type { Origin } from './foodcostPath';
import { useBackToRecipe, useLeave, wantsTitleFocus } from './foodcostNav';
import { NEW_OPENER, productOpener, useHandBack } from './handBack';
import { ProductForm } from './ProductForm';
import styles from './ProductEditor.module.css';

// The product's own screen: a product by its address, or a new one.
//
// ⚠️ THREE THINGS THIS FILE KEEPS FROM THE PLACEHOLDER IT REPLACED:
//  - a product address WAITS for the first answer of the server (`productsFromServer`) before it
//    says the product no longer exists — a local copy can be a stale partial one;
//  - the section does NOT remount this component when the split goes from one product to another
//    (that would take the focus off the row that was pressed), so it follows `id` itself: the form
//    below is keyed on the id, and a form copies its product once, when it mounts;
//  - Back hands the focus to the button that opened it (`handBack`).
export function ProductEditor({ id, origin }: { id: string | null; origin: Origin }) {
  const { t } = useT();
  const { state } = useLocation();
  const { products, productsFromServer, recipes, recipesFromServer } = useFoodcost();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);

  const product = id === null ? null : products.find(candidate => candidate.id === id) ?? null;

  // A NEW product opened from a recipe is prefilled from it (draftFromRecipe). ⚠️ It waits for the recipe
  // like a product address waits for its product: the recipe in the store's recipes, or the server's word
  // that there is none, or the deadline. A recipe still missing then is a plain empty new product.
  const draftFor = id === null ? origin.recipe : null;
  const recipeHere = draftFor !== null && recipes[draftFor] !== undefined;

  // ⚠️ AN EXISTING PRODUCT OPENS ON THE SERVER'S WORD, NOT ON THE LOCAL COPY ALONE (review finding):
  // the form copies its product ONCE and Save writes it WHOLE, so a form opened from a copy a week
  // old would write last week's price and lines back over another phone's changes. It waits for the
  // server's first answer — or, with no signal (or none after COPY_WAIT_MS), opens what this phone has.
  const answered = useCopyWait(id === null ? draftFor === null || recipeHere || recipesFromServer : productsFromServer);
  const canOpen = product !== null && answered;
  const draftWaiting = draftFor !== null && !answered;
  // ⚠️ DECIDED ONCE: a recipe that arrives after the form opened plain must not swap the form for a
  // prefilled one (the key would change and what was typed would be lost).
  const [draftSeen, setDraftSeen] = useState<ReturnType<typeof draftFromRecipe> | undefined>(undefined);
  if (draftFor !== null && answered && draftSeen === undefined) setDraftSeen(draftFromRecipe(recipes[draftFor]));
  const draft = draftSeen ?? null;
  // The origin the form is drawn with: a recipe that turned out not to exist leaves a plain new product.
  const formOrigin = draftFor !== null && draft === null ? { recipe: null, using: null } : origin;

  // The id whose form has been shown. A product that leaves the list while its form is open (deleted
  // on another phone) keeps the form on screen: the form decides what to do about it, because only it
  // knows whether anything was typed.
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (canOpen && shownFor !== id) setShownFor(id);

  // Waiting for the server: neither the screen of a product nor the sentence that it is gone.
  const hasForm = id === null || canOpen || shownFor === id;
  const gone = !hasForm && product === null && productsFromServer;
  const waiting = draftWaiting || (!hasForm && !gone);
  const shown = !waiting;

  // Opened from the list, the page does not move the focus (FROM_LIST): it goes to this title. Only
  // when the screen first appears — picking another product beside it (the split) keeps the focus on
  // the row that was pressed.
  useEffect(() => {
    if (shown && wantsTitleFocus(state)) title.current?.focus();
  }, [shown]);

  if (waiting) {
    return (
      <section className={styles.editor} aria-busy="true">
        <p className={styles.loading}>{t('session.loading')}</p>
      </section>
    );
  }

  if (gone) return <Gone titleId={titleId} titleRef={title} id={id} origin={origin} />;

  return (
    <ProductForm
      key={id ?? `new:${draft?.components[0]?.recipeId ?? ''}`}
      id={id}
      product={product}
      draft={draft}
      origin={formOrigin}
      titleRef={title}
    />
  );
}

// A product address whose product is not among the products, once the server has said so.
function Gone({ titleId, titleRef, id, origin }: { titleId: string; titleRef: Ref<HTMLHeadingElement>; id: string | null; origin: Origin }) {
  const { t } = useT();
  const handBack = useHandBack();
  const leave = useLeave(origin.using === null ? FOODCOST_PATH : usingPath(origin.using), () => {
    handBack.expect(id === null ? NEW_OPENER : productOpener(id));
  }, origin.using !== null);
  const backToRecipe = useBackToRecipe(origin.recipe);
  return (
    <section className={styles.editor} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={origin.recipe === null ? leave : backToRecipe}
        title={t('fc.productGone')}
        titleId={titleId}
        titleRef={titleRef}
      />
    </section>
  );
}
