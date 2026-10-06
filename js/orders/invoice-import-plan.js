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

import { planIngredients, resolveRow, packLabelOf, MAX_DOCS_PER_BATCH } from './invoice-import-model.js';
import { changesFromPoints } from './price-changes-model.js';

const INGREDIENTS = 'ingredients';
const PRICE_CHANGES = 'price-changes';
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
    if (op.type === 'add-price-change') {
      if (typeof op.changeId !== 'string' || !op.changeId) throw new Error('A price change has no id');
      return write([PRICE_CHANGES, op.changeId], op.data, false, bakery);
    }
    if (op.type === 'remove-price-change') {
      if (typeof op.changeId !== 'string' || !op.changeId) throw new Error('A price change has no id');
      return { path: [PRICE_CHANGES, op.changeId], remove: true };
    }
    throw new Error(`Unknown import write: ${op.type}`);
  }));
  return { batches: out, ingredientId };
}

// ── The price changes an import finds ────────────────────────────────────────────

// The stored history points of an ingredient (docs = [{ id, data }], each `inv-<invoice>-<line>`) → what
// changesFromPoints reads. The line is not stored in the point, only in its id.
export function pointsOfDocs(docs) {
  const out = [];
  (docs || []).forEach(({ id, data }) => {
    const m = /^inv-(\d+)-(\d+)$/.exec(String(id));
    if (!m || !data) return;
    out.push({
      invoiceId: typeof data.invoiceId === 'string' && data.invoiceId ? data.invoiceId : m[1],
      line: Number(m[2]),
      invoiceDate: data.invoiceDate,
      pricePerUnit: data.pricePerUnit,
      priceUnit: data.priceUnit,
      // Which pack the price was paid for: its article code decides «another pack», its label is only words
      // (changesFromPoints). A point stored before packs existed has neither: planPriceChanges fills them in
      // from the ingredient.
      ...(typeof data.unitWeightKg === 'number' ? { unitWeightKg: data.unitWeightKg } : {}),
      ...(typeof data.packCode === 'string' && data.packCode ? { packCode: data.packCode } : {}),
      ...(typeof data.packLabel === 'string' && data.packLabel ? { pack: data.packLabel } : {}),
    });
  });
  return out;
}

// ⚠️ What the rules accept of a change, checked HERE too: one refused document in a batch would stop the run.
const CHANGE_UNITS = ['kg', 'l', 'pcs'];
const MAX_NAME = 200;
const MAX_ID = 100;
const acceptable = (c) => /^\d{1,20}$/.test(c.invoiceId) && c.line <= 999999 && CHANGE_UNITS.includes(c.priceUnit)
  && (c.supplierId === undefined || (typeof c.supplierId === 'string' && c.supplierId.length <= MAX_ID));

// A stored change is the same fact as an expected one when every field a later import could move is equal.
const sameChange = (stored, c) => stored.oldPrice === c.oldPrice && stored.newPrice === c.newPrice
  && stored.oldDate === c.oldDate && stored.priceUnit === c.priceUnit;

// The price-change writes a row's ingredient needs → { create, remove }.
//   create — [{ type: 'add-price-change', ingredientId, changeId, data }], in date order
//   remove — [{ type: 'remove-price-change', ingredientId, changeId }]
// Points = those ALREADY stored as invoice points + the ones this row is about to write (a point in both counts
// once). ⚠️ A change is create-only, so an invoice that arrives OUT OF ORDER (a February one after March's was
// recorded) would leave March's change comparing the wrong two prices for ever: every stored change that is no
// longer expected, or whose old/new price, old date or unit differ, is REMOVED and written again. A second import of
// the same file therefore plans nothing. `isNew`: the ingredient was created a moment ago, so it cannot have any
// (no read). read = { changeIds(ingredientId) → [{ id, oldPrice, newPrice, oldDate, date, priceUnit }] } — a server
// read, refused offline; not made when nothing is expected and nothing new is written.
// `packLabel`, `packCode` and `unitWeightKg` describe the pack the NEW points were paid for (the file's);
// `ingredient` is the STORED ingredient: a stored point with no pack code takes its main article code, and one
// with no label takes its name + weight as they are NOW (computed, never written). Packs alone never make a
// stored change differ.
export async function planPriceChanges({
  ingredientId, supplierId, name, storedPoints, newPoints, priceUnit, isNew, read, nowIso, packLabel, packCode, unitWeightKg, ingredient,
}) {
  const none = { create: [], remove: [] };
  if (typeof ingredientId !== 'string' || !ingredientId || ingredientId.length > MAX_ID) return none;
  const mainCode = typeof ingredient?.supplierCode === 'string' ? ingredient.supplierCode.trim() : '';
  const ownLabel = ingredient ? packLabelOf({ name: String(ingredient.name || '').slice(0, MAX_NAME), weight: ingredient.weight }) : '';
  const known = (storedPoints || []).map(p => ({
    ...p,
    ...(!p.packCode && mainCode ? { packCode: mainCode } : {}),
    ...(!p.pack && ownLabel ? { pack: ownLabel } : {}),
  }));
  const fresh = (newPoints || []).map(p => ({
    invoiceId: p.invoiceId, line: p.line, invoiceDate: p.invoiceDate, pricePerUnit: p.pricePerUnit, priceUnit,
    ...(priceUnit === 'pcs' && typeof unitWeightKg === 'number' ? { unitWeightKg } : {}),
    ...(packCode ? { packCode } : {}),
    ...(packLabel ? { pack: packLabel } : {}),
  }));
  const label = String(name ?? '').trim().slice(0, MAX_NAME);
  const found = changesFromPoints({ id: ingredientId, supplierId, name: label }, [...known, ...fresh])
    .filter(acceptable);
  if (found.length === 0 && (isNew || fresh.length === 0)) return none;
  const stored = isNew ? [] : [...(await read.changeIds(ingredientId))];
  const storedById = new Map(stored.map(x => [x.id, x]));
  const expectedById = new Map(found.map(c => [c.id, c]));
  const remove = stored
    .filter(x => !expectedById.has(x.id) || !sameChange(x, expectedById.get(x.id)))
    .map(x => ({ type: 'remove-price-change', ingredientId, changeId: x.id }));
  const gone = new Set(remove.map(r => r.changeId));
  const create = found.filter(c => !storedById.has(c.id) || gone.has(c.id)).map(({ id, ...data }) => ({
    type: 'add-price-change', ingredientId, changeId: id, data: { ...data, recordedAt: nowIso },
  }));
  return { create, remove };
}

// Change ops → batches of at most MAX_DOCS_PER_BATCH, to run AFTER the row's own writes: a refused change
// must never undo the prices that went in before it. Accepts the { create, remove } of planPriceChanges: the
// removals come FIRST (a change removed and written again keeps its id), then the creations.
export function priceChangeBatches(ops) {
  const list = Array.isArray(ops) ? ops : [...(ops.remove || []), ...(ops.create || [])];
  const out = [];
  const flush = (kind) => {
    const group = list.filter(op => (op.type === 'remove-price-change') === (kind === 'remove'));
    for (let i = 0; i < group.length; i += MAX_DOCS_PER_BATCH) out.push(group.slice(i, i + MAX_DOCS_PER_BATCH));
  };
  flush('remove');
  flush('create');
  return out;
}

// The name a screen shows for a stored ingredient (its short name when it has one).
export const ingredientDisplayName = (ing) => (String(ing?.shortName || '').trim() || String(ing?.name || ''));

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

// ⚠️ A MATCHED ROW THAT CARRIES A `checkReason` (the price comes from a reading a person must look at) WRITES NOTHING
// UNTIL THE PERSON CONFIRMS IT. A NEW row keeps its own «create / do not import» answer instead.
export const needsConfirmation = (row) => Boolean(row && row.checkReason) && ['update-price', 'history-only'].includes(row.status);

// ⚠️ A RENAME IS ITS OWN CHOICE, NEVER PART OF A PRICE CONFIRMATION. The model proposes it as `row.invoiceRename`
// ({ stored, file }); it is written only when the person picked «Save the new name» for exactly THAT old → new pair.
// `choice` is the pair the person saw. A row that now shows another pair (the catalogue or the file moved) writes
// nothing of it.
export function withRename(row, choice) {
  const pair = row && row.invoiceRename;
  if (!pair || !choice || choice.stored !== pair.stored || choice.file !== pair.file) return row;
  return { ...row, patchInvoiceName: pair.file };
}

// The row as it must be written, from the plan made again right before the write: null when it must not be written
// (a price that needs a look which nobody confirmed), else the row with the rename only if the person chose it.
export function rowToWrite(fresh, { confirmed = false, rename = null } = {}) {
  if (!fresh) return null;
  if (needsConfirmation(fresh) && !confirmed) return null;
  return withRename(fresh, rename);
}

// planned rows + the person's decisions → [{ planned, row, waiting }]. `row` is the effective row (what
// would be written); `waiting` is true while somebody still has to answer.
// `forgetKeys` (a Set of keys) are NEW rows the person answered «Do not import (remember)»: they become skipped.
// `confirmKeys` (a Set of keys) are the rows with a `checkReason` the person answered «Use this price»; the others
// are held back (status 'skipped', `held: true`) — they come back on the next import.
export function applyDecisions(plannedRows, decisions, ctx, forgetKeys, confirmKeys, renames) {
  return (plannedRows || []).map(planned => {
    const decision = decisions ? decisions[planned.key] : undefined;
    let row = decision ? resolveRow(planned, decision, ctx) : planned;
    if (forgetKeys && forgetKeys.has(planned.key) && row.status === 'new') {
      row = { ...row, status: 'skipped', newPoints: [], updateCurrent: false };
    }
    row = withRename(row, renames ? renames.get(planned.key) : null);
    if (needsConfirmation(row) && !(confirmKeys && confirmKeys.has(planned.key))) {
      row = { ...row, status: 'skipped', newPoints: [], updateCurrent: false, held: true, heldRow: row };
    }
    return { planned, row, waiting: WAITING.includes(row.status) };
  });
}

// The chip a row is counted under. ⚠️ BY WHAT IT WAS PLANNED AS: a row that waits for an answer stays under
// «To decide» once answered, so it does not jump to another chip under the finger that just answered it. The
// same for a NEW row answered «Do not import»: it stays under «New» (or «Price to check»).
export function bucketOf(entry) {
  if (WAITING.includes(entry.planned.status)) return 'decide';
  // A wanted ingredient with no price of its own: its own group, asked to be looked at.
  if (entry.planned.priceCheck && ['new', 'unchanged'].includes(entry.planned.status)) return 'check';
  // A price that waits for a person's look (a weight that cannot be read, a big move, an older invoice's price).
  if (entry.planned.checkReason || entry.row.checkReason || entry.planned.invoiceRename || entry.row.invoiceRename) return 'check';
  if (entry.planned.status === 'new' && entry.row.status === 'skipped') return 'new';
  return entry.row.status;   // new · update-price · history-only · unchanged · error
}

export const FILTERS = Object.freeze(['all', 'new', 'update-price', 'history-only', 'unchanged', 'check', 'decide', 'error']);

// What a price rise or fall looks like: { percent } (whole number, signed), or null when the two cannot be
// compared (another unit, a missing or zero side). Within half a percent is «equal» (percent 0).
export function priceChange(stored, nextRate, nextUnit) {
  const was = stored && typeof stored.pricePerUnit === 'number' ? stored.pricePerUnit : null;
  if (!(was > 0) || !(nextRate > 0) || !stored.priceUnit || stored.priceUnit !== nextUnit) return null;
  const raw = ((nextRate - was) / was) * 100;
  return { percent: Math.abs(raw) < 0.5 ? 0 : Math.round(raw) };
}

export function filterCounts(entries) {
  const counts = { all: entries.length, new: 0, 'update-price': 0, 'history-only': 0, unchanged: 0, check: 0, decide: 0, error: 0 };
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

// A row already in Mise still WRITES when it teaches the ingredient its invoice name: that is a write like any other,
// so the primary action counts it and «Done» never discards it.
export const writesRow = (entry) => WRITES.includes(entry.row.status) || (entry.row.status === 'unchanged' && Boolean(entry.row.patchInvoiceName));

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
  // The matched ingredient and its stored invoice points come out of the reads above (the reader hangs the
  // points on the Set it returns): the price changes need them and must not read the same folder twice.
  const ingredient = matched ? ingredients.find(i => i.id === matched) || null : null;
  const storedPoints = matched && invoicePointIds[matched] && Array.isArray(invoicePointIds[matched].points)
    ? invoicePointIds[matched].points : [];
  return { row, waiting: WAITING.includes(row.status), ingredient, storedPoints };
}

// ── The end-of-run summary ───────────────────────────────────────────────────────

// results: [{ key, name, outcome: 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed', pricesAdded?, reason?,
//             retry? }] — `retry` is true when loading the same file again can fix the failure (a write that
// failed, a timeout, a catalogue that changed); a file entry that is invalid cannot be fixed that way.
export function summarizeRun(results, { stopped = null, notRun = 0 } = {}) {
  const totals = { namesSaved: 0, created: 0, updated: 0, pricesAdded: 0, changesAdded: 0, changesFailed: 0, unchanged: 0, skipped: 0, codesFull: 0, failed: [], stopped, notRun };
  (results || []).forEach(r => {
    // An ingredient whose list of pack codes is full: the new code was NOT remembered (the summary says so).
    if (r.codesFull) totals.codesFull += 1;
    if (r.outcome === 'failed') totals.failed.push({ key: r.key, name: r.name, reason: r.reason || '', retry: r.retry === true });
    else totals[r.outcome] += 1;
    totals.pricesAdded += r.pricesAdded || 0;
    totals.namesSaved += r.namesSaved || 0;
    totals.changesAdded += r.changesAdded || 0;
    totals.changesFailed += r.changesFailed || 0;
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
