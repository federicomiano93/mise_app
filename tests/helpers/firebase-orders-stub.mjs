// firebase-orders-stub.mjs — stands in for js/orders/firebase-orders.js when a test executes
// js/orders/draft.js: the real module loads the Firebase SDK from a CDN, which node cannot, and a
// unit test must never reach a database. The draft document lives in globalThis.__draftDoc and every
// write is recorded in globalThis.__draftWrites.
export const COLLECTIONS = { drafts: 'drafts', orderHistory: 'orders-history' };
export async function getDocOnce() { return globalThis.__draftDoc ?? null; }
export async function saveDoc(name, id, data) { globalThis.__draftWrites.push({ name, id, data }); }
export async function watchDoc() { return () => {}; }
export async function clearFields() {}
export async function transactDoc() {}
export async function replaceDoc() {}
export async function removeDoc() {}
