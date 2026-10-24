// export-sheet.js — «Export as PDF or Excel» for a recipe as the screen shows it (the
// Calculator's scaled dough, or a Recipe catalogue recipe at base or scaled). One dialog that changes its
// content: the choice, then «Preparing the file…», then «File ready» with a Download link.
//
// It is the same shell as js/send-sheet.js (the `app-dialog` box, the `send-routes` rows from
// tokens.css, Escape, a Tab trap, focus handed back, one open at a time) so the two sheets look
// and behave alike. It builds its own DOM with document APIs for the same reason that one does.
//
// ⚠️ THE FILE IS NOT SAVED ON THE FIRST TAP, AND THAT IS DELIBERATE. The libraries load on the
// tap (js/recipe-export.js), so by the time the file exists the tap's «user activation» may have
// run out, and a browser then refuses a programmatic download or share. A fresh tap on a real
// <a download> always works, on a new phone and on an old Chrome alike. So the dialog makes the
// file first and asks for one more tap.
//
// ⚠️ SHARE IS OFFERED FOR THE PDF ONLY. Chrome's Web Share accepts .pdf but has no Office types
// in its allowlist, so an .xlsx can only be downloaded. canShare() is asked with the real file:
// a browser that cannot share it shows no Share button rather than one that fails.
//
// ⚠️ NOTHING LEAVES THE DEVICE. The recipe is turned into a file in this page; no request is
// made but the one that fetches the library the first time.

import { t } from './i18n.js';
import { svgElement } from './send-icon.js';
import { DOCUMENT_PATHS, TABLE_PATHS } from './export-icon.js';
import { exportFileName, exportErrorKey, exportErrorCode, buildPdfBlob, buildXlsxBlob } from './recipe-export.js';

let isOpen = false;   // one at a time
let seq = 0;
// A download that has just been tapped may still be reading the blob: keep the address alive.
const REVOKE_DELAY_MS = 30000;

const KINDS = [
  { id: 'pdf', ext: 'pdf', mime: 'application/pdf', paths: DOCUMENT_PATHS, nameKey: 'export.pdf', noteKey: 'export.pdfNote' },
  { id: 'xlsx', ext: 'xlsx', mime: null, paths: TABLE_PATHS, nameKey: 'export.excel', noteKey: 'export.excelNote' },
];

// openExportSheet({ model, totalLabel, opener }) — `model` is { name, trays, totalG, rows } from the
// Calculator (js/calc.js exportModelFor) or the Recipe catalogue (exportModelOf); `totalLabel` is the word for the Excel total row, already translated by the caller.
export function openExportSheet({ model, totalLabel = '', opener = null } = {}) {
  if (isOpen || !model) return;
  isOpen = true;

  const n = ++seq;
  const prevFocus = opener || document.activeElement;
  const backdrop = make('div', 'app-dialog-backdrop send-chooser');
  const box = make('div', 'app-dialog');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  const titleId = `export-sheet-title-${n}`;
  box.setAttribute('aria-labelledby', titleId);
  backdrop.appendChild(box);

  let closed = false;
  let blobUrl = null;
  let focusable = [];

  const close = () => {
    if (closed) return;
    closed = true;
    isOpen = false;
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    if (blobUrl) {
      const url = blobUrl;
      const timer = setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* nothing to free */ } }, REVOKE_DELAY_MS);
      // A test run (Node) must not wait 30 s for it; a browser timer is a number and has no unref.
      if (timer && typeof timer.unref === 'function') timer.unref();
    }
    if (prevFocus && typeof prevFocus.focus === 'function') {
      try { prevFocus.focus(); } catch (e) { /* focus restore is best-effort */ }
    }
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const at = focusable.indexOf(document.activeElement);
    const next = e.shiftKey ? at - 1 : at + 1;
    focusable[(next + focusable.length) % focusable.length].focus();
  };

  // Every state starts from an empty box and a title; `buttons` is the Tab order.
  const paint = (titleKey, fill) => {
    box.textContent = '';
    const title = make('h2', 'app-dialog-title', t(titleKey));
    title.id = titleId;
    box.appendChild(title);
    const buttons = fill();
    focusable = buttons;
    return buttons;
  };
  const closeButton = (key, cls = 'app-dialog-btn app-dialog-btn-ghost') => {
    const b = make('button', cls, t(key));
    b.type = 'button';
    b.addEventListener('click', close);
    return b;
  };
  const message = (text, cls = '') => {
    const p = make('p', `app-dialog-msg ${cls}`.trim(), text);
    box.appendChild(p);
    return p;
  };

  const showChoice = () => {
    const [first] = paint('export.title', () => {
      const list = make('div', 'send-routes');
      const routes = KINDS.map((kind) => {
        const b = make('button', 'send-route');
        b.type = 'button';
        const icon = make('span', 'send-route-icon');
        icon.appendChild(svgElement(kind.paths, 22));
        const col = make('span', 'send-route-text');
        col.appendChild(make('span', 'send-route-name', t(kind.nameKey)));
        col.appendChild(make('span', 'send-route-note', t(kind.noteKey)));
        b.appendChild(icon);
        b.appendChild(col);
        b.addEventListener('click', () => build(kind));
        list.appendChild(b);
        return b;
      });
      box.appendChild(list);
      const actions = make('div', 'app-dialog-actions');
      const cancel = closeButton('ui.cancel');
      actions.appendChild(cancel);
      box.appendChild(actions);
      return [...routes, cancel];
    });
    first.focus();
  };

  const showWorking = () => {
    const [cancel] = paint('export.title', () => {
      // ⚠️ The live region is in the page BEFORE its text is set: a screen reader announces a change
      // to a region it already knows, not one that arrives with its words inside.
      const status = message('');
      status.setAttribute('role', 'status');
      setTimeout(() => { status.textContent = t('export.preparing'); }, 0);
      const actions = make('div', 'app-dialog-actions');
      const cancel = closeButton('ui.cancel');
      actions.appendChild(cancel);
      box.appendChild(actions);
      return [cancel];
    });
    cancel.focus();
  };

  const showError = (err) => {
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    const [ok] = paint('export.title', () => {
      const msg = message(t(exportErrorKey(err, online)));
      msg.setAttribute('role', 'alert');
      const actions = make('div', 'app-dialog-actions');
      const ok = closeButton('export.close', 'app-dialog-btn app-dialog-btn-solid');
      actions.appendChild(ok);
      box.appendChild(actions);
      return [ok];
    });
    ok.focus();
  };

  const showReady = (kind, blob, fileName) => {
    blobUrl = URL.createObjectURL(blob);
    const file = shareableFile(kind, blob, fileName);
    const buttons = paint('export.ready', () => {
      message(fileName, 'export-file');
      // Three actions do not fit side by side at 296 px in Italian, so this state stacks them: the
      // primary Download on top, Share (when there is one) and Close below (.export-actions).
      const actions = make('div', 'app-dialog-actions export-actions');
      // A real link, not a click made by script: the browser downloads it on THIS tap.
      const link = make('a', 'app-dialog-btn app-dialog-btn-solid', t('export.download'));
      link.href = blobUrl;
      link.download = fileName;
      actions.appendChild(link);
      const out = [link];
      if (file) {
        const share = make('button', 'app-dialog-btn app-dialog-btn-ghost', t('export.share'));
        share.type = 'button';
        share.addEventListener('click', () => shareFile(file, fileName));
        actions.appendChild(share);
        out.push(share);
      }
      const closeBtn = closeButton('export.close');
      actions.appendChild(closeBtn);
      out.push(closeBtn);
      box.appendChild(actions);
      return out;
    });
    buttons[0].focus();
  };

  function build(kind) {
    showWorking();
    // The words for a nameless recipe are read now, in the venue's language, never at module load.
    const fileName = exportFileName(model, kind.ext, t('export.fileFallback'));
    const made = kind.id === 'pdf' ? buildPdfBlob(model) : buildXlsxBlob(model, totalLabel, t('export.sheetFallback'));
    made.then((blob) => { if (!closed) showReady(kind, blob, fileName); })
      .catch((err) => {
        // Reported through the app's error path (console.error → js/error-report.js): FIXED words
        // only — which file, which stage — never the recipe, its name or the error's own message.
        console.error('Recipe export failed:', kind.id, exportErrorCode(err));
        if (!closed) showError(err);
      });
  }

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(backdrop);
  showChoice();
}

// The PDF as a File the browser agrees to share, or null (an .xlsx, or no Web Share for files).
function shareableFile(kind, blob, fileName) {
  if (kind.id !== 'pdf') return null;
  try {
    if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function') return null;
    const file = new File([blob], fileName, { type: kind.mime });
    return navigator.canShare({ files: [file] }) ? file : null;
  } catch (e) {
    return null;
  }
}

// Closing the phone's share sheet without choosing is not an error, so it says nothing.
async function shareFile(file, title) {
  try {
    await navigator.share({ files: [file], title });
  } catch (e) {
    if (!e || e.name !== 'AbortError') console.warn('export share failed');
  }
}

function make(tag, cls, text) {
  const node = document.createElement(tag);
  node.className = cls;
  if (text) node.textContent = text;
  return node;
}
