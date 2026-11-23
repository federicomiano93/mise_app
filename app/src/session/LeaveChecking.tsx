import { Loader2 } from 'lucide-react';
import { useT } from '../i18n/useT';
import styles from './LeaveChecking.module.css';

// «Checking everything has reached the server…», shown while useLeaveFlow waits for the answer
// (up to 4 seconds with no signal). Without it the dialog looks frozen and a hurried person taps again.
//
// ⚠️ THE LIVE REGION IS ALWAYS RENDERED, EMPTY, AND ONLY ITS CONTENT COMES AND GOES: a role="status"
// inserted already filled in is announced unreliably (same rule as ui/StatusMessage).
export function LeaveChecking({ checking }: { checking: boolean }) {
  const { t } = useT();
  return (
    <p role="status" className={styles.line}>
      {checking ? (
        <>
          <Loader2 className={styles.spinner} aria-hidden="true" />
          <span>{t('leave.checking')}</span>
        </>
      ) : null}
    </p>
  );
}
