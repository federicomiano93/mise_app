import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { LabelSheet } from './LabelSheet';
import type { SheetSource } from './LabelSheet';

// The host the printer receives: built when Print is pressed, removed once the person is back in the app.
//
// ⚠️⚠️ IT OUTLIVES THE SCREEN, ON PURPOSE. On Android Chrome window.print() does not block: the dialog is open while the
// page carries on, and a person can leave the label screen with it still up. A host owned by the screen would vanish
// with it and the paper would come out blank. So the host is created here, with its OWN React root, appended to
// <body> (label-print.css hides every other child of the body while printing).
//
// ⚠️⚠️ AND `afterprint` DOES NOT REMOVE IT — IT ONLY ARMS THE REMOVAL. Driven on the lab tablet (Android 7, Chrome 101,
// 13 Oct 2026): Android fires `afterprint` as soon as window.print() hands over, BEFORE the system's print screen has
// laid the page out (and it lays it out again whenever the paper is changed there). A host removed on that event
// left nothing to print: the current app, built that way, offered a BLANK A4 page from the tablet. So after
// `afterprint` the host waits for the first sign the person is back in the page — a pointer or a key — which cannot
// happen while the system's print screen covers it. On a computer the dialog is modal, so that sign comes after it
// has closed; Ctrl+P is a key, so it removes the host BEFORE the browser prints the screen the person asked for.
// The host is invisible on screen (`.lab-print { display: none }`), so keeping it a little longer costs nothing.
//
// `flushSync` puts the sheet in the document before the caller calls window.print(). Not `.preview-overlay`: that
// class holds back a compulsory update for as long as it exists in the current app, and the habit is kept. No style
// attribute: the sheet sets its size through the CSSOM and the class decides the page.
//
// One host at a time: a second Print removes the old one first.
//
// ⚠️ THE `lab-printing` CLASS ON <html> LIVES EXACTLY AS LONG AS THE HOST. It is what scopes label-print.css's «hide
// everything else» rule to a label print (the stylesheet explains why it is a class and not `:has`, which the lab
// tablet's Chrome 101 does not know). Left behind after it, every later print of the app would come out blank — so
// it goes in closePrintHost(), the one way out.
export const PRINTING_CLASS = 'lab-printing';

// ⚠️⚠️ THE PAGE'S OWN MARGIN IS ZERO WHILE A LABEL PRINTS, AND ONLY THEN. Driven on the lab tablet (Chrome 101,
// 14 Oct 2026): that Chrome does not lay the sheet on its named @page (label-print.css), so the label went onto the
// DEFAULT page with the browser's default margins — off its corner, and spilling onto a second, blank page: a wasted
// label on a label printer. The current app has an unnamed `@page { size: auto; margin: 0 }` and prints one page
// there; Mise 2 cannot keep that rule in a stylesheet, because this single-page app would give margin 0 to every other
// print it ever makes. So the rule is a constructed stylesheet adopted for exactly as long as the host lives — the
// same lifetime as the class above. Where named pages work (a computer's Chrome) the sheet's own page still wins.
export const LABEL_PAGE_RULE = '@page { size: auto; margin: 0; }';
let labelPageSheet: CSSStyleSheet | null = null;

function adoptLabelPage(): void {
  // Constructed stylesheets: Chrome 73, Safari 16.4 — inside the build target. Feature-detected so a browser without
  // them (and jsdom) still prints, with the browser's margins.
  if (!('adoptedStyleSheets' in document) || typeof CSSStyleSheet !== 'function' || !('replaceSync' in CSSStyleSheet.prototype)) return;
  if (labelPageSheet === null) {
    labelPageSheet = new CSSStyleSheet();
    labelPageSheet.replaceSync(LABEL_PAGE_RULE);
  }
  const sheet = labelPageSheet;
  if (!document.adoptedStyleSheets.includes(sheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

function dropLabelPage(): void {
  const sheet = labelPageSheet;
  if (sheet === null || !('adoptedStyleSheets' in document)) return;
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => s !== sheet);
}

// The signs that the person is back in the page.
const BACK_IN_PAGE = ['pointerdown', 'keydown'] as const;

let current: { root: Root; node: HTMLElement; armed: () => void; back: () => void } | null = null;

export function closePrintHost(): void {
  if (current === null) return;
  const { root, node, armed, back } = current;
  current = null;
  window.removeEventListener('afterprint', armed);
  for (const type of BACK_IN_PAGE) window.removeEventListener(type, back, true);
  root.unmount();
  node.remove();
  document.documentElement.classList.remove(PRINTING_CLASS);
  dropLabelPage();
}

export function openPrintHost(resolved: SheetSource, fontMm: number, sizeId: string | null): void {
  closePrintHost();
  const node = document.createElement('div');
  node.id = 'labelPrint';
  node.className = sizeId === null ? 'lab-print' : `lab-print lab-print--${sizeId}`;
  document.body.appendChild(node);
  document.documentElement.classList.add(PRINTING_CLASS);
  adoptLabelPage();
  const root = createRoot(node);
  const back = () => { closePrintHost(); };
  // Capture phase: the removal happens before anything the tap or key goes on to do (Ctrl+P included).
  const armed = () => {
    window.removeEventListener('afterprint', armed);
    for (const type of BACK_IN_PAGE) window.addEventListener(type, back, true);
  };
  current = { root, node, armed, back };
  window.addEventListener('afterprint', armed);
  flushSync(() => { root.render(<LabelSheet resolved={resolved} fontMm={fontMm} />); });
}
