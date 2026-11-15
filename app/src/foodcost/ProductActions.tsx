import { History, Trash2 } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import styles from './ProductActions.module.css';

type Props = {
  onHistory: () => void;
  // null: this person may not delete (only whoever runs the place).
  onDelete: (() => void) | null;
};

// History and Delete stay at the bottom of the card, small and low-key, in the read view and in the form; a new product has
// neither (the caller draws nothing).
//
// ⚠️ DELETE: whoever runs the place only. Deleting a product takes its margin history with it, and that history cannot be
// rebuilt — a snapshot exists only where somebody changed something, on the day they changed it. The bins on the lines of the
// form are NOT this: they edit the working copy and touch nothing until Save, so they stay for everybody.
export function ProductActions({ onHistory, onDelete }: Props) {
  const { t } = useT();
  return (
    <div className={styles.actions}>
      <Button variant="quiet" onPress={onHistory}>
        <History aria-hidden="true" />
        {t('fc.marginHistory')}
      </Button>
      {onDelete === null ? null : (
        <Button variant="quiet" className={styles.delete} onPress={onDelete}>
          <Trash2 aria-hidden="true" />
          {t('fc.deleteProduct2')}
        </Button>
      )}
    </div>
  );
}
