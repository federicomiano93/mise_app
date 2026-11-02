// firebase-inventory.js — Firestore data layer for the monthly stocktake.
//
// Reuses the Firebase app and the SESSION established by js/firebase.js (the one
// sanctioned cross-file bridge), so this page shares the signed-in account, the
// open location and the localhost emulator switch.
//
// Collections, all under the current location's folder (js/location.js):
//   locations/{lid}/inventory/{YYYY-MM}   — one document per month. Its own.
//
// It also READS two collections it does not own: `ingredients` (Orders', for the
// list of what there is to count) and `ingredient-prices` (for what a month's
// consumption is worth). That is a shared COLLECTION, not a shared module —
// js/inventory/ imports nothing from js/orders/ or js/foodcost/, so the feature
// stays liftable (CLAUDE.md, "Modular by feature").

// ⚠️ NO ROLE IS READ HERE, ON PURPOSE. The whole page rides the Food Cost gate
// (inventory.html, data-section="foodcost"), so every account that can open this
// screen may already run it — a second, UX-only check inside would be a control
// this feature does not have, dressed as one it does.
import { firebaseConfig, sessionReady } from '../firebase.js';
import { currentLocationId, pathFor } from '../location.js';
import { withPrices } from '../price-model.js';
import { isMonthId, withoutEmptyMaps } from './inventory-model.js';
import {
  getApps,
  getApp,
  initializeApp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
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
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

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
//
// ⚠️ WITH WHERE IT CAME FROM: `fromServer` is false for the phone's own copy, which
// can be days old. A count held over from an earlier visit is sent only once the
// SERVER says the month is open (js/inventory/inventory-outbox.js, `held`) — and
// without includeMetadataChanges a server answer identical to that copy would never
// be reported at all.
// ⚠️ AND WHETHER IT CARRIES THIS PHONE'S OWN UNSENT WRITES: a merge on a month never read here shows up as a document
// that exists, and it proves nothing about the month (inventory-store.js).
export async function watchMonth(monthId, onChange, onError) {
  await authReady;
  return onSnapshot(
    monthRef(monthId),
    { includeMetadataChanges: true },
    snap => onChange(
      snap.exists() ? { id: snap.id, ...snap.data() } : null,
      { fromServer: !snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites },
    ),
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
// that would make somebody stop trusting the screen. `clear` names the boxes that
// were emptied, as `{ closing: { flour: true } }`, and they travel in the SAME
// write as the rest, so a count and its neighbour's deletion can never half-land.
//
// ⚠️ A NESTED MAP, NEVER A DOTTED 'closing.flour' STRING. An ingredient id is a
// Firestore document id and may legally contain a dot, and splitting on it would
// delete the wrong key — or nothing at all — without a sound.
//
// ⚠️ AND NO EMPTY MAP EVER GOES OUT: in a merge it wipes the stored one (withoutEmptyMaps, in the model).
export async function saveMonthFields(monthId, patch, clear = {}) {
  await authReady;
  const payload = withBakery({ ...patch });
  for (const [map, ids] of Object.entries(clear)) {
    if (!map || !ids || typeof ids !== 'object') continue;
    const removals = {};
    for (const id of Object.keys(ids)) removals[id] = deleteField();
    payload[map] = { ...(payload[map] || {}), ...removals };
  }
  return setDoc(monthRef(monthId), withoutEmptyMaps(payload), { merge: true });
}

// Every order placed inside one month, read ONCE — never watched.
//
// ⚠️ BOUNDED BY A RANGE ON `date`, NOT BY THE DOCUMENT ID. The ids look like
// `2026-09-04_alba`, so a key range reads tempting; Firestore refuses a
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
//
// ⚠️ THE PHONE'S COPY IS NOT AN ANSWER. With no signal getDocs does not fail: it answers from whatever orders happen
// to be on this device, often none. That said «no orders this month» when there were, and a part of them would
// replace the whole month's purchases. So it counts as a failed read.
export async function getOrdersInMonth(from, to) {
  await authReady;
  const snap = await getDocs(query(
    collection(db, pathFor(HISTORY)),
    where('date', '>=', from),
    where('date', '<', to),
  ));
  if (snap.metadata.fromCache) throw new Error('The orders are only on this device.');
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ⚠️ NOTHING IS EMITTED UNTIL THE INGREDIENTS HAVE ARRIVED. The prices snapshot
// can land first, and emitting then would paint an empty list for a frame — the
// same shape as the bug where every ingredient flashed as an orphan before the
// suppliers arrived.
// ⚠️ THE PRICE HALF FAILS QUIETLY. A venue with no prices entered is a venue
// whose stocktake still counts perfectly well; it simply has no money column, and
// the screen says so in words rather than failing.
// ⚠️ onChange ALSO GETS WHETHER THE ANSWER CAME FROM THE PHONE'S COPY. An EMPTY list from the copy
// proves nothing (a cold start with no signal reports one), so the screen must not say «no products» on it.
// ⚠️ includeMetadataChanges, OR THE SERVER'S «YES, EMPTY» NEVER ARRIVES: confirming an empty copy changes
// no document, so Firestore would stay silent. And it answers again when the server confirms a full list
// too, so that one is dropped: an identical answer would redo the work of the screen for nothing.
// ⚠️ onChange'S THIRD ANSWER IS WHETHER THE PRICES HAVE ANSWERED, by the same rule: an empty copy proves nothing, and
// a month closed on it would freeze no money. A REFUSED read does count: that account will never get more. Any other
// failure does not (a quota running out, say): the month would be closed with no money and no warning.
export async function watchIngredients(onChange, onError) {
  await authReady;
  let ingredients = null;
  let prices = {};
  let fromCache = true;
  let emptyFromCache = null;
  let pricesAnswered = false;
  const emit = () => { if (ingredients) onChange(withPrices(ingredients, prices), fromCache, pricesAnswered); };

  const stopIngredients = onSnapshot(
    collection(db, pathFor(INGREDIENTS)),
    { includeMetadataChanges: true },
    snap => {
      const nowEmptyFromCache = snap.empty && snap.metadata.fromCache;
      if (nowEmptyFromCache === emptyFromCache && !snap.docChanges().length) return;
      emptyFromCache = nowEmptyFromCache;
      fromCache = snap.metadata.fromCache;
      ingredients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      emit();
    },
    err => { console.warn('watchIngredients failed:', err); if (onError) onError(err); },
  );
  const stopPrices = onSnapshot(
    collection(db, pathFor(INGREDIENT_PRICES)),
    { includeMetadataChanges: true },
    snap => {
      const proves = !snap.empty || !snap.metadata.fromCache;
      if ((pricesAnswered || !proves) && !snap.docChanges().length) return;
      pricesAnswered = pricesAnswered || proves;
      prices = {};
      snap.forEach(d => { prices[d.id] = d.data(); });
      emit();
    },
    err => {
      prices = {};
      if (err?.code === 'permission-denied') pricesAnswered = true;
      emit();
    },
  );
  return () => { stopIngredients(); stopPrices(); };
}
