// load-pastries.mjs — executes the REAL Pastries modules under node, with three imports pointed at
// stand-ins: the Firestore data layer (firebase-pastries-stub.mjs), the weekday strip and the
// confirm dialog (both need more of a browser than the small fake DOM offers, and neither is what
// these tests are about). A synchronous resolve hook (node:module registerHooks) does it, the same
// way tests/helpers/load-draft.mjs swaps the Orders data layer.
//
// Every load is a CASE with a fresh module graph: the stores and the page keep module state, so the
// case name rides on every import inside js/ as `?case=<name>`, and the stand-ins get the same tag —
// a test reaches the very stub its page is talking to by loading it with the same case.

import { registerHooks } from 'node:module';

const JS_ROOT = new URL('../../js/', import.meta.url).href;
const PASTRIES_DIR = new URL('../../js/pastries/', import.meta.url).href;
const STAND_INS = {
  './firebase-pastries.js': new URL('./firebase-pastries-stub.mjs', import.meta.url).href,
  './pastries-strip.js': new URL('./pastries-strip-stub.mjs', import.meta.url).href,
  './confirm-dialog.js': new URL('./pastries-dialog-stub.mjs', import.meta.url).href,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || '';
    const at = parent.indexOf('?case=');
    if (at < 0 || !parent.startsWith(JS_ROOT)) return nextResolve(specifier, context);
    const tag = parent.slice(at);
    if (parent.startsWith(PASTRIES_DIR) && STAND_INS[specifier]) {
      return { url: STAND_INS[specifier] + tag, shortCircuit: true };
    }
    if (!specifier.startsWith('.')) return nextResolve(specifier, context);
    const resolved = nextResolve(specifier, context);
    return { ...resolved, url: resolved.url.split('?')[0] + tag };
  },
});

// The stand-ins of one case, created before the page so a test can set them up first.
export async function standIns(name) {
  const tag = `?case=${encodeURIComponent(name)}`;
  return {
    fs: await import(STAND_INS['./firebase-pastries.js'] + tag),
    dialog: await import(STAND_INS['./confirm-dialog.js'] + tag),
  };
}

// A module of js/pastries/ (e.g. 'pastries-store.js') in the case's own graph.
export async function loadPastries(file, name) {
  return import(`${PASTRIES_DIR}${file}?case=${encodeURIComponent(name)}`);
}
