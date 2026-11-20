import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useT } from '../i18n/useT';
import { usePhonePush } from '../push/PhonePushContext';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { canKeepScreenAwake } from '../ui/wakeLock';
import styles from './GuidedRun.module.css';

// The line under the guided mix's controls: what this phone can do when the timer ends and the app is not in front.
//   A  registered for this person → «It will also send a notification if you leave the app.»
//   B  could be, with one tap → the button that registers (FROM THE TAP: a permission prompt needs a real gesture) and the
//      honest «keep this screen open» line under it
//   C  cannot → why, then the honest line. Permission-only mode and the preview project (`not-configured`) have no reason
//      sentence: there is nothing the person can do about it.
// ⚠️ ASKED AT EVERY DRAWING AND AGAIN WHEN THE PAGE BECOMES VISIBLE: the person may have changed the browser's settings while
// the app was behind.
type Tapped = 'blocked' | 'install-first' | 'unsupported' | 'failed';
const REASONS = { blocked: 'ord.settings.noticesBlocked', 'install-first': 'ord.settings.noticesInstallFirst', unsupported: 'ord.settings.noticesUnsupported', failed: 'ord.settings.noticesFailed' } as const;

export function GuidedPushNote({ onRegistered }: {
  // The phone has just been registered: a timer that is already running can be booked now.
  onRegistered: () => void;
}) {
  const { t } = useT();
  const phonePush = usePhonePush();
  const { user } = useSession();
  const uid = user?.uid ?? '';
  const [registering, setRegistering] = useState(false);
  // The answer of the last tap when it was a reason the phone cannot be registered; cleared when the page comes back.
  const [tapped, setTapped] = useState<Tapped | null>(null);
  const [, redraw] = useState(0);
  const line = useRef<HTMLParagraphElement>(null);
  const [focusLine, setFocusLine] = useState(false);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      setTapped(null);
      redraw(n => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const reason = phonePush.support();
  const only = phonePush.permissionOnly();
  const registered = phonePush.onForMe(uid);
  const state: 'A' | 'B' | 'C' | 'plain' = only !== null || reason === 'not-configured' ? 'plain'
    : tapped !== null ? 'C'
    : reason === 'granted' && registered ? 'A'
    : reason === 'ask' || reason === 'granted' ? 'B'
    : 'C';
  const why: Tapped | null = state !== 'C' ? null : tapped ?? (reason === 'blocked' || reason === 'install-first' || reason === 'unsupported' ? reason : null);

  // The button goes away when it worked (or was answered with a reason): focus follows to the line that replaces it.
  useEffect(() => {
    if (!focusLine || state === 'B') return;
    setFocusLine(false);
    line.current?.focus();
  }, [focusLine, state]);

  const honest = canKeepScreenAwake() ? t('cat.keepThisScreenOpen') : t('cat.keepThisScreenOpen2');

  const enable = () => {
    if (registering) return;
    setRegistering(true);
    void phonePush.register().then(outcome => {
      setRegistering(false);
      if (outcome === 'blocked' || outcome === 'install-first' || outcome === 'unsupported' || outcome === 'failed') setTapped(outcome);
      setFocusLine(true);
      if (outcome === 'on') onRegistered();
      redraw(n => n + 1);
    });
  };

  if (state === 'A') {
    return (
      <p ref={line} tabIndex={-1} className={`${styles.note} ${styles.noteOn}`}>
        <Bell aria-hidden="true" />
        <span>{t('cat.itWillAlsoSend')}</span>
      </p>
    );
  }
  if (state === 'B') {
    return (
      <div className={styles.noteBlock}>
        <Button className={styles.alsoTell} isDisabled={registering} onPress={enable}>
          <Bell aria-hidden="true" />
          {t('cat.alsoTellMeIf')}
        </Button>
        <p ref={line} tabIndex={-1} className={styles.note}>{t('cat.otherwiseKeepThisScreen')}</p>
      </div>
    );
  }
  return (
    <div className={styles.noteBlock}>
      {why === null ? null : <p ref={line} tabIndex={-1} className={styles.note}>{t(REASONS[why])}</p>}
      <p ref={why === null ? line : undefined} tabIndex={-1} className={styles.note}>{honest}</p>
    </div>
  );
}
