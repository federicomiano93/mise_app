import { CloudOff } from 'lucide-react';
import { useT } from '../i18n/useT';
import { useOnline } from './useOnline';
import styles from './OfflineBanner.module.css';

// «Offline: saved here…»: a thin amber strip under the screen's title (Page), only while the device is offline, gone by itself
// when the signal is back. On the tablet's Home the top bar says it with its dot instead, so the strip is not drawn there from
// 700px; the phone has no top bar, so it shows it everywhere (16 Nov 2026, the Orders redesign on the lab tablet).
//
// It is a hint and never a lock: saves are local-first (P20), so the words say where the changes are and that they will be sent —
// see useOnline for why «offline» is the only answer to trust.
//
// ⚠️ THE LIVE REGION IS ALWAYS THERE, EMPTY WHILE ONLINE; only the strip inside it comes and goes. A role="status" element inserted
// already filled in is announced unreliably (VoiceOver on iOS often says nothing), while text added to a region that was already
// on the page is.
// `onHome`: the screen is the Home (Page knows the address).
export function OfflineBanner({ onHome = false }: { onHome?: boolean }) {
  const { t } = useT();
  const online = useOnline();

  return (
    <div role="status">
      {online ? null : (
        <div className={styles.banner} data-home={onHome ? 'true' : undefined}>
          {/* base.css sizes a Lucide icon at 20px; it is decoration, the sentence says it all. */}
          <CloudOff aria-hidden="true" />
          <p>{t('offline.banner')}</p>
        </div>
      )}
    </div>
  );
}
