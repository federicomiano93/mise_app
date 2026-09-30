// preview-ribbon.js — the small band that says «this is the preview, with test data».
//
// A pull request's preview link (Firebase Hosting, the mise-app-preview project) looks exactly
// like the real app. Without a mark, a screenshot or a phone left open on it is easily taken for
// the live app — and the other way round. So every page of the preview wears this band, and no
// page of the live site ever can: it is drawn only when js/firebase-target.js recognised a
// preview host.
//
// pointer-events: none — it must never swallow a tap meant for a button under it.

import { t, onLanguageChange } from './i18n.js';

const RIBBON_ID = 'preview-ribbon';

function draw(doc) {
  let ribbon = doc.getElementById(RIBBON_ID);
  if (!ribbon) {
    ribbon = doc.createElement('div');
    ribbon.id = RIBBON_ID;
    ribbon.className = 'preview-ribbon';
    ribbon.setAttribute('role', 'note');
    doc.body.appendChild(ribbon);
  }
  // Asked here, at draw time: at module load no venue is open and the language is not known.
  ribbon.textContent = t('preview.ribbon');
}

export function showPreviewRibbon(doc = document) {
  const start = () => {
    draw(doc);
    onLanguageChange(() => draw(doc));
  };
  if (doc.body) start();
  else doc.addEventListener('DOMContentLoaded', start, { once: true });
}
