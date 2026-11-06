import { useT } from '../i18n/useT';
import { Page } from './Page';
import { sectionById } from './sections';
import type { SectionId } from './sections';
import styles from './SectionPlaceholder.module.css';

// What every section shows until it is built in a later step of Mise 2. It says so plainly
// and points back at the app people use today, rather than leaving an empty screen.
export function SectionPlaceholder({ sectionId }: { sectionId: SectionId }) {
  const { t } = useT();
  const section = sectionById(sectionId);
  const Icon = section.icon;

  return (
    <Page title={t(section.label)}>
      <div className={styles.card}>
        <div className={styles.disc}>
          <Icon className={styles.icon} aria-hidden="true" />
        </div>
        <p className={styles.title}>{t('placeholder.title')}</p>
        <p className={styles.body}>{t('placeholder.body')}</p>
      </div>
    </Page>
  );
}
