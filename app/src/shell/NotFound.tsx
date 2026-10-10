import { Link } from 'react-router';
import { useT } from '../i18n/useT';
import { Page } from './Page';
import styles from './NotFound.module.css';

// An address that leads nowhere (an old bookmark, a typo in the hash). It says so and offers
// the one way out; the rail and the tab bar are still on screen around it. «The start» is `/`,
// which lands on the first section this person is shown — not always Orders.
export function NotFound() {
  const { t } = useT();

  return (
    <Page title={t('notFound.title')}>
      <p className={styles.text}>{t('notFound.body')}</p>
      <Link to="/" className={styles.action}>{t('notFound.action')}</Link>
    </Page>
  );
}
