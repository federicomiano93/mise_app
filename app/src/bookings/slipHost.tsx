import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import slipPageHref from './booking-slip-page.css?url';

// The host a booking's slip prints from (18 Nov 2026): built when a print button is pressed, removed once the person is back
// in the app. The label's print host (recipes/printHost.tsx) paid for every rule below on the lab tablet; this is the same
// road for a different piece of paper, kept in this folder because one feature never imports another's.
//
// ⚠️⚠️ IT OUTLIVES THE SCREEN, ON PURPOSE: on Android Chrome window.print() does not block, so the person can leave the booking
// with the print dialog still up, and a host owned by the screen would vanish with it — a blank slip. So it has its OWN React
// root, appended to <body> (booking-slip.css hides every other child of the body while it prints).
//
// ⚠️⚠️ `afterprint` ONLY ARMS THE REMOVAL. Android fires it as soon as print() hands over, BEFORE the system's print screen has
// laid the page out; a host removed then leaves nothing to print. So the host waits for the first sign the person is back in
// the page — a pointer or a key — which cannot happen while the system's print screen covers it.
//
// ⚠️ THE `slip-printing` CLASS ON <html> AND THE 80 mm PAGE LIVE EXACTLY AS LONG AS THE HOST (closeSlipHost, the one way out):
// left behind, every later print of the app would come out blank or on receipt paper.
export const SLIP_PRINTING_CLASS = 'slip-printing';
export const SLIP_HOST_ID = 'bookingSlip';
export const SLIP_PAGE_ID = 'bookingSlipPage';
export const SLIP_PAGE_OFF = 'not all';
export const SLIP_PAGE_ON = 'print';

// A static file, linked switched off as soon as this module loads (the browser downloads it anyway, so it is there when Print
// is pressed), never CSS built at run time (the page's CSP).
function slipPageLink(): HTMLLinkElement {
  const existing = document.getElementById(SLIP_PAGE_ID);
  if (existing instanceof HTMLLinkElement) return existing;
  const link = document.createElement('link');
  link.id = SLIP_PAGE_ID;
  link.rel = 'stylesheet';
  link.href = slipPageHref;
  link.media = SLIP_PAGE_OFF;
  document.head.appendChild(link);
  return link;
}

slipPageLink();

const BACK_IN_PAGE = ['pointerdown', 'keydown'] as const;

let current: { root: Root; node: HTMLElement; armed: () => void; back: () => void } | null = null;

export function closeSlipHost(): void {
  if (current === null) return;
  const { root, node, armed, back } = current;
  current = null;
  window.removeEventListener('afterprint', armed);
  for (const type of BACK_IN_PAGE) window.removeEventListener(type, back, true);
  root.unmount();
  node.remove();
  document.documentElement.classList.remove(SLIP_PRINTING_CLASS);
  slipPageLink().media = SLIP_PAGE_OFF;
}

// Puts the slip in the document (flushSync: it is there before print() is called) and opens the browser's print dialog.
// One host at a time: a second print removes the old one first.
export function printSlip(content: ReactNode, print: () => void = () => { window.print(); }): void {
  closeSlipHost();
  const node = document.createElement('div');
  node.id = SLIP_HOST_ID;
  document.body.appendChild(node);
  document.documentElement.classList.add(SLIP_PRINTING_CLASS);
  slipPageLink().media = SLIP_PAGE_ON;
  const root = createRoot(node);
  const back = () => { closeSlipHost(); };
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
