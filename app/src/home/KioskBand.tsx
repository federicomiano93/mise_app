import { useEffect, useRef } from 'react';
import { Moon, Power } from 'lucide-react';
import { EXIT_CHECK_MS, exitRefused } from '@mise/shared/kiosk-model';
import { useT } from '../i18n/useT';
import { useKioskSettings } from '../kiosk/kioskSettings';
import { requestRestNow } from '../kiosk/restNow';
import { announceAction } from '../telemetry/usage';
import { Button } from '../ui/Button';
import { useAlert } from '../ui/useAlert';
import styles from './KioskBand.module.css';

// «Rest» and «Exit» on the Home, above «Da fare», shown ONLY on a device where kiosk mode is on, to every role (staff slice 6, D8; the
// current app's js/home-kiosk-band.js, whose Rest was a round button in the Home's header and Exit a red button at its foot).
// Neither changes the setting: kiosk mode stays on.
//   - «Rest» covers the screen at once (kiosk/restNow.ts → the kiosk's controller). The tap that pressed it does not wake the cover:
//     the waking tap is armed only after REST_NOW_GUARD_MS.
//   - «Exit» asks the browser to close the page. An installed app on many tablets refuses: the page still there after EXIT_CHECK_MS
//     means it refused, and the person is told how to close it by hand.
// Each counts a usage action by name only (`kiosk-rest`, `kiosk-exit`), as the current app does.
export function KioskBand() {
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
      <div role="group" aria-label={t('kiosk.home.aria')} className={styles.band}>
        <Button onPress={rest} className={styles.button}>
          <Moon className={styles.icon} aria-hidden="true" />
          <span>{t('kiosk.home.rest')}</span>
        </Button>
        <Button variant="danger" onPress={exit} className={styles.button}>
          <Power className={styles.icon} aria-hidden="true" />
          <span>{t('kiosk.home.exit')}</span>
        </Button>
      </div>
      {alertDialog}
    </>
  );
}
