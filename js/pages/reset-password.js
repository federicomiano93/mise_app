// js/pages/reset-password.js — the scripts reset-password.html runs, in the order it used to list them as
// <script type="module"> tags. Bundled into dist/reset-password.js by scripts/build-bundles.mjs.
import { runInOrder } from './run-in-order.js';

// Accepted (10 Oct 2026): this bundle loads the Firebase SDK eagerly, where reset-password.js used to
// import firebase.js lazily. The page needs the network anyway, and one bundle removes the stale-cache
// mismatch that reset-password-boot.js's «update the app» fallback guarded against.

runInOrder([
  () => import('../i18n-dom.js'),
  () => import('../reset-password-boot.js'),
  () => import('../sw-update.js'),
]);
