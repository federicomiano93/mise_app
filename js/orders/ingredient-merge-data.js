// ingredient-merge-data.js — the database half of «Unisci un'altra confezione…».
//
// ingredient-merge.js decides WHAT happens; this file only reads and writes, through the same Firebase app, the
// same session and the same rules as every form (so nothing here can do what the signed-in person could not).
//
// ⚠️ IT NEEDS THE NETWORK, like the invoice import: with the offline cache a write is «saved» at once and sent
// later, and a merge half-queued behind a screen that looks finished would be worse than no merge. So every read
// comes from the SERVER (it rejects offline instead of answering from the cache — a stale «B is free» would let a
// used ingredient be deleted) and every write is refused up front when the phone says it is offline.

import { sessionReady } from '../firebase.js';
import { currentLocationId, pathFor } from '../location.js';
import { deleteIngredientWithPrice } from '../record-data.js';
import { db } from './firebase-orders.js';
import { refuseOffline, withTimeout } from './invoice-import-data.js';
import { dropDeletedIngredientFromDraft } from './draft.js';
import { findUsage, monthKeyOf, planMerge, deletionBatches } from './ingredient-merge.js';
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

const docsOf = (snap) => snap.docs.map(d => ({ id: d.id, ...d.data() }));

// Where ingredient B is still used → [{ kind, name?, month? }] (empty = free to merge). Every read comes from the
// server and the first failure REJECTS: «could not check» must never read as «not used».
export async function checkUsage(bId, nowMs = Date.now()) {
  refuseOffline();
  await sessionReady;
  const month = monthKeyOf(nowMs);
  const [products, recipes, inventory, draft] = await Promise.all([
    withTimeout(getDocsFromServer(collection(db, pathFor(PRODUCTS)))),
    withTimeout(getDocsFromServer(collection(db, pathFor(RECIPES)))),
    month ? withTimeout(getDocFromServer(doc(collection(db, pathFor(INVENTORY)), month))) : Promise.resolve(null),
    withTimeout(getDocFromServer(doc(collection(db, pathFor(DRAFTS)), CURRENT_DRAFT))),
  ]);
  return findUsage(bId, {
    products: docsOf(products),
    recipes: docsOf(recipes),
    inventory: inventory && inventory.exists() ? inventory.data() : null,
    month,
    draft: draft.exists() ? draft.data() : null,
  });
}

function ingredientRef(id) {
  return doc(collection(db, pathFor(INGREDIENTS)), id);
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

// Merge B into A: a = the stored ingredient that stays, b = the one that goes (both as the screen holds them).
// → { prices, codes, droppedCodes }. Any failure throws with the Firestore `code` untouched, and every step
// before it is safe to leave: running it again finishes the job (see ingredient-merge.js).
export async function mergeIngredients(a, b) {
  refuseOffline();
  await sessionReady;
  const input = await readInputs(a.id, b.id);
  const plan = planMerge({ a, b, ...input });
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
  }

  // B's price changes go with B (A's own are recomputed by the next import).
  for (const ids of deletionBatches(input.changeIds)) {
    refuseOffline();
    const batch = writeBatch(db);
    ids.forEach(id => batch.delete(doc(collection(db, pathFor(PRICE_CHANGES)), id)));
    await withTimeout(batch.commit());
  }

  // B itself, with its price document, LAST. Its history under it stays (the rules forbid deleting it), unreachable.
  refuseOffline();
  await withTimeout(deleteIngredientWithPrice(b.id, true));
  dropDeletedIngredientFromDraft(b.id);
  return plan.counts;
}

// The same planning without writing: what the confirmation quotes («N prezzi e M codici …»). Read from the server.
export async function previewMerge(a, b) {
  refuseOffline();
  await sessionReady;
  const input = await readInputs(a.id, b.id);
  return planMerge({ a, b, ...input }).counts;
}
