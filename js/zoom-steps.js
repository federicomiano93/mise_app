// zoom-steps.js — the «−» / «+» text-size pair of a full-screen recipe view, and the six sizes
// it steps through. Remembered PER DEVICE (one localStorage key per feature, passed in).
//
// ⚠️ THIS FILE EXISTS IN TWO PLACES, byte for byte: js/zoom-steps.js (the Calculator) and
// js/catalogue/zoom-steps.js (the Ricettario). A feature may not import from another
// feature's folder, and a copied small helper is cheap; tests/copie-allineate.test.mjs fails
// if the two ever differ. The text of the buttons comes IN (labels), never from here, so
// nothing in this file is a word a person reads.
//
// Plain DOM, no imports: CSP-safe (the icons are static author markup, the size travels as a
// CSS custom property set through the CSSOM, never an inline style attribute).

// Multipliers of the view's own base size. 1× is step 1, so the first tap on «+» already
// makes the text bigger and the first tap on «−» smaller.
export const ZOOM_SCALES = Object.freeze([0.8, 1, 1.2, 1.45, 1.75, 2.1]);
export const DEFAULT_ZOOM_STEP = 1;
const LAST_STEP = ZOOM_SCALES.length - 1;

// A step the buttons computed: held inside the range, a non-number answers the default.
export function clampStep(step) {
  const isNumber = typeof step === 'number';
  const isDigits = typeof step === 'string' && /^-?d+$/.test(step.trim());
  if (!isNumber && !isDigits) return DEFAULT_ZOOM_STEP;
  const n = Number(step);
  if (!Number.isInteger(n)) return DEFAULT_ZOOM_STEP;
  return Math.min(LAST_STEP, Math.max(0, n));
}

// A step read back from storage. Anything that is not a whole number inside the range is
// corrupt (a hand-edited value, another app's key) and answers the default — it is never
// stretched to the nearest end, which would turn garbage into the biggest text on the screen.
export function parseStep(raw) {
  if (typeof raw !== 'string' || !/^\d$/.test(raw.trim())) return DEFAULT_ZOOM_STEP;
  const n = Number(raw.trim());
  return n >= 0 && n <= LAST_STEP ? n : DEFAULT_ZOOM_STEP;
}

export function readZoomStep(key) {
  try { return parseStep(localStorage.getItem(key)); } catch (e) { return DEFAULT_ZOOM_STEP; }
}

export function saveZoomStep(key, step) {
  try { localStorage.setItem(key, String(clampStep(step))); } catch (e) { /* private mode / full: the size just is not remembered */ }
}

export const stepBy = (step, delta) => clampStep(clampStep(step) + delta);
export const canStep = (step, delta) => stepBy(step, delta) !== clampStep(step);
export const scaleOf = (step) => ZOOM_SCALES[clampStep(step)];

const SVG_OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';
const MINUS_SVG = SVG_OPEN + '<path d="M5 12h14"/></svg>';
const PLUS_SVG = SVG_OPEN + '<path d="M12 5v14M5 12h14"/></svg>';

// The pair of round buttons. `target` is the view whose text they size: it gets the CSS custom
// property --zoom-scale (and data-zoom-step). `labels` = { smaller, larger }, already
// translated by the caller at draw time.
//
// ⚠️ aria-disabled, NOT the disabled attribute, at either end: a button that becomes disabled
// under the finger that just pressed it drops keyboard focus on the page body. A press at the
// end of the range simply does nothing.
// ⚠️ Clicks AND keys are stopped here: the Ricettario's view closes on a tap anywhere and on
// Enter/Space, and sizing the text must never close it.
export function buildZoomControls({ storageKey, target, labels }) {
  let step = DEFAULT_ZOOM_STEP;
  const node = document.createElement('div');
  node.className = 'zoom-steps';
  node.setAttribute('role', 'group');
  node.setAttribute('aria-label', labels.group || '');

  function button(delta, label, svg) {
    const btn = document.createElement('button');
    btn.setAttribute('type', 'button');
    btn.className = 'zoom-step-btn';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.innerHTML = svg; // static author markup above, never data
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!canStep(step, delta)) return;
      step = stepBy(step, delta);
      saveZoomStep(storageKey, step);
      paint();
    });
    btn.addEventListener('keydown', (e) => e.stopPropagation());
    return btn;
  }

  const smaller = button(-1, labels.smaller, MINUS_SVG);
  const larger = button(1, labels.larger, PLUS_SVG);
  node.appendChild(smaller);
  node.appendChild(larger);

  function paint() {
    target.style.setProperty('--zoom-scale', String(scaleOf(step)));
    target.setAttribute('data-zoom-step', String(step));
    smaller.setAttribute('aria-disabled', canStep(step, -1) ? 'false' : 'true');
    larger.setAttribute('aria-disabled', canStep(step, 1) ? 'false' : 'true');
  }

  // Called each time the view opens: the step is read again, so another tab's choice, or a
  // value corrupted since, is honoured at once.
  function sync() {
    step = readZoomStep(storageKey);
    paint();
  }

  sync();
  return { node, sync, get step() { return step; } };
}
