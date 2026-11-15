import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Share } from 'lucide-react';
import { afterShare, settleOnce } from '@mise/shared/send-chooser';
import { editorTitle, picturePrep, previewLines } from '@mise/shared/send-editor';
import type { EditorAnswer, EditorJob, PicturePrep, PictureState } from '@mise/shared/send-editor';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useConfirm } from '../ui/useConfirm';
import { renderOrderImage, sharePhoto } from './orderImage';
import { sendTranslate } from './sendFlow';
import styles from './SendEditorDialog.module.css';

type Props = {
  job: EditorJob;
  i: number;
  n: number;
  // Draw the order as a picture and share it (the two WhatsApp roads where the browser can share a PNG); false sends the text.
  photo: boolean;
  // The venue's output language: the picture is what the SUPPLIER reads.
  language: unknown;
  answer: (answer: EditorAnswer) => void;
};

const IDLE: PictureState = { ready: false, busy: false, failed: false };
const DRAWING: PictureState = { ready: false, busy: true, failed: false };

// What the supplier will get, as the person is about to send it: the message exactly as buildOrderMessage wrote it, shown as
// WhatsApp shows it, in a box that can be corrected, and ONE «Send».
//
// ⚠️⚠️ WHY IT EXISTS (the order of 14 Nov 2026 that reached a supplier with a product missing, because nobody ever SAW what the
// supplier would receive). AN EDIT CHANGES ONLY THE MESSAGE: History keeps the quantities that were confirmed.
//
// ⚠️⚠️ «SEND»'S PRESS STARTS share() (or opens the window) AT ONCE, with nothing awaited and no state round-trip before it: the
// browser lets a page open the share sheet or a window only inside a person's tap. So the picture is drawn AHEAD of the tap, from
// the text in the box (picturePrep, drawn again 350 ms after the last key), and «Send» stays disabled until the picture is the one
// for EXACTLY the text in the box.
//
// ⚠️ NOTHING LEAVES WHILE THE SHARE SHEET IS OPEN (Cancel, Skip and Escape are ignored): leaving then would orphan the question
// when the share resolves. A sheet sent to the background may never resolve, so coming back to the page puts «Send» back.
// ⚠️ LEAVING WITH EDITED TEXT ASKS FIRST (P20: confirm before discarding edits); while that question is up a second Cancel does
// nothing and Escape belongs to it. The parent's `answer` settles once.
export function SendEditorDialog({ job, i, n, photo, language, answer }: Props) {
  const { t } = useT();
  const [confirm, confirmDialog] = useConfirm();
  const [text, setText] = useState(job.text);
  const [picture, setPicture] = useState<PictureState>(photo ? DRAWING : IDLE);
  const [sharing, setSharing] = useState(false);
  const sharingNow = useRef(false);
  const asking = useRef(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const sendButton = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const wasSharing = useRef(false);
  const ids = { area: useId(), hint: useId(), preview: useId() };

  const done = useRef<((value: EditorAnswer) => boolean) | null>(null);
  done.current ??= settleOnce(answer);
  const prep = useRef<PicturePrep<File> | null>(null);
  if (photo && prep.current === null) {
    prep.current = picturePrep<File>({ render: draw => renderOrderImage(draw, { language }), onChange: setPicture });
  }

  useEffect(() => {
    const pictures = prep.current;
    pictures?.update(job.text, { now: true });
    return () => { pictures?.stop(); };
  }, [job.text]);

  useEffect(() => {
    const back = () => {
      if (document.visibilityState === 'visible' && sharingNow.current) {
        sharingNow.current = false;
        setSharing(false);
      }
    };
    document.addEventListener('visibilitychange', back);
    return () => { document.removeEventListener('visibilitychange', back); };
  }, []);

  // A disabled button drops the focus on the page. While the sheet is open the focus goes to the dialog; when «Send» is back it
  // gets the focus again (a focus the person moved elsewhere is left alone).
  useEffect(() => {
    if (sharing) {
      const active = document.activeElement;
      if (active === null || active === document.body || active === sendButton.current) {
        body.current?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]')?.focus();
      }
    } else if (wasSharing.current) {
      sendButton.current?.focus();
    }
    wasSharing.current = sharing;
  }, [sharing]);

  // React Aria's Button does not pass aria-busy on, so it is set on the node: «Send» says it is waiting for the picture.
  const drawing = photo && picture.busy;
  useEffect(() => {
    sendButton.current?.setAttribute('aria-busy', drawing ? 'true' : 'false');
  }, [drawing]);

  const change = (value: string) => {
    setText(value);
    prep.current?.update(value);
  };

  const send = () => {
    if (sharingNow.current || asking.current) return;
    const value = area.current?.value ?? text;
    if (!value.trim()) return;
    const pictures = prep.current;
    if (pictures === null) {
      // The text road: the window opens HERE, inside the tap.
      // ⚠️ A WINDOW THAT THROWS IS A WINDOW THAT DID NOT OPEN: thrown from a press handler it would leave this editor open with
      // nobody waiting for it, and the send would never finish. The log carries the error, never the order.
      let opened = false;
      try {
        opened = job.open(value);
      } catch (err) {
        console.error('Opening the order failed:', err);
      }
      done.current?.({ outcome: opened ? 'opened' : 'blocked', text: value });
      return;
    }
    if (pictures.failed(value)) {
      done.current?.({ outcome: 'failed', text: value });
      return;
    }
    const file = pictures.ready(value);
    // Still drawing: the button is disabled, this is a race.
    if (file === null) return;
    // ⚠️ NO AWAIT AND NO STATE UPDATE BEFORE THE NEXT LINE: sharePhoto calls navigator.share() synchronously.
    const sharedFile = sharePhoto(file);
    sharingNow.current = true;
    setSharing(true);
    void sharedFile.then(result => {
      const after = afterShare(result);
      if (after === 'again') {
        sharingNow.current = false;
        setSharing(false);
        return;
      }
      done.current?.({ outcome: after, text: value });
    });
  };

  const leave = async (outcome: 'skipped' | 'cancelled') => {
    // While the share sheet is open the editor waits for its answer; while the question is up a second Cancel does nothing.
    if (asking.current || sharingNow.current) return;
    const current = area.current?.value ?? text;
    if (current !== job.text) {
      asking.current = true;
      const discard = await confirm({
        title: t('ord.sendEditor.discard.title'),
        message: t('ord.sendEditor.discard.body'),
        okLabel: t('ord.sendEditor.discard.yes'),
        cancelLabel: t('ord.sendEditor.discard.no'),
        danger: true,
      });
      asking.current = false;
      if (!discard) {
        area.current?.focus();
        return;
      }
    }
    done.current?.({ outcome, text: current });
  };

  const words = sendTranslate(t);
  const empty = text.trim() === '';
  const disabled = sharing || empty || drawing;
  const lines = job.plain === true
    ? text.split('\n').map(line => (line === '' ? [] : [{ text: line, bold: false }]))
    : previewLines(text);

  return (
    <>
    <Dialog
      isOpen
      title={editorTitle({ ...(job.name === undefined ? {} : { name: job.name }), i, n }, words)}
      onClose={() => { void leave('cancelled'); }}
      actions={
        <>
          <Button onPress={() => { void leave(n > 1 ? 'skipped' : 'cancelled'); }}>
            {n > 1 ? t('ord.sendFormat.skip') : t('common.cancel')}
          </Button>
          <Button
            ref={sendButton}
            variant="primary"
            autoFocus={!disabled}
            isDisabled={disabled}
            onPress={send}
          >
            <Share aria-hidden="true" />
            {t('ord.sendEditor.send')}
          </Button>
        </>
      }
    >
      <div ref={body} className={styles.body}>
        <p id={ids.preview} className={styles.label}>{t('ord.sendEditor.preview')}</p>
        <div role="group" aria-labelledby={ids.preview} className={styles.preview}>
          {lines.map((runs, index): ReactNode => (
            <div key={index} className={styles.line}>
              {runs.length === 0 ? <br /> : runs.map((run, at) => (run.bold ? <strong key={at}>{run.text}</strong> : run.text))}
            </div>
          ))}
        </div>
        <label htmlFor={ids.area} className={styles.label}>{t('ord.sendEditor.edit')}</label>
        <p id={ids.hint} className={styles.hint}>{t('ord.sendEditor.hint')}</p>
        <textarea
          ref={area}
          id={ids.area}
          className={styles.text}
          rows={6}
          spellCheck={false}
          aria-describedby={ids.hint}
          value={text}
          onChange={event => { change(event.target.value); }}
        />
      </div>
    </Dialog>
    {confirmDialog}
    </>
  );
}
