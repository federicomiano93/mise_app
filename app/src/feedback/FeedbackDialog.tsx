import { useEffect, useRef, useState } from 'react';
import { TextArea, TextField } from 'react-aria-components';
import { useDataServices } from '../data/DataContext';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { titleKeyFor } from '../shell/sections';
import { MISE2_VERSION } from '../telemetry/version';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { FEEDBACK_MAX, feedbackNote } from './feedbackModel';
import styles from './FeedbackDialog.module.css';

// Where a note is written: the address, and the name of the open item when the screen said it.
export type Place = { readonly pathname: string; readonly name: string | null };

// How long an ONLINE send is watched for a refusal before the dialog lets go (the rules say no in well under a second). An offline send
// never waits: Firestore keeps the write and sends it by itself.
export const REFUSAL_WAIT_MS = 1500;

// «Nota per Claude» (his words 18 Nov 2026 for the old app; a port of js/feedback.js): a short note from any screen, which reaches the
// developer with WHERE it was written. P20: nothing typed is lost silently — Cancel with typing asks first, and a refused send keeps the
// text. Typing holds `markBusy()` so no self-started reload throws it away.
export function FeedbackDialog({ place, onClose }: { place: Place; onClose: () => void }) {
  const { t } = useT();
  const { user, locationId } = useSession();
  const services = useDataServices();
  const say = useStatusMessage();
  const [confirm, confirmDialog] = useConfirm();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState(false);
  const alive = useRef(true);
  const typed = text.trim() !== '';

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => (typed ? markBusy() : undefined), [typed]);

  const where = place.name === null ? t(titleKeyFor(place.pathname)) : `${t(titleKeyFor(place.pathname))} › ${place.name}`;

  async function cancel(): Promise<void> {
    if (sending) return;
    if (typed) {
      const discard = await confirm({
        title: t('feedback.discardTitle'),
        okLabel: t('ui.discard'),
        cancelLabel: t('feedback.keep'),
        danger: true,
      });
      if (!discard) return;
    }
    onClose();
  }

  async function send(): Promise<void> {
    const note = feedbackNote({ text, pathname: place.pathname, appVersion: MISE2_VERSION });
    if (note === null || sending || user === null || locationId === null) return;
    setSending(true);
    setRefused(false);
    // ⚠️ NEVER AWAITED UNTIL THE SERVER ANSWERS: offline the promise stays pending for as long as there is no signal, and the note is
    // already in Firestore's queue. Online, a refusal (the venue's switch turned off meanwhile) comes back at once and keeps the text.
    const written = services.feedback(locationId).send(user.uid, note);
    const refusal = written.then(() => false, () => true);
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    const wasRefused = online
      ? await Promise.race([refusal, new Promise<boolean>(resolve => { setTimeout(() => { resolve(false); }, REFUSAL_WAIT_MS); })])
      : false;
    if (!alive.current) return;
    if (wasRefused) {
      setSending(false);
      setRefused(true);
      return;
    }
    say(t('feedback.sent'));
    onClose();
  }

  return (
    <>
      <Dialog
        isOpen
        title={t('feedback.title')}
        onClose={() => { void cancel(); }}
        actions={
          <>
            <Button onPress={() => { void cancel(); }} isDisabled={sending}>{t('common.cancel')}</Button>
            <Button variant="primary" onPress={() => { void send(); }} isDisabled={!typed || sending}>{t('feedback.send')}</Button>
          </>
        }
      >
        <TextField
          className={styles.field}
          value={text}
          onChange={value => { setText(value); setRefused(false); }}
          maxLength={FEEDBACK_MAX}
          autoFocus
          aria-label={t('feedback.title')}
        >
          <TextArea className={styles.area} rows={5} placeholder={t('feedback.placeholder')} />
        </TextField>
        <p className={styles.from}>{t('feedback.from', { where })}</p>
        {refused ? <p className={styles.error} role="alert">{t('feedback.refused')}</p> : null}
      </Dialog>
      {confirmDialog}
    </>
  );
}
