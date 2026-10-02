// line-supplier.js — which supplier ONE draft line is going to. PURE: no DOM, no Firestore.
//
// A draft line has always belonged to its ingredient's supplier. «Ordina da un altro
// fornitore» (a missing line bought from somebody else, FOR THIS ORDER ONLY) adds one
// optional key to the line — `entries.<ingredientId>.supplierId` — that sends it to
// another supplier while the ingredient stays with its usual one.
//
// ⚠️ THIS FILE IS THE ONE PLACE THAT ANSWERS «WHOSE LINE IS IT?». The order flow reads
// ingredients through resolveSuppliers() (no-supplier.js), which asks lineSupplierId()
// here, so the supplier list, the counts, the message, the summary and the history record
// can never disagree about where the line goes. Never compare `ingredient.supplierId`
// to a supplier id in the order flow without going through that lens.
//
// ⚠️ THE OVERRIDE NEVER OUTLIVES THE LINE. It only counts while the line has a quantity,
// and every writer that takes a quantity to nothing takes the key away in the same write
// (changedEntries, quantityPathsFor, clearSupplier). An empty string is how a cleared key
// travels in a merge write — a merge cannot delete a nested key — so '' reads as «no
// override», exactly as `unit: ''` reads as «the card's own unit».

import { NO_SUPPLIER_ID } from '../records.js';

// A stored override, made safe: a non-empty trimmed string, else ''.
export function cleanSupplierId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// The same clamp the order rows use (archive.js wholeNumber), repeated here only so this
// file imports nothing from archive.js, which imports it.
function hasQuantity(entry) {
  const n = Math.round(Number(entry?.qty));
  return Number.isFinite(n) && n > 0;
}

// The override a draft line carries, or '' — only a line that is actually being ordered
// can be somebody else's.
export function overrideOf(entry) {
  return hasQuantity(entry) ? cleanSupplierId(entry?.supplierId) : '';
}

// The supplier this line is ordered from: its override when it has one and a quantity,
// else the ingredient's own supplier. Existence of the override's supplier is NOT checked
// here (this is pure, with no supplier list) — resolveSuppliers() does that and falls back.
export function lineSupplierId(ingredient, entry) {
  return overrideOf(entry) || ingredient?.supplierId;
}

// Ingredients (already resolved against the suppliers that exist) with every line that
// carries a VALID override filed under that supplier. A copy gets `supplierId = X` and
// `usualSupplierId = the usual one` (what the screens say in «di solito da …»); every
// other ingredient is returned as it is.
//
// «Valid» = the override names an ACTIVE supplier that is not the pseudo «no supplier». A
// supplier that was deleted or switched off after the override was written must never make
// the line vanish: it falls back to the usual supplier, where it is still ordered.
export function withLineSuppliers(ingredients, entries, suppliers) {
  const list = ingredients || [];
  if (!entries) return list;
  const active = new Set((suppliers || [])
    .filter(s => s && s.active !== false && s.id !== NO_SUPPLIER_ID)
    .map(s => s.id));

  return list.map(ing => {
    const to = lineSupplierId(ing, entries[ing.id]);
    if (!to || to === ing.supplierId || !active.has(to)) return ing;
    return { ...ing, supplierId: to, usualSupplierId: ing.supplierId };
  });
}

// A short fingerprint of WHO has an override right now, for a screen that must repaint
// when another phone moves a line (the rows are not rebuilt by a draft snapshot). Typing a
// quantity never changes it, so it never costs a repaint mid-keystroke.
export function overrideSignature(entries) {
  return Object.keys(entries || {}).sort()
    .map(id => [id, overrideOf(entries[id])])
    .filter(([, to]) => to)
    .map(([id, to]) => `${id}>${to}`)
    .join('|');
}
