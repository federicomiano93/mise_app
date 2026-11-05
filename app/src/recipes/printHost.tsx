import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import labelPageHaccp40x30Href from './label-page-haccp-40x30.css?url';
import labelPageHaccp50x30Href from './label-page-haccp-50x30.css?url';
import labelPageHaccp60x40Href from './label-page-haccp-60x40.css?url';
import labelPageHaccp62x29Href from './label-page-haccp-62x29.css?url';
import labelPageHaccp80x60Href from './label-page-haccp-80x60.css?url';
import labelPageImageHref from './label-page-image.css?url';
import labelPageHref from './label-page.css?url';
import { LabelSheet } from './LabelSheet';
import type { SheetSource } from './LabelSheet';
import type { HaccpSize } from '@mise/shared/haccp-label';

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
// there; Mise 2 cannot keep that rule in a stylesheet that is always on, because this single-page app would give
// margin 0 to every other print it ever makes. So the rule lives in its own static file, label-page.css, linked here
// with media="not all" the moment this module loads — the browser downloads it anyway, so it is there when Print is
// pressed — and switched to media="print" for exactly as long as the host lives, the same lifetime as the class
// above. A static file, not CSS built at run time: labelSource.spec.ts keeps the label's files clear of that (the page
// CSP). Where named pages work (a computer's Chrome) the sheet's own page still wins.
export const LABEL_PAGE_OFF = 'not all';
export const LABEL_PAGE_ON = 'print';
export const LABEL_PAGE_ID = 'labelPage';
// The image label's page (label-page-image.css): 80 × 60 mm whatever the browser does with named pages. Linked and
// switched the same way, and only one of the two is ever on.
export const LABEL_PAGE_IMAGE_ID = 'labelPageImage';

// The HACCP label's pages, one file per size (label-page-haccp-<size>.css): linked and switched like the image label's, and
// only one of ALL the page files is ever on. The map is closed over the five sizes the settings offer.
export const LABEL_PAGE_HACCP_PREFIX = 'labelPageHaccp';
const HACCP_PAGES: Readonly<Record<HaccpSize, string>> = {
  '40x30': labelPageHaccp40x30Href,
  '50x30': labelPageHaccp50x30Href,
  '60x40': labelPageHaccp60x40Href,
  '62x29': labelPageHaccp62x29Href,
  '80x60': labelPageHaccp80x60Href,
};
const haccpPageId = (size: HaccpSize): string => `${LABEL_PAGE_HACCP_PREFIX}${size}`;

function pageLink(id: string, href: string): HTMLLinkElement {
  const existing = document.getElementById(id);
  if (existing instanceof HTMLLinkElement) return existing;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = href;
  link.media = LABEL_PAGE_OFF;
  document.head.appendChild(link);
  return link;
}

const labelPageLink = (): HTMLLinkElement => pageLink(LABEL_PAGE_ID, labelPageHref);
const imagePageLink = (): HTMLLinkElement => pageLink(LABEL_PAGE_IMAGE_ID, labelPageImageHref);

const haccpPageLink = (size: HaccpSize): HTMLLinkElement => pageLink(haccpPageId(size), HACCP_PAGES[size]);
const HACCP_SIZE_LIST = Object.keys(HACCP_PAGES) as HaccpSize[];

labelPageLink();
imagePageLink();
for (const size of HACCP_SIZE_LIST) haccpPageLink(size);

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
  labelPageLink().media = LABEL_PAGE_OFF;
  imagePageLink().media = LABEL_PAGE_OFF;
  for (const size of HACCP_SIZE_LIST) haccpPageLink(size).media = LABEL_PAGE_OFF;
}

// ⚠️ ONE LIFETIME FOR EVERY KIND OF LABEL. The paper sheet and the image label (a PNG of the very dots that go to the
// printer) differ only in the node's class and in what is drawn inside it; everything above — the host outliving the
// screen, `afterprint` only arming the removal, the class on <html>, the zero-margin page — is this one function's.
function openHost(className: string, content: ReactNode, page: () => HTMLLinkElement): void {
  closePrintHost();
  const node = document.createElement('div');
  node.id = 'labelPrint';
  node.className = className;
  document.body.appendChild(node);
  document.documentElement.classList.add(PRINTING_CLASS);
  page().media = LABEL_PAGE_ON;
  const root = createRoot(node);
  const back = () => { closePrintHost(); };
  // Capture phase: the removal happens before anything the tap or key goes on to do (Ctrl+P included).
  const armed = () => {
    window.removeEventListener('afterprint', armed);
    for (const type of BACK_IN_PAGE) window.addEventListener(type, back, true);
  };
  current = { root, node, armed, back };
  window.addEventListener('afterprint', armed);
  flushSync(() => { root.render(content); });
}

export function openPrintHost(resolved: SheetSource, fontMm: number, sizeId: string | null): void {
  openHost(
    sizeId === null ? 'lab-print' : `lab-print lab-print--${sizeId}`,
    <LabelSheet resolved={resolved} fontMm={fontMm} />,
    labelPageLink,
  );
}

// The image label («with logo»): its dots as a PNG on an 80 × 60 mm page of its own (label-print.css, `p80x60`). The
// image has no alt text on purpose: it is a picture of a label, and nobody reads the print host.
export function openImagePrintHost(png: string): void {
  openHost('lab-print lab-print--p80x60', <img className="lab-print-image" src={png} alt="" />, imagePageLink);
}

// The HACCP label: its dots as a PNG on a page of exactly its size (label-print.css, `.lab-print--haccp-<size>`), through the
// same host as the others. The size is one of the closed set, so the class and the page file always exist.
export function openHaccpPrintHost(png: string, size: HaccpSize): void {
  openHost(`lab-print lab-print--haccp-${size}`, <img className="lab-print-image" src={png} alt="" />, () => haccpPageLink(size));
}
