// Loads js/orders/draft.js with its data layer replaced by tests/helpers/firebase-orders-recording-stub.mjs.
// A synchronous resolve hook (node:module registerHooks) points ONE import at the stub; nothing
// else about draft.js is touched, so the real merge/clear logic is what runs.

import { registerHooks } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const stubUrl = new URL('./firebase-orders-recording-stub.mjs', import.meta.url).href;
const draftHref = pathToFileURL(fileURLToPath(new URL('../../js/orders/draft.js', import.meta.url))).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './firebase-orders.js' && context.parentURL?.startsWith(draftHref)) {
      return { url: stubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

export const draft = await import('../../js/orders/draft.js');
export const stub = await import('./firebase-orders-recording-stub.mjs');

// A new copy of draft.js with nothing in memory, as after a reload; the data layer stays the same stub.
let copies = 0;
export function reopenDraft() {
  copies += 1;
  return import(`${draftHref}?reopened=${copies}`);
}
