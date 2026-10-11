import { CloudOff } from 'lucide-react';
import { useT } from '../i18n/useT';
import { useOnline } from './useOnline';
import styles from './OfflineBanner.module.css';

// «No connection» on a phone. The tablet's top bar carries a dot and the words; the phone has no
// top bar, so this sits at the top of the content instead (CSS shows it below 700px only).
//
// It is a hint and never a lock: saves are local-first (P20), so the words say where the changes
// are and that they will be sent — see useOnline for why «offline» is the only answer to trust.
// Drawn only while offline, as a status: a screen reader is told when the signal goes.
export function OfflineBanner() {
  const { t } = useT();
  const online = useOnline();

  if (online) return null;

  return (
    <div role="status" className={styles.banner}>
      {/* base.css sizes a Lucide icon at 20px; it is decoration, the sentence says it all. */}
      <CloudOff aria-hidden="true" />
      <p>{t('offline.banner')}</p>
    </div>
  );
}
