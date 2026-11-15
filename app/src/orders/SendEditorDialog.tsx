import { useEffect, useId, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { afterShare } from '@mise/shared/send-chooser';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { markBusy } from '../session/busy';
import { sharePhoto } from './orderImage';
import { picturePrep, previewLines } from './sendEditor';
import type { EditAnswer, EditOutcome, EditQuestion, PicturePrep, PictureState } from './sendEditor';
import styles from './SendEditorDialog.module.css';

type Props = {
  question: EditQuestion;
  // Draws the picture of a text (orderImage.ts renderOrderImage, in the venue's output language). Only asked on the picture road.
  render: (text: string) => Promise<File>;
  // Settles once (useSendOrder's ask).
  answer: (value: EditAnswer) => void;
};

// «This is what the supplier will get», editable, with ONE button: «Send» (the current app's send-editor.js, PR #554). One per message
// of a send: the WhatsApp roads go AS A PICTURE through the phone's share sheet where it can share a file (orderImage.ts
// canSharePhotos), else as the edited text by wa.me; email always as text by the mail app.
//
// ⚠️ «SEND» STARTS THE SHARE (or opens the link) INSIDE ITS OWN PRESS, with nothing awaited first (sendEditor.ts): the picture is drawn
// ahead of the tap from the text in the box, and «Send» waits until it matches the box.
// ⚠️ WHILE THE SHARE SHEET IS OPEN, CANCEL AND ESCAPE ARE IGNORED: leaving then would leave a question behind when the share answers and
// closes the editor under it. Coming back to the page with the share still unanswered gives «Send» back (a sheet sent to the background
// may never answer).
// ⚠️ LEAVING WITH EDITS ASKS FIRST («Discard your changes?»), in this same dialog: the text typed stays if they keep editing.
// ⚠️ RULE 2 OF EVERY SCREEN: while the text differs from what was opened, markBusy() holds a self-started reload off.
export function SendEditorDialog({ question, render, answer }: Props) {
  const { t } = useT();
  const { job, i, n, photo } = question;
  const original = job.text;
  const [text, setText] = useState(original);
  const [asking, setAsking] = useState(false);
  const [sharing, setSharing] = useState(false);
  const sharingRef = useRef(false);
  const [picture, setPicture] = useState<PictureState>({ ready: false, busy: photo, failed: false });
  const prep = useRef<PicturePrep | null>(null);
  const sendButton = useRef<HTMLButtonElement>(null);
  const areaId = useId();
  const hintId = useId();
  const previewId = useId();
  const latestText = useRef(text);
  latestText.current = text;

  // The picture road: drawn at once from the text as it opens, again after each pause in the typing.
  useEffect(() => {
    if (!photo) return undefined;
    const made = picturePrep({ render, onChange: setPicture });
    prep.current = made;
    made.update(latestText.current, { now: true });
    return () => {
      made.stop();
      prep.current = null;
    };
  }, [photo, render]);

  // Back from the share sheet with its promise still pending: «Send» comes back so they can try again.
  useEffect(() => {
    const back = () => {
      if (document.visibilityState === 'visible' && sharingRef.current) {
        sharingRef.current = false;
        setSharing(false);
      }
    };
    document.addEventListener('visibilitychange', back);
    return () => { document.removeEventListener('visibilitychange', back); };
  }, []);

  const edited = text !== original;
  useEffect(() => (edited ? markBusy() : undefined), [edited]);

  const onType = (next: string) => {
    setText(next);
    prep.current?.update(next);
  };

  const send = () => {
    if (sharingRef.current) return;
    const now = text;
    if (!now.trim()) return;
    if (!photo) {
      // The text road: the link opens HERE, inside the press. A window that throws is not «blocked»: the send says it failed.
      let opened: boolean;
      try {
        opened = question.open(now);
      } catch (err) {
        answer({ outcome: 'blocked', text: now, error: err });
        return;
      }
      answer({ outcome: opened ? 'opened' : 'blocked', text: now });
      return;
    }
    const pictures = prep.current;
    if (!pictures) return;
    if (pictures.failed(now)) { answer({ outcome: 'failed', text: now }); return; }
    const file = pictures.ready(now);
    if (!file) return; // still drawing: «Send» is disabled, this is a race
    // ⚠️ NO AWAIT BEFORE THIS LINE.
    sharingRef.current = true;
    setSharing(true);
    void sharePhoto(file).then(result => {
      const next = afterShare(result);
      if (next === 'again') {
        sharingRef.current = false;
        setSharing(false);
        requestAnimationFrame(() => { sendButton.current?.focus(); });
        return;
      }
      sharingRef.current = false;
      answer({ outcome: next, text: now });
    });
  };

  const leave = (outcome: EditOutcome) => {
    if (sharingRef.current) return;
    if (text !== original) { setAsking(true); return; }
    answer({ outcome, text });
  };
  const otherOutcome: EditOutcome = n > 1 ? 'skipped' : 'cancelled';

  if (asking) {
    return (
      <Dialog
        isOpen
        role="alertdialog"
        title={t('ord.sendEditor.discard.title')}
        message={t('ord.sendEditor.discard.body')}
        onClose={() => { setAsking(false); }}
        actions={(
          <>
            <Button autoFocus onPress={() => { setAsking(false); }}>{t('ord.sendEditor.discard.no')}</Button>
            <Button variant="danger" onPress={() => { answer({ outcome: otherOutcome, text }); }}>{t('ord.sendEditor.discard.yes')}</Button>
          </>
        )}
      />
    );
  }

  const title = !job.name ? t('ord.sendEditor.titleGrouped')
    : n > 1 ? t('ord.sendEditor.titleOf', { name: job.name, i: i + 1, n }) : t('ord.sendEditor.titleOne', { name: job.name });
  const waitingForPicture = photo && !picture.ready && !picture.failed;
  return (
    <Dialog
      isOpen
      title={title}
      onClose={() => { leave('cancelled'); }}
      actions={(
        <>
          <Button onPress={() => { leave(otherOutcome); }}>{n > 1 ? t('ord.sendFormat.skip') : t('common.cancel')}</Button>
          <Button
            ref={sendButton}
            variant="primary"
            autoFocus
            isDisabled={!text.trim() || waitingForPicture || sharing}
            aria-busy={waitingForPicture || sharing}
            onPress={send}
          >
            <Send aria-hidden="true" />
            {t('ord.sendEditor.send')}
          </Button>
        </>
      )}
    >
      <div className={styles.body}>
        <p className={styles.label} id={previewId}>{t('ord.sendEditor.preview')}</p>
        {/* Drawn with nodes, never innerHTML: the text is whatever was typed. */}
        <div className={styles.preview} role="group" aria-labelledby={previewId}>
          {previewLines(text, job.plain).map((runs, index) => (
            <div key={index} className={styles.line}>
              {runs.length === 0 ? <br /> : runs.map((run, at) => (run.bold ? <strong key={at}>{run.text}</strong> : <span key={at}>{run.text}</span>))}
            </div>
          ))}
        </div>
        <label className={styles.label} htmlFor={areaId}>{t('ord.sendEditor.edit')}</label>
        <p className={styles.hint} id={hintId}>{t('ord.sendEditor.hint')}</p>
        <textarea
          id={areaId}
          className={styles.text}
          rows={6}
          spellCheck={false}
          aria-describedby={hintId}
          value={text}
          onChange={event => { onType(event.target.value); }}
        />
      </div>
    </Dialog>
  );
}
