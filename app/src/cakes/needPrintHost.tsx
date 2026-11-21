import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import './need-print.css';

// The host «What you need» prints from, built when «Print» is pressed and removed once the person is back in the app. The booking
// slip's host (bookings/slipHost.tsx) paid for every rule below; this is the same road for an A4 sheet, kept in this folder because
// one feature never imports another's.
//
// ⚠️⚠️ IT OUTLIVES THE DIALOG, ON PURPOSE: on Android Chrome window.print() does not block, so the person can close the dialog (or
// leave the cake) with the print screen still up, and a host owned by the dialog would vanish with it — a blank sheet. So it has its
// OWN React root, appended to <body> (need-print.css hides every other child of the body while it prints).
// ⚠️⚠️ `afterprint` ONLY ARMS THE REMOVAL: Android fires it before the system's print screen has laid the page out, so the host
// waits for the first sign the person is back in the page, a pointer or a key.
// ⚠️ THE `need-printing` CLASS ON <html> LIVES EXACTLY AS LONG AS THE HOST (closeNeedPrintHost, the one way out): left behind, every
// later print of the app would come out blank.
export const NEED_PRINTING_CLASS = 'need-printing';
export const NEED_HOST_ID = 'cakeNeedPrint';

const BACK_IN_PAGE = ['pointerdown', 'keydown'] as const;

let current: { root: Root; node: HTMLElement; armed: () => void; back: () => void } | null = null;

export function closeNeedPrintHost(): void {
  if (current === null) return;
  const { root, node, armed, back } = current;
  current = null;
  window.removeEventListener('afterprint', armed);
  for (const type of BACK_IN_PAGE) window.removeEventListener(type, back, true);
  root.unmount();
  node.remove();
  document.documentElement.classList.remove(NEED_PRINTING_CLASS);
}

// Puts the sheet in the document (flushSync: it is there before print() is called) and opens the browser's print dialog. One host at
// a time: a second print removes the old one first.
export function printNeeds(content: ReactNode, print: () => void = () => { window.print(); }): void {
  closeNeedPrintHost();
  const node = document.createElement('div');
  node.id = NEED_HOST_ID;
  document.body.appendChild(node);
  document.documentElement.classList.add(NEED_PRINTING_CLASS);
  const root = createRoot(node);
  const back = () => { closeNeedPrintHost(); };
  // Capture phase: the removal happens before anything the tap or key goes on to do.
  const armed = () => {
    window.removeEventListener('afterprint', armed);
    for (const type of BACK_IN_PAGE) window.addEventListener(type, back, true);
  };
  current = { root, node, armed, back };
  window.addEventListener('afterprint', armed);
  flushSync(() => { root.render(content); });
  print();
}
