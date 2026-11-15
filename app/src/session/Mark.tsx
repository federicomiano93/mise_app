import { useT } from '../i18n/useT';
import styles from './Mark.module.css';

// The app's mark: the first letter of the product's name on a dark tile, the same tile as the
// top of the rail. It is decoration — the name is always written next to it.
export function Mark() {
  const { t } = useT();
  return <div className={styles.mark} aria-hidden="true">{t('app.name').charAt(0)}</div>;
}
