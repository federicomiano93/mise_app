// js/pages/foodcost.js — the scripts foodcost.html runs, in the order it used to list them as
// <script type="module"> tags. Bundled into dist/foodcost.js by scripts/build-bundles.mjs.
import { runInOrder } from './run-in-order.js';

runInOrder([
  () => import('../i18n-dom.js'),
  () => import('../auth-gate.js'),
  () => import('../sw-update.js'),
  () => import('../kiosk.js'),
  () => import('../foodcost/foodcost-main.js'),
  () => import('../help-button.js'),
]);
