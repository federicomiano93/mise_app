import { useEffect, useRef } from 'react';
import { Moon, Power } from 'lucide-react';
import { EXIT_CHECK_MS, exitRefused } from '@mise/shared/kiosk-model';
import { useT } from '../i18n/useT';
import { useKioskSettings } from '../kiosk/kioskSettings';
import { requestRestNow } from '../kiosk/restNow';
import { announceAction } from '../telemetry/usage';
import { Button } from '../ui/Button';
import { useAlert } from '../ui/useAlert';
import styles from './KioskPills.module.css';

// «Standby» and «Exit» as two small pills in the Home's top bar, shown ONLY on a device where kiosk mode is on, to every role (staff
// slice 6, D8; Federico's decision on the lab tablet, 19 Nov 2026: they were two big buttons at the top of the Home). Neither changes the
// setting: kiosk mode stays on. The shell draws them only while the Home is open (never elsewhere: Exit there could drop unsaved edits).
//   - «Standby» covers the screen at once (kiosk/restNow.ts → the kiosk's controller). The tap that pressed it does not wake the cover:
//     the waking tap is armed only after REST_NOW_GUARD_MS.
//   - «Exit» asks the browser to close the page. An installed app on many tablets refuses: the page still there after EXIT_CHECK_MS
//     means it refused, and the person is told how to close it by hand.
// Each counts a usage action by name only (`kiosk-rest`, `kiosk-exit`), as the current app does.
export function KioskPills() {
  const { t } = useT();
  const { enabled } = useKioskSettings();
  const [alert, alertDialog] = useAlert();
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (exitTimer.current !== null) clearTimeout(exitTimer.current); }, []);

  function rest(): void {
    announceAction('kiosk-rest');
    requestRestNow();
  }

  function exit(): void {
    announceAction('kiosk-exit');
    try { window.close(); } catch { /* refused: said below */ }
    if (exitTimer.current !== null) clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(() => {
      exitTimer.current = null;
      if (exitRefused({ visibilityState: document.visibilityState, closed: window.closed })) {
        void alert({ message: t('kiosk.home.cannotClose'), okLabel: t('common.ok') });
      }
    }, EXIT_CHECK_MS);
  }

  if (!enabled) return <>{alertDialog}</>;
  return (
    <>
      <div role="group" aria-label={t('kiosk.home.aria')} className={styles.group}>
        <Button variant="bare" onPress={rest} className={styles.pill}>
          <Moon className={styles.icon} aria-hidden="true" />
          <span className={styles.word}>{t('kiosk.home.rest')}</span>
        </Button>
        <Button variant="bare" onPress={exit} className={`${styles.pill} ${styles.danger}`}>
          <Power className={styles.icon} aria-hidden="true" />
          <span className={styles.word}>{t('kiosk.home.exit')}</span>
        </Button>
      </div>
      {alertDialog}
    </>
  );
}
