import { Link } from 'react-router';
import { useT } from '../i18n/useT';
import { Page } from './Page';
import { sectionById } from './sections';
import type { SectionId } from './sections';
import styles from './NotAvailable.module.css';

// A section this person is not shown here: the venue did not buy it, or the venue keeps it from
// its employees. It says so in words — a blank page or a wall of «permission denied» would not
// — and offers the one way out. The rail and the tab bar are still on screen around it.
export function NotAvailable({ sectionId }: { sectionId: SectionId }) {
  const { t } = useT();
  return (
    <Page title={t(sectionById(sectionId).label)}>
      <p className={styles.text}>{t('notAvailable.body')}</p>
      <Link to="/" className={styles.action}>{t('notAvailable.action')}</Link>
    </Page>
  );
}
