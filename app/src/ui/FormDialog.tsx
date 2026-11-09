import type { ReactNode } from 'react';
import { Dialog as AriaDialog, Modal, ModalOverlay } from 'react-aria-components';
import styles from './FormDialog.module.css';

type Props = {
  // The dialog's name (the form inside it has its own heading, which names it too).
  label: string;
  // Below 700px the form takes the whole screen instead of floating as a card (a long form on a phone: the ingredient card
  // opened from a recipe). From 700px it is the card on its scrim either way.
  phoneFull?: boolean;
  children: ReactNode;
};

// A whole form shown in a modal ABOVE the screen that opened it, which stays mounted and untouched underneath (the ingredient
// card's «+ New supplier…»). Unlike Dialog it has no title, message or buttons of its own: the form brings its own bar, with
// Back and Save.
//
// ⚠️ ESCAPE AND A PRESS OUTSIDE DO NOT CLOSE IT: the form may hold typing and asks «Discard changes?» through its own Back.
// A question the form asks (Save “name”?) opens above this one and does close on Escape, being the topmost.
export function FormDialog({ label, phoneFull = false, children }: Props) {
  return (
    <ModalOverlay
      isOpen
      isDismissable={false}
      isKeyboardDismissDisabled
      className={phoneFull ? `${styles.overlay} ${styles.overlayFull}` : styles.overlay}
    >
      <Modal className={phoneFull ? `${styles.modal} ${styles.modalFull}` : styles.modal}>
        <AriaDialog aria-label={label} className={styles.dialog}>
          {children}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
