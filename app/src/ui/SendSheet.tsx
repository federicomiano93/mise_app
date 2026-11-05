import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Mail, MessageCircle } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from './Button';
import { Dialog } from './Dialog';
import styles from './SendSheet.module.css';

type Piece = { subject: string; text: string };

// «How do you want to send it?», for every screen that hands a piece of text to a person (the Calculator's
// recipe now; Orders later). One sheet with two roads, never a brand on the button that opens it.
//
//   const [send, sendSheet] = useSendSheet();
//   send({ subject, text });    // and put sendSheet in the component's output
//
// ⚠️ NO RECIPIENT, ON PURPOSE: WhatsApp (`wa.me/?text=`) and the mail app (`mailto:?subject=&body=`) both leave
// the choice of the person to the app that opens, where their contacts are. Both texts are percent-encoded —
// an ingredient list is full of commas, brackets and a raw «&» would end the body.
// ⚠️ THE MAIL ROAD OPENS THE MAIL APP; IT DOES NOT SEND, and the sheet says so before it is taken.
// ⚠️ 'noopener': without it the page that opens could navigate this one, which an owner is signed into.
// ⚠️ THE SHEET CLOSES BEFORE THE ROAD IS TAKEN: both roads open a new window, and on a phone that leaves the
// app — coming back to a dialog still open reads as a send that did not happen.
// ⚠️ AN EMPTY TEXT NEVER OPENS IT: there is nothing to hand over.
//
// Escape, the backdrop and Cancel close it without sending; the focus is trapped inside and goes back to what
// opened it (React Aria's modal).
export function useSendSheet(): readonly [(piece: Piece) => void, ReactNode] {
  const [piece, setPiece] = useState<Piece | null>(null);
  const send = useCallback((next: Piece) => {
    if (next.text.trim() === '') return;
    setPiece(next);
  }, []);
  return [send, piece === null ? null : <SendSheet piece={piece} onClose={() => { setPiece(null); }} />];
}

function SendSheet({ piece, onClose }: { piece: Piece; onClose: () => void }) {
  const { t } = useT();

  const take = (road: 'whatsapp' | 'email') => {
    onClose();
    const url = road === 'whatsapp'
      ? `https://wa.me/?text=${encodeURIComponent(piece.text)}`
      : `mailto:?subject=${encodeURIComponent(piece.subject)}&body=${encodeURIComponent(piece.text)}`;
    window.open(url, '_blank', 'noopener');
  };

  return (
    <Dialog
      isOpen
      title={t('send.how')}
      dismissable
      onClose={onClose}
      actions={<Button onPress={onClose}>{t('common.cancel')}</Button>}
    >
      <div className={styles.roads}>
        <Button variant="bare" className={styles.road} onPress={() => { take('whatsapp'); }}>
          <MessageCircle aria-hidden="true" />
          <span className={styles.text}>
            <span className={styles.name}>{t('send.whatsapp')}</span>
          </span>
        </Button>
        <Button variant="bare" className={styles.road} onPress={() => { take('email'); }}>
          <Mail aria-hidden="true" />
          <span className={styles.text}>
            <span className={styles.name}>{t('send.email')}</span>
            <span className={styles.note}>{t('send.emailOpensApp')}</span>
          </span>
        </Button>
      </div>
    </Dialog>
  );
}
