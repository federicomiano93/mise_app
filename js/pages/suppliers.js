// js/pages/suppliers.js — the scripts suppliers.html runs, in the order it used to list them as
// <script type="module"> tags. Bundled into dist/suppliers.js by scripts/build-bundles.mjs.
import { runInOrder } from './run-in-order.js';

runInOrder([
  () => import('../i18n-dom.js'),
  () => import('../auth-gate.js'),
  () => import('../sw-update.js'),
  () => import('../kiosk.js'),
  () => import('../orders/registry-main.js'),
  () => import('../help-button.js'),
  () => import('../hold-to-zoom.js'),
]);
