import { CloudOff } from 'lucide-react';
import { useT } from '../i18n/useT';
import { useOnline } from './useOnline';
import styles from './OfflineBanner.module.css';

// «No connection» on a phone. The tablet's top bar carries a dot and the words; the phone has no
// top bar, so this sits at the top of the content instead (CSS shows the banner below 700px only).
//
// It is a hint and never a lock: saves are local-first (P20), so the words say where the changes
// are and that they will be sent — see useOnline for why «offline» is the only answer to trust.
//
// ⚠️ THE LIVE REGION IS ALWAYS THERE, EMPTY WHILE ONLINE; only the banner inside it comes and
// goes. A role="status" element inserted already filled in is announced unreliably (VoiceOver on
// iOS often says nothing), while text added to a region that was already on the page is.
export function OfflineBanner() {
  const { t } = useT();
  const online = useOnline();

  return (
    <div role="status">
      {online ? null : (
        <div className={styles.banner}>
          {/* base.css sizes a Lucide icon at 20px; it is decoration, the sentence says it all. */}
          <CloudOff aria-hidden="true" />
          <p>{t('offline.banner')}</p>
        </div>
      )}
    </div>
  );
}
