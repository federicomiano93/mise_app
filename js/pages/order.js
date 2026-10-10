// js/pages/order.js — the scripts order.html runs, in the order it used to list them as
// <script type="module"> tags. Bundled into dist/order.js by scripts/build-bundles.mjs.
import { runInOrder } from './run-in-order.js';

runInOrder([
  () => import('../client-orders/order-main.js'),
]);
