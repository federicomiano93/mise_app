// not-in-use.js — an ingredient switched off while it still holds a quantity. PURE.
//
// Since the row switch in Fornitori, anybody can set an ingredient to `active: false` with one
// tap. The order flow hides an inactive ingredient everywhere, so one switched off while it held
// a quantity in the shared draft (drafts/current.entries[id].qty) used to VANISH from Orders: its
// quantity was never sent, and it came back if switched on again.
//
// The rule: an inactive ingredient whose draft entry holds a positive quantity STAYS in the
// order flow, its row saying «Non in uso», until the order is sent or the quantity is cleared.
//
// STICKY, on purpose: once held, an id stays held for the rest of the page's life even if its
// quantity goes to 0 — otherwise the row would vanish from under the finger correcting it
// (deleting «3» to type «4»). Only a send or a clear releases it (releaseHeld).
//
// `active` itself is NEVER touched: a card opened from Orders must still see `active: false`.
// The mark is a separate, in-memory `notInUse: true` on a copy of the item.

import { t } from '../i18n.js';

// Does the order flow show this ingredient?
export function inOrderFlow(ing) {
  return ing.active !== false || ing.notInUse === true;
}

// Read the defensive way orderSummary does (never NaN). Not archive.js's wholeNumber: archive.js
// imports this file, and a cycle between the two is not worth a shared helper.
function holdsQuantity(entries, id) {
  const qty = Number(entries?.[id]?.qty);
  return Number.isFinite(qty) && qty > 0;
}

// Add to `heldSet` every inactive ingredient whose draft entry holds a quantity, and return a
// stable signature of the ids currently BOTH inactive AND held — the memo key for the marked
// list, because the entries are mutated in place.
export function noteHeld(ingredients, entries, heldSet) {
  const ids = [];
  (ingredients || []).forEach(ing => {
    // Switched back on: nothing to hold. Forgetting it here means a later switch-off with an
    // empty quantity does not bring the row back.
    if (ing.active !== false) { heldSet.delete(ing.id); return; }
    if (holdsQuantity(entries, ing.id)) heldSet.add(ing.id);
    if (heldSet.has(ing.id)) ids.push(String(ing.id));
  });
  return ids.sort().join('\n');
}

// A NEW array: each inactive item whose id is held is replaced by a marked copy.
export function markHeld(ingredients, heldSet) {
  return (ingredients || []).map(item =>
    item.active === false && heldSet.has(item.id) ? { ...item, notInUse: true } : item);
}

// After a send or a clear: let go of each of `ids` whose entry no longer holds a quantity.
export function releaseHeld(heldSet, ids, entries) {
  (ids || []).forEach(id => {
    if (!holdsQuantity(entries, id)) heldSet.delete(id);
  });
}

// The line under a row's name: «Non in uso», joined with any other note by « · ».
// Read at paint time (the language can change).
export function lineNoteText(ing, base = '') {
  return [ing?.notInUse === true ? t('orders.line.notInUse') : '', base]
    .filter(Boolean).join(' · ');
}
