import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useLeave } from './stocktakeNav';
import { monthPath } from './stocktakePath';
import type { ShownView } from './stocktakePath';
import styles from './StocktakeDetail.module.css';

// The right-hand side of the split — and, on a phone, the whole screen when a product or «What it
// cost» is open. With nothing chosen it says what to do; the product and cost screens come in the
// next slice, and until then they are a placeholder that can only go back.
export function StocktakeDetail({ view }: { view: ShownView }) {
  const { t } = useT();
  const leave = useLeave(monthPath(view.month));

  if (view.kind === 'list') {
    // Only the split draws this (a phone hides the right-hand side while the list is the screen).
    return (
      <div className={styles.prompt}>
        <p>{t('stock.choosePrompt')}</p>
      </div>
    );
  }

  return (
    <div className={styles.placeholder}>
      <p>{t('placeholder.title')}</p>
      <Button onPress={leave}>{t('ui.back')}</Button>
    </div>
  );
}
