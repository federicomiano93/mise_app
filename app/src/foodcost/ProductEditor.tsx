import { useEffect, useId, useRef, useState } from 'react';
import type { Ref } from 'react';
import { useLocation } from 'react-router';
import { useT } from '../i18n/useT';
import { FormBar } from '../ui/FormBar';
import { useFoodcost } from './FoodcostContext';
import { FOODCOST_PATH } from './foodcostPath';
import { cameFromList, useLeave } from './foodcostNav';
import { NEW_OPENER, productOpener, useHandBack } from './handBack';
import { ProductForm } from './ProductForm';
import styles from './ProductEditor.module.css';

// The product's own screen: a product by its address, or a new one.
//
// How long a product found only in this phone's local copy waits for the server before its form
// opens anyway (the current app's RECIPE_LINK_WAIT_MS). Offline the server never answers, and the
// copy — by then usually replaced by the browser's own database — is all there will be.
export const COPY_WAIT_MS = 1200;

// ⚠️ THREE THINGS THIS FILE KEEPS FROM THE PLACEHOLDER IT REPLACED:
//  - a product address WAITS for the first answer of the server (`productsFromServer`) before it
//    says the product no longer exists — a local copy can be a stale partial one;
//  - the section does NOT remount this component when the split goes from one product to another
//    (that would take the focus off the row that was pressed), so it follows `id` itself: the form
//    below is keyed on the id, and a form copies its product once, when it mounts;
//  - Back hands the focus to the button that opened it (`handBack`).
export function ProductEditor({ id }: { id: string | null }) {
  const { t } = useT();
  const { state } = useLocation();
  const { products, productsFromServer } = useFoodcost();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);

  const product = id === null ? null : products.find(candidate => candidate.id === id) ?? null;

  // ⚠️ AN EXISTING PRODUCT OPENS ON THE SERVER'S WORD, NOT ON THE LOCAL COPY ALONE (review finding):
  // the form copies its product ONCE and Save writes it WHOLE, so a form opened from a copy a week
  // old would write last week's price and lines back over another phone's changes. It waits for the
  // server's first answer — or, with no signal (or none after COPY_WAIT_MS), opens what this phone has.
  const [patienceOver, setPatienceOver] = useState(false);
  useEffect(() => {
    if (productsFromServer || patienceOver) return undefined;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setPatienceOver(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setPatienceOver(true), COPY_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [productsFromServer, patienceOver]);
  const canOpen = product !== null && (productsFromServer || patienceOver);

  // The id whose form has been shown. A product that leaves the list while its form is open (deleted
  // on another phone) keeps the form on screen: the form decides what to do about it, because only it
  // knows whether anything was typed.
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (canOpen && shownFor !== id) setShownFor(id);

  // Waiting for the server: neither the screen of a product nor the sentence that it is gone.
  const hasForm = id === null || canOpen || shownFor === id;
  const gone = !hasForm && product === null && productsFromServer;
  const waiting = !hasForm && !gone;
  const shown = !waiting;

  // Opened from the list, the page does not move the focus (FROM_LIST): it goes to this title. Only
  // when the screen first appears — picking another product beside it (the split) keeps the focus on
  // the row that was pressed.
  useEffect(() => {
    if (shown && cameFromList(state)) title.current?.focus();
  }, [shown]);

  if (waiting) {
    return (
      <section className={styles.editor} aria-busy="true">
        <p className={styles.loading}>{t('session.loading')}</p>
      </section>
    );
  }

  if (gone) return <Gone titleId={titleId} titleRef={title} id={id} />;

  return <ProductForm key={id ?? 'new'} id={id} product={product} titleRef={title} />;
}

// A product address whose product is not among the products, once the server has said so.
function Gone({ titleId, titleRef, id }: { titleId: string; titleRef: Ref<HTMLHeadingElement>; id: string | null }) {
  const { t } = useT();
  const handBack = useHandBack();
  const leave = useLeave(FOODCOST_PATH, () => {
    handBack.expect(id === null ? NEW_OPENER : productOpener(id));
  });
  return (
    <section className={styles.editor} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={leave} title={t('fc.productGone')} titleId={titleId} titleRef={titleRef} />
    </section>
  );
}
