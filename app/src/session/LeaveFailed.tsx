import { useT } from '../i18n/useT';
import styles from './LeaveFailed.module.css';

// Said beside the sign-out or switch-venue button when the last attempt did not happen.
export function LeaveFailed({ failed }: { failed: boolean }) {
  const { t } = useT();
  if (!failed) return null;
  return <p role="alert" className={styles.note}>{t('leave.failed')}</p>;
}
