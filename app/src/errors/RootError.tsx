import { Button } from 'react-aria-components';
import { useT } from '../i18n/useT';
import styles from './RootError.module.css';

// The whole-app error screen: what a person sees when the shell itself failed. It is the root
// route's errorElement AND the fallback of AppBoundary, so it can be drawn with no router and
// no I18nProvider above it — the i18n context's default is working English for exactly this.
//
// ⚠️ «Nothing you saved is lost» is a promise the data layer has to keep: a save lands on the
// device before it reaches the cloud (P20, local-first), so a plain reload never costs work.
// That is why the only action here is «Reload the app».
export function RootError() {
  const { t } = useT();
  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <h1 className={styles.title}>{t('app.failed.title')}</h1>
        <p className={styles.body}>{t('app.failed.body')}</p>
        <Button className={styles.reload} onPress={() => window.location.reload()}>
          {t('app.failed.action')}
        </Button>
      </div>
    </main>
  );
}
