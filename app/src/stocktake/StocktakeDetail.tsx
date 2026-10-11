import { useT } from '../i18n/useT';
import { StocktakeCost } from './StocktakeCost';
import { StocktakeProduct } from './StocktakeProduct';
import type { ShownView } from './stocktakePath';
import styles from './StocktakeDetail.module.css';

// The right-hand side of the split — and, on a phone, the whole screen when a product or «What it
// cost» is open. With nothing chosen it says what to do.
export function StocktakeDetail({ view }: { view: ShownView }) {
  const { t } = useT();

  switch (view.kind) {
    case 'list':
      // Only the split draws this (a phone hides the right-hand side while the list is the screen).
      return (
        <div className={styles.prompt}>
          <p>{t('stock.choosePrompt')}</p>
        </div>
      );
    case 'product':
      return <StocktakeProduct month={view.month} id={view.id} />;
    case 'cost':
      return <StocktakeCost month={view.month} />;
  }
}
