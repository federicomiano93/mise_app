import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { useT } from '../i18n/useT';
import { Page } from './Page';
import { useVisibleSections } from './useVisibleSections';
import styles from './MorePage.module.css';

// The phone's fifth tab: the sections that have no tab of their own, as far as this person is
// shown them. On a tablet the rail already lists them all, so nothing links here — the route
// simply stays valid.
export function MorePage() {
  const { t } = useT();
  const { more } = useVisibleSections();

  return (
    <Page title={t('section.more')}>
      <ul className={styles.list}>
        {more.map(section => {
          const Icon = section.icon;
          return (
            <li key={section.id} className={styles.item}>
              <Link to={section.path} className={styles.row}>
                <Icon aria-hidden="true" />
                <span className={styles.label}>{t(section.label)}</span>
                <ChevronRight className={styles.chevron} aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Page>
  );
}
