// js/pages/catalogue.js — the scripts catalogue.html runs, in the order it used to list them as
// <script type="module"> tags. Bundled into dist/catalogue.js by scripts/build-bundles.mjs.
import { runInOrder } from './run-in-order.js';

runInOrder([
  () => import('../i18n-dom.js'),
  () => import('../auth-gate.js'),
  () => import('../sw-update.js'),
  () => import('../kiosk.js'),
  () => import('../catalogue/catalogue-main.js'),
  () => import('../help-button.js'),
  () => import('../hold-to-zoom.js'),
]);
