// firebase-foodcost.js — Firestore data layer for the Food Cost screen.
//
// Reuses the Firebase app and the SESSION established by js/firebase.js (the one
// sanctioned cross-file bridge), so this page shares the signed-in account, the
// open location, the localhost emulator switch and App Check.
//
// Collections, all under the current location's folder (js/location.js):
//   locations/{lid}/products/{id}                — a finished product
//   locations/{lid}/products/{id}/snapshots/{id} — append-only margin history
//
// It also READS two collections it does not own: `recipes` (the catalogue's, to
// cost the components) and `ingredients` (Orders', for packaging). That is a
// shared COLLECTION, not a shared module.
// ⚠️ AND SINCE 13 SEP 2026 IT WRITES THREE FIELDS OF A RECIPE: the oven loss, weighed on
// a product's recipe line (saveRecipeLoss below). Nothing else of a recipe is ever
// written from here. The only modules this feature takes from js/catalogue/ are the
// pure MODELS — recipe-cost-model.js and catalogue-model.js — never a screen or a
// data layer, so it stays liftable.

import { firebaseConfig, sessionReady, currentSession } from '../firebase.js';
import { currentLocationId, pathFor } from '../location.js';
import { withPrices } from '../price-model.js';
import { countryOf } from '../market.js';
import {
  getApps,
  getApp,
  initializeApp,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  query,
  orderBy,
  limit,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);

const PRODUCTS = 'products';
const SNAPSHOTS = 'snapshots';
const RECIPES = 'recipes';
const INGREDIENTS = 'ingredients';
// What each ingredient COSTS. A separate collection, because Orders must read
// every ingredient to work at all — see js/price-model.js and firestore.rules.
const INGREDIENT_PRICES = 'ingredient-prices';

export const authReady = sessionReady;

function withBakery(data) {
  return { ...data, bakery: currentLocationId() };
}

// A new client-side document id (no write), so a brand-new product can be shown
// locally before the network write — instantly, and offline.
export function newProductId() {
  return doc(collection(db, pathFor(PRODUCTS))).id;
}

function watch(name, onChange, onError, quiet) {
  return async () => {
    await authReady;
    return onSnapshot(
      collection(db, pathFor(name)),
      snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      err => {
        if (quiet) console.warn(`watch(${name}) failed:`, err);
        else console.error(`watch(${name}) failed:`, err);
        if (onError) onError(err);
      },
    );
  };
}

export const watchProducts = (onChange, onError) => watch(PRODUCTS, onChange, onError, false)();
// The two borrowed collections fail QUIETLY: they belong to other sections, a
// venue may not use them, and the worst outcome is a product that reads as
// unpriced — which is exactly what the screen says anyway when nothing is linked.
export const watchRecipes = (onChange, onError) => watch(RECIPES, onChange, onError, true)();
// ⚠️ TWO COLLECTIONS, ONE ANSWER. The price moved off the ingredient document
// (js/price-model.js says why), so what this screen needs is the two merged.
// Food Cost is manager-only, so both halves normally succeed here — but the price
// half still fails QUIETLY, because a venue that does not use Food Cost has no
// such collection and an unpriced ingredient is something every screen here
// already knows how to say.
//
// ⚠️ NOTHING IS EMITTED UNTIL THE INGREDIENTS HAVE ARRIVED. The prices snapshot
// can land first, and emitting then would paint an empty list for a frame — the
// same shape as the bug where every ingredient flashed as an orphan before the
// suppliers arrived.
export const watchIngredients = async (onChange, onError) => {
  await authReady;
  let ingredients = null;
  let prices = {};
  const emit = () => { if (ingredients) onChange(withPrices(ingredients, prices)); };

  const stopIngredients = onSnapshot(
    collection(db, pathFor(INGREDIENTS)),
    snap => { ingredients = snap.docs.map(d => ({ id: d.id, ...d.data() })); emit(); },
    err => { console.warn('watchIngredients failed:', err); if (onError) onError(err); },
  );
  const stopPrices = onSnapshot(
    collection(db, pathFor(INGREDIENT_PRICES)),
    snap => { prices = {}; snap.forEach(d => { prices[d.id] = d.data(); }); emit(); },
    () => { prices = {}; emit(); },
  );
  return () => { stopIngredients(); stopPrices(); };
};

// Save a product and, when the change is worth recording, append its margin —
// as ONE atomic write.
//
// ⚠️ THE BATCH IS THE POINT, exactly as it is for an ingredient's price. Done as
// two writes the second can fail alone, leaving a product whose margin history has
// no record of the change that was just made — the one question the history exists
// to answer. Either both land or neither does.
export async function saveProductWithSnapshot(id, data, snapshot) {
  await authReady;
  const products = collection(db, pathFor(PRODUCTS));
  const ref = id ? doc(products, id) : doc(products);

  const batch = writeBatch(db);
  // WHOLE, not merged: the editor has already computed the exact document, and a
  // merge would leave a component removed from the list alive in Firestore.
  batch.set(ref, withBakery(data));
  if (snapshot) batch.set(doc(collection(ref, SNAPSHOTS)), withBakery(snapshot));
  await batch.commit();
  return ref.id;
}

// The oven loss a person weighed on a product's recipe line, written onto the RECIPE —
// which is where it has always lived, and where the cost model and the label read it.
//
// ⚠️ THREE FIELDS, NEVER THE WHOLE RECIPE. This screen does not own the recipe: its
// name, rows and steps are the catalogue's, and a whole write from a copy read minutes
// ago would put back whatever the catalogue changed since.
// ⚠️ updateDoc, NOT setDoc: a recipe deleted meanwhile must fail, not be re-created as
// a nameless document.
// ⚠️ `bakery` TRAVELS WITH IT because the rules judge the MERGED document and ask it to
// name this location — the same stamp the catalogue sends on every save of a recipe.
export async function saveRecipeLoss(id, patch) {
  await authReady;
  return updateDoc(doc(db, pathFor(RECIPES), id), withBakery({
    lossPct: patch.lossPct,
    rawGrams: patch.rawGrams,
    cookedGrams: patch.cookedGrams,
  }));
}

// Whether this session may write a recipe at all.
//
// ⚠️ UX ONLY (P2): the rules decide. It exists because a venue can have Food cost ON and
// the catalogue OFF — then its recipes are readable here (the rules let Food cost read
// them) but not writable (writing is the catalogue's), and two weighing boxes whose
// Save is always refused would still record a margin point for a loss that never
// landed. Same default as the rules: a section nobody switched off is on.
export function canWriteRecipes() {
  return currentSession().sections?.catalogue === true;
}

// The country the open venue sells in — which decides the VAT choices a product offers.
// null for a country the app does not know; foodcost-model.js vatRatesFor() decides
// what that means.
export function venueCountry() {
  return countryOf(currentSession().location);
}

export async function removeProduct(id) {
  await authReady;
  return deleteDoc(doc(db, pathFor(PRODUCTS), id));
}

// A product's margin over time, newest first. Read ON DEMAND — only when someone
// opens the history — never watched, so a series that grows for years costs
// nothing on the screens that do not ask for it (P14).
//
// ⚠️ ORDERED BY THE recordedAt FIELD, never by document id: Firestore refuses a
// descending scan by key, a trap this project has lost a release to twice.
export async function getProductHistory(productId, max = 30) {
  await authReady;
  const ref = doc(collection(db, pathFor(PRODUCTS)), productId);
  const snap = await getDocs(query(
    collection(ref, SNAPSHOTS),
    orderBy('recordedAt', 'desc'),
    limit(max),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Whether this session may take things away in this location.
//
// ⚠️ UX ONLY (P2). The rules decide, and they read users/{uid} themselves rather
// than trusting anything this page says. This exists so a screen does not draw a
// button the database is going to refuse — a control that fails on tap teaches
// people the app is broken, not that they lack the permission.
// ⚠️ canManage, NOT isOwner — the manager runs the place. Reading isOwner here
// would take every bin away from every manager, and the database would have
// allowed the delete: the screen would be lying about what is possible.
export function canManageHere() {
  return currentSession().canManage === true;
}

// ── What an hour of work costs this venue (13 Sep 2026) ──────────────────────
//
// Federico: «potremmo anche mettere una sezione dove io metto il costo del lavoro orario
// e l'app mi dice quanto è il costo del lavoro per quella ricetta», and, asked who may
// see it: ONLY whoever runs the place — it is a wage figure.
//
// ⚠️ ITS OWN DOCUMENT, locations/{lid}/foodcost-settings/main, readable and writable only
// by canManage(lid, 'foodcost'). Not config/* (every member reads config) and not the
// location document (every member reads that too, and only a Cloud Function writes it).
const SETTINGS = 'foodcost-settings';
const SETTINGS_DOC = 'main';

// Watched ONLY for whoever may read it — an employee's listener would be refused, and a
// refused listener is noise in the console and a wasted read. Resolves an unsubscribe.
export async function watchFoodcostSettings(onChange) {
  await authReady;
  return onSnapshot(
    doc(db, pathFor(SETTINGS), SETTINGS_DOC),
    snap => onChange(snap.exists() ? snap.data() : null),
    err => { console.warn('watchFoodcostSettings failed:', err); onChange(null); },
  );
}

// The hourly labour cost, or null to clear it. A MERGE with the stamp, so a field added
// to this document later is never wiped by an older screen saving the rate.
export async function saveLabourCostPerHour(rate) {
  await authReady;
  return setDoc(doc(db, pathFor(SETTINGS), SETTINGS_DOC), withBakery({
    labourCostPerHour: rate,
    updatedAt: new Date().toISOString(),
  }), { merge: true });
}
