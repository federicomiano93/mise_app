import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { EXIT_CHECK_MS, exitRefused } from '@mise/shared/kiosk-model';
import { useT } from '../i18n/useT';
import { announceAction } from '../telemetry/usage';
import { useAlert } from '../ui/useAlert';

// «Exit» of kiosk mode: asks the browser to close the page, and says so if it refused. It lives in the account menu of the Home's top bar
// (shell/AccountMenu.tsx), shown only on a device where kiosk mode is on; it does not change the setting. Counts a usage action by name
// only (`kiosk-exit`), as the current app does.
//
// ⚠️ AN INSTALLED APP ON MANY TABLETS REFUSES window.close(): the page still there after EXIT_CHECK_MS means it refused, and the person is
// told how to close it by hand. The caller must draw the returned dialog node, or the refusal is never said.
export function useKioskExit(): readonly [exit: () => void, dialog: ReactNode] {
  const { t } = useT();
  const [alert, alertDialog] = useAlert();
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (exitTimer.current !== null) clearTimeout(exitTimer.current); }, []);

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

  return [exit, alertDialog] as const;
}
