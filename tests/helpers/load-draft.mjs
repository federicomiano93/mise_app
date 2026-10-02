// Loads js/orders/draft.js with its data layer replaced by tests/helpers/firebase-orders-stub.mjs.
// A synchronous resolve hook (node:module registerHooks) points ONE import at the stub; nothing
// else about draft.js is touched, so the real merge/clear logic is what runs.

import { registerHooks } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const stubUrl = new URL('./firebase-orders-stub.mjs', import.meta.url).href;
const draftHref = pathToFileURL(fileURLToPath(new URL('../../js/orders/draft.js', import.meta.url))).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './firebase-orders.js' && context.parentURL === draftHref) {
      return { url: stubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

export const draft = await import('../../js/orders/draft.js');
export const stub = await import('./firebase-orders-stub.mjs');
