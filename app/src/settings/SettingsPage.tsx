import { useId } from 'react';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { SignOutButton } from '../session/SignOutButton';
import { SwitchVenueButton } from '../session/SwitchVenueButton';
import { Page } from '../shell/Page';
import styles from './SettingsPage.module.css';

// Settings. For now it holds one card, the person's own account: who is signed in, which venue
// they are working on (and the way to another). The way out, «Log out», is a small quiet button
// at the far right of the title line, not a button at the bottom of the card (the owner's choice,
// 15 Oct 2026). The venue's own settings arrive with the sections of step 3.
export function SettingsPage() {
  const { t } = useT();
  const { user, name, options } = useSession();
  const headingId = useId();
  // The email, or the account's id for the rare account that has none.
  const account = user?.email || user?.uid || '';

  return (
    <Page title={t('section.settings')} action={<SignOutButton variant="small" />}>
      <section className={styles.card} aria-labelledby={headingId}>
        <h2 id={headingId} className={styles.title}>{t('account.title')}</h2>
        <p className={styles.account}>{t('account.signedInAs', { email: account })}</p>

        <div className={styles.venueRow}>
          <div className={styles.venue}>
            <p className={styles.label}>{t('account.venue')}</p>
            <p className={styles.name}>{name}</p>
          </div>
          {options.length > 1 ? <SwitchVenueButton>{t('account.switchVenue')}</SwitchVenueButton> : null}
        </div>

      </section>

      <p className={styles.more}>{t('settings.more')}</p>
    </Page>
  );
}
