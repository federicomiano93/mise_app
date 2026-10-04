// calc-fullscreen.js — a confirmed recipe, full screen: only the scaled ingredient rows
// (name + grams) and the total, large, for a tablet propped up in the kitchen. Opened from
// the result card (js/app.js); it owns nothing of the Calculator's state — it is GIVEN the
// rows, so it can be driven without Firebase.
//
// A CSS overlay, NOT the Fullscreen API (iOS Safari refuses it for anything but video) —
// the same choice as the Ricettario's full-screen list (js/catalogue/catalogue-detail.js).
//
// Dialog: role="dialog" + aria-modal, labelled with the recipe's name; focus moves in and goes
// back to whatever opened it; Tab stays inside; the page behind cannot scroll. It closes with
// the × button and with Escape. ⚠️ NOT with the browser's Back button: no overlay of this page
// pushes a history entry (nothing in the Calculator listens for popstate), and adding the first
// one here would make Back mean two different things on one screen.

import { t } from './i18n.js';
import { el } from './calculator-render.js';
import { buildZoomControls } from './zoom-steps.js';

export const ZOOM_STORAGE_KEY = 'mise.calcZoomStep';
const CLOSE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const LOCK_CLASS = 'calc-zoom-lock';

let current = null; // the one open view, if any

// rows: [{ name, grams }], totalG: number, opener: the element to give focus back to.
export function openRecipeFullScreen({ name, rows, totalG, opener }) {
  if (current) return current;

  const body = el('div', { class: 'calc-zoom-rows' });
  for (const r of rows) {
    body.appendChild(el('div', { class: 'calc-zoom-row' }, [
      el('span', { class: 'calc-zoom-name' }, r.name),
      el('span', { class: 'calc-zoom-val' }, Math.round(r.grams) + ' g'),
    ]));
  }
  body.appendChild(el('div', { class: 'calc-zoom-row calc-zoom-total' }, [
    el('span', { class: 'calc-zoom-name' }, t('calc.totalDough')),
    el('span', { class: 'calc-zoom-val' }, Math.round(totalG) + ' g'),
  ]));

  const closeBtn = document.createElement('button');
  closeBtn.setAttribute('type', 'button');
  closeBtn.className = 'calc-zoom-close';
  closeBtn.setAttribute('aria-label', t('calc.exitFullScreen'));
  closeBtn.title = t('calc.exitFullScreen');
  closeBtn.innerHTML = CLOSE_SVG; // static author markup

  // The × lives in its own strip ABOVE the scrolling rows (not floating over them): a row scrolled
  // up never slides under it and loses its «g».
  const view = el('div', { class: 'calc-zoom', role: 'dialog', 'aria-modal': 'true', 'aria-label': name }, [
    el('div', { class: 'calc-zoom-top' }, [closeBtn]),
    el('div', { class: 'calc-zoom-scroll' }, [body]),
  ]);
  const controls = buildZoomControls({
    storageKey: ZOOM_STORAGE_KEY,
    target: view,
    labels: { group: t('ui.textSize'), smaller: t('ui.textSmaller'), larger: t('ui.textLarger') },
  });
  view.appendChild(controls.node);

  function close() {
    if (current !== api) return;
    current = null;
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove(LOCK_CLASS);
    view.remove();
    if (opener && typeof opener.focus === 'function') {
      try { opener.focus({ preventScroll: true }); } catch (e) { /* best-effort */ }
    }
  }

  // Escape closes; Tab cycles through the three buttons (nothing behind the dialog is reachable).
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const stops = [closeBtn, ...controls.node.querySelectorAll('button')];
    const at = stops.indexOf(document.activeElement);
    const next = e.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at < 0 || at === stops.length - 1 ? 0 : at + 1);
    e.preventDefault();
    stops[next].focus();
  }

  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.classList.add(LOCK_CLASS);
  document.body.appendChild(view);
  try { closeBtn.focus({ preventScroll: true }); } catch (e) { /* best-effort */ }

  const api = { node: view, close, controls, closeBtn };
  current = api;
  return api;
}
