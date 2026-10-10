// js/pages/index.js — the scripts index.html runs, in the order it used to list them as
// <script type="module"> tags. Bundled into dist/index.js by scripts/build-bundles.mjs.
import { runInOrder } from './run-in-order.js';

runInOrder([
  () => import('../i18n-dom.js'),
  () => import('../auth-gate.js'),
  () => import('../sw-update.js'),
  () => import('../kiosk.js'),
  () => import('../orders/boot.js'),
  // "What's new" after an update. Home only, and it waits for orders/boot.js above to
  // take the splash down before it opens.
  () => import('../whats-new-boot.js'),
  () => import('../install-version-boot.js'),
  () => import('../install-hint-boot.js'),
  () => import('../location-title.js'),
  () => import('../home-session.js'),
  () => import('../home-kiosk-band.js'),
  () => import('../home-orders-badge.js'),
  () => import('../help-button.js'),
  () => import('../home-client-orders-badge.js'),
  () => import('../home-order-requests-badge.js'),
  () => import('../hold-to-zoom.js'),
  () => import('../install.js'),
]);
