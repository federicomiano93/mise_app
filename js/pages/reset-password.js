// js/pages/reset-password.js — the scripts reset-password.html runs, in the order it used to list them as
// <script type="module"> tags. Bundled into dist/reset-password.js by scripts/build-bundles.mjs.
import { runInOrder } from './run-in-order.js';

runInOrder([
  () => import('../i18n-dom.js'),
  () => import('../reset-password-boot.js'),
  () => import('../sw-update.js'),
]);
