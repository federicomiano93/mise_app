// invoice-import-plan.js — the decisions of the «Import from invoices» screen and the shape of its
// writes, kept PURE (no Firebase, no DOM) so every rule runs under node --test (P15).
//
// Three jobs:
//   1. planBatchWrites — the model's ops (invoice-import-model.js ingredientWrites) turned into the
//      exact documents a data layer sets, with a minted id for a NEW ingredient filled into every later op.
//   2. the screen's view of a plan: a person's decisions applied, the filter chips and their counts, the
//      totals the confirmation dialog quotes.
//   3. replanRow — the re-check that runs right before each row is written, on data read from the
//      server a moment ago, so a catalogue that changed during the import never gets a duplicate.
//
// ⚠️ NO ALLERGEN, NUTRITION OR PACK-INGREDIENT KEY CAN PASS planBatchWrites: the model never builds one
// (an invoice line says nothing about what a product contains), and this refuses one anyway.

import { planIngredients, resolveRow } from './invoice-import-model.js';

const INGREDIENTS = 'ingredients';
const INGREDIENT_PRICES = 'ingredient-prices';
const PRICES = 'prices';

export const FORBIDDEN_KEYS = Object.freeze([
  'allergens', 'mayContain', 'allergensCheckedAt', 'nutrition', 'packIngredients',
]);

// The ops of ONE row's batches → { batches: [[{ path, data, merge }]], ingredientId }.
//   path   — segments relative to the venue's folder: ['ingredients', id, 'prices', pointId]
//   merge  — true for every write except a history point, which is create-only (a second create of
//            the same `inv-<invoice>-<line>` id is what the rules refuse)
//   bakery — the venue id stamped on every document (the rules' stampedFor)
//   mintId — () => a fresh ingredient id, called ONCE per create-ingredient op, before anything is
//            written, so the id exists for the ops that come after it in the same row.
export function planBatchWrites(batches, { mintId, bakery } = {}) {
  let ingredientId = null;
  const out = (batches || []).map(batch => (batch || []).map(op => {
    if (op.type === 'create-ingredient') {
      ingredientId = mintId();
      return write([INGREDIENTS, ingredientId], op.data, true, bakery);
    }
    const id = op.ingredientId ?? ingredientId;
    if (typeof id !== 'string' || !id) throw new Error(`The ${op.type} write has no ingredient to go to`);
    ingredientId = id;
    if (op.type === 'patch-ingredient') return write([INGREDIENTS, id], op.data, true, bakery);
    if (op.type === 'set-current-price') return write([INGREDIENT_PRICES, id], op.data, true, bakery);
    if (op.type === 'add-price-point') {
      if (typeof op.pointId !== 'string' || !op.pointId) throw new Error('A price point has no id');
      return write([INGREDIENTS, id, PRICES, op.pointId], op.data, false, bakery);
    }
    throw new Error(`Unknown import write: ${op.type}`);
  }));
  return { batches: out, ingredientId };
}

function write(path, data, merge, bakery) {
  const keys = Object.keys(data || {});
  const forbidden = keys.filter(k => FORBIDDEN_KEYS.includes(k));
  if (forbidden.length > 0) throw new Error(`An import may never write ${forbidden.join(', ')}`);
  return { path, data: { ...data, bakery }, merge };
}

// ── Why a write stopped ──────────────────────────────────────────────────────────

// 'permission' | 'offline' | null. These two STOP the whole run: another row would fail the same way,
// and ten more refusals teach nobody anything.
export function stopKind(err) {
  const code = err && typeof err.code === 'string' ? err.code.replace(/^firestore\//, '') : '';
  if (code === 'permission-denied') return 'permission';
  if (code === 'offline' || code === 'unavailable' || code === 'timeout') return 'offline';
  return null;
}

// ── The screen's view of a plan ──────────────────────────────────────────────────

const WRITES = ['new', 'update-price', 'history-only'];
const WAITING = ['maybe-duplicate', 'choose'];

// planned rows + the person's decisions → [{ planned, row, waiting }]. `row` is the effective row (what
// would be written); `waiting` is true while somebody still has to answer.
export function applyDecisions(plannedRows, decisions, ctx) {
  return (plannedRows || []).map(planned => {
    const decision = decisions ? decisions[planned.key] : undefined;
    const row = decision ? resolveRow(planned, decision, ctx) : planned;
    return { planned, row, waiting: WAITING.includes(row.status) };
  });
}

// The chip a row is counted under. ⚠️ BY WHAT IT WAS PLANNED AS: a row that waits for an answer stays under
// «To decide» once answered, so it does not jump to another chip under the finger that just answered it.
export function bucketOf(entry) {
  if (WAITING.includes(entry.planned.status)) return 'decide';
  return entry.row.status;   // new · update-price · history-only · unchanged · error
}

export const FILTERS = Object.freeze(['all', 'new', 'update-price', 'history-only', 'unchanged', 'decide', 'error']);

export function filterCounts(entries) {
  const counts = { all: entries.length, new: 0, 'update-price': 0, 'history-only': 0, unchanged: 0, decide: 0, error: 0 };
  entries.forEach(entry => { counts[bucketOf(entry)] += 1; });
  return counts;
}

// The chips worth showing: «All», the one that is on, and every other with something under it. On a 296 px
// phone seven chips with six zeros took half the screen.
export function visibleFilters(counts, active) {
  return FILTERS.filter(f => f === 'all' || f === active || counts[f] > 0);
}

export function entriesFor(entries, filter) {
  return filter === 'all' ? entries.slice() : entries.filter(entry => bucketOf(entry) === filter);
}

export const waitingCount = (entries) => entries.filter(entry => entry.waiting).length;

export const writesRow = (entry) => WRITES.includes(entry.row.status);

// What the confirmation says: how many rows write, how many ingredients are created, how many prices.
export function importTotals(entries) {
  const writing = entries.filter(writesRow);
  return {
    rows: writing.length,
    newIngredients: writing.filter(e => e.row.status === 'new').length,
    pricesAdded: writing.reduce((sum, e) => sum + e.row.newPoints.length, 0),
  };
}

// The ingredient ids whose invoice points must be read before the plan is trusted: the ones a row is
// matched to, and every candidate a person might pick.
export function idsToCheck(rows) {
  const ids = new Set();
  (rows || []).forEach(row => {
    if (row.ingredientId) ids.add(row.ingredientId);
    (row.candidates || []).forEach(c => ids.add(c.id));
  });
  return [...ids];
}

// How many different invoices a row's prices come from.
export function invoiceCount(row) {
  return new Set((row.allPoints || []).map(p => p.invoiceId)).size;
}

// ── The re-check before suppliers are written ────────────────────────────────────

const candidateIds = (entry) => (entry.candidates || []).map(c => c.id).sort().join(',');

// What the owner confirmed against what the server holds now. → the keys of the file suppliers whose answer
// is no longer the same (status, the supplier it is, or who it might be). `settled` are the keys this very
// import already wrote: they exist now by its own doing, so «new → present» is not a change.
export function changedSupplierKeys(before, after, settled = []) {
  const done = new Set(settled);
  const now = new Map((after || []).map(e => [e.key, e]));
  const changed = [];
  (before || []).forEach(old => {
    if (done.has(old.key)) return;
    const fresh = now.get(old.key);
    if (!fresh || fresh.status !== old.status || (fresh.supplierId || '') !== (old.supplierId || '')
      || candidateIds(fresh) !== candidateIds(old)) {
      changed.push(old.key);
    }
  });
  return changed;
}

// ── The re-check before each row is written ──────────────────────────────────────

// The same plan the screen showed, computed again on what the database holds NOW.
//   read = { ingredients(supplierId) → [ingredient], pointIds(ingredientId) → Set, price(ingredientId) → doc|null }
// → { row, waiting }. A row that is waiting here was not decided: the catalogue changed under it (a
// similar ingredient appeared — maybe the one this very import created a moment ago), so the caller
// leaves it for the next run rather than guess.
export async function replanRow({ fileIngredient, decision, supplierIdByKey, read }) {
  const supplierId = supplierIdByKey ? supplierIdByKey[fileIngredient.supplierKey] : undefined;
  const ingredients = typeof supplierId === 'string' && supplierId ? await read.ingredients(supplierId) : [];
  const plan = (extra) => {
    const ctx = { supplierIdByKey, ingredients, pricesById: {}, invoicePointIds: {}, ...extra };
    const first = planIngredients([fileIngredient], ctx)[0];
    return { ctx, row: decision ? resolveRow(first, decision, ctx) : first };
  };
  const pass0 = plan();
  // The ingredient it matched, AND every candidate of a question: a decision the owner made last month is
  // remembered by the prices it left on one of those candidates (questionOrRemembered in the model).
  const ids = idsToCheck([pass0.row]);
  if (ids.length === 0) return { row: pass0.row, waiting: WAITING.includes(pass0.row.status) };
  const sets = await Promise.all(ids.map(id => read.pointIds(id)));
  const invoicePointIds = {};
  ids.forEach((id, i) => { invoicePointIds[id] = sets[i]; });
  const pass1 = plan({ invoicePointIds });
  let row = pass1.row;
  const matched = row.ingredientId;
  if (matched) {
    const price = await read.price(matched);
    row = plan({ invoicePointIds, pricesById: { [matched]: price } }).row;
  }
  return { row, waiting: WAITING.includes(row.status) };
}

// ── The end-of-run summary ───────────────────────────────────────────────────────

// results: [{ key, name, outcome: 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed', pricesAdded?, reason?,
//             retry? }] — `retry` is true when loading the same file again can fix the failure (a write that
// failed, a timeout, a catalogue that changed); a file entry that is invalid cannot be fixed that way.
export function summarizeRun(results, { stopped = null, notRun = 0 } = {}) {
  const totals = { created: 0, updated: 0, pricesAdded: 0, unchanged: 0, skipped: 0, failed: [], stopped, notRun };
  (results || []).forEach(r => {
    if (r.outcome === 'failed') totals.failed.push({ key: r.key, name: r.name, reason: r.reason || '', retry: r.retry === true });
    else totals[r.outcome] += 1;
    totals.pricesAdded += r.pricesAdded || 0;
  });
  totals.retryable = totals.failed.filter(f => f.retry).length;
  totals.notFixableByRetry = totals.failed.length - totals.retryable;
  return totals;
}

// The reasons a second load of the same file can fix: the ingredient the owner picked is gone, so the
// question comes back. Every other reason of an error row is in the file itself.
export const isRetryableReason = (code) => code === 'target-not-found';

// «To skip this question next month …»: the rows the owner answered by hand with «Same as X» that carry NO
// article code — with a code the next run finds X by itself. → [{ name, target }], target = X's label.
export function rememberHints(entries, decisions, labelOf) {
  const out = [];
  (entries || []).forEach(({ planned, row }) => {
    const d = decisions ? decisions[planned.key] : null;
    if (!d || typeof d.sameAs !== 'string' || planned.supplierCode) return;
    if (!WRITES.includes(row.status) && row.status !== 'unchanged') return;
    const target = labelOf(d.sameAs, planned);
    if (target) out.push({ name: planned.name, target });
  });
  return out;
}
