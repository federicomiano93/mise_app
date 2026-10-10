// js/pages/inventory.js — the scripts inventory.html runs, in the order it used to list them as
// <script type="module"> tags. Bundled into dist/inventory.js by scripts/build-bundles.mjs.
import { runInOrder } from './run-in-order.js';

runInOrder([
  () => import('../i18n-dom.js'),
  () => import('../auth-gate.js'),
  () => import('../sw-update.js'),
  () => import('../kiosk.js'),
  () => import('../inventory/inventory-main.js'),
  () => import('../help-button.js'),
]);
