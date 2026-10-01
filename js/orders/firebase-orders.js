// firebase-orders.js — Firestore data layer for the Orders system.
//
// Reuses the Firebase app and the SESSION already established by js/firebase.js
// (imported here for its config and its init side effect), so every page shares
// one signed-in account and one open location.
//
// Collections, all under the current location's folder (js/location.js):
//   locations/{location}/suppliers/{id} · …/ingredients/{id} ·
//   …/drafts/{id} · …/orders-history/{id} · …/config/{id}
//
// Collection names stay plain strings at every call site; pathFor() is the only
// thing that knows where they live. Every document still carries the `bakery`
// field — now the location id, matching its own path — because removing a
// field that live documents already carry is what breaks merge writes for good.

import { firebaseConfig, sessionReady, currentSession } from '../firebase.js';
import { currentLocationId, pathFor } from '../location.js';
import { planBatches, categoryPatch, INGREDIENT_WRITES_PER_BATCH } from './category-batches.js';
import {
  getApps,
  getApp,
  initializeApp,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  getDocsFromServer,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  onSnapshot,
  runTransaction,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  startAfter,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

// Reuse the default app if firebase.js already created it; otherwise create it.
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);

// The id stamped on every document, in the `bakery` field. It is the same value
// as the location folder the document sits in, so the field and the path can
// never disagree — and the rules check exactly that.
export function currentBakery() {
  return currentLocationId();
}

// Collection names, in one place so the feature modules never hardcode strings.
export const COLLECTIONS = {
  suppliers: 'suppliers',
  ingredients: 'ingredients',
  // What each ingredient COSTS, keyed by the ingredient's own id. A separate
  // collection because Orders must read every ingredient to work at all, so a
  // rate written on the ingredient is a rate everybody can read — see the block
  // on it in firestore.rules and the note in js/price-model.js.
  ingredientPrices: 'ingredient-prices',
  drafts: 'drafts',
  history: 'orders-history',
  // An order list one person prepared and sent to whoever runs the place.
  orderRequests: 'order-requests',
  // The roster. Orders reads exactly ONE document from it — the sender's own row,
  // to put a name rather than a uid at the top of the list they send. It is
  // read-only here and written by nobody (a Cloud Function owns it), which is why
  // reaching for it does not make Orders depend on the staff feature.
  members: 'members',
  // Who has said 'do not buzz my phone, I am on holiday'.
  away: 'away',
  // Shared with the Calculator, which keeps config/calculator here. Orders uses
  // config/orders. The rules match /config/{doc} generically, so this needed no
  // change to firestore.rules.
  config: 'config',
};

// Resolves once a location is OPEN — not merely once someone is signed in.
// Every read and write awaits this, because until it resolves there is no
// location folder to build a path from (js/location.js throws if asked).
export const authReady = sessionReady;

// Stamp the current bakery id on a document payload.
function withBakery(data) {
  return { ...data, bakery: currentBakery() };
}

// Subscribe to a collection in real time. onChange receives an array of
// documents ({ id, ...data }). Returns the unsubscribe function.
//
// onError is how a failure REACHES SOMEONE. Without it the stream dying — a
// revoked session, a rule change, a network Firestore gives up on — left the
// screen looking exactly like a location with no data in it, and onSnapshot does
// NOT resubscribe after an error, so it stayed that way until a reload. The
// console line remains for diagnosis; it is not a substitute for telling the user.
export async function watchCollection(name, onChange, onError) {
  await authReady;
  return onSnapshot(
    collection(db, pathFor(name)),
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error(`watchCollection(${name}) failed:`, err);
      onError?.(err);
    },
  );
}

// COST NOTE (P14) — orders-history grows by roughly 500-1000 documents a year (one per
// day per supplier), and an unbounded listener would read all of it on every Orders open,
// slower and dearer for ever. So the live listener covers only the last
// HISTORY_LIVE_MONTHS calendar months (watchRecentHistory: `date >= liveHistoryStart()`),
// and anything older is fetched on demand, one page at a time, when somebody taps «Load
// older orders» (getOlderHistory). Nothing is deleted; older orders are just not read until
// wanted.
//
// Why `date` and not the document id: Firestore refuses a descending scan by key ("does
// not support descending key scans"), and limitToLast on an ascending key order is
// rewritten into exactly that scan. Ordering by a FIELD is fully supported, and a single
// field needs no composite index.
//
// Why the legacy record is fetched by `weekStart`: the one old weekly document (July 2026)
// has no `date`, so no `date` query can ever return it. Only legacy records carry
// `weekStart` (the rules' hasOnly keeps it off modern ones), so ordering by it returns
// just them. getLegacyHistory is called once, when the paging reaches its end.

// The live window: orders from `fromDate` ("YYYY-MM-DD") onwards, in real time. Same
// error handling as watchCollection — onSnapshot does not resubscribe after an error.
export async function watchRecentHistory(fromDate, onChange, onError) {
  await authReady;
  return onSnapshot(
    query(collection(db, pathFor(COLLECTIONS.history)), where('date', '>=', fromDate)),
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error('watchRecentHistory failed:', err);
      onError?.(err);
    },
  );
}

// ⚠️ BOTH ONE-OFF READS BELOW USE getDocsFromServer, NEVER getDocs. The app runs Firestore
// with its persistent offline cache, and offline getDocs quietly answers from that cache —
// often empty or partial. A short page would then read as `done`, and «Load older orders»
// would vanish for good under a false "no more orders". getDocsFromServer REJECTS when the
// server cannot be reached, which is what puts the error line and the retry on screen.

// One page of orders OLDER than `before`, newest first. `cursor` is the last document
// snapshot of the previous page (null for the first). Returns the records, the cursor to
// pass next time, and whether this was the last page.
export async function getOlderHistory({ before, cursor = null, pageSize = 100 }) {
  await authReady;
  const constraints = [
    where('date', '<', before),
    orderBy('date', 'desc'),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(pageSize),
  ];
  const snap = await getDocsFromServer(
    query(collection(db, pathFor(COLLECTIONS.history)), ...constraints));
  const records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return {
    records,
    cursor: snap.docs.length ? snap.docs[snap.docs.length - 1] : cursor,
    done: records.length < pageSize,
  };
}

// The legacy weekly records — the only ones with a `weekStart` and no `date`.
export async function getLegacyHistory() {
  await authReady;
  const snap = await getDocsFromServer(query(
    collection(db, pathFor(COLLECTIONS.history)),
    orderBy('weekStart'),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// One-off read of a collection. Returns an array of { id, ...data }.
export async function getCollection(name) {
  await authReady;
  const snap = await getDocs(collection(db, pathFor(name)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// The orders recorded on ONE day. Used by the Home screen, which only needs to know
// what has already been placed today.
//
// Deliberately a WHERE query rather than getCollection('orders-history'): the Home is
// opened many times a day on every phone, and reading the whole archive there would
// bill for the entire order history each time — a cost that grows for ever while the
// answer needed is always one day wide (P14). An equality filter on a single field
// needs no composite index, so this works with no console setup.
//
// The legacy weekly record carries `weekStart` instead of `date` and therefore never
// matches. That is correct here: it is from July 2026 and can never be "placed today".
export async function getHistoryForDay(date) {
  await authReady;
  const snap = await getDocs(query(
    collection(db, pathFor(COLLECTIONS.history)),
    where('date', '==', date),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Create or merge a document. The bakery field is always stamped server-side
// of the client (rules also enforce that it matches the location folder).
export async function saveDoc(name, id, data) {
  await authReady;
  return setDoc(doc(db, pathFor(name), id), withBakery(data), { merge: true });
}

// Overwrite a document WHOLE — no merge. saveDoc's { merge: true } deep-merges
// maps, so a key removed from `quantities` would survive in Firestore; when the
// caller has already computed the exact final document (a history record), that
// is wrong. Use saveDoc when you are patching, this when you are replacing.
export async function replaceDoc(name, id, data) {
  await authReady;
  return setDoc(doc(db, pathFor(name), id), withBakery(data));
}

// Remove specific fields — including keys inside a map ('entries.<ingredientId>')
// — and patch the rest, leaving every other key untouched.
//
// This is how one supplier's rows leave the shared draft. Rewriting the whole
// draft document instead would wipe whatever another phone typed for a DIFFERENT
// supplier in the second before this write landed; deleteField touches only the
// named keys, so concurrent edits elsewhere in the document survive.
export async function clearFields(name, id, paths, patch = {}) {
  await authReady;
  const update = { ...patch, bakery: currentBakery() };
  paths.forEach(path => { update[path] = deleteField(); });
  return updateDoc(doc(db, pathFor(name), id), update);
}

// Read-modify-write a single document atomically. `updater` receives the current
// document ({ id, ...data }) or null, and returns the FULL new document — or null
// to leave it alone. Used so that two orders to the same supplier on the same day
// add up correctly even if two people tap at once.
export async function transactDoc(name, id, updater) {
  await authReady;
  const ref = doc(db, pathFor(name), id);
  return runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    const existing = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    const next = updater(existing);
    if (!next) return null;
    tx.set(ref, withBakery(next));
    return next;
  });
}

// Create a document with an auto-generated id. Returns the new id.
export async function createDoc(name, data) {
  await authReady;
  const ref = await addDoc(collection(db, pathFor(name)), withBakery(data));
  return ref.id;
}

// Set the category on many ingredients at once — «delete a category» leaves every ingredient
// that used it without one. Stamped with the bakery, exactly like saveDoc.
//
// ⚠️ `alsoWrite` ({ name, id, data }) RIDES IN THE FIRST BATCH: the venue's category list and
// the first ingredients then change together or not at all. A longer list is split into
// several batches, the list going first — see js/orders/category-batches.js for why they are
// small (Firestore's 20 document accesses per write, which the emulator does not enforce).
//
// ⚠️ batch.update(), NOT set with merge: an ingredient deleted meanwhile on another phone must
// not come back as a nameless document. The batch fails instead and the error is reported;
// the list is recomputed from live data on retry.
export async function setCategoryOnMany(ids, value, alsoWrite = null) {
  await authReady;
  const plan = planBatches(ids, INGREDIENT_WRITES_PER_BATCH, !!alsoWrite);
  for (const step of plan) {
    const batch = writeBatch(db);
    if (step.config) {
      batch.set(doc(db, pathFor(alsoWrite.name), alsoWrite.id), withBakery(alsoWrite.data), { merge: true });
    }
    for (const id of step.ids) {
      batch.update(doc(db, pathFor(COLLECTIONS.ingredients), id), withBakery(categoryPatch(value)));
    }
    await batch.commit();
  }
}

// Delete a document. The rules permit this for drafts, suppliers, ingredients
// and — since orders became correctable — orders-history.
export async function removeDoc(name, id) {
  await authReady;
  return deleteDoc(doc(db, pathFor(name), id));
}

// ── Ingredient prices ────────────────────────────────────────────────────────
// The name of the append-only history that hangs under each ingredient. It is a
// SUBCOLLECTION, so it never appears in COLLECTIONS above: pathFor() builds a
// location's top-level collections and refuses a name containing a slash. The
// path is composed from the ingredient's own document reference instead.
const PRICES = 'prices';

// ⚠️ SAVING AN INGREDIENT WITH ITS PRICE, SAVING A SUPPLIER, AND THE ONE RULE OF WHO MAY
// WRITE A PRICE live in js/record-data.js since 13 Sep 2026: the two record cards are also
// opened from the Catalogue, which may not import this folder. Re-exported, so every Orders
// screen calls exactly what it called before.
export {
  saveIngredientWithPrice, saveSupplierRecord, mayWritePrices, deleteIngredientWithPrice,
} from '../record-data.js';

// What every ingredient costs, as a map keyed by ingredient id.
//
// ⚠️ IT FAILS QUIETLY AND RETURNS AN EMPTY MAP. An employee is refused this
// collection by the rules, and that refusal is the feature working — not an
// error to report. Every screen already knows what an unpriced ingredient looks
// like, because most ingredients have never had a price, so the result is a
// screen that says "not priced yet" rather than one that breaks.
// ⚠️ `await authReady` IS NOT OPTIONAL AND ITS ABSENCE IS NOT SUBTLE. pathFor()
// THROWS before a location is open — deliberately, so a read can never quietly
// use another venue's folder — so without this line the call threw during init(),
// taking the ingredient watcher on the next line down with it and leaving the
// Orders screen with no ingredients at all. Every other watcher in this file
// awaits it; this one did not, and only driving the real page said so: the checks
// were green because they called it by hand AFTER signing in.
export async function watchIngredientPrices(onChange) {
  await authReady;
  return onSnapshot(
    collection(db, pathFor(COLLECTIONS.ingredientPrices)),
    snap => {
      const map = {};
      snap.forEach(d => { map[d.id] = d.data(); });
      // ⚠️ An EMPTY answer from the offline cache proves nothing — the server's
      // refusal may simply not have arrived yet (a tablet with no signal). Only a
      // server answer, or a cached one that holds prices, counts as «readable».
      onChange(map, !snap.metadata.fromCache || !snap.empty);
    },
    // Second argument false: the rules refused it (or it failed), so a screen that
    // shows MONEY must show none — an empty map alone reads like "nothing priced".
    () => onChange({}, false),
  );
}

// What this ingredient has cost, newest first. Read ON DEMAND — only when someone
// opens the ingredient — never watched, so an archive that grows for years costs
// nothing on the screens that do not ask for it (P14).
//
// ⚠️ ORDERED BY THE recordedAt FIELD, never by document id. Firestore refuses a
// descending scan by key, and limitToLast on an ascending key order is rewritten
// into that same refused query. This project has already lost a release to that
// exact trap twice.
export async function getPriceHistory(ingredientId, max = 20) {
  await authReady;
  const ref = doc(collection(db, pathFor(COLLECTIONS.ingredients)), ingredientId);
  const snap = await getDocs(query(
    collection(ref, PRICES),
    orderBy('recordedAt', 'desc'),
    limit(max),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// One-off read of a single document. Returns { id, ...data } or null.
export async function getDocOnce(name, id) {
  await authReady;
  const snap = await getDoc(doc(db, pathFor(name), id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Subscribe to a single document in real time. onChange receives { id, ...data }
// or null when the document does not exist. Returns the unsubscribe function.
export async function watchDoc(name, id, onChange, onError) {
  await authReady;
  return onSnapshot(
    doc(db, pathFor(name), id),
    // Second argument: did this answer come from the local cache? «Missing» from the cache
    // proves nothing (a phone that starts offline has never seen the document).
    snap => onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null, snap.metadata.fromCache),
    err => {
      console.error(`watchDoc(${name}/${id}) failed:`, err);
      onError?.(err);
    },
  );
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

// ── Order lists sent from one person to another ──────────────────────────────

// How many lists the screen ever holds. ⚠️ A BOUNDED LIVE READ, and the bound is
// the point: this collection grows for ever (nothing in this app deletes by
// itself), so an unbounded listener would bill for every list ever sent, on every
// phone, every time Orders is opened — the cost problem orders-history already
// has and this one must not inherit (P14).
const REQUEST_LIMIT = 120;

// ⚠️ ORDERED BY THE createdAt FIELD, NEVER BY DOCUMENT ID. Firestore refuses a
// descending scan by key outright ("does not support descending key scans"), and
// limitToLast on an ascending key order is rewritten into that same scan, so it
// fails identically — a lesson that already cost this project a release.
//
// ⚠️ AND BY createdAt RATHER THAN date, which is the field the screen's window
// uses. Several lists can share a day, so `date` alone leaves their order
// undefined; adding a second orderBy to break the tie would need a composite
// index and a console step. createdAt is an ISO string, so sorting it as text
// sorts it as time, and it is fine-grained enough to be unique in practice.
export async function watchOrderRequests(onChange, onError) {
  await authReady;
  return onSnapshot(
    query(
      collection(db, pathFor(COLLECTIONS.orderRequests)),
      orderBy('createdAt', 'desc'),
      limit(REQUEST_LIMIT),
    ),
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      console.error('watchOrderRequests failed:', err);
      onError?.(err);
    },
  );
}

export async function sendOrderRequest(payload) {
  return createDoc(COLLECTIONS.orderRequests, payload);
}

// Tick ONE ingredient off, or untick it.
//
// ⚠️ IT SENDS ONLY THE ONE KEY, and that is what makes two managers working the
// same list at once safe. setDoc(merge) merges a map key by key, so this cannot
// disturb a line somebody else ticked a second ago — whereas writing the whole
// `done` map from a snapshot this phone read moments earlier would silently put
// their tick back. Same technique, same reason, as the draft autosave.
//
// ⚠️ UNTICKING WRITES `false`, IT DOES NOT REMOVE THE KEY. A merge cannot delete a
// key by leaving it out, and a mis-tap has to be undoable — so the value carries
// the answer and isRequestDone() asks for exactly `true`.
export async function setOrderRequestDone(id, ingredientId, done) {
  return saveDoc(COLLECTIONS.orderRequests, id, {
    done: { [ingredientId]: done === true },
    updatedAt: new Date().toISOString(),
  });
}

// Tick off everything still open, in ONE write — what "Finish" does.
export async function finishOrderRequest(id, ingredientIds) {
  const done = {};
  (ingredientIds || []).forEach(ingredientId => { done[ingredientId] = true; });
  return saveDoc(COLLECTIONS.orderRequests, id, {
    done, updatedAt: new Date().toISOString(),
  });
}

export async function deleteOrderRequest(id) {
  return removeDoc(COLLECTIONS.orderRequests, id);
}

// The signed-in person's own roster row, for the name that goes on a list they
// send. One document, read once, at the moment of sending.
//
// ⚠️ IT MUST NEVER BLOCK THE SEND. The roster is a label and nothing decides
// anything by it (see locations/{lid}/members), so a row that is missing, or a
// read that fails, falls back to the address and then to a neutral word — never
// to a raw uid, and never to refusing to send the order.
export async function getOwnMemberRow() {
  const { user } = currentSession();
  if (!user?.uid) return null;
  try {
    return await getDocOnce(COLLECTIONS.members, user.uid);
  } catch (err) {
    console.warn('Could not read the roster row for the sender’s name:', err);
    return null;
  }
}

// The lists sent recently, read ONCE — what the Home screen's badge counts.
//
// ⚠️ A RANGE ON ONE FIELD, NOT THE WHOLE COLLECTION AND NOT THE 120 ABOVE. The
// Home is opened many times a day on every phone; reading every list ever sent
// there would bill for the whole archive each time, for ever (P14). A range on a
// single field needs no composite index and no console setup — the same shape as
// getHistoryForDay and as the client-order badge.
//
// ⚠️ THE WINDOW IS DELIBERATELY WIDER THAN THE SCREEN'S. The screen draws 15 days
// and offers "show older"; this reaches back twice as far, so a list that has sat
// unfinished for three weeks still lights the Home. Beyond that it stops counting
// here while remaining visible inside Orders — a list nobody has touched in two
// months is a conversation, not a badge.
export async function getRecentOrderRequestsOnce(days = 30) {
  await authReady;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const iso = cutoff.toISOString().slice(0, 10);
  const snap = await getDocs(query(
    collection(db, pathFor(COLLECTIONS.orderRequests)),
    where('date', '>=', iso),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── "I am on holiday" ────────────────────────────────────────────────────────
//
// One document per person, in `away`. It lives in the Orders data layer because
// Orders is what it silences and what has to warn about it — and because putting
// it anywhere else would mean a second file that knows how to reach Firestore.

export async function watchAwayDays(onChange, onError) {
  await authReady;
  return onSnapshot(
    collection(db, pathFor(COLLECTIONS.away)),
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => {
      // ⚠️ A FAILED READ MEANS "NOBODY IS AWAY", which is what the empty list
      // below produces: phones ring. The recoverable direction — see the model.
      console.warn('Could not read who is away; treating everybody as available:', err);
      onChange([]);
      onError?.(err);
    },
  );
}

export async function getAwayDaysOnce() {
  await authReady;
  const snap = await getDocs(collection(db, pathFor(COLLECTIONS.away)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// The roster, so a screen can put NAMES on who will be told.
//
// ⚠️ A LABEL, NEVER A DECISION. users/{uid} — the document the rules and the
// server actually read — is readable only by its own owner, so no phone can know
// for certain who runs the place. This is what the app can see, and it is used
// only to say something helpful before a list is sent.
export async function getRosterOnce() {
  await authReady;
  const snap = await getDocs(collection(db, pathFor(COLLECTIONS.members)));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

export async function saveAwayDay(uid, doc) {
  return saveDoc(COLLECTIONS.away, uid, doc);
}
