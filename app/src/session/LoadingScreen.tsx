import { VisuallyHidden } from 'react-aria-components';
import { useT } from '../i18n/useT';
import { Mark } from './Mark';
import styles from './LoadingScreen.module.css';

// What the first moments look like, before the session knows whether anybody is signed in: the
// mark and the name on an empty page. It is the same page the app opens on, so there is nothing
// to flash — no sign-in form that vanishes, no data of a previous person.
export function LoadingScreen() {
  const { t } = useT();
  return (
    <main className={styles.screen} aria-busy="true">
      <Mark />
      <p className={styles.name}>{t('app.name')}</p>
      <div role="status">
        <VisuallyHidden>{t('session.loading')}</VisuallyHidden>
      </div>
    </main>
  );
}
