// A stand-in for js/orders/firebase-orders.js, so draft.js can run in node: every write is
// RECORDED instead of sent. Wired in by tests/helpers/load-draft.mjs (a resolve hook) — the
// real module imports Firebase from a CDN URL, which node cannot load.

export const calls = { saveDoc: [], clearFields: [], patchDoc: [], transactDoc: [] };
export const COLLECTIONS = { drafts: 'drafts', history: 'orders-history' };

export function reset() {
  Object.keys(calls).forEach(k => { calls[k].length = 0; });
}

export async function saveDoc(name, id, data) { calls.saveDoc.push({ name, id, data }); return data; }
export async function patchDoc(name, id, data) { calls.patchDoc.push({ name, id, data }); }
export async function clearFields(name, id, paths, patch = {}) {
  calls.clearFields.push({ name, id, paths: [...paths], patch });
}
export async function transactDoc(name, id, updater) { calls.transactDoc.push({ name, id, updater }); return null; }
export function watchDoc() { return () => {}; }
export async function replaceDoc() {}
export async function removeDoc() {}
