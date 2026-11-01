// product-usage.js — does a Food cost product use this ingredient? For the owner of the kitchen.
//
// Merging two ingredients deletes one of them, and a product still naming it would lose that
// line of its cost without anybody being told. js/orders/ingredient-merge-data.js therefore
// reads every product first. The owner of the kitchen runs the merge and may not read products,
// because they also hold selling prices and margins. The rules cannot hide a field, so the
// question is asked here and the answer carries the NAMES and nothing else.
//
// ⚠️ ONLY THE KITCHEN. Everybody else who merges reads the products directly, as before, so no
// other role depends on this call.
//
// ⚠️ IT READS THE WHOLE COLLECTION, once per check (P14). A merge is rare and the app already
// reads the same documents for every other role.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { productNamesUsing } from './product-usage-model.js';

// The same shape requireOwner() accepts: an id that could never name a real folder is refused
// before it reaches a path.
const LOCATION_ID = /^[A-Za-z0-9_-]{1,128}$/;

export const productsUsingIngredient = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { locationId, ingredientId } = request.data || {};
  if (typeof locationId !== 'string' || !LOCATION_ID.test(locationId)) {
    throw new HttpsError('invalid-argument', 'That is not a location.');
  }
  if (typeof ingredientId !== 'string' || !ingredientId) {
    throw new HttpsError('invalid-argument', 'That is not an ingredient.');
  }
  const db = getFirestore();
  const user = await db.doc(`users/${uid}`).get();
  const access = user.exists ? (user.data().locations || {})[locationId] : undefined;
  if (access !== 'owner-kitchen') {
    throw new HttpsError('permission-denied', 'Only for the owner of the kitchen.');
  }
  const products = await db.collection(`locations/${locationId}/products`).get();
  return { names: productNamesUsing(ingredientId, products.docs.map(d => d.data())) };
});
