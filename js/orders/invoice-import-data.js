// invoice-import-data.js — the database half of «Import from invoices».
//
// The model (invoice-import-model.js) decides WHAT would be written; invoice-import-plan.js turns it into
// documents; this file only reads and writes them. Same Firebase app, same session and the same rules as
// every form: nothing here can do what the signed-in person could not do by hand.
//
// ⚠️ THE IMPORT NEEDS THE NETWORK. With the offline cache a write is «saved» at once and sent later, so a
// bulk import would sit half-queued behind a screen that looks finished. So every read here comes from the
// SERVER (getDocsFromServer / getDocFromServer reject offline, getDocs would answer from the cache and the
// «fresh» check would be a lie), and every write is refused before it starts when the phone says it is offline.
// ⚠️ AND A COMMIT THAT NEVER ANSWERS IS A STOP, NOT A HANG: a connection that says it is up and carries
// nothing leaves commit() pending for ever; after IMPORT_COMMIT_TIMEOUT_MS it throws code 'timeout'.

import { sessionReady } from '../firebase.js';
import { currentLocationId, pathFor } from '../location.js';
import { saveSupplierRecord } from '../record-data.js';
import { db } from './firebase-orders.js';
import { planBatchWrites, pointsOfDocs } from './invoice-import-plan.js';
import { planDecisionBatches } from './invoice-zip/selection.js';
import {
  collection,
  doc,
  getDocsFromServer,
  getDocFromServer,
  writeBatch,
  query,
  where,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const SUPPLIERS = 'suppliers';
const INGREDIENTS = 'ingredients';
const INGREDIENT_PRICES = 'ingredient-prices';
const PRICES = 'prices';
const PRICE_CHANGES = 'price-changes';
const DECISIONS = 'invoice-decisions';

export const IMPORT_COMMIT_TIMEOUT_MS = 30000;

// An Error whose `code` the screen reads (stopKind in invoice-import-plan.js).
function importError(code) {
  // The message is the code: nobody reads it (the screen words each code), and it stays out of the dictionary.
  const err = new Error(`invoice-import:${code}`);
  err.code = code;
  return err;
}

export function refuseOffline() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw importError('offline');
  }
}

// ── Suppliers ────────────────────────────────────────────────────────────────────

// A new supplier from the file → its id. The one form-shaped write (saveSupplierRecord mints the id and
// stamps the venue), so the card and the import can never disagree about what a supplier looks like.
// ⚠️ EVERY WRITE HERE IS BOUNDED BY THE SAME TIMEOUT AS A BATCH: a connection that says it is up and carries
// nothing leaves setDoc pending for ever, and the step would never end.
export async function createImportedSupplier(data) {
  refuseOffline();
  return withTimeout(saveSupplierRecord(null, data));
}

// ⚠️ THE ONLY FIELD EVER WRITTEN ONTO A SUPPLIER THAT ALREADY EXISTS. A merge: name, phone, days stay.
export async function linkSupplierVat(supplierId, vatNumber) {
  refuseOffline();
  return withTimeout(saveSupplierRecord(supplierId, { vatNumber }));
}

// The venue's suppliers, read from the server NOW — what the owner confirmed on step 2 may be minutes old,
// and another phone may have added the same supplier since.
export async function freshSuppliers() {
  await sessionReady;
  const snap = await withTimeout(getDocsFromServer(collection(db, pathFor(SUPPLIERS))));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Fresh reads, right before a row is written ───────────────────────────────────

// The venue's ingredients of one supplier, read from the server NOW: the catalogue may have changed (this
// import's own earlier rows, another phone) since the plan was drawn.
export async function freshIngredientsForSupplier(supplierId) {
  await sessionReady;
  const snap = await getDocsFromServer(query(
    collection(db, pathFor(INGREDIENTS)),
    where('supplierId', '==', supplierId),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// The ids of the history points that already came from an invoice, for one ingredient — what makes a
// second import of the same file plan nothing. Single-field equality: no composite index.
// ⚠️ The Set also carries `.points` — the same documents read as { invoiceId, line, invoiceDate, pricePerUnit,
// priceUnit } — so the price changes need no second read of the folder.
export async function invoicePointIds(ingredientId) {
  await sessionReady;
  const ref = doc(collection(db, pathFor(INGREDIENTS)), ingredientId);
  const snap = await getDocsFromServer(query(collection(ref, PRICES), where('source', '==', 'invoice')));
  const ids = new Set(snap.docs.map(d => d.id));
  ids.points = pointsOfDocs(snap.docs.map(d => ({ id: d.id, data: d.data() })));
  return ids;
}

// The price changes already stored for one ingredient (server read, refused offline like the rest) →
// [{ id, oldPrice, newPrice, oldDate, date, priceUnit }]: the fields too, because an invoice that arrives out of
// order makes a stored change wrong, and the plan has to see that to remove it.
export async function storedPriceChangeIds(ingredientId) {
  refuseOffline();
  await sessionReady;
  const snap = await withTimeout(getDocsFromServer(query(
    collection(db, pathFor(PRICE_CHANGES)),
    where('ingredientId', '==', ingredientId),
  )));
  return snap.docs.map((d) => {
    const { oldPrice, newPrice, oldDate, date, priceUnit } = d.data();
    return { id: d.id, oldPrice, newPrice, oldDate, date, priceUnit };
  });
}

// The ingredient's price document, or null when it has none. From the server, and it THROWS when it
// cannot be read (null means «no price»).
export async function freshPrice(ingredientId) {
  await sessionReady;
  const snap = await getDocFromServer(doc(collection(db, pathFor(INGREDIENT_PRICES)), ingredientId));
  return snap.exists() ? snap.data() : null;
}

// ── Writing one row ──────────────────────────────────────────────────────────────

export function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(importError('timeout')), IMPORT_COMMIT_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ingredientWrites() batches of ONE row → committed in order, one writeBatch each. A NEW ingredient's id is
// minted here (doc() on a collection writes nothing) and filled into the later ops by planBatchWrites.
// Returns the ingredient's id. Any failure throws with the Firestore `code` untouched.
export async function runImportBatches(batches) {
  refuseOffline();
  await sessionReady;
  const ingredients = collection(db, pathFor(INGREDIENTS));
  const { batches: steps, ingredientId } = planBatchWrites(batches, {
    mintId: () => doc(ingredients).id,
    bakery: currentLocationId(),
  });
  for (const step of steps) {
    refuseOffline();
    const batch = writeBatch(db);
    step.forEach(({ path, data, merge, remove }) => {
      const ref = doc(db, pathFor(path[0]), ...path.slice(1));
      if (remove) batch.delete(ref);
      else if (merge) batch.set(ref, data, { merge: true });
      else batch.set(ref, data);
    });
    await withTimeout(batch.commit());
  }
  return ingredientId;
}

// ── What the owner decided about invoice products and suppliers ───────────────────

// The venue's remembered decisions, read from the SERVER (a cache answer would hide a decision made on another
// phone), refused offline like every read of this import. → [{ id, decision, label, updatedAt, … }]
export async function loadInvoiceDecisions() {
  refuseOffline();
  await sessionReady;
  const snap = await withTimeout(getDocsFromServer(collection(db, pathFor(DECISIONS))));
  return snap.docs.map(d => ({ ...d.data(), id: d.id }));
}

// changes = decisionChanges() of invoice-zip/selection.js → how many documents were written or deleted.
// Small batches (at most 20 operations), each bounded by the same timeout as a row. The ids are SHA-256 hex of the
// decision key; the data is exactly what the rules accept.
export async function writeInvoiceDecisions(changes) {
  refuseOffline();
  await sessionReady;
  const batches = planDecisionBatches(changes, { bakery: currentLocationId(), nowIso: new Date().toISOString() });
  const folder = collection(db, pathFor(DECISIONS));
  let count = 0;
  for (const ops of batches) {
    refuseOffline();
    const batch = writeBatch(db);
    ops.forEach((op) => {
      const ref = doc(folder, op.id);
      if (op.type === 'set') batch.set(ref, op.data, { merge: true });
      else batch.delete(ref);
    });
    await withTimeout(batch.commit());
    count += ops.length;
  }
  return count;
}
