// home-kiosk-band.js — «Rest» and «Exit» on the Home, shown ONLY on a device where kiosk mode
// is on (js/kiosk-model.js), to every role. «Rest» is the round moon button in the green header
// (#home-rest-btn, in index.html) and tells js/kiosk.js to cover the screen now
// ('kiosk-rest-now'); «Exit» is the red raised button in the bar under the scroll area
// (#home-kiosk-footer) and closes the page when the tablet allows it. Neither changes the
// setting: kiosk mode stays on. (The file keeps its old name: it is listed in sw.js.)
//
// The setting is read inside render(), never at load, and follows the two ways it changes:
// the Home's own settings screen ('kiosk-settings-changed', same page) and another tab
// ('storage').

import { t, onLanguageChange } from './i18n.js';
import { alertDialog } from './confirm-dialog.js';
import {
  KIOSK_STORAGE_KEY, kioskBandVisible, EXIT_CHECK_MS, exitRefused,
} from './kiosk-model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// 24×24, stroked 2px, currentColor — the power symbol (the moon is static markup in index.html).
const POWER = ['M18.36 6.64a9 9 0 1 1-12.73 0', 'M12 2v10'];

function powerIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attrs = {
    viewBox: '0 0 24 24', width: '22', height: '22', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  POWER.forEach(d => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  });
  return svg;
}

function exitButton(text, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'home-kiosk-exit';
  const label = document.createElement('span');
  label.textContent = text;
  btn.append(powerIcon(), label);
  btn.addEventListener('click', onClick);
  return btn;
}

function readStored() {
  try { return localStorage.getItem(KIOSK_STORAGE_KEY); } catch { return null; }
}

function restNow() {
  globalThis.window?.dispatchEvent(new CustomEvent('mise:action', { detail: 'kiosk-rest' }));
  window.dispatchEvent(new Event('kiosk-rest-now'));
}

function exitApp() {
  globalThis.window?.dispatchEvent(new CustomEvent('mise:action', { detail: 'kiosk-exit' }));
  try { window.close(); } catch { /* refused: handled below */ }
  setTimeout(() => {
    if (exitRefused({ visibilityState: document.visibilityState, closed: window.closed })) {
      alertDialog(t('kiosk.home.cannotClose'));
    }
  }, EXIT_CHECK_MS);
}

export function mountKioskBand(footer, restBtn) {
  restBtn.addEventListener('click', restNow);
  // Built on every render, so the words follow the language of the moment.
  function render() {
    footer.textContent = '';
    const visible = kioskBandVisible(readStored());
    footer.hidden = !visible;
    restBtn.hidden = !visible;
    if (!visible) return;
    restBtn.setAttribute('aria-label', t('kiosk.home.rest'));
    footer.setAttribute('aria-label', t('kiosk.home.aria'));
    footer.append(exitButton(t('kiosk.home.exit'), exitApp));
  }
  window.addEventListener('kiosk-settings-changed', render);
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === KIOSK_STORAGE_KEY) render();
  });
  onLanguageChange(render);
  render();
}

if (typeof document !== 'undefined') {
  const footer = document.getElementById('home-kiosk-footer');
  const restBtn = document.getElementById('home-rest-btn');
  if (footer && restBtn) mountKioskBand(footer, restBtn);
}
