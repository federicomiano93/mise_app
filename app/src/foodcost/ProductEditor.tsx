import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { History } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { costProduct } from '@mise/shared/foodcost-model';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { SPLIT_QUERY } from '../ui/split';
import { useMediaQuery } from '../ui/useMediaQuery';
import { useFoodcost } from './FoodcostContext';
import { FOODCOST_PATH, historyPath } from './foodcostPath';
import { FROM_PRODUCT, cameFromList, useLeave } from './foodcostNav';
import { NEW_OPENER, productOpener, useHandBack } from './handBack';
import { figureText, subLine } from './productRowModel';
import styles from './ProductEditor.module.css';

// ⚠️ A PLACEHOLDER, ON PURPOSE, AND THE NEXT SLICE REPLACES THIS FILE ENTIRELY. The product's own
// screen (the whole editor: «Made of», packaging, labour, how it is sold, VAT, price, Save, Delete)
// is built in the slice after the list, the history and Settings. Until then this is just enough for
// the section to be whole: the address `product/<id>` and `new` open it, its Back steps up to the
// list, a product that is not there says so, and the product's answer is one read-only line.
//
// What the real editor must keep from here:
//  - a product address WAITS for the first answer of the server (`productsFromServer`) before it
//    says the product no longer exists — a local copy can be a stale partial one;
//  - the section does NOT remount the editor when the split goes from one product to another (that
//    would take the focus off the row that was pressed), so it must follow `id` itself and copy the
//    product only once the products have answered;
//  - Back hands the focus to the button that opened it (`handBack`).
export function ProductEditor({ id }: { id: string | null }) {
  const { t, locale } = useT();
  const money = useMoney();
  const navigate = useNavigate();
  const { state } = useLocation();
  const split = useMediaQuery(SPLIT_QUERY);
  const handBack = useHandBack();
  const { products, productsFromServer, tables } = useFoodcost();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);

  const product = id === null ? null : products.find(candidate => candidate.id === id) ?? null;
  const result = useMemo(() => (product === null ? null : costProduct(product, tables)), [product, tables]);
  // Waiting for the server: neither the screen of a product nor the sentence that it is gone.
  const waiting = id !== null && product === null && !productsFromServer;
  const gone = id !== null && product === null && productsFromServer;
  const shown = !waiting;

  const onLeaving = useCallback(() => {
    handBack.expect(id === null ? NEW_OPENER : productOpener(id));
  }, [handBack, id]);
  const leave = useLeave(FOODCOST_PATH, onLeaving);

  // Opened from the list, the page does not move the focus (FROM_LIST): it goes to this title. Only
  // when the screen first appears — picking another product beside it (the split) keeps the focus
  // on the row that was pressed.
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

  const heading = gone
    ? t('fc.productGone')
    : id === null ? t('fc.newProduct') : (product?.name ?? '') || t('fc.untitledProduct');

  return (
    <section className={styles.editor} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={leave}
        title={heading}
        titleId={titleId}
        titleRef={title}
      />
      {result === null || id === null ? null : (
        <div className={styles.body}>
          <p className={styles.answer}>{figureText(result, locale)} · {subLine(t, result, money)}</p>
          <Button
            className={styles.history}
            onPress={() => {
              // On the split the history takes the product's place (so the list's rows still mean
              // «replace what is open»); on a phone it is one level down and Back is the browser's.
              void navigate(historyPath(id), split ? { replace: true, state } : { state: FROM_PRODUCT });
            }}
          >
            <History aria-hidden="true" />
            {t('fc.marginHistory')}
          </Button>
        </div>
      )}
    </section>
  );
}
