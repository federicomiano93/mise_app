// js/pages/install-guide.js — the scripts install-guide.html runs, in the order it used to list them as
// <script type="module"> tags. Bundled into dist/install-guide.js by scripts/build-bundles.mjs.
import { runInOrder } from './run-in-order.js';

runInOrder([
  () => import('../install-guide.js'),
]);
