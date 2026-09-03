// firebase-catalogue.js — Firestore data layer for the Recipe catalogue.
//
// Reuses the Firebase app and the SESSION established by js/firebase.js (the
// single sanctioned cross-file bridge), so the catalogue shares the one
// signed-in account, the one open location, and inherits the localhost
// emulator switch + App Check.
//
// Collection: locations/{location}/recipes/{id} — one document per recipe
// (scales to 500+). Every document carries the location id in `bakery`, which
// must match the folder it sits in (rules enforce it). js/location.js is the
// only place that knows the path.

import { firebaseConfig, sessionReady, currentSession } from '../firebase.js';
import { currentLocationId, pathFor } from '../location.js';
import { withPrices } from '../price-model.js';
import {
  getApps,
  getApp,
  initializeApp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  addDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Reuse the default app if firebase.js already created it; otherwise create it.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);

const RECIPES = 'recipes';
// Orders owns this collection and is the only place it is written; the catalogue
// READS it so a recipe row can be linked to a real ingredient and costed. The rules
// were widened to allow exactly that (canReadIngredients) and nothing more.
//
// This is a shared COLLECTION, not a shared module — js/catalogue/ still imports
// nothing from js/orders/, so the feature stays liftable.
const INGREDIENTS = 'ingredients';
// What each ingredient COSTS. A separate collection, because Orders must read
// every ingredient to work at all — see js/price-model.js and firestore.rules.
const INGREDIENT_PRICES = 'ingredient-prices';
const SUPPLIERS = 'suppliers';
const CONFIG = 'config';
const LABELS_DOC = 'labels';
const PRINT_JOBS = 'print-jobs';
const PRINT_AGENTS = 'print-agents';

// Resolves once a location is OPEN — not merely once someone is signed in.
// It no longer needs its own timeout: a sign-in that cannot complete is now a
// SCREEN (js/auth-gate.js shows why), not a promise that quietly never settles
// behind a spinner.
export const authReady = sessionReady;

// A new client-side document id (no write). Lets a brand-new recipe be shown
// locally BEFORE the network write, so saving works instantly and offline.
export function newRecipeId() {
  return doc(collection(db, pathFor(RECIPES))).id;
}

// Stamp the bakery id on a document payload (usageCount is local-only and never
// written here — it lives in localStorage per device).
function withBakery(data) {
  return { ...data, bakery: currentLocationId() };
}

// Subscribe to the whole recipes collection in real time. onChange receives an
// array of { id, ...data }. onError (optional) is called if the stream errors —
// note onSnapshot does NOT auto-resubscribe after an error, so the caller decides
// whether to warn the user. Returns the unsubscribe function. Attach this only
// when the catalogue page is open (not at app boot) to avoid an unbounded read.
export async function watchRecipes(onChange, onError) {
  await authReady;
  return onSnapshot(
    collection(db, pathFor(RECIPES)),
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => { console.error('watchRecipes failed:', err); if (onError) onError(err); },
  );
}

// Subscribe to the ingredient list in real time, so a price corrected in Orders
// shows up in an open recipe without a reload.
//
// COST (P14): one listener over ~65 documents, attached only while the catalogue
// page is open — the same discipline as watchRecipes above, and the reason neither
// is attached at app boot.
//
// A venue that does not use Orders still resolves this listener; the rules simply
// return nothing readable and the catalogue shows every row as unpriced, which is
// the honest answer for a venue that keeps no ingredient list.
// ⚠️ TWO COLLECTIONS, ONE ANSWER. The price moved off the ingredient document
// (js/price-model.js says why), so what this screen needs is the two merged.
//
// ⚠️ AND THE PRICE HALF FAILS QUIETLY, ON PURPOSE. An employee is refused that
// collection by the rules, and the refusal IS the feature working — not an error
// to report. Every screen here already knows what an unpriced ingredient looks
// like, because most ingredients have never had a price, so the result is "not
// priced yet" rather than a broken screen.
//
// ⚠️ NOTHING IS EMITTED UNTIL THE INGREDIENTS THEMSELVES HAVE ARRIVED. The prices
// snapshot can land first, and emitting then would paint an empty list for a
// frame — the same shape as the bug where every ingredient flashed as an orphan
// before the suppliers arrived.
export async function watchIngredients(onChange, onError) {
  await authReady;
  let ingredients = null;
  let prices = {};
  const emit = () => { if (ingredients) onChange(withPrices(ingredients, prices)); };

  const stopIngredients = onSnapshot(
    collection(db, pathFor(INGREDIENTS)),
    snap => { ingredients = snap.docs.map(d => ({ id: d.id, ...d.data() })); emit(); },
    err => { console.error('watchIngredients failed:', err); if (onError) onError(err); },
  );

  const stopPrices = onSnapshot(
    collection(db, pathFor(INGREDIENT_PRICES)),
    snap => { prices = {}; snap.forEach(d => { prices[d.id] = d.data(); }); emit(); },
    () => { prices = {}; emit(); },
  );

  return () => { stopIngredients(); stopPrices(); };
}

// The supplier names, so the chooser can tell two similar articles apart. Six
// documents; same read-only, fail-quietly treatment as the ingredients above.
export async function watchSuppliers(onChange, onError) {
  await authReady;
  return onSnapshot(
    collection(db, pathFor(SUPPLIERS)),
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => { console.warn('watchSuppliers failed:', err); if (onError) onError(err); },
  );
}

// ── The label profile ────────────────────────────────────────────────────────
//
// locations/{lid}/config/labels — the paper, the printer and which optional blocks
// a venue prints. One small document.
//
// ⚠️ WATCHED RATHER THAN READ ONCE, and what that does and does not buy is worth
// being exact about: it keeps the store current, so a size changed on the office
// computer is right the next time somebody opens the label screen, and it is right
// immediately on a Settings screen that is already open. It does NOT repaint a label
// screen somebody is standing in front of — nothing subscribes it — and claiming
// otherwise would be the kind of comment that sends the next person hunting for a
// bug that was never written.
//
// ⚠️ IT IS config/labels AND NOT A FIELD ON locations/{lid}, deliberately. That
// document is `allow write: if false` for every client, so a field there would need
// a Cloud Function — which is the right price for a venue SWITCH (showAllergens) and
// the wrong one for configuration. This is the same shape as config/orders.
//
// ⚠️ AND A MISSING DOCUMENT IS NOT AN ERROR. No venue has one until somebody opens
// Settings; normalizeLabelProfile(null) answers with the defaults, which is why this
// emits null rather than refusing.
export async function watchLabelConfig(onChange, onError) {
  await authReady;
  return onSnapshot(
    doc(db, pathFor(CONFIG), LABELS_DOC),
    snap => onChange(snap.exists() ? snap.data() : null),
    err => { console.warn('watchLabelConfig failed:', err); if (onError) onError(err); },
  );
}

// ⚠️ merge: true, NEVER a whole write. Two people can have Settings open, and a
// whole-document write would take the other one's paper size with it. The rules
// see the FULL MERGED document, so a field this build does not know about survives.
export async function saveLabelConfig(patch) {
  await authReady;
  return setDoc(doc(db, pathFor(CONFIG), LABELS_DOC), withBakery(patch), { merge: true });
}

// ── The print queue ──────────────────────────────────────────────────────────
//
// ⚠️ IT LIVES IN THIS FILE RATHER THAN ITS OWN, and that is a deliberate departure
// from the plan. A separate data layer would mean a FOURTH copy of the Firebase
// init boilerplate — getApps/getApp/initializeApp, the emulator switch, sessionReady
// — and every copy is a place the emulator wiring can be forgotten, which is a
// mistake this project has already made three times. One more collection in the
// catalogue's own data layer is cheaper than one more copy of that.

// A label somebody tapped Print on, waiting for the agent on the shop computer.
// The job is built by js/print-queue-model.js so the app and the rules describe the
// same document.
export async function queuePrintJob(job) {
  await authReady;
  return addDoc(collection(db, pathFor(PRINT_JOBS)), withBakery(job));
}

// Which computers are listening, so the screen can say «printer ready» BEFORE
// anybody taps rather than leaving them to guess (P17).
//
// COST (P14): one listener over a collection with one document in it — a venue has
// one shop computer — attached only while the catalogue page is open, like the
// recipes and the ingredients above. Quiet on failure: a venue that has never run
// an agent has no documents here, and «no printer listening» is the right answer
// for it rather than an error.
export async function watchPrintAgents(onChange, onError) {
  await authReady;
  return onSnapshot(
    collection(db, pathFor(PRINT_AGENTS)),
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => { console.warn('watchPrintAgents failed:', err); if (onError) onError(err); },
  );
}

// Create or merge a recipe document at a known id (id is generated client-side).
export async function saveRecipeDoc(id, data) {
  await authReady;
  return setDoc(doc(db, pathFor(RECIPES), id), withBakery(data), { merge: true });
}

// Delete a recipe document.
export async function removeRecipeDoc(id) {
  await authReady;
  return deleteDoc(doc(db, pathFor(RECIPES), id));
}

// Read the shared config/calculator document once (or null if it doesn't exist).
// Read-only; used to check whether a catalogue recipe was imported into the
// Calculator before deleting it (so we can warn). Never writes.
export async function getCalculatorConfig() {
  await authReady;
  const snap = await getDoc(doc(db, pathFor('config'), 'calculator'));
  return snap.exists() ? snap.data() : null;
}

// Atomically read-modify-write the shared config/calculator document. applyFn
// receives the current raw config data (or null when the doc doesn't exist yet)
// and must return the full new document to write. Used ONLY by the Calculator
// import so a whole-document overwrite can't clobber a concurrent Calculator save
// (runTransaction re-reads and retries on conflict). Returns whatever applyFn built.
//
// The location stamp is applied HERE, not by the caller. The rules require the
// `bakery` field to name the folder the document is being written to, and a caller
// that hardcodes it goes stale the moment the folder changes — which is exactly
// what happened when the data moved under locations/: the import kept stamping
// 'main' and every import was refused. Stamping in the data layer means the field
// is derived from the open location, in one place, like every other write here.
export async function updateConfigInTransaction(applyFn) {
  await authReady;
  const ref = doc(db, pathFor('config'), 'calculator');
  let built;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    built = withBakery(applyFn(snap.exists() ? snap.data() : null));
    tx.set(ref, built);
  });
  return built;
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
