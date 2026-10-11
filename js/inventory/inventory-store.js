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
import { guarded } from '../guard.js';
import { currentLocationId } from '../location.js';
import {
  normalizeMonth, carryOver, toDocument, readCount, isMonthId, nextMonth,
  monthBounds, COUNT_MAPS, isClosed,
} from './inventory-model.js';
import {
  EMPTY_OUTBOX, stage, stageMany, hasWork, take, answered, applyOver,
  echoed, unsaved, hasUnsaved, revive, isSending, hasHeld, release,
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

// What was typed here and is not yet in the browser's own database (see
// keepUnsaved). The venue is in it for the same reason.
function unsavedKey(monthId) {
  return `inventory-unsaved-${currentLocationId() || 'none'}-${monthId}`;
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
// The writes in the air, each one settling (never rejecting) once Firestore has
// answered it — which with no signal is never.
const inAir = new Set();
// Whether Firestore has answered at all yet. Until it has, the local copy is the
// only thing there is; afterwards it is a mirror.
let remoteArrived = false;
// The month exactly as Firestore last sent it, before anything of this phone's was
// laid over it — so the screen can be drawn again once the writes have answered.
let lastRemote = null;

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

// ⚠️⚠️ WHAT EXISTS ONLY IN THIS PAGE'S MEMORY IS WRITTEN DOWN AT ONCE, on every
// change to the outbox. A write handed to Firestore reaches the browser's own
// database a moment later, and a page torn down inside that moment — the last
// number typed and the back gesture straight after — took the number with it
// (emulator, 11 Oct 2026). localStorage is written before this line returns; the
// copy is laid back in when the month is next opened (reviveUnsaved), and removed
// once a snapshot has shown every number back.
// ⚠️ NOT the month copy above: the first snapshot rewrites that one, which is
// exactly how the counts used to vanish.
function keepUnsaved() {
  if (!monthId || !currentLocationId()) return;
  try {
    if (hasUnsaved(outbox)) localStorage.setItem(unsavedKey(monthId), JSON.stringify(unsaved(outbox)));
    else localStorage.removeItem(unsavedKey(monthId));
  } catch (e) {
    // Storage full or unavailable — the SDK's own queue still has every write.
  }
}

function announce() {
  if (notify) notify();
}

export function initInventory(id, onUpdate, onError) {
  monthId = isMonthId(id) ? id : null;
  notify = guarded('Inventory: screen refresh', onUpdate);
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
  authReady.then(fromThisPhone).catch(() => {});

  watchMonth(
    monthId,
    (remote, meta) => {
      remoteArrived = true;
      lastRemote = remote;
      // What the snapshot shows back is in the browser's database: no longer only
      // in this page's memory. Judged on the document AS IT ARRIVED.
      outbox = echoed(outbox, remoteMonth(), COUNT_MAPS);
      keepUnsaved();
      adoptRemote();
      if (meta && meta.fromServer) releaseHeld();
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

// A fresh copy of the month as Firestore last sent it.
function remoteMonth() {
  return normalizeMonth(lastRemote, monthId) || normalizeMonth({ month: monthId });
}

// The month on screen = what Firestore last sent + what this phone has not had
// confirmed yet.
//
// A remote change never discards what has not been sent yet: the local values for
// still-unsent boxes are laid back over the incoming document.
// ⚠️⚠️ EXCEPT OVER A CLOSED MONTH. It is shown as it was closed, and what this phone
// still holds for it stays held — not drawn, not sent (flush) — until the month is
// reopened. Otherwise a count left on one phone would change a closed month's
// figures weeks later, after the next month had already copied them (code review,
// 11 Oct 2026). The SDK has already laid its own unanswered writes into `remote`.
function adoptRemote() {
  const merged = remoteMonth();
  if (!isClosed(merged)) applyOver(outbox, merged, COUNT_MAPS);
  month = merged;
  cacheMonth();
  announce();
}

// What this phone kept for this month, once the venue is open (its name is in
// both keys): the month as it was last seen, then what had not reached the
// browser's database when the page last went away.
function fromThisPhone() {
  hydrateFromCache();
  reviveUnsaved();
}

// Numbers a torn-down page left behind (keepUnsaved), laid back over the month as
// HELD: on screen and kept, not sent (releaseHeld). Anything typed since is newer
// and wins (revive()).
function reviveUnsaved() {
  if (!monthId || !month) return;
  const saved = readJson(unsavedKey(monthId), null);
  if (saved) {
    outbox = revive(outbox, saved, COUNT_MAPS);
  }
  // Written down now in any case: the venue was not known until this moment.
  keepUnsaved();
  // Not over a month known to be closed (adoptRemote says why): kept for its reopening.
  if (!saved || !hasHeld(outbox) || isClosed(month)) return;
  applyOver(outbox, month, COUNT_MAPS);
  cacheMonth();
  announce();
}

// ⚠️⚠️ WHAT AN EARLIER VISIT LEFT GOES ONLY ONCE THE SERVER SAYS THE MONTH IS OPEN —
// never on the strength of this phone's own copy, which can be days old. Driven on
// the emulator (11 Oct 2026): a count left on the phone, the month closed from
// another device, the phone back online — sent at once from its stale copy, the
// count landed in the closed month. Sending one that did reach Firestore after all
// writes the same number twice and loses nothing.
function releaseHeld() {
  if (!hasHeld(outbox) || isClosed(month)) return;
  outbox = release(outbox);
  keepUnsaved();
  scheduleSave();
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
  keepUnsaved();

  cacheMonth();
  scheduleSave();
  announce();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { flush(); }, SAVE_DELAY_MS);
}

// Send everything that has changed. Kept as ONE write so a count and a cleared
// box beside it can never half-land. Answers when every write sent so far has
// answered — which with no signal is never, hence flushBeforeLeaving().
//
// ⚠️⚠️ IT NEVER WAITS FOR AN EARLIER WRITE. It used to keep one write in the air
// and hold every later count in memory behind it; with no signal that write never
// answers, so only the FIRST count of a storeroom reached the SDK's own queue —
// the one in the browser's database, which outlasts the page. Closing the app,
// changing month or going Home before signal lost all the others (found 11 Oct
// 2026). Handed over at once, every count is in that queue and goes up, in order,
// when there is signal. The outbox keeps the books for several writes at once
// (answered(), js/inventory/inventory-outbox.js).
//
// ⚠️⚠️ NOTHING IS SENT INTO A CLOSED MONTH, the same promise setCount() keeps: what
// is waiting stays waiting until the month is reopened (adoptRemote says why).
export function flush() {
  clearTimeout(saveTimer);
  if (!month || !monthId) return Promise.resolve();
  if (hasWork(outbox) && !isClosed(month)) send();
  return Promise.all([...inAir]).then(() => {});
}

function send() {
  const taken = take(outbox);
  outbox = taken.outbox;
  keepUnsaved();

  const patch = { month: monthId, updatedAt: new Date().toISOString() };
  if (!month.createdAt) {
    month.createdAt = patch.updatedAt;
    patch.createdAt = patch.updatedAt;
  }
  for (const [map, values] of Object.entries(taken.values)) patch[map] = { ...values };

  const write = saveMonthFields(monthId, patch, taken.clear).then(
    () => true,
    err => {
      console.warn('The stocktake did not reach Firestore:', err);
      reportSyncFailure();
      return false;
    },
  ).then(ok => {
    outbox = answered(outbox, ok);
    keepUnsaved();
    inAir.delete(write);
    // Every write has answered: nothing of this phone's is in the air any more, so
    // the screen is drawn again from what Firestore last sent. Until now its own
    // numbers were laid over that, hiding a correction another phone made meanwhile.
    if (!isSending(outbox) && lastRemote) adoptRemote();
  });
  inAir.add(write);
}

// Send what is waiting and answer within the bound, whatever the network is doing.
//
// ⚠️ FOR THE CALLER THAT IS ABOUT TO TAKE THE PAGE AWAY — changing month reloads
// it, going Home leaves it. flush() answers when the WRITE does, which with no
// signal is never, so chaining a navigation onto it makes the month arrows dead
// buttons. The wait is still worth having: it gives the SDK the moment it needs to
// put the write in the browser's own database before the page is gone.
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
    // The PRICED ingredients: a case of packages (what lets a line in «busta» be counted
    // in «cartone») is stored in the price document, which `ingredients` already merges.
    const byId = Object.fromEntries(ingredients.map(i => [i.id, i]));
    return { ...purchasesInMonth(records, monthId, byId), failed: false };
  } catch (err) {
    console.warn('Could not read the orders of this month:', err);
    return { totals: {}, orders: 0, products: 0, unconverted: [], failed: true };
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
  keepUnsaved();

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
  // What this phone was holding while the month was closed comes back, and goes:
  // reopened here, this phone has just told the server so.
  outbox = release(outbox);
  keepUnsaved();
  if (hasWork(outbox)) {
    applyOver(outbox, month, COUNT_MAPS);
    scheduleSave();
  }
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
  keepUnsaved();
  cacheMonth();
  scheduleSave();
  announce();
  return count;
}
