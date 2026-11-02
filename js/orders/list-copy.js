// list-copy.js — a local copy of the last good supplier and ingredient lists, so the Orders page
// can draw its supplier list the moment the sign-in cover lifts instead of waiting for Firestore.
//
// WHY. Measured on the lab tablet (Chrome 101, 302 ingredients): the cover lifts at ~1.2 s but
// the supplier list appeared only at ~3.2 s, because render() waits for BOTH live snapshots and
// the ingredients one is the slow one. The copy paints the cards in that gap; the live data then
// replaces it.
//
// ⚠️ THE COPY IS ONLY FOR LOOKING. Nothing can be typed from it: the draft (the shared order)
// may not have landed yet, and a row from the copy can be out of date. Opening a supplier is
// HELD until the live lists land, what sends, records or edits from these lists does nothing until
// then (orders-main.js, whenLive), and `state.loaded` is never touched by the copy, so every banner
// and every check that needs live data stays silent until it has. The Incoming tab still works: it
// writes only to its own live history records, and borrows from the copy just a supplier's name and
// delivery days.
//
// ⚠️ ONLY WHAT A SUPPLIER CARD READS. No price (a manager's prices must not sit in this device's
// storage for an employee to read), no contact, no allergen, no pack list (P8) — and a small value
// is also a fast one to parse in the moment the cover lifts.
//
// ⚠️ IT TRUSTS NOTHING IT READS. Storage can hold anything (another version of the app, a
// half-written value, another venue's copy). Every refusal returns null and the page behaves as
// it did before this file existed. An EMPTY copy never paints: an empty venue would flash
// «no suppliers» before its real list arrived.
//
// The key must NOT start with a KEEP_PREFIXES entry (js/local-data.js): signing out or switching
// venue has to wipe it, it is one venue's data.

export const LIST_COPY_KEY = 'orders-list-copy';
export const LIST_COPY_VERSION = 1;

// How long after the last snapshot the copy is written. Stringifying ~300 documents is real
// work on a weak tablet and must not sit in the first seconds of the page.
export const LIST_COPY_WRITE_DELAY_MS = 3000;

const SUPPLIER_FIELDS = ['id', 'name', 'shortName', 'category', 'deliveryDays', 'orderDays', 'active'];
const INGREDIENT_FIELDS = ['id', 'name', 'supplierId', 'active', 'kind'];

function keepFields(list, fields) {
  return list
    .filter(item => item && typeof item === 'object')
    .map(item => Object.fromEntries(fields.filter(field => field in item).map(field => [field, item[field]])));
}

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function writeListCopy(lid, suppliers, ingredients, storage = defaultStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(LIST_COPY_KEY, JSON.stringify({
      v: LIST_COPY_VERSION,
      lid,
      suppliers: keepFields(suppliers, SUPPLIER_FIELDS),
      ingredients: keepFields(ingredients, INGREDIENT_FIELDS),
    }));
    return true;
  } catch {
    // Quota or a value JSON cannot hold. Never log the data. An older copy is removed rather
    // than left behind half-true.
    console.warn('Orders: the list copy could not be saved');
    try { storage.removeItem(LIST_COPY_KEY); } catch { /* ignore */ }
    return false;
  }
}

function cleanList(list) {
  if (!Array.isArray(list)) return null;
  return list.filter(item => item && typeof item === 'object' && !Array.isArray(item)
    && typeof item.id === 'string' && item.id !== '');
}

export function readListCopy(lid, storage = defaultStorage()) {
  if (!storage || !lid) return null;
  let parsed;
  try {
    const raw = storage.getItem(LIST_COPY_KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.v !== LIST_COPY_VERSION) return null;
  if (parsed.lid !== lid) return null;
  const suppliers = cleanList(parsed.suppliers);
  const ingredients = cleanList(parsed.ingredients);
  if (!suppliers || !ingredients) return null;
  if (suppliers.length === 0) return null;
  return { suppliers, ingredients };
}

// Both live snapshots have landed: the copy's job is over.
export function bothLanded(loaded) {
  return Boolean(loaded && loaded.suppliers && loaded.ingredients);
}

// Should the copy be painted now? Not once either live snapshot has landed, and not on the flat
// ingredient list (that one has quantity boxes on every row).
export function shouldShowCopy({ loaded, view }) {
  if (!loaded || loaded.suppliers || loaded.ingredients) return false;
  return view !== 'all';
}

// The supplier to open once live data landed: the held one, only if it still exists.
// `exists` is asked with the id; anything else opens nothing.
export function supplierToOpen(heldId, exists) {
  if (typeof heldId !== 'string' || heldId === '') return null;
  return exists(heldId) ? heldId : null;
}

// Whether the copy may be written now: both lists live, and they are the live ones.
export function mayWriteCopy({ loaded, lid }) {
  return bothLanded(loaded) && typeof lid === 'string' && lid !== '';
}
