// ingredient-merge-data.js — the database half of «Unisci un'altra confezione…».
//
// ingredient-merge.js decides WHAT happens; this file only reads and writes, through the same Firebase app, the
// same session and the same rules as every form (so nothing here can do what the signed-in person could not).
//
// ⚠️ IT NEEDS THE NETWORK, like the invoice import: with the offline cache a write is «saved» at once and sent
// later, and a merge half-queued behind a screen that looks finished would be worse than no merge. So every read
// comes from the SERVER (it rejects offline instead of answering from the cache — a stale «B is free» would let a
// used ingredient be deleted) and every write is refused up front when the phone says it is offline.
//
// ⚠️ THE WRITE WORKS ON FRESH DATA. The screen's copies of A and B are minutes old; mergeIngredients reads both
// again from the server, stops if either is gone, plans from the FRESH A (its codes may have changed under the
// owner's finger) and checks where B is used ONCE MORE, right before the first write.

import { sessionReady } from '../firebase.js';
import { currentLocationId, pathFor } from '../location.js';
import { deleteIngredientWithPrice } from '../record-data.js';
import { db } from './firebase-orders.js';
import { refuseOffline, withTimeout } from './invoice-import-data.js';
import { dropDeletedIngredientFromDraft } from './draft.js';
import { findUsage, monthKeyOf, previousMonthKeyOf, planMerge, deletionBatches } from './ingredient-merge.js';
import {
  collection, doc, getDocsFromServer, getDocFromServer, writeBatch, query, where,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const INGREDIENTS = 'ingredients';
const INGREDIENT_PRICES = 'ingredient-prices';
const PRICES = 'prices';
const PRICE_CHANGES = 'price-changes';
const PRODUCTS = 'products';
const RECIPES = 'recipes';
const INVENTORY = 'inventory';
const DRAFTS = 'drafts';
const CURRENT_DRAFT = 'current';
const ORDER_REQUESTS = 'order-requests';

const docsOf = (snap) => snap.docs.map(d => ({ id: d.id, ...d.data() }));

// Where ingredient B is still used → [{ kind, name?, month? }] (empty = free to merge). Every read comes from the
// server and the first failure REJECTS: «could not check» must never read as «not used». Both the current AND the
// previous month's stocktake are read (last month stays open until somebody closes it), and every order list
// (one not yet done that names B blocks).
export async function checkUsage(bId, nowMs = Date.now()) {
  refuseOffline();
  await sessionReady;
  const months = [monthKeyOf(nowMs), previousMonthKeyOf(nowMs)].filter(Boolean);
  const [products, recipes, draft, requests, ...inventories] = await Promise.all([
    withTimeout(getDocsFromServer(collection(db, pathFor(PRODUCTS)))),
    withTimeout(getDocsFromServer(collection(db, pathFor(RECIPES)))),
    withTimeout(getDocFromServer(doc(collection(db, pathFor(DRAFTS)), CURRENT_DRAFT))),
    withTimeout(getDocsFromServer(collection(db, pathFor(ORDER_REQUESTS)))),
    ...months.map(month => withTimeout(getDocFromServer(doc(collection(db, pathFor(INVENTORY)), month)))),
  ]);
  return findUsage(bId, {
    products: docsOf(products),
    recipes: docsOf(recipes),
    inventories: months.map((month, i) => ({ month, data: inventories[i] && inventories[i].exists() ? inventories[i].data() : null })),
    draft: draft.exists() ? draft.data() : null,
    requests: docsOf(requests),
  });
}

function ingredientRef(id) {
  return doc(collection(db, pathFor(INGREDIENTS)), id);
}

// A stored ingredient as the server holds it NOW, or null when it is gone.
async function freshIngredient(id) {
  const snap = await withTimeout(getDocFromServer(ingredientRef(id)));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// What the merge reads before planning: B's whole price history, the ids A already holds, both current prices
// and the ids of B's price changes.
async function readInputs(aId, bId) {
  const [bPoints, aPoints, aPrice, bPrice, changes] = await Promise.all([
    withTimeout(getDocsFromServer(collection(ingredientRef(bId), PRICES))),
    withTimeout(getDocsFromServer(collection(ingredientRef(aId), PRICES))),
    withTimeout(getDocFromServer(doc(collection(db, pathFor(INGREDIENT_PRICES)), aId))),
    withTimeout(getDocFromServer(doc(collection(db, pathFor(INGREDIENT_PRICES)), bId))),
    withTimeout(getDocsFromServer(query(collection(db, pathFor(PRICE_CHANGES)), where('ingredientId', '==', bId)))),
  ]);
  return {
    bPoints: bPoints.docs.map(d => ({ id: d.id, data: d.data() })),
    aPointIds: new Set(aPoints.docs.map(d => d.id)),
    aPrice: aPrice.exists() ? aPrice.data() : null,
    bPrice: bPrice.exists() ? bPrice.data() : null,
    changeIds: changes.docs.map(d => d.id),
  };
}

// An error that stops the merge BEFORE anything is written, with the reason the screen words:
//   err.mergeStop === 'gone' — A or B no longer exists;  'used' — B is used somewhere (err.used = the list).
function stopped(kind, extra = {}) {
  const err = new Error(`merge-stopped-before-writing:${kind}`);
  err.mergeStop = kind;
  return Object.assign(err, extra);
}

// Merge B into A: a, b = the ingredients the person tapped (only their ids are trusted).
// → { prices, codes, droppedCodes }. Any failure throws with the Firestore `code` untouched and `mergeCommitted`
// set to whether at least one batch already landed; every step before it is safe to leave: running it again
// finishes the job (see ingredient-merge.js).
export async function mergeIngredients(a, b) {
  refuseOffline();
  await sessionReady;
  let committed = false;
  try {
    const [freshA, freshB] = await Promise.all([freshIngredient(a.id), freshIngredient(b.id)]);
    if (!freshA || !freshB) throw stopped('gone');
    const input = await readInputs(freshA.id, freshB.id);
    const plan = planMerge({ a: freshA, b: freshB, ...input });
    const used = await checkUsage(freshB.id);
    if (used.length > 0) throw stopped('used', { used });
    const bakery = currentLocationId();

    for (const step of plan.batches) {
      refuseOffline();
      const batch = writeBatch(db);
      step.forEach(({ path, data, merge }) => {
        const ref = doc(db, pathFor(path[0]), ...path.slice(1));
        if (merge) batch.set(ref, { ...data, bakery }, { merge: true });
        else batch.set(ref, { ...data, bakery });
      });
      await withTimeout(batch.commit());
      committed = true;
    }

    // B's price changes go with B (A's own are recomputed by the next import).
    for (const ids of deletionBatches(input.changeIds)) {
      refuseOffline();
      const batch = writeBatch(db);
      ids.forEach(id => batch.delete(doc(collection(db, pathFor(PRICE_CHANGES)), id)));
      await withTimeout(batch.commit());
      committed = true;
    }

    // B itself, with its price document, LAST. Its history under it stays (the rules forbid deleting it), unreachable.
    refuseOffline();
    await withTimeout(deleteIngredientWithPrice(freshB.id, true));
    dropDeletedIngredientFromDraft(freshB.id);
    return plan.counts;
  } catch (err) {
    if (err && typeof err === 'object') err.mergeCommitted = committed;
    throw err;
  }
}

// The same planning without writing: what the confirmation quotes. Read from the server.
// → { counts, takeover, bLostPrice, hasChanges, bPrice, aPrice } (see planMerge).
export async function previewMerge(a, b) {
  refuseOffline();
  await sessionReady;
  const [freshA, freshB] = await Promise.all([freshIngredient(a.id), freshIngredient(b.id)]);
  if (!freshA || !freshB) throw stopped('gone');
  const input = await readInputs(freshA.id, freshB.id);
  const plan = planMerge({ a: freshA, b: freshB, ...input });
  return {
    counts: plan.counts, takeover: plan.takeover, bLostPrice: plan.bLostPrice, hasChanges: plan.hasChanges,
    aPrice: input.aPrice, bPrice: input.bPrice,
  };
}
