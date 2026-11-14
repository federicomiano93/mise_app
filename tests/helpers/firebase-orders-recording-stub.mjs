// A stand-in for js/orders/firebase-orders.js, so draft.js can run in node: every write is
// RECORDED instead of sent. Wired in by tests/helpers/load-draft.mjs (a resolve hook) — the
// real module imports Firebase from a CDN URL, which node cannot load.
//
// Two controls for the two-phone tests (tests/draft-claims.test.mjs): `emit(doc)` plays a
// snapshot of drafts/current to the page's listener, and `holdSaves()` keeps every later
// saveDoc in the air until the test settles it — `held` lists them, each with its own
// resolve/reject, as the server's answer would arrive. `answerFromServer(doc)` plays the server's
// first word on the document to whoever is waiting for it (tests/draft-journal.test.mjs).

export const calls = { saveDoc: [], clearFields: [], patchDoc: [], transactDoc: [], saveFields: [], clearFieldsIf: [] };
export const COLLECTIONS = { drafts: 'drafts', history: 'orders-history' };
export const held = [];

let watcher = null;
let serverWaiter = null;
let holding = false;

export function reset() {
  Object.keys(calls).forEach(k => { calls[k].length = 0; });
  held.length = 0;
  holding = false;
  holdingClears = false;
  serverWaiter = null;
  heldClears.length = 0;
  history.records = [];
  history.fail = false;
  history.reads = 0;
  server.draft = null;
}

export function holdSaves() { holding = true; }
export function letSavesThrough() { holding = false; }

export function emit(doc) { watcher?.(doc); }
export const waitingForServer = () => serverWaiter !== null;
export function answerFromServer(doc) {
  const waiter = serverWaiter;
  serverWaiter = null;
  waiter?.(doc);
}

export async function saveDoc(name, id, data) {
  calls.saveDoc.push({ name, id, data });
  if (!holding) return data;
  return new Promise((resolve, reject) => { held.push({ data, resolve: () => resolve(data), reject }); });
}
export async function patchDoc(name, id, data) { calls.patchDoc.push({ name, id, data }); }
export const heldClears = [];
let holdingClears = false;
export function holdClears() { holdingClears = true; }
export async function clearFields(name, id, paths, patch = {}) {
  calls.clearFields.push({ name, id, paths: [...paths], patch });
  if (holdingClears) await new Promise(resolve => { heldClears.push(resolve); });
}
export async function transactDoc(name, id, updater) { calls.transactDoc.push({ name, id, updater }); return null; }
export function watchDoc(name, id, onChange) { watcher = onChange; return () => { watcher = null; }; }
export function watchServerAnswer(name, id, onAnswer) { serverWaiter = onAnswer; return () => { serverWaiter = null; }; }
export const currentBakery = () => 'venue-a';
// The orders the server holds, as draft.js asks for them before a line comes back. `history.fail`
// makes the read refuse, as it does with no connection.
export const history = { records: [], fail: false, reads: 0 };
export async function getRecentHistoryFromServer() {
  history.reads += 1;
  if (history.fail) throw new Error('unavailable');
  return history.records;
}
// draft.js reads the draft once in some paths (PR #254's freezeUnitInDraft): nothing stored here.
export async function getDocOnce() { return null; }
export async function replaceDoc() {}
export async function removeDoc() {}

// The «did it go?» question (js/orders/awaiting-sent.js). `server.draft` is drafts/current as the
// server holds it, for the claim transaction: clearFieldsIf reads it, asks `decide`, and deletes
// the paths only when told to — two claims racing for one key behave as Firestore's would, one
// after the other, because each runs to the end before the next reads.
export const server = { draft: null };
export async function saveFields(name, id, data, fieldPaths) {
  calls.saveFields.push({ name, id, data, fieldPaths: [...fieldPaths] });
}
export async function clearFieldsIf(name, id, paths, decide) {
  calls.clearFieldsIf.push({ name, id, paths: [...paths] });
  const data = server.draft;
  if (!data || !decide(data)) return false;
  paths.forEach(path => {
    const parts = path.split('.');
    let at = data;
    for (const part of parts.slice(0, -1)) at = at?.[part];
    if (at) delete at[parts[parts.length - 1]];
  });
  return true;
}
