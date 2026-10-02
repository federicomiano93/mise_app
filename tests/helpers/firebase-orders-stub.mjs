// firebase-orders-stub.mjs — stands in for js/orders/firebase-orders.js when a test executes
// js/orders/draft.js: the real module loads the Firebase SDK from a CDN, which node cannot, and a
// unit test must never reach a database. The draft document lives in globalThis.__draftDoc and every
// write is recorded in globalThis.__draftWrites.
export const COLLECTIONS = { drafts: 'drafts', orderHistory: 'orders-history' };
export async function getDocOnce() { return globalThis.__draftDoc ?? null; }
export async function saveDoc(name, id, data) { globalThis.__draftWrites.push({ name, id, data }); }
// patchDoc arrives with PR #253 («Da riordinare»): draft.js imports it there, so the stub offers it too.
export async function patchDoc(name, id, data) { globalThis.__draftWrites.push({ name, id, data, patch: true }); }
export async function watchDoc() { return () => {}; }
export async function clearFields() {}
export async function transactDoc() {}
export async function replaceDoc() {}
export async function removeDoc() {}
