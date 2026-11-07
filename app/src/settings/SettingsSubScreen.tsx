import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { FormBar } from '../ui/FormBar';
import type { SettingsDoor } from './settingsPath';
import { SETTINGS_PATH } from './settingsPath';
import styles from './SettingsSubScreen.module.css';

// A screen one level below Settings: the page's own h1 («Settings»), then a card with Back and the screen's name (an h2), and the
// screen's body. The same shape as the Orders and Food cost settings.
//
// FOCUS: it opens on its title (the person asked to move), and Back hands the focus to the door that opened it — carried in the
// navigation's state, with KEEP_FOCUS so the page does not take the focus to its h1 over it (SettingsPage reads `door`).
export function SettingsSubScreen({ door, title, children }: { door: SettingsDoor; title: string; children: ReactNode }) {
  const { t } = useT();
  const navigate = useNavigate();
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  return (
    <Page title={t('section.settings')}>
      <section className={styles.screen}>
        <FormBar
          backLabel={t('ui.back')}
          onBack={() => { void navigate(SETTINGS_PATH, { state: { ...KEEP_FOCUS, door } }); }}
          title={title}
          titleRef={titleRef}
        />
        <div className={styles.body}>{children}</div>
      </section>
    </Page>
  );
}
