import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { LabelSheet } from './LabelSheet';
import type { SheetSource } from './LabelSheet';

// The host the printer receives: built when Print is pressed, removed when the print is over.
//
// ⚠️⚠️ IT OUTLIVES THE SCREEN, ON PURPOSE. On Android Chrome window.print() does not block: the dialog is open while the
// page carries on, and a person can leave the label screen with it still up. A host owned by the screen would vanish
// with it and the paper would come out blank. So the host is created here, with its OWN React root, appended to
// <body> (label-print.css hides every other child of the body while printing), and taken away by `afterprint` ONLY —
// never by a line after print(), never by the screen unmounting.
//
// `flushSync` puts the sheet in the document before the caller calls window.print(). Not `.preview-overlay`: that
// class holds back a compulsory update for as long as it exists in the current app, and the habit is kept. No style
// attribute: the sheet sets its size through the CSSOM and the class decides the page.
//
// One host at a time: a second Print removes the old one first.

let current: { root: Root; node: HTMLElement; done: () => void } | null = null;

export function closePrintHost(): void {
  if (current === null) return;
  const { root, node, done } = current;
  current = null;
  window.removeEventListener('afterprint', done);
  root.unmount();
  node.remove();
}

export function openPrintHost(resolved: SheetSource, fontMm: number, sizeId: string | null): void {
  closePrintHost();
  const node = document.createElement('div');
  node.id = 'labelPrint';
  node.className = sizeId === null ? 'lab-print' : `lab-print lab-print--${sizeId}`;
  document.body.appendChild(node);
  const root = createRoot(node);
  const done = () => { closePrintHost(); };
  current = { root, node, done };
  window.addEventListener('afterprint', done);
  flushSync(() => { root.render(<LabelSheet resolved={resolved} fontMm={fontMm} />); });
}
