// inventory-store.js — the month being counted, plus the ingredients there are
// to count.
//
// Resilience (P17) + cost (P14): everything is held in memory and mirrored to
// localStorage, so the screen paints instantly and the count survives a reload in
// a storeroom with no signal. The listeners are attached only when this page
// initialises, never at app boot.
//
// ⚠️ WRITES ARE LOCAL-FIRST AND DELIBERATELY NOT ROLLED BACK. Everywhere else in
// this app a rejected write is undone and the row snaps back; here that would
// delete a number somebody has just walked across a storeroom to read, which is
// the one thing this screen must never do. Instead the count stays on screen and
// in the local cache, the failure is said out loud, and the unsent change is kept
// in the outbox so the next save carries it too.
//
// ⚠️ WHICH IS WHY NOTHING THE SCREEN DOES WAITS FOR A SERVER. A Firestore write
// does not settle until it reaches one, and with the app's offline cache that can
// be hours — see settled() below. The count is safe long before it is confirmed.
//
// ⚠️ FUNCTION DECLARATIONS, NOT const ARROWS, for anything called from the
// initialisation below: a declaration is hoisted, a const arrow throws "Cannot
// access before initialization" and leaves the page blank with nothing on screen
// to explain it.

import { t } from '../i18n.js';
import { currentLocationId } from '../location.js';
import {
  normalizeMonth, carryOver, toDocument, readCount, isMonthId, nextMonth,
  monthBounds, COUNT_MAPS, isClosed,
} from './inventory-model.js';
import {
  EMPTY_OUTBOX, stage, stageMany, hasWork, take, confirm, restore, applyOver,
} from './inventory-outbox.js';
import { purchasesInMonth } from './inventory-purchases.js';
import {
  watchMonth, watchIngredients, getMonthOnce, getOrdersInMonth, saveMonthFields,
  authReady,
} from './firebase-inventory.js';

// How long after the last keystroke the count is sent. Long enough that typing
// "12" is one write and not two, short enough that putting the phone down saves.
const SAVE_DELAY_MS = 700;

// The longest the SCREEN may wait for a write before carrying on regardless.
const SETTLE_MS = 1200;

// ⚠️ THE VENUE IS IN THE KEY. One phone can hold two businesses, and a cache key
// of "the month" alone would show The Italian Club's counts under Panificio
// Miano's name — the same shape as the Firestore cache still being per project
// rather than per location.
function cacheKey(monthId) {
  return `inventory-${currentLocationId() || 'none'}-${monthId}`;
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    // Corrupt or unavailable cache — the listener will fill it in.
  }
  return fallback;
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Storage full or unavailable — the in-memory copy still works this session.
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function deadlineFromNow(ms = SETTLE_MS) {
  return Date.now() + ms;
}

// Wait for a write to be SAFE, not for it to be CONFIRMED.
//
// ⚠️⚠️ A FIRESTORE WRITE DOES NOT SETTLE UNTIL IT REACHES THE SERVER. Under the
// app's offline cache (persistentLocalCache, js/firebase.js) a write made with no
// signal is already durable — it is in the browser's own database and the SDK
// sends it when there is signal — but its promise simply never settles. Anything
// the SCREEN waits on must therefore wait against a clock as well.
//
// ⚠️ WITHOUT THIS, THE TWO MOST IMPORTANT BUTTONS ON THIS SCREEN DO NOTHING AT
// ALL, SILENTLY — closing a month and changing month both awaited a write — in
// the one place this feature is ever used: a storeroom with no signal.
// ⚠️ ONE DEADLINE FOR A WHOLE SEQUENCE, not one per write, so closing a month
// answers within a second and a bit rather than once per step.
function settled(promise, deadline) {
  return Promise.race([promise, wait(Math.max(0, deadline - Date.now()))]);
}

// A write whose confirmation nobody is waiting for: it reports a failure and
// never rejects, so it cannot become an unhandled rejection either.
function queued(promise) {
  return Promise.resolve(promise).catch(err => {
    console.warn('The stocktake did not reach Firestore:', err);
    reportSyncFailure();
  });
}

function reportSyncFailure() {
  if (onSyncError) onSyncError(t('inv.notSavedYet'));
}

let monthId = null;
let month = null;
let ingredients = [];
let notify = null;
let onSyncError = null;

// What has been typed here and has not reached Firestore yet
// (js/inventory/inventory-outbox.js holds the whole reasoning).
let outbox = EMPTY_OUTBOX;
let saveTimer = null;
// The write currently in the air, if any. Exactly one at a time.
let sending = null;
// Whether Firestore has answered at all yet. Until it has, the local copy is the
// only thing there is; afterwards it is a mirror.
let remoteArrived = false;

export function getMonth() { return month; }
export function getMonthId() { return monthId; }
export function getIngredients() { return ingredients; }

export function setSyncErrorHandler(fn) {
  onSyncError = typeof fn === 'function' ? fn : null;
}

function cacheMonth() {
  // ⚠️ NOT BEFORE THE VENUE IS KNOWN: the key names it, so a write made while the
  // session is still opening would file the counts under a key nothing ever reads.
  if (month && currentLocationId()) writeJson(cacheKey(month.id), toDocument(month));
}

function announce() {
  if (notify) notify();
}

export function initInventory(id, onUpdate, onError) {
  monthId = isMonthId(id) ? id : null;
  notify = typeof onUpdate === 'function' ? onUpdate : null;
  if (!monthId) return null;

  // An empty month of the right shape, so the screen can paint before anything
  // has arrived from anywhere.
  month = normalizeMonth({ month: monthId });

  // ⚠️⚠️ THE LOCAL COPY IS READ ONLY ONCE THE VENUE IS OPEN, AND THE WAIT IS THE
  // WHOLE POINT. This module is loaded before sign-in has finished, so
  // currentLocationId() is still null at this line — reading here looked for
  // `inventory-none-2026-09` while every write of the evening went to
  // `inventory-loc-abc-2026-09`. The safety copy was written faithfully and never
  // read once.
  authReady.then(hydrateFromCache).catch(() => {});

  watchMonth(
    monthId,
    remote => {
      remoteArrived = true;
      // A remote change never discards what has not been sent yet: the local
      // values for still-unsent boxes are laid back over the incoming document.
      const merged = normalizeMonth(remote, monthId) || normalizeMonth({ month: monthId });
      applyOver(outbox, merged, COUNT_MAPS);
      month = merged;
      cacheMonth();
      announce();
    },
    err => { if (onError) onError(err); },
  ).catch(err => {
    console.error('Stocktake live sync failed to start:', err);
    if (onError) onError(err);
  });

  watchIngredients(list => {
    ingredients = Array.isArray(list) ? list : [];
    announce();
  }, () => {}).catch(() => {});

  return month;
}

// The counts this phone saved last time, put back on screen.
//
// ⚠️ IT NEVER OVERWRITES SOMETHING NEWER. Firestore may already have answered, or
// a number may already have been typed; in both cases the cache is the stale copy
// and is left where it is.
function hydrateFromCache() {
  if (!monthId || remoteArrived || hasWork(outbox)) return;
  const cached = normalizeMonth(readJson(cacheKey(monthId), null), monthId);
  if (!cached) return;
  month = cached;
  announce();
}

// Change one box. `value` is whatever was typed; an empty one CLEARS the entry
// rather than storing a zero (js/inventory/inventory-model.js says why at length).
//
// ⚠️⚠️ A CLOSED MONTH REFUSES EVERY CHANGE, AND THIS IS THE ONLY PLACE THAT CAN
// GUARANTEE IT. The screen disables the boxes, but the screen is built before
// Firestore says whether the month is closed, and the rules cannot tell a count
// apart from the write that reopens the month. «Closed» is a promise the app makes
// about figures other people read: it is kept here, not by a disabled attribute.
export function setCount(map, ingredientId, value) {
  if (!month || !COUNT_MAPS.includes(map) || !ingredientId) return;
  if (isClosed(month)) return;
  const n = readCount(value);

  if (n === null) delete month[map][ingredientId];
  else month[map][ingredientId] = n;
  outbox = stage(outbox, map, ingredientId, n);

  cacheMonth();
  scheduleSave();
  announce();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { flush(); }, SAVE_DELAY_MS);
}

// Send everything that has changed. Kept as ONE write so a count and a cleared
// box beside it can never half-land.
//
// ⚠️ EXACTLY ONE WRITE IN THE AIR AT A TIME. With two, the second's success would
// confirm the first one's values as landed as well — and a failed first write
// would then never be sent again.
export function flush() {
  clearTimeout(saveTimer);
  if (!month || !monthId) return Promise.resolve();
  if (sending) return sending.then(() => flush());
  if (!hasWork(outbox)) return Promise.resolve();

  const taken = take(outbox);
  outbox = taken.outbox;

  const patch = { month: monthId, updatedAt: new Date().toISOString() };
  if (!month.createdAt) {
    month.createdAt = patch.updatedAt;
    patch.createdAt = patch.updatedAt;
  }
  for (const [map, values] of Object.entries(taken.values)) patch[map] = { ...values };

  sending = saveMonthFields(monthId, patch, taken.clear).then(
    () => { outbox = confirm(outbox); },
    err => {
      console.warn('The stocktake did not reach Firestore:', err);
      outbox = restore(outbox);
      reportSyncFailure();
    },
  ).finally(() => { sending = null; });
  return sending;
}

// Send what is waiting and answer within the bound, whatever the network is doing.
//
// ⚠️ FOR THE CALLER THAT IS ABOUT TO TAKE THE PAGE AWAY — changing month reloads
// it. flush() answers when the WRITE does, which with no signal is never, so
// chaining a navigation onto it makes the month arrows dead buttons. The count is
// safe either way: it is in the browser's own database and in the local copy.
export function flushBeforeLeaving() {
  return settled(flush(), deadlineFromNow());
}

// Close the month: stamp it, freeze what it was worth, and open the next one with
// this one's closing counts as its opening.
//
// ⚠️ THE NEXT MONTH IS WRITTEN FIRST. If the two writes are done the other way
// round and the second fails, September is closed and October does not exist —
// and October's openings are then gone, because they only ever existed as
// September's closings. This order fails towards "closed nothing, lost nothing".
// ⚠️ IT IS THE ORDER OF SENDING THAT MATTERS, NOT OF CONFIRMING. Offline neither
// write is confirmed at all; the SDK holds them in the order they were made and
// sends them in that order when there is signal.
export async function closeMonth(frozen, nowIso = new Date().toISOString()) {
  if (!month || !monthId) return null;
  const deadline = deadlineFromNow();
  await settled(flush(), deadline);

  const next = carryOver(month, nextMonth(monthId), nowIso);
  if (next) {
    await settled(queued(saveMonthFields(next.month, {
      month: next.month,
      opening: next.opening,
      packKg: next.packKg,
      createdAt: nowIso,
      updatedAt: nowIso,
    })), deadline);
  }

  const patch = {
    month: monthId,
    closedAt: nowIso,
    updatedAt: nowIso,
    names: frozen && frozen.names ? frozen.names : {},
    unitPrice: frozen && frozen.unitPrice ? frozen.unitPrice : {},
    packKg: frozen && frozen.packKg ? frozen.packKg : month.packKg,
  };
  await settled(queued(saveMonthFields(monthId, patch)), deadline);
  month.closedAt = nowIso;
  month.names = patch.names;
  month.unitPrice = patch.unitPrice;
  month.packKg = patch.packKg;
  cacheMonth();
  announce();
  return next ? next.month : null;
}

// What the orders already recorded say was bought this month.
//
// ⚠️ IT READS, IT DOES NOT WRITE. Nothing moves until applyPurchases() is called,
// so the screen can say what would change and let somebody refuse it.
// ⚠️ A FAILURE IS AN EMPTY PROPOSAL, NOT AN ERROR. The orders collection belongs
// to another section and a venue may not use it at all; the honest answer there is
// "nothing to propose, type it yourself", which is exactly what the screen already
// supports.
export async function readProposedPurchases() {
  if (!monthId) return { totals: {}, orders: 0, products: 0, failed: false };
  const bounds = monthBounds(monthId);
  if (!bounds) return { totals: {}, orders: 0, products: 0, failed: false };
  try {
    const records = await getOrdersInMonth(bounds.from, bounds.to);
    return { ...purchasesInMonth(records, monthId), failed: false };
  } catch (err) {
    console.warn('Could not read the orders of this month:', err);
    return { totals: {}, orders: 0, products: 0, failed: true };
  }
}

// Put a proposal into the month's `purchased` figures.
//
// ⚠️ IT REPLACES THE WHOLE MAP, clearing what the orders no longer account for —
// a figure left behind from a previous proposal would otherwise sit there for ever
// with nothing to explain it. The dialog says so before this runs.
export function applyPurchases(totals) {
  if (!month || !totals || isClosed(month)) return 0;
  const wanted = {};
  for (const [id, value] of Object.entries(totals)) {
    const n = readCount(value);
    if (n !== null && n > 0) wanted[id] = n;
  }
  const gone = Object.keys(month.purchased).filter(id => !(id in wanted));

  gone.forEach(id => { delete month.purchased[id]; });
  Object.entries(wanted).forEach(([id, n]) => { month.purchased[id] = n; });
  outbox = stageMany(outbox, 'purchased', wanted, gone);

  cacheMonth();
  scheduleSave();
  announce();
  return Object.keys(wanted).length;
}

// Unfreeze a month that was closed too early.
//
// ⚠️ IT DOES NOT UNDO THE NEXT MONTH. October's openings were COPIED out of
// September when September was closed, so correcting September now changes
// nothing there — which is the whole point of the copy (see carryOver), but it
// has to be said to whoever presses this, and the dialog says it.
export async function reopenMonth(nowIso = new Date().toISOString()) {
  if (!month || !monthId) return;
  await settled(
    queued(saveMonthFields(monthId, { month: monthId, closedAt: '', updatedAt: nowIso })),
    deadlineFromNow(),
  );
  month.closedAt = '';
  cacheMonth();
  announce();
}

// Copy a previous month's closing counts into this month's opening — the button
// offered when a month is opened before the one before it was closed, and the
// repair when an earlier month is corrected later.
//
// Three different answers, and they must stay three: a number of figures moved,
// `0` for "that month has nothing", and `null` for "I could not read it".
export async function pullOpeningFromPrevious(previousId) {
  if (!month || !isMonthId(previousId) || isClosed(month)) return 0;
  let previous = null;
  try {
    previous = await getMonthOnce(previousId);
  } catch (err) {
    // ⚠️ A FAILED READ IS NOT AN EMPTY MONTH. On screen the two look identical
    // and mean opposite things — "there is nothing to carry" and "I could not
    // look" — and this is the one screen used where there is no signal.
    console.warn('Could not read the previous month:', err);
    return null;
  }
  const seed = carryOver(previous, month.id);
  const opening = seed ? seed.opening : {};
  const count = Object.keys(opening).length;
  if (!count) return 0;

  month.opening = { ...month.opening, ...opening };
  outbox = stageMany(outbox, 'opening', opening);
  cacheMonth();
  scheduleSave();
  announce();
  return count;
}
