import { useId } from 'react';
import type { ReactNode } from 'react';
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import styles from './Dialog.module.css';

type Props = {
  isOpen: boolean;
  // Escape, or the dialog being dismissed any other way: the same as its cancel button.
  onClose: () => void;
  // The dialog's name. A one-sentence notice (useAlert) has none, and its message names it
  // instead, as the current app's alert does.
  title?: string;
  // A sentence under the title, or several (one paragraph each). With a title, the dialog is
  // described by all of it for assistive technology; without one, it names the dialog instead
  // (and is not also its description, or it would be read twice).
  message?: string | readonly string[];
  // `alertdialog` for a question that needs an answer (leave? discard?); `dialog` for a list
  // to pick from.
  role?: 'dialog' | 'alertdialog';
  children?: ReactNode;
  actions: ReactNode;
};

// The app's dialog (the design's `.dialog`), on React Aria's Modal: it traps the focus, hides
// the page behind it from screen readers, closes on Escape and gives the focus back to the
// button that opened it.
//
// ⚠️ NEVER THE BROWSER'S confirm() / alert() — they cannot be styled, translated or tested, and
// a phone can suppress them.
export function Dialog({ isOpen, onClose, title, message, role = 'dialog', children, actions }: Props) {
  const messageId = useId();
  const paragraphs = message === undefined ? [] : typeof message === 'string' ? [message] : message;

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={open => { if (!open) onClose(); }}
      className={styles.overlay}
    >
      <Modal className={styles.modal}>
        <AriaDialog
          role={role}
          // ⚠️ WITHOUT A TITLE THE MESSAGE IS THE NAME: an unnamed dialog is announced as just
          // «dialog» and the sentence is never read out.
          aria-labelledby={title === undefined && paragraphs.length > 0 ? messageId : undefined}
          // ⚠️ ...AND THEN IT IS NOT ALSO THE DESCRIPTION: the same paragraph as both name and
          // description is read out twice by a screen reader. Only a titled dialog is described.
          aria-describedby={title !== undefined && paragraphs.length > 0 ? messageId : undefined}
          className={styles.dialog}
        >
          {title === undefined ? null : <Heading slot="title" className={styles.title}>{title}</Heading>}
          {paragraphs.length === 0 ? null : (
            <div id={messageId} className={styles.message}>
              {paragraphs.map((text, index) => <p key={index}>{text}</p>)}
            </div>
          )}
          {children}
          <div className={styles.actions}>{actions}</div>
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
