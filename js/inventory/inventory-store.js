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
// in `pending` so the next save carries it too.
//
// ⚠️ FUNCTION DECLARATIONS, NOT const ARROWS, for anything called from the
// initialisation below: a declaration is hoisted, a const arrow throws "Cannot
// access before initialization" and leaves the page blank with nothing on screen
// to explain it.

import { t } from '../i18n.js';
import { currentLocationId } from '../location.js';
import {
  normalizeMonth, carryOver, toDocument, readCount, isMonthId, nextMonth,
  monthBounds, COUNT_MAPS,
} from './inventory-model.js';
import { purchasesInMonth } from './inventory-purchases.js';
import {
  watchMonth, watchIngredients, getMonthOnce, getOrdersInMonth, saveMonthFields,
} from './firebase-inventory.js';

// How long after the last keystroke the count is sent. Long enough that typing
// "12" is one write and not two, short enough that putting the phone down saves.
const SAVE_DELAY_MS = 700;

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

let monthId = null;
let month = null;
let ingredients = [];
let notify = null;
let onSyncError = null;

// What has changed since the last write reached Firestore. `pending` holds the
// maps and their new values; `cleared` holds the dotted paths of boxes that were
// emptied, which a merge cannot express as a value.
let pending = {};
let cleared = new Set();
let saveTimer = null;

export function getMonth() { return month; }
export function getMonthId() { return monthId; }
export function getIngredients() { return ingredients; }

export function setSyncErrorHandler(fn) {
  onSyncError = typeof fn === 'function' ? fn : null;
}

function cacheMonth() {
  if (month) writeJson(cacheKey(month.id), toDocument(month));
}

function announce() {
  if (notify) notify();
}

export function initInventory(id, onUpdate, onError) {
  monthId = isMonthId(id) ? id : null;
  notify = typeof onUpdate === 'function' ? onUpdate : null;
  if (!monthId) return null;

  month = normalizeMonth(readJson(cacheKey(monthId), null), monthId)
    || normalizeMonth({ month: monthId });

  watchMonth(
    monthId,
    remote => {
      // A remote change never discards what has not been sent yet: the local
      // values for still-pending boxes are laid back over the incoming document.
      const merged = normalizeMonth(remote, monthId) || normalizeMonth({ month: monthId });
      applyPendingOver(merged);
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

function applyPendingOver(target) {
  for (const [map, values] of Object.entries(pending)) {
    if (!COUNT_MAPS.includes(map)) continue;
    Object.assign(target[map], values);
  }
  for (const path of cleared) {
    const [map, id] = path.split('.');
    if (COUNT_MAPS.includes(map)) delete target[map][id];
  }
}

// Change one box. `value` is whatever was typed; an empty one CLEARS the entry
// rather than storing a zero (js/inventory/inventory-model.js says why at length).
export function setCount(map, ingredientId, value) {
  if (!month || !COUNT_MAPS.includes(map) || !ingredientId) return;
  const n = readCount(value);
  const path = `${map}.${ingredientId}`;

  if (n === null) {
    delete month[map][ingredientId];
    if (pending[map]) delete pending[map][ingredientId];
    cleared.add(path);
  } else {
    month[map][ingredientId] = n;
    pending[map] = { ...(pending[map] || {}), [ingredientId]: n };
    cleared.delete(path);
  }

  cacheMonth();
  scheduleSave();
  announce();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, SAVE_DELAY_MS);
}

// Send everything that has changed. Kept as ONE write so a count and a cleared
// box beside it can never half-land.
export function flush() {
  clearTimeout(saveTimer);
  if (!month || !monthId) return Promise.resolve();
  const keys = Object.keys(pending).filter(map => Object.keys(pending[map]).length);
  if (!keys.length && !cleared.size) return Promise.resolve();

  const patch = { month: monthId, updatedAt: new Date().toISOString() };
  if (!month.createdAt) {
    month.createdAt = patch.updatedAt;
    patch.createdAt = patch.updatedAt;
  }
  keys.forEach(map => { patch[map] = { ...pending[map] }; });
  const clearPaths = [...cleared];

  // Taken out BEFORE the write, and put back only if it fails: an edit made while
  // the write is in flight must not be wiped by its success.
  const sent = pending;
  pending = {};
  cleared = new Set();

  return saveMonthFields(monthId, patch, clearPaths).catch(err => {
    console.warn('The stocktake did not reach Firestore:', err);
    for (const [map, values] of Object.entries(sent)) {
      pending[map] = { ...values, ...(pending[map] || {}) };
    }
    clearPaths.forEach(path => cleared.add(path));
    if (onSyncError) onSyncError(t('inv.notSavedYet'));
  });
}

// Close the month: stamp it, freeze what it was worth, and open the next one with
// this one's closing counts as its opening.
//
// ⚠️ THE NEXT MONTH IS WRITTEN FIRST. If the two writes are done the other way
// round and the second fails, September is closed and October does not exist —
// and October's openings are then gone, because they only ever existed as
// September's closings. This order fails towards "closed nothing, lost nothing".
export async function closeMonth(frozen, nowIso = new Date().toISOString()) {
  if (!month || !monthId) return null;
  await flush();

  const next = carryOver(month, nextMonth(monthId), nowIso);
  if (next) {
    await saveMonthFields(next.month, {
      month: next.month,
      opening: next.opening,
      packKg: next.packKg,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  const patch = {
    month: monthId,
    closedAt: nowIso,
    updatedAt: nowIso,
    names: frozen && frozen.names ? frozen.names : {},
    unitPrice: frozen && frozen.unitPrice ? frozen.unitPrice : {},
    packKg: frozen && frozen.packKg ? frozen.packKg : month.packKg,
  };
  await saveMonthFields(monthId, patch);
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
  if (!month || !totals) return 0;
  const wanted = {};
  for (const [id, value] of Object.entries(totals)) {
    const n = readCount(value);
    if (n !== null && n > 0) wanted[id] = n;
  }
  Object.keys(month.purchased).forEach(id => {
    if (!(id in wanted)) {
      delete month.purchased[id];
      if (pending.purchased) delete pending.purchased[id];
      cleared.add(`purchased.${id}`);
    }
  });
  Object.entries(wanted).forEach(([id, n]) => {
    month.purchased[id] = n;
    pending.purchased = { ...(pending.purchased || {}), [id]: n };
    cleared.delete(`purchased.${id}`);
  });

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
  await saveMonthFields(monthId, { month: monthId, closedAt: '', updatedAt: nowIso });
  month.closedAt = '';
  cacheMonth();
  announce();
}

// Copy a previous month's closing counts into this month's opening — the button
// offered when a month is opened before the one before it was closed, and the
// repair when an earlier month is corrected later.
export async function pullOpeningFromPrevious(previousId) {
  if (!month || !isMonthId(previousId)) return 0;
  const previous = await getMonthOnce(previousId);
  const seed = carryOver(previous, month.id);
  const opening = seed ? seed.opening : {};
  const count = Object.keys(opening).length;
  if (!count) return 0;

  month.opening = { ...month.opening, ...opening };
  pending.opening = { ...(pending.opening || {}), ...opening };
  Object.keys(opening).forEach(id => cleared.delete(`opening.${id}`));
  cacheMonth();
  scheduleSave();
  announce();
  return count;
}
