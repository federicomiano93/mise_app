import { useEffect } from 'react';
import { checkInstallHint } from '@mise/shared/install-hint';
import { useT } from '../i18n/useT';
import { focusMain } from '../session/focusMain';
import { guidePage, runsInstalled } from '../session/installGuide';
import { useConfirm } from '../ui/useConfirm';

// After a join, ONCE: «Add the app to your phone» (staff slice 2; a port of js/install-hint-boot.js). The join marks
// `just-joined` (session.ts openJoinedVenue), and the Home — where the app opens after it — asks.
//
// ⚠️ THE HOME ONLY, as in the current app: this is the screen somebody arrives on, not one they work in. A question that
// appears while an order is being typed interrupts the one thing the app exists for.
//
// ⚠️ SPENT WHEN IT IS ASKED, not before and not after: asked only after the Home has settled, then spent, then shown. Spent
// after the answer, an app closed while it is open would ask for ever; spent before it is drawn, an app closed in that gap
// would never ask.
//
// ⚠️ «Show me how» IS A NAVIGATION to the current app's guide page, not a second dialog: the guide is a whole page with
// pictures for both kinds of phone, and a paragraph of it reprinted here would be the one version nobody maintains.

// The Home's own first moments (its list, the holiday band) come first; a short wait, cleared if the Home goes away.
const SETTLE_MS = 600;
// The dialog's own unmounting and React Aria's focus restore both finish within this.
const FOCUS_BACK_MS = 50;

export function InstallHint() {
  const { t } = useT();
  const [confirm, dialog] = useConfirm();

  useEffect(() => {
    let hint: ReturnType<typeof checkInstallHint>;
    let focusTimer: number | undefined;
    try {
      hint = checkInstallHint({ storage: window.localStorage, standalone: runsInstalled() });
    } catch {
      return undefined;   // ⚠️ never let this stop the Home from working
    }
    if (!hint.offer) return undefined;
    // ⚠️ A TIMER, CLEARED ON UNMOUNT: React's development mode mounts twice, and a Home left at once must not spend it.
    const timer = window.setTimeout(() => {
      hint.adopt();
      void confirm({
        title: t('install.hint.title'),
        message: t('install.hint.body'),
        okLabel: t('install.hint.ok'),
        cancelLabel: t('install.hint.later'),
      }).then(show => {
        if (show) { guidePage.open(); return; }
        // ⚠️ ON A FRESHLY RELOADED HOME NOTHING HAD THE FOCUS BEFORE THE DIALOG, so there is nothing to give it back to and it
        // falls to the page itself, where a keyboard is lost and a screen reader says nothing: the page's heading takes it.
        focusTimer = window.setTimeout(() => {
          const active = document.activeElement;
          if (!active || active === document.body) focusMain();
        }, FOCUS_BACK_MS);
      });
    }, SETTLE_MS);
    return () => { window.clearTimeout(timer); window.clearTimeout(focusTimer); };
    // Asked once per Home: the words and the hook's confirm are read when it is asked.
  }, []);

  return dialog;
}
