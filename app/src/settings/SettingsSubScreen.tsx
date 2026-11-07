import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { FormBar } from '../ui/FormBar';
import { cameFromSettings, usePendingDoor } from './settingsHandBack';
import type { SettingsDoor } from './settingsPath';
import { SETTINGS_PATH } from './settingsPath';
import styles from './SettingsSubScreen.module.css';

// A screen one level below Settings: the page's own h1 («Settings»), then a card with Back and the screen's name (an h2), and the
// screen's body. The same shape as the Orders and Food cost settings.
//
// ⚠️ BACK IS ONE LEVEL UP AND NEVER A NEW HISTORY ENTRY (the rule of orders/ordersNav.ts useLeave). Opened from the page, the entry behind IS
// the page, so Back is the browser's Back and the browser's own Back keeps meaning the same thing. Opened by its address (a bookmark, a
// reload with nothing behind it) there is nothing to step back to, so it REPLACES itself with the page.
//
// FOCUS: it opens on its title (the person asked to move), and the door that opened it is owed the focus when the page is back — promised in
// settingsHandBack.ts, so the phone's back gesture lands on it too.
export function SettingsSubScreen({ door, title, backDisabled = false, children }: {
  door: SettingsDoor;
  title: string;
  // A save is in the air and leaving would not undo it: Back is drawn off.
  backDisabled?: boolean;
  children: ReactNode;
}) {
  const { t } = useT();
  const navigate = useNavigate();
  const { state } = useLocation();
  const pending = usePendingDoor();
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  function back(): void {
    pending.current = door;
    if (cameFromSettings(state)) void navigate(-1);
    else void navigate(SETTINGS_PATH, { replace: true, state: KEEP_FOCUS });
  }

  return (
    <Page title={t('section.settings')}>
      <section className={styles.screen}>
        <FormBar backLabel={t('ui.back')} onBack={back} backDisabled={backDisabled} title={title} titleRef={titleRef} />
        <div className={styles.body}>{children}</div>
      </section>
    </Page>
  );
}
