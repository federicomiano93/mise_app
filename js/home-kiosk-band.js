// home-kiosk-band.js — the thin band at the top of the Home with «Rest» and «Exit», shown ONLY
// on a device where kiosk mode is on (js/kiosk-model.js), to every role. «Rest» tells
// js/kiosk.js to cover the screen now ('kiosk-rest-now'); «Exit» closes the page when the
// tablet allows it. Neither changes the setting: kiosk mode stays on.
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

// 24×24, stroked 2px, currentColor — the moon and the power symbol.
const ICONS = {
  moon: ['M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'],
  power: ['M18.36 6.64a9 9 0 1 1-12.73 0', 'M12 2v10'],
};

function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attrs = {
    viewBox: '0 0 24 24', width: '22', height: '22', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  ICONS[name].forEach(d => {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  });
  return svg;
}

function button(iconName, text, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-secondary home-kiosk-btn';
  const label = document.createElement('span');
  label.textContent = text;
  btn.append(icon(iconName), label);
  btn.addEventListener('click', onClick);
  return btn;
}

function readStored() {
  try { return localStorage.getItem(KIOSK_STORAGE_KEY); } catch { return null; }
}

function restNow() {
  window.dispatchEvent(new Event('kiosk-rest-now'));
}

function exitApp() {
  try { window.close(); } catch { /* refused: handled below */ }
  setTimeout(() => {
    if (exitRefused({ visibilityState: document.visibilityState, closed: window.closed })) {
      alertDialog(t('kiosk.home.cannotClose'));
    }
  }, EXIT_CHECK_MS);
}

export function mountKioskBand(host) {
  // Built on every render, so the words follow the language of the moment.
  function render() {
    host.textContent = '';
    host.hidden = !kioskBandVisible(readStored());
    if (host.hidden) return;
    host.setAttribute('aria-label', t('kiosk.home.aria'));
    host.append(
      button('moon', t('kiosk.home.rest'), restNow),
      button('power', t('kiosk.home.exit'), exitApp),
    );
  }
  window.addEventListener('kiosk-settings-changed', render);
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === KIOSK_STORAGE_KEY) render();
  });
  onLanguageChange(render);
  render();
}

if (typeof document !== 'undefined') {
  const host = document.getElementById('home-kiosk-band');
  if (host) mountKioskBand(host);
}
