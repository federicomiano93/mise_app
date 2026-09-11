// firebase-inventory.js — Firestore data layer for the monthly stocktake.
//
// Reuses the Firebase app and the SESSION established by js/firebase.js (the one
// sanctioned cross-file bridge), so this page shares the signed-in account, the
// open location, the localhost emulator switch and App Check.
//
// Collections, all under the current location's folder (js/location.js):
//   locations/{lid}/inventory/{YYYY-MM}   — one document per month. Its own.
//
// It also READS two collections it does not own: `ingredients` (Orders', for the
// list of what there is to count) and `ingredient-prices` (for what a month's
// consumption is worth). That is a shared COLLECTION, not a shared module —
// js/inventory/ imports nothing from js/orders/ or js/foodcost/, so the feature
// stays liftable (CLAUDE.md, "Modular by feature").

import { firebaseConfig, sessionReady, currentSession } from '../firebase.js';
import { currentLocationId, pathFor } from '../location.js';
import { withPrices } from '../price-model.js';
import { isMonthId } from './inventory-model.js';
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
  setDoc,
  onSnapshot,
  deleteField,
  query,
  where,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);

const MONTHS = 'inventory';
const INGREDIENTS = 'ingredients';
// The orders already placed. Read to PROPOSE what was bought — never written to.
const HISTORY = 'orders-history';
// What each ingredient COSTS. A separate collection, because Orders must read
// every ingredient to work at all — see js/price-model.js and firestore.rules.
const INGREDIENT_PRICES = 'ingredient-prices';

export const authReady = sessionReady;

function withBakery(data) {
  return { ...data, bakery: currentLocationId() };
}

function monthRef(monthId) {
  if (!isMonthId(monthId)) throw new Error(`Not a month id: ${monthId}`);
  return doc(collection(db, pathFor(MONTHS)), monthId);
}

// The month on screen, live — so a count typed on the phone in the storeroom
// appears on the one in the office without either being reloaded.
export async function watchMonth(monthId, onChange, onError) {
  await authReady;
  return onSnapshot(
    monthRef(monthId),
    snap => onChange(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    err => {
      console.error(`watchMonth(${monthId}) failed:`, err);
      if (onError) onError(err);
    },
  );
}

// One month, read once. Used for the month BEFORE this one, whose closing counts
// become this one's opening — a single read, never a listener, because a month
// that has been closed cannot change while you look at it (P14).
export async function getMonthOnce(monthId) {
  await authReady;
  const snap = await getDoc(monthRef(monthId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Write part of a month.
//
// ⚠️ A MERGE, NEVER A WHOLE DOCUMENT. Counting 67 products is one long evening of
// small edits, and a whole-document write from a phone holding a slightly stale
// copy would silently undo whatever the other phone had just counted. A merge
// touches only the fields it names.
//
// ⚠️ WHICH IS EXACTLY WHY CLEARING A BOX NEEDS deleteField(). A merge never
// removes a key, so emptying a count box would leave the old number in the
// database and the row would come back counted on the next load — the one bug
// that would make somebody stop trusting the screen. `clearPaths` carries the
// dotted paths ('closing.flour') of the boxes that were emptied, and they travel
// in the SAME write as the rest, so a count and its neighbour's deletion can
// never half-land.
export async function saveMonthFields(monthId, patch, clearPaths = []) {
  await authReady;
  const payload = withBakery({ ...patch });
  for (const path of clearPaths) {
    const [map, id] = String(path).split('.');
    if (!map || !id) continue;
    payload[map] = { ...(payload[map] || {}), [id]: deleteField() };
  }
  return setDoc(monthRef(monthId), payload, { merge: true });
}

// Every order placed inside one month, read ONCE — never watched.
//
// ⚠️ BOUNDED BY A RANGE ON `date`, NOT BY THE DOCUMENT ID. The ids look like
// `2026-09-04_salvo`, so a key range reads tempting; Firestore refuses a
// descending scan by key, and this project has lost a release to that twice. An
// inequality on ONE field plus nothing else needs no composite index.
//
// ⚠️ AND IT THEREFORE MISSES THE RETIRED WEEKLY RECORD, which has `weekStart`
// instead of `date`. That is the right answer, not a gap: that document merges
// every supplier of one July week into a single map and belongs to no month.
//
// ⚠️ READING IT NEEDS THE ORDERS SECTION. A venue that does not use Orders is
// refused here, which is why the caller treats a failure as "nothing to propose"
// and falls back to typing the purchases by hand.
export async function getOrdersInMonth(from, to) {
  await authReady;
  const snap = await getDocs(query(
    collection(db, pathFor(HISTORY)),
    where('date', '>=', from),
    where('date', '<', to),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ⚠️ NOTHING IS EMITTED UNTIL THE INGREDIENTS HAVE ARRIVED. The prices snapshot
// can land first, and emitting then would paint an empty list for a frame — the
// same shape as the bug where every ingredient flashed as an orphan before the
// suppliers arrived.
// ⚠️ THE PRICE HALF FAILS QUIETLY. A venue with no prices entered is a venue
// whose stocktake still counts perfectly well; it simply has no money column, and
// the screen says so in words rather than failing.
export async function watchIngredients(onChange, onError) {
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
}

// Whether this session may run this place.
//
// ⚠️ UX ONLY (P2). The rules decide, and they read users/{uid} themselves rather
// than trusting anything this page says. The whole screen is behind the Food Cost
// gate already, so this exists for the one control inside it that closes a month —
// an act that freezes figures other people will read.
export function canManageHere() {
  return currentSession().canManage === true;
}
