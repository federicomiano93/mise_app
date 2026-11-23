import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Mail } from 'lucide-react';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { GateScreen } from './GateScreen';
import styles from './VerifyEmailView.module.css';

// What the view says under its title. Each answer is a new state (`id`), and the wait in between empties the region, so two
// identical answers in a row are spoken twice. `notYet` is the warning box of the mockup; the others are sentences.
export type VerifyNotice =
  | { readonly id: number; readonly kind: 'notYet' }
  | { readonly id: number; readonly kind: 'info' | 'error'; readonly key: MessageKey };

export type VerifyPending = 'check' | 'resend' | 'back';

type Props = {
  email: string;
  pending: VerifyPending | null;
  notice: VerifyNotice | null;
  // «Wrong email? Go back» is for the account the form has just made; an older account that came back to this view has
  // `leave` (the form's own «Sign in with a different account») in its place.
  onBack: (() => void) | null;
  leave?: ReactNode;
  onConfirmed: () => void;
  onResend: () => void;
};

// Splits a sentence around the address so it can be drawn in bold: the phrase keeps its holes (never glued halves), the address
// is put in by a marker no sentence contains.
const MARK = '\u0001';

// The join form's second screen for a NEW account (docs: «Check your email»): the account exists, a confirmation email has
// gone, and nothing more happens until the person has tapped the link in it. JoinScreen owns every call; this is only what is
// drawn, so the screen can be read top to bottom.
//
// ⚠️ THE FOCUS GOES TO THE h1 WHEN IT APPEARS: the form it replaces had the cursor in a box that is gone.
export function VerifyEmailView({ email, pending, notice, onBack, leave, onConfirmed, onResend }: Props) {
  const { t } = useT();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);

  const notYet = notice !== null && notice.kind === 'notYet';
  const sentence = t(notYet ? 'verify.sentToAgain' : 'verify.sentTo', { email: MARK }).split(MARK);
  const alertShown = notice !== null && notice.kind !== 'info';
  const infoShown = (notice !== null && notice.kind === 'info') || pending === 'check';
  const busy = pending !== null;

  return (
    <GateScreen
      title={t('verify.title')}
      headingRef={heading}
      mark={<div className={styles.icon} aria-hidden="true"><Mail size={28} aria-hidden="true" /></div>}
    >
      <div className={styles.body}>
        {/* Both regions are in the page before they speak (one inserted already filled is not announced reliably). */}
        <p
          className={styles.note}
          data-kind={notice !== null && notice.kind === 'notYet' ? 'warn' : 'error'}
          data-filled={alertShown ? 'true' : undefined}
          role="alert"
        >
          {notice === null ? null : notice.kind === 'notYet'
            ? <><strong>{t('verify.notYetTitle')}</strong> {t('verify.notYetBody')}</>
            : notice.kind === 'error' ? t(notice.key) : null}
        </p>
        <p className={styles.note} data-kind="info" data-filled={infoShown ? 'true' : undefined} role="status">
          {notice !== null && notice.kind === 'info' ? t(notice.key) : pending === 'check' ? t('verify.checking') : null}
        </p>

        <p className={styles.sentTo}>{sentence[0]}<b>{email}</b>{sentence[1]}</p>

        {notYet ? null : (
          <ol className={styles.steps}>
            <li>{t('verify.step1')}</li>
            <li>{t('verify.step2')}</li>
            <li>{t('verify.step3')}</li>
          </ol>
        )}

        <div className={styles.buttons}>
          <Button variant="primary" block isPending={pending === 'check'} isDisabled={busy && pending !== 'check'} onPress={onConfirmed}>
            {t('verify.confirmed')}
          </Button>
          <Button variant="secondary" block isPending={pending === 'resend'} isDisabled={busy && pending !== 'resend'} onPress={onResend}>
            {t('verify.resend')}
          </Button>
        </div>

        <div className={styles.ways}>
          {onBack === null ? leave : (
            <Button variant="quiet" isDisabled={busy} onPress={onBack}>{t('verify.wrongEmail')}</Button>
          )}
          <p className={styles.spam}>{t('verify.spam')}</p>
        </div>
      </div>
    </GateScreen>
  );
}
