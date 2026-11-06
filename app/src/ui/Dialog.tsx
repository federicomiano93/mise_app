import { useId } from 'react';
import type { ReactNode } from 'react';
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import styles from './Dialog.module.css';

type Props = {
  isOpen: boolean;
  // Escape, or the dialog being dismissed any other way: the same as its cancel button.
  onClose: () => void;
  title: string;
  // A sentence under the title. Given, the dialog is described by it for assistive technology.
  message?: string;
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

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={open => { if (!open) onClose(); }}
      className={styles.overlay}
    >
      <Modal className={styles.modal}>
        <AriaDialog
          role={role}
          aria-describedby={message === undefined ? undefined : messageId}
          className={styles.dialog}
        >
          <Heading slot="title" className={styles.title}>{title}</Heading>
          {message === undefined ? null : <p id={messageId} className={styles.message}>{message}</p>}
          {children}
          <div className={styles.actions}>{actions}</div>
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
