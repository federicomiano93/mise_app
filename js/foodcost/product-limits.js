// product-limits.js — PURE, ZERO IMPORTS: the numbers firestore.rules accepts on a product,
// checked BEFORE a save.
//
// ⚠️ WHY THE EDITOR MUST ASK FIRST. A product is saved local-first: the editor goes back to the
// list at once and the database answers a moment later. A number the rules refuse — a 0 typed
// in «persone», a pack of 0 g — therefore fails AFTER the work has left the screen, and the
// rollback removes the new product (or restores the old one). Found by the code review of
// 14 Sep 2026: one zero in the wrong box threw away a whole product somebody had just built.
//
// ⚠️ THESE ARE THE RULES' NUMBERS, copied, and tests/foodcost-save-limits.test.mjs reads them
// back out of firestore.rules: change one side and the suite names the other.

// { key, min, minInclusive, max } — max null means no ceiling. A missing value (null) is
// always allowed: every one of these fields is optional.
export const PRODUCT_NUMBER_LIMITS = Object.freeze([
  Object.freeze({ key: 'piecesPerBatch', min: 0, minInclusive: false, max: null }),
  Object.freeze({ key: 'packSize', min: 0, minInclusive: false, max: 1000000 }),
  Object.freeze({ key: 'labourMinutes', min: 0, minInclusive: false, max: 100000 }),
  Object.freeze({ key: 'labourPeople', min: 0, minInclusive: false, max: 1000 }),
  Object.freeze({ key: 'sellingPrice', min: 0, minInclusive: false, max: null }),
  Object.freeze({ key: 'vatRate', min: 0, minInclusive: true, max: 100 }),
  Object.freeze({ key: 'foodCostTarget', min: 0, minInclusive: false, max: 100 }),
]);

// The hourly labour cost (foodcost-settings/main): more than 0, at most this.
export const LABOUR_RATE_MAX = 10000;

// Would the database accept this value for this field?
export function numberAllowed(limit, value) {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (limit.minInclusive ? value < limit.min : value <= limit.min) return false;
  return limit.max === null || value <= limit.max;
}

// The first field of `product` the database would refuse, or null when it would accept them all.
export function firstInvalidNumber(product) {
  const p = product || {};
  const bad = PRODUCT_NUMBER_LIMITS.find(limit => !numberAllowed(limit, p[limit.key]));
  return bad ? bad.key : null;
}

// Would the database accept this hourly rate? null clears it and is always allowed.
export function labourRateAllowed(value) {
  if (value === null || value === undefined) return true;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= LABOUR_RATE_MAX;
}
