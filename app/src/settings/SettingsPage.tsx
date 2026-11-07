import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { SignOutButton } from '../session/SignOutButton';
import { SwitchVenueButton } from '../session/SwitchVenueButton';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { StatusMessageProvider } from '../ui/StatusMessage';
import { AwayRow } from './AwayRow';
import { SettingsRow } from './SettingsRow';
import { LANGUAGE_PATH, SECTIONS_PATH } from './settingsPath';
import styles from './SettingsPage.module.css';

// A card of Settings, named by WHO its rows are about: «You», «The venue», «Account». A card with no rows is not drawn by its caller.
function Card({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.title}>{title}</h2>
      {children}
    </section>
  );
}

// Settings, in cards by who a row is about:
//   You        — the holiday (everybody);
//   The venue  — the app language and the sections for employees (an owner, a manager or a head chef — `canManage`);
//   Account    — who is signed in, which venue, the way to another.
// There is no «This device» card yet: the app's version waits for the service worker (step 5) and the kiosk for its own slice.
// The way out, «Log out», is a small quiet button at the far right of the title line (the owner's choice, 15 Oct 2026).
//
// ⚠️ NOTHING HERE IS A PERMISSION (P2): the venue's two rows are not drawn for an employee and their addresses send an employee back
// here, but the Cloud Functions behind them refuse a non-manager as well.
export function SettingsPage() {
  const { t } = useT();
  const { user, name, options, canManage } = useSession();
  const { state } = useLocation();
  const language = useRef<HTMLAnchorElement>(null);
  const sections = useRef<HTMLAnchorElement>(null);
  // The email, or the account's id for the rare account that has none.
  const account = user?.email || user?.uid || '';

  // Back from a screen below hands the focus to the door that opened it (SettingsSubScreen).
  useEffect(() => {
    const door = typeof state === 'object' && state !== null && 'door' in state ? (state as { door: unknown }).door : null;
    if (door === 'language') language.current?.focus();
    if (door === 'sections') sections.current?.focus();
  }, [state]);

  return (
    <Page title={t('section.settings')} action={<SignOutButton variant="small" />}>
      <StatusMessageProvider>
        <div className={styles.column}>
          <Card title={t('settings.you')}>
            <PartBoundary>
              <div className={styles.rows}><AwayRow /></div>
            </PartBoundary>
          </Card>

          {canManage ? (
            <Card title={t('settings.venue')}>
              <PartBoundary>
                <div className={styles.rows}>
                  <SettingsRow ref={language} to={LANGUAGE_PATH} state={KEEP_FOCUS} title={t('lang.title')} sub={t('lang.intro')} />
                  <SettingsRow ref={sections} to={SECTIONS_PATH} state={KEEP_FOCUS} title={t('staffSections.title')} sub={t('staffSections.intro')} />
                </div>
              </PartBoundary>
            </Card>
          ) : null}

          <Card title={t('account.title')}>
            <div className={styles.padded}>
              <p className={styles.account}>{t('account.signedInAs', { email: account })}</p>

              <div className={styles.venueRow}>
                <div className={styles.venue}>
                  <p className={styles.label}>{t('account.venue')}</p>
                  <p className={styles.name}>{name}</p>
                </div>
                {options.length > 1 ? <SwitchVenueButton>{t('account.switchVenue')}</SwitchVenueButton> : null}
              </div>
            </div>
          </Card>
        </div>
      </StatusMessageProvider>
    </Page>
  );
}
