// record-data.js — the writes behind the two RECORD cards: an ingredient (with its price)
// and a supplier. SHARED since 13 Sep 2026.
//
// They lived in js/orders/firebase-orders.js. The ingredient card is now also opened from the
// Catalogue — a recipe row's missing ingredient is added with the same card «Fornitori e
// ingredienti» uses — and a feature may not import another feature's folder. So the two
// writes, and the one rule of who may write a price, came to js/ root; firebase-orders.js
// re-exports them, so Orders calls exactly what it called before.
//
// Same Firebase app and same Firestore instance as every feature's data layer: getFirestore()
// on the default app returns the one js/firebase.js started, offline cache included.

import { firebaseConfig, sessionReady, currentSession } from './firebase.js';
import { currentLocationId, pathFor } from './location.js';
import { splitPriceFields } from './price-model.js';
import {
  getApps,
  getApp,
  initializeApp,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);

// The collections, by the names the rules know them by.
const INGREDIENTS = 'ingredients';
const INGREDIENT_PRICES = 'ingredient-prices';
const SUPPLIERS = 'suppliers';
// The append-only history under each ingredient. A SUBCOLLECTION: pathFor() builds a
// location's top-level collections and refuses a name containing a slash, so its path is
// composed from the ingredient's own reference.
const PRICES = 'prices';

// Every document carries the location id in `bakery`, matching the folder it sits in —
// the rules check exactly that.
function withBakery(data) {
  return { ...data, bakery: currentLocationId() };
}

// Whether this session may WRITE what an ingredient costs.
//
// ⚠️ NOT canManage ALONE, AND THE DIFFERENCE REFUSED EVERY SAVE. The rules grant
// ingredient-prices to canManage(lid, 'foodcost') — the role AND the Food cost section.
// An owner of a venue with Food cost switched off passed the role check, so the form
// drew the price and saveIngredientWithPrice() put a price write in the batch; the
// database refused that write, and a batch is all-or-nothing, so adding or renaming
// ANY ingredient there failed with «check your network». Found 13 Sep 2026 driving
// the registry as the owner of such a venue.
// `sections` is the session's, already narrowed by the location AND the role
// (js/sections.js sectionsFor), so a missing key reads the same way the rules do.
export function mayWritePrices() {
  const session = currentSession();
  return session.canManage === true && session.sections?.foodcost === true;
}

// Save an ingredient and, when its price actually changed, record that price —
// as ONE atomic write.
//
// ⚠️ THE BATCH IS THE POINT. These are documents in different places, and done as
// separate writes one can fail on its own: the ingredient would then carry a price that
// the history has no record of, which is precisely the question the history exists to
// answer. Either all land or none does.
//
// `priceRecord` is null when nothing about the price moved — re-saving an ingredient to
// fix a typo in its name must not plant a second identical entry, or the history fills
// with non-events and "when did this go up?" stops being answerable.
//
// A new ingredient gets its id here rather than from addDoc(): doc() on a collection
// mints an id WITHOUT writing anything, which is what lets a brand-new ingredient and its
// first price go in the same batch. Returns the id either way.
// ⚠️ AND THE PRICE IS A THIRD DOCUMENT, IN ITS OWN COLLECTION. splitPriceFields separates
// the two halves; the ingredient keeps the price KEYS set to null so old documents drain,
// and the rate itself goes beside it where an employee cannot read it.
//
// ⚠️ `writePrice` IS FALSE FOR SOMEBODY WHO MAY NOT SEE MONEY, AND THAT IS NOT AN
// OPTIMISATION. A batch is all-or-nothing: including a write to ingredient-prices for an
// employee would have the DATABASE refuse the whole batch, so renaming an ingredient —
// ordinary work — would fail with a permission error and no explanation.
export async function saveIngredientWithPrice(id, data, priceRecord, writePrice = true) {
  await sessionReady;
  const ingredients = collection(db, pathFor(INGREDIENTS));
  const ref = id ? doc(ingredients, id) : doc(ingredients);
  const { ingredient, price } = splitPriceFields(data);

  const batch = writeBatch(db);
  batch.set(ref, withBakery(ingredient), { merge: true });
  if (writePrice) {
    const prices = collection(db, pathFor(INGREDIENT_PRICES));
    batch.set(doc(prices, ref.id), withBakery(price), { merge: true });
    if (priceRecord) batch.set(doc(collection(ref, PRICES)), withBakery(priceRecord));
  }
  await batch.commit();
  return ref.id;
}

// Save a supplier — a new one when `id` is null — and return its id.
//
// ⚠️ THE ID IS MINTED HERE, BEFORE THE WRITE, for the same reason as the ingredient's: the
// card that asked for a new supplier («+ Nuovo fornitore», inside an ingredient's card) has
// to select it the moment it is saved, and a MERGE keeps an edit from blanking any field a
// newer screen wrote that this form does not know about.
export async function saveSupplierRecord(id, data) {
  await sessionReady;
  const suppliers = collection(db, pathFor(SUPPLIERS));
  const ref = id ? doc(suppliers, id) : doc(suppliers);
  await setDoc(ref, withBakery(data), { merge: true });
  return ref.id;
}
