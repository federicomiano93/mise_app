import { Moon } from 'lucide-react';
import { useT } from '../i18n/useT';
import { useKioskSettings } from '../kiosk/kioskSettings';
import { requestRestNow } from '../kiosk/restNow';
import { announceAction } from '../telemetry/usage';
import { Button } from '../ui/Button';
import styles from './KioskPills.module.css';

// «Standby» as a small pill in the Home's top bar, shown ONLY on a device where kiosk mode is on, to every role (staff slice 6, D8; Federico's
// decision on the lab tablet, 19 Nov 2026: it was a big button at the top of the Home). It does not change the setting: kiosk mode stays on.
// The shell draws it only while the Home is open. It covers the screen at once (kiosk/restNow.ts → the kiosk's controller); the tap that pressed
// it does not wake the cover: the waking tap is armed only after REST_NOW_GUARD_MS. Counts a usage action by name only (`kiosk-rest`).
//
// «Exit» is no longer here: since the single bar (22 Nov 2026) it is an item of the account menu under the person's letter (AccountMenu.tsx,
// kiosk/useKioskExit.ts), so the bar holds one pill and the letter is the one place for everything about the person and the device.
export function KioskPills() {
  const { t } = useT();
  const { enabled } = useKioskSettings();

  function rest(): void {
    announceAction('kiosk-rest');
    requestRestNow();
  }

  if (!enabled) return null;
  return (
    <div role="group" aria-label={t('kiosk.home.aria')} className={styles.group}>
      <Button variant="bare" onPress={rest} className={styles.pill}>
        <Moon className={styles.icon} aria-hidden="true" />
        <span className={styles.word}>{t('kiosk.home.rest')}</span>
      </Button>
    </div>
  );
}
