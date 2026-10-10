// js/pages/calculator.js — the scripts calculator.html runs, in the order it used to list them as
// <script type="module"> tags. Bundled into dist/calculator.js by scripts/build-bundles.mjs.
import { runInOrder } from './run-in-order.js';

runInOrder([
  () => import('../location-title.js'),
  () => import('../i18n-dom.js'),
  () => import('../auth-gate.js'),
  () => import('../sw-update.js'),
  () => import('../kiosk.js'),
  () => import('../app.js'),
  () => import('../help-button.js'),
  () => import('../hold-to-zoom.js'),
]);
