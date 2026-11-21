import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { useT } from '../i18n/useT';
import { Page } from './Page';
import { SECTIONS } from './sections';
import { useVisibleSections } from './useVisibleSections';
import styles from './MorePage.module.css';

// «More»: on a phone (under 700px wide) the sections that have no tab of their own, as far as this person is shown them; from 700px
// (a tablet or a PC, where the rail is shown) ONLY the sections the rail had no room for on a short window (arrangeSections, railSpill),
// or a note that the rail holds them all.
//
// ⚠️ THE WIDTH IS DECIDED BY CSS, NEVER BY A SCRIPT (like the shell): both lists are in the DOM, each row says which screen it is for —
// `data-phone` when it is in the phone's «More», `data-spill` when the rail can spill it — and a media query hides the rest.
export function MorePage() {
  const { t } = useT();
  const { more, railSpill } = useVisibleSections();
  const rows = SECTIONS.filter(section => more.includes(section) || railSpill.includes(section));

  return (
    <Page title={t('section.more')}>
      <p className={styles.railNote}>{t(railSpill.length === 0 ? 'nav.moreAllInRail' : 'nav.moreRailNote')}</p>
      <ul className={styles.list} data-spill={railSpill.length > 0 ? '' : undefined}>
        {rows.map(section => {
          const Icon = section.icon;
          return (
            <li
              key={section.id}
              className={styles.item}
              data-phone={more.includes(section) ? '' : undefined}
              data-spill={railSpill.includes(section) ? '' : undefined}
            >
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
