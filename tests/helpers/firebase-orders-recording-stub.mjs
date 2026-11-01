// A stand-in for js/orders/firebase-orders.js, so draft.js can run in node: every write is
// RECORDED instead of sent. Wired in by tests/helpers/load-draft.mjs (a resolve hook) — the
// real module imports Firebase from a CDN URL, which node cannot load.
//
// Two controls for the two-phone tests (tests/draft-claims.test.mjs): `emit(doc)` plays a
// snapshot of drafts/current to the page's listener, and `holdSaves()` keeps every later
// saveDoc in the air until the test settles it — `held` lists them, each with its own
// resolve/reject, as the server's answer would arrive.

export const calls = { saveDoc: [], clearFields: [], patchDoc: [], transactDoc: [] };
export const COLLECTIONS = { drafts: 'drafts', history: 'orders-history' };
export const held = [];

let watcher = null;
let holding = false;

export function reset() {
  Object.keys(calls).forEach(k => { calls[k].length = 0; });
  held.length = 0;
  holding = false;
}

export function holdSaves() { holding = true; }

export function emit(doc) { watcher?.(doc); }

export async function saveDoc(name, id, data) {
  calls.saveDoc.push({ name, id, data });
  if (!holding) return data;
  return new Promise((resolve, reject) => { held.push({ data, resolve: () => resolve(data), reject }); });
}
export async function patchDoc(name, id, data) { calls.patchDoc.push({ name, id, data }); }
export async function clearFields(name, id, paths, patch = {}) {
  calls.clearFields.push({ name, id, paths: [...paths], patch });
}
export async function transactDoc(name, id, updater) { calls.transactDoc.push({ name, id, updater }); return null; }
export function watchDoc(name, id, onChange) { watcher = onChange; return () => { watcher = null; }; }
// draft.js reads the draft once in some paths (PR #254's freezeUnitInDraft): nothing stored here.
export async function getDocOnce() { return null; }
export async function replaceDoc() {}
export async function removeDoc() {}
