// js/pages/clients.js — the scripts clients.html runs, in the order the other pages list theirs.
// Bundled into dist/clients.js by scripts/build-bundles.mjs.
import { runInOrder } from './run-in-order.js';

runInOrder([
  () => import('../viewport-height.js'),
  () => import('../i18n-dom.js'),
  () => import('../auth-gate.js'),
  () => import('../sw-update.js'),
  () => import('../kiosk.js'),
  () => import('../clients/clients-main.js'),
  () => import('../help-button.js'),
  () => import('../hold-to-zoom.js'),
]);
