import { useT } from '../i18n/useT';
import { useFoodcost } from './FoodcostContext';
import { FoodcostSettings } from './FoodcostSettings';
import { MarginHistory } from './MarginHistory';
import { ProductEditor } from './ProductEditor';
import type { ShownView } from './foodcostPath';
import styles from './FoodcostDetail.module.css';

// The right-hand side of the split — and, on a phone, the whole screen when a product, a new
// product, a margin history or Settings is open. With nothing chosen it says what to do.
//
// (No `key` on the product: the section keeps one editor from one product to the next on the
// split, so the focus stays on the row that was pressed — see ProductEditor.)
export function FoodcostDetail({ view }: { view: ShownView }) {
  switch (view.kind) {
    case 'list':
      return <Prompt />;
    case 'new':
      return <ProductEditor id={null} />;
    case 'product':
      return <ProductEditor id={view.id} />;
    case 'history':
      return <MarginHistory id={view.id} />;
    case 'settings':
      return <FoodcostSettings />;
  }
}

// Only the split draws this (a phone hides the right-hand side while the list is the screen).
//
// ⚠️ NOT BESIDE «NO PRODUCTS YET»: a prompt to tap a product, next to a list that says there are
// none, would send somebody looking for what is not there.
function Prompt() {
  const { t } = useT();
  const { products } = useFoodcost();
  if (products.length === 0) return null;
  return (
    <div className={styles.prompt}>
      <p className={styles.promptTitle}>{t('fc.split.empty.title')}</p>
      <p>{t('fc.split.empty.text')}</p>
    </div>
  );
}
