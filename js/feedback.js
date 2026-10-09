// feedback.js — «Write to Claude»: the note form behind the «?» help sheet.
//
// Only reachable in a venue whose document says feedbackToClaude === true (see
// feedbackOn() in js/venue-features.js and js/help-button.js); the rules refuse the write
// anywhere else. Built on the app's ONE dialog (js/confirm-dialog.js) with a textarea as
// its `node`, so it inherits Escape, the backdrop, the focus trap and the naming a screen
// reader needs. DOM API only — the page CSP forbids string-built markup.
//
// P20: nothing the person typed is lost silently. An empty send, a refused send and a
// «keep writing» after Cancel all REOPEN the form with the text still in it.

import { t } from './i18n.js';
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import { feedbackPayload, FEEDBACK_MAX } from './feedback-model.js';
import { askVersionOf, versionNumber } from './app-version.js';

// The real collaborators. firebase.js is loaded when a note is sent, not at import, so
// this module (and its tests) never need the Firebase SDK from its CDN just to be read.
const REAL = {
  confirmDialog,
  alertDialog,
  sendFeedback: (payload) => import('./firebase.js').then((m) => m.sendFeedback(payload)),
  runningVersion,
  waitMs: 4000,
};

// waitMs: how long to wait for the server before saying «saved on this device». Offline,
// Firestore keeps the write and sends it by itself; the promise just stays pending.
let fieldSeq = 0;

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// The label, the field and (after a blank send) the error line.
function buildForm(value, showError) {
  const n = ++fieldSeq;
  const wrap = make('div', 'fb-form');
  const label = make('label', 'fb-label', t('feedback.label'));
  label.htmlFor = 'fb-text-' + n;
  const area = document.createElement('textarea');
  area.id = 'fb-text-' + n;
  area.className = 'fb-area';
  area.rows = 5;
  area.maxLength = FEEDBACK_MAX;
  area.placeholder = t('feedback.placeholder');
  area.value = value;
  wrap.append(label, area);
  if (showError) {
    const error = make('p', 'fb-error', t('feedback.empty'));
    error.id = 'fb-error-' + n;
    error.setAttribute('role', 'alert');
    area.setAttribute('aria-invalid', 'true');
    area.setAttribute('aria-describedby', error.id);
    area.classList.add('fb-area-invalid');
    wrap.appendChild(error);
  }
  return { wrap, area };
}

// The running release, or null. Never holds the form up for more than a moment.
async function runningVersion() {
  try {
    const controller = navigator.serviceWorker ? navigator.serviceWorker.controller : null;
    return versionNumber(await askVersionOf(controller, { timeoutMs: 800, attempts: 1 }));
  } catch {
    return null;
  }
}

// 'sent' | 'queued' | { failed: error }
function sendAndWait(send, payload, waitMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('queued'), waitMs);
    Promise.resolve().then(() => send(payload)).then(
      () => { clearTimeout(timer); resolve('sent'); },
      (err) => {
        clearTimeout(timer);
        // P17: the error code only — never the text a person wrote.
        console.error('sendFeedback failed:', err && err.code ? err.code : 'unknown');
        resolve({ failed: err });
      },
    );
  });
}

// `deps` exists so the flows can be tested without a browser; production passes nothing.
export async function openFeedback(screenId, draft = '', deps = {}) {
  const d = { ...REAL, ...deps };
  let text = draft;
  let showError = false;
  for (;;) {
    const { wrap, area } = buildForm(text, showError);
    const answer = d.confirmDialog({
      title: t('feedback.title'),
      message: t('feedback.intro'),
      node: wrap,
      okLabel: t('feedback.send'),
      cancelLabel: t('ui.cancel'),
    });
    // confirmDialog focuses its OK button synchronously; the person came to type.
    area.focus();
    const confirmed = await answer;
    text = area.value;
    showError = false;

    if (!confirmed) {
      if (!text.trim()) return;
      const discard = await d.confirmDialog({
        message: t('feedback.discard.message'),
        okLabel: t('feedback.discard.ok'),
        cancelLabel: t('feedback.discard.keep'),
        danger: true,
      });
      if (discard) return;
      continue;
    }

    const payload = feedbackPayload({
      text, screen: screenId, appVersion: await d.runningVersion(),
    });
    if (!payload) { showError = true; continue; }

    const outcome = await sendAndWait(d.sendFeedback, payload, d.waitMs);
    if (outcome === 'sent' || outcome === 'queued') {
      globalThis.window?.dispatchEvent(new CustomEvent('mise:action', { detail: 'feedback-sent' }));
    }
    if (outcome === 'sent') { await d.alertDialog(t('feedback.sent')); return; }
    if (outcome === 'queued') { await d.alertDialog(t('feedback.queued')); return; }
    await d.alertDialog(t('feedback.failed'));
  }
}
