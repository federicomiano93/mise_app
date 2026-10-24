// invoice-import-plan.ts — the decisions of the «Import from invoices» screen and the shape of its writes, kept PURE
// (no Firebase, no DOM) so every rule runs under a test (P15).
//
// TypeScript port of js/orders/invoice-import-plan.js for Mise 2. Behaviour is identical, input for input:
// invoice-import-plan.spec.ts, invoice-import-names.spec.ts and invoice-import-review.spec.ts run every test against
// BOTH files and parity.spec.ts compares their exports. The comments below are the ones the original paid for in bugs.
//
// Three jobs:
//   1. planBatchWrites — the model's ops (invoice-import-model ingredientWrites) turned into the
//      exact documents a data layer sets, with a minted id for a NEW ingredient filled into every later op.
//   2. the screen's view of a plan: a person's decisions applied, the filter chips and their counts, the
//      totals the confirmation dialog quotes.
//   3. replanRow — the re-check that runs right before each row is written, on data read from the
//      server a moment ago, so a catalogue that changed during the import never gets a duplicate.
//
// ⚠️ NO ALLERGEN, NUTRITION OR PACK-INGREDIENT KEY CAN PASS planBatchWrites: the model never builds one
// (an invoice line says nothing about what a product contains), and this refuses one anyway.

import {
  planIngredients, resolveRow, packLabelOf, MAX_DOCS_PER_BATCH,
} from './invoice-import-model';
import type {
  Candidate, ExistingIngredient, FileIngredient, IngredientRow, PlanContext, PlanPoint, SupplierPlanEntry,
} from './invoice-import-model';
import { changesFromPoints } from './price-changes-model';
import type { PriceChange, PricePoint } from './price-changes-model';

const INGREDIENTS = 'ingredients';
const PRICE_CHANGES = 'price-changes';
const INGREDIENT_PRICES = 'ingredient-prices';
const PRICES = 'prices';

export const FORBIDDEN_KEYS: readonly string[] = Object.freeze([
  'allergens', 'mayContain', 'allergensCheckedAt', 'nutrition', 'packIngredients',
]);

// A plan row as the screen holds it (a row that is not ours is data too: every field may be missing).
type Row = Partial<IngredientRow>;
type Data = Record<string, unknown>;

const inList = (list: readonly string[], value: unknown): boolean => list.includes(value as string);

// One op of a row's batches, as the model (ingredientWrites) and the price-change planner build them.
export interface PlanOp {
  type: string;
  ingredientId?: unknown;
  pointId?: unknown;
  changeId?: unknown;
  data?: Data;
  [key: string]: unknown;
}

// One document write: `path` is relative to the venue's folder; a removal carries no data.
export type DocWrite =
  | { path: string[]; data: Data; merge: boolean }
  | { path: string[]; remove: true };

// The ops of ONE row's batches → { batches: [[{ path, data, merge }]], ingredientId }.
//   path   — segments relative to the venue's folder: ['ingredients', id, 'prices', pointId]
//   merge  — true for every write except a history point, which is create-only (a second create of
//            the same `inv-<invoice>-<line>` id is what the rules refuse)
//   bakery — the venue id stamped on every document (the rules' stampedFor)
//   mintId — () => a fresh ingredient id, called ONCE per create-ingredient op, before anything is
//            written, so the id exists for the ops that come after it in the same row.
export function planBatchWrites(
  batches: readonly (readonly PlanOp[] | null | undefined)[] | null | undefined,
  { mintId, bakery }: { mintId?: () => string; bakery?: string } = {},
): { batches: DocWrite[][]; ingredientId: string | null } {
  let ingredientId: string | null = null;
  const out = (batches || []).map(batch => (batch || []).map((op): DocWrite => {
    if (op.type === 'create-ingredient') {
      ingredientId = (mintId as () => string)();
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
export function pointsOfDocs(docs?: readonly { id?: unknown; data?: Data | null }[] | null): PricePoint[] {
  const out: PricePoint[] = [];
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
const CHANGE_UNITS: readonly string[] = ['kg', 'l', 'pcs'];
const MAX_NAME = 200;
const MAX_ID = 100;
const acceptable = (c: PriceChange): boolean => /^\d{1,20}$/.test(c.invoiceId) && c.line <= 999999 && CHANGE_UNITS.includes(c.priceUnit)
  && (c.supplierId === undefined || (typeof c.supplierId === 'string' && c.supplierId.length <= MAX_ID));

// A change as it is stored: the fields a later import could move.
export interface StoredChange {
  id: string;
  oldPrice?: unknown;
  newPrice?: unknown;
  oldDate?: unknown;
  date?: unknown;
  priceUnit?: unknown;
}

// A stored change is the same fact as an expected one when every field a later import could move is equal.
const sameChange = (stored: StoredChange, c: PriceChange): boolean => stored.oldPrice === c.oldPrice && stored.newPrice === c.newPrice
  && stored.oldDate === c.oldDate && stored.priceUnit === c.priceUnit;

export interface PriceChangeOp extends PlanOp {
  ingredientId: string;
  changeId: string;
}

export interface PriceChangePlan {
  create: PriceChangeOp[];
  remove: PriceChangeOp[];
}

export interface PlanPriceChangesInput {
  ingredientId?: unknown;
  supplierId?: unknown;
  name?: unknown;
  storedPoints?: readonly PricePoint[] | null;
  newPoints?: readonly PricePoint[] | null;
  priceUnit?: string;
  isNew?: boolean;
  read: { changeIds: (ingredientId: string) => Promise<readonly StoredChange[]> | readonly StoredChange[] };
  nowIso?: string;
  packLabel?: string;
  packCode?: string;
  unitWeightKg?: unknown;
  ingredient?: { supplierCode?: unknown; name?: unknown; weight?: unknown } | null;
}

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
}: PlanPriceChangesInput): Promise<PriceChangePlan> {
  const none: PriceChangePlan = { create: [], remove: [] };
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
  const stored: StoredChange[] = isNew ? [] : [...(await read.changeIds(ingredientId))];
  const storedById = new Map(stored.map(x => [x.id, x]));
  const expectedById = new Map(found.map(c => [c.id, c]));
  const remove = stored
    .filter(x => !expectedById.has(x.id) || !sameChange(x, expectedById.get(x.id) as PriceChange))
    .map((x): PriceChangeOp => ({ type: 'remove-price-change', ingredientId, changeId: x.id }));
  const gone = new Set(remove.map(r => r.changeId));
  const create = found.filter(c => !storedById.has(c.id) || gone.has(c.id)).map(({ id, ...data }): PriceChangeOp => ({
    type: 'add-price-change', ingredientId, changeId: id, data: { ...data, recordedAt: nowIso },
  }));
  return { create, remove };
}

// Change ops → batches of at most MAX_DOCS_PER_BATCH, to run AFTER the row's own writes: a refused change
// must never undo the prices that went in before it. Accepts the { create, remove } of planPriceChanges: the
// removals come FIRST (a change removed and written again keeps its id), then the creations.
export function priceChangeBatches(ops: readonly PlanOp[] | { remove?: readonly PlanOp[]; create?: readonly PlanOp[] }): PlanOp[][] {
  const parts = ops as { remove?: readonly PlanOp[]; create?: readonly PlanOp[] };
  const list: readonly PlanOp[] = Array.isArray(ops) ? ops as readonly PlanOp[] : [...(parts.remove || []), ...(parts.create || [])];
  const out: PlanOp[][] = [];
  const flush = (kind: 'remove' | 'create'): void => {
    const group = list.filter(op => (op.type === 'remove-price-change') === (kind === 'remove'));
    for (let i = 0; i < group.length; i += MAX_DOCS_PER_BATCH) out.push(group.slice(i, i + MAX_DOCS_PER_BATCH));
  };
  flush('remove');
  flush('create');
  return out;
}

// The name a screen shows for a stored ingredient (its short name when it has one).
export const ingredientDisplayName = (ing?: { shortName?: unknown; name?: unknown } | null): string =>
  (String(ing?.shortName || '').trim() || String(ing?.name || ''));

function write(path: string[], data: Data | undefined, merge: boolean, bakery: string | undefined): DocWrite {
  const keys = Object.keys(data || {});
  const forbidden = keys.filter(k => FORBIDDEN_KEYS.includes(k));
  if (forbidden.length > 0) throw new Error(`An import may never write ${forbidden.join(', ')}`);
  return { path, data: { ...data, bakery }, merge };
}

// ── Why a write stopped ──────────────────────────────────────────────────────────

// 'permission' | 'offline' | null. These two STOP the whole run: another row would fail the same way,
// and ten more refusals teach nobody anything.
export function stopKind(err?: unknown): 'permission' | 'offline' | null {
  const raw = err ? (err as { code?: unknown }).code : undefined;
  const code = typeof raw === 'string' ? raw.replace(/^firestore\//, '') : '';
  if (code === 'permission-denied') return 'permission';
  if (code === 'offline' || code === 'unavailable' || code === 'timeout') return 'offline';
  return null;
}

// ── The screen's view of a plan ──────────────────────────────────────────────────

const WRITES: readonly string[] = ['new', 'update-price', 'history-only'];
const WAITING: readonly string[] = ['maybe-duplicate', 'choose'];

// ⚠️ A MATCHED ROW THAT CARRIES A `checkReason` (the price comes from a reading a person must look at) WRITES NOTHING
// UNTIL THE PERSON CONFIRMS IT. A NEW row keeps its own «create / do not import» answer instead.
export const needsConfirmation = (row?: Row | null): boolean =>
  Boolean(row && row.checkReason) && ['update-price', 'history-only'].includes(row?.status as string);

// ⚠️ A RENAME IS ITS OWN CHOICE, NEVER PART OF A PRICE CONFIRMATION. The model proposes it as `row.invoiceRename`
// ({ stored, file }); it is written only when the person picked «Save the new name» for exactly THAT old → new pair.
// `choice` is the pair the person saw. A row that now shows another pair (the catalogue or the file moved) writes
// nothing of it.
export function withRename<R extends Row | null | undefined>(row: R, choice?: { stored?: unknown; file?: unknown } | null): R {
  const pair = row && row.invoiceRename;
  if (!pair || !choice || choice.stored !== pair.stored || choice.file !== pair.file) return row;
  return { ...row, patchInvoiceName: pair.file } as R;
}

// ⚠️ A RENAME THE PERSON CHOSE IS SAVED EVEN WHILE ITS PRICE IS HELD: the rename is its own choice and never depends on
// the price. The held row becomes a row that writes ONLY the name (no price, no point, no code); `heldRow` keeps what
// was held, for the screen.
function nameOnly(row: Row): IngredientRow {
  return {
    ...row, status: 'unchanged', newPoints: [], updateCurrent: false, patchSupplierCode: null, setSupplierCodes: null,
    held: true, heldRow: row,
  } as IngredientRow;
}

// The row as it must be written, from the plan made again right before the write: null when there is nothing to write
// (a price that needs a look which nobody confirmed, and no rename chosen), the name-only row when only the rename was
// chosen, else the row with the rename if the person chose it.
// ⚠️ `held` is whether the SCREEN held this row for its price: a fresh plan that has lost its reason (another row of this
// run moved the shared price, another phone changed the stored one) must not write what nobody confirmed.
export function rowToWrite(
  fresh: IngredientRow | null | undefined,
  { confirmed = false, rename = null, held = false }: { confirmed?: boolean; rename?: { stored?: unknown; file?: unknown } | null; held?: boolean } = {},
): IngredientRow | null {
  if (!fresh) return null;
  const chosen = withRename(fresh, rename);
  if ((needsConfirmation(fresh) || held) && !confirmed) return chosen !== fresh ? nameOnly(chosen) : null;
  return chosen;
}

// One row of the screen: what the file planned, what would be written, and whether somebody still has to answer.
export interface PlanEntry {
  planned: IngredientRow;
  row: IngredientRow;
  waiting: boolean;
}

// planned rows + the person's decisions → [{ planned, row, waiting }]. `row` is the effective row (what
// would be written); `waiting` is true while somebody still has to answer.
// `forgetKeys` (a Set of keys) are NEW rows the person answered «Do not import (remember)»: they become skipped.
// `confirmKeys` (a Set of keys) are the rows with a `checkReason` the person answered «Use this price»; the others
// are held back (status 'skipped', `held: true`) — they come back on the next import.
export function applyDecisions(
  plannedRows: readonly IngredientRow[] | null | undefined,
  decisions?: Record<string, unknown> | null,
  ctx?: PlanContext | null,
  forgetKeys?: ReadonlySet<string> | null,
  confirmKeys?: ReadonlySet<string> | null,
  renames?: ReadonlyMap<string, { stored?: unknown; file?: unknown }> | null,
): PlanEntry[] {
  return (plannedRows || []).map(planned => {
    const decision = decisions ? decisions[planned.key] : undefined;
    let row: IngredientRow = decision ? resolveRow(planned, decision, ctx) as IngredientRow : planned;
    if (forgetKeys && forgetKeys.has(planned.key) && row.status === 'new') {
      row = { ...row, status: 'skipped', newPoints: [], updateCurrent: false };
    }
    const chosen = withRename(row, renames ? renames.get(planned.key) : null);
    if (needsConfirmation(row) && !(confirmKeys && confirmKeys.has(planned.key))) {
      // Held for its price; a rename the person chose is still saved (nameOnly), the price waits.
      row = chosen !== row
        ? nameOnly(chosen)
        : { ...row, status: 'skipped', newPoints: [], updateCurrent: false, held: true, heldRow: row };
    } else {
      row = chosen;
    }
    return { planned, row, waiting: inList(WAITING, row.status) };
  });
}

// The chip a row is counted under. ⚠️ BY WHAT IT WAS PLANNED AS: a row that waits for an answer stays under
// «To decide» once answered, so it does not jump to another chip under the finger that just answered it. The
// same for a NEW row answered «Do not import»: it stays under «New» (or «Price to check»).
export function bucketOf(entry: { planned: Row; row: Row }): string {
  if (inList(WAITING, entry.planned.status)) return 'decide';
  // A wanted ingredient with no price of its own: its own group, asked to be looked at.
  if (entry.planned.priceCheck && ['new', 'unchanged'].includes(entry.planned.status as string)) return 'check';
  // A price that waits for a person's look (a weight that cannot be read, a big move, an older invoice's price).
  if (entry.planned.checkReason || entry.row.checkReason || entry.planned.invoiceRename || entry.row.invoiceRename) return 'check';
  if (entry.planned.status === 'new' && entry.row.status === 'skipped') return 'new';
  return entry.row.status as string;   // new · update-price · history-only · unchanged · error
}

export const FILTERS: readonly string[] = Object.freeze(['all', 'new', 'update-price', 'history-only', 'unchanged', 'check', 'decide', 'error']);

// What a price rise or fall looks like: { percent } (whole number, signed), or null when the two cannot be
// compared (another unit, a missing or zero side). Within half a percent is «equal» (percent 0).
export function priceChange(
  stored: { pricePerUnit?: unknown; priceUnit?: unknown } | null | undefined,
  nextRate: number,
  nextUnit: string,
): { percent: number } | null {
  const was = stored && typeof stored.pricePerUnit === 'number' ? stored.pricePerUnit : null;
  if (was === null || !(was > 0) || !(nextRate > 0) || !stored?.priceUnit || stored.priceUnit !== nextUnit) return null;
  const raw = ((nextRate - was) / was) * 100;
  return { percent: Math.abs(raw) < 0.5 ? 0 : Math.round(raw) };
}

export function filterCounts(entries: readonly { planned: Row; row: Row }[]): Record<string, number> {
  const counts: Record<string, number> = { all: entries.length, new: 0, 'update-price': 0, 'history-only': 0, unchanged: 0, check: 0, decide: 0, error: 0 };
  entries.forEach(entry => {
    const bucket = bucketOf(entry);
    counts[bucket] = (counts[bucket] as number) + 1;
  });
  return counts;
}

// The chips worth showing: «All», the one that is on, and every other with something under it. On a 296 px
// phone seven chips with six zeros took half the screen.
export function visibleFilters(counts: Record<string, number>, active: string): string[] {
  return FILTERS.filter(f => f === 'all' || f === active || (counts[f] as number) > 0);
}

export function entriesFor<E extends { planned: Row; row: Row }>(entries: readonly E[], filter: string): E[] {
  return filter === 'all' ? entries.slice() : entries.filter(entry => bucketOf(entry) === filter);
}

export const waitingCount = (entries: readonly { waiting?: boolean }[]): number => entries.filter(entry => entry.waiting).length;

// A row already in Mise still WRITES when it teaches the ingredient its invoice name: that is a write like any other,
// so the primary action counts it and «Done» never discards it.
export const writesRow = (entry: { row: Row }): boolean =>
  inList(WRITES, entry.row.status) || (entry.row.status === 'unchanged' && Boolean(entry.row.patchInvoiceName));

// What the confirmation says: how many rows write, how many ingredients are created, how many prices.
export function importTotals(entries: readonly { row: Row }[]): { rows: number; newIngredients: number; pricesAdded: number; namesSaved: number } {
  const writing = entries.filter(writesRow);
  return {
    rows: writing.length,
    newIngredients: writing.filter(e => e.row.status === 'new').length,
    pricesAdded: writing.reduce((sum, e) => sum + (e.row.newPoints as PlanPoint[]).length, 0),
    // The invoice names of ingredients already in Mise that this import will save (a backfill or a chosen rename).
    namesSaved: writing.filter(e => e.row.status !== 'new' && Boolean(e.row.patchInvoiceName)).length,
  };
}

// The ingredient ids whose invoice points must be read before the plan is trusted: the ones a row is
// matched to, and every candidate a person might pick.
export function idsToCheck(rows?: readonly Row[] | null): string[] {
  const ids = new Set<string>();
  (rows || []).forEach(row => {
    if (row.ingredientId) ids.add(row.ingredientId as string);
    (row.candidates || []).forEach((c: Candidate) => ids.add(c.id));
  });
  return [...ids];
}

// How many different invoices a row's prices come from.
export function invoiceCount(row: Row): number {
  return new Set((row.allPoints || []).map(p => p.invoiceId)).size;
}

// ── The re-check before suppliers are written ────────────────────────────────────

interface SupplierEntryLike {
  key: string;
  status?: unknown;
  supplierId?: unknown;
  candidates?: readonly { id: string }[];
}

const candidateIds = (entry: SupplierEntryLike): string => (entry.candidates || []).map(c => c.id).sort().join(',');

// What the owner confirmed against what the server holds now. → the keys of the file suppliers whose answer
// is no longer the same (status, the supplier it is, or who it might be). `settled` are the keys this very
// import already wrote: they exist now by its own doing, so «new → present» is not a change.
export function changedSupplierKeys(
  before?: readonly (SupplierEntryLike | SupplierPlanEntry)[] | null,
  after?: readonly (SupplierEntryLike | SupplierPlanEntry)[] | null,
  settled: readonly string[] = [],
): string[] {
  const done = new Set(settled);
  const now = new Map((after || []).map(e => [e.key, e as SupplierEntryLike]));
  const changed: string[] = [];
  (before || []).forEach(entry => {
    const old = entry as SupplierEntryLike;
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

// The invoice-point ids of an ingredient; the reader hangs the stored points themselves on the Set it returns.
export type PointIds = Set<string> & { points?: unknown[] };

export interface ReplanInput {
  fileIngredient: Partial<FileIngredient>;
  decision?: unknown;
  supplierIdByKey?: Record<string, string> | null;
  read: {
    ingredients: (supplierId: string) => Promise<readonly ExistingIngredient[]>;
    pointIds: (ingredientId: string) => Promise<PointIds>;
    price: (ingredientId: string) => Promise<Record<string, unknown> | null | undefined>;
  };
}

export interface ReplanResult {
  row: IngredientRow;
  waiting: boolean;
  ingredient?: ExistingIngredient | null;
  storedPoints?: unknown[];
}

// The same plan the screen showed, computed again on what the database holds NOW.
//   read = { ingredients(supplierId) → [ingredient], pointIds(ingredientId) → Set, price(ingredientId) → doc|null }
// → { row, waiting }. A row that is waiting here was not decided: the catalogue changed under it (a
// similar ingredient appeared — maybe the one this very import created a moment ago), so the caller
// leaves it for the next run rather than guess.
export async function replanRow({ fileIngredient, decision, supplierIdByKey, read }: ReplanInput): Promise<ReplanResult> {
  const supplierId = supplierIdByKey ? supplierIdByKey[fileIngredient.supplierKey as string] : undefined;
  const ingredients = typeof supplierId === 'string' && supplierId ? await read.ingredients(supplierId) : [];
  const plan = (extra?: PlanContext): { ctx: PlanContext; row: IngredientRow } => {
    const ctx: PlanContext = { supplierIdByKey, ingredients, pricesById: {}, invoicePointIds: {}, ...extra };
    const first = planIngredients([fileIngredient], ctx)[0] as IngredientRow;
    return { ctx, row: decision ? resolveRow(first, decision, ctx) as IngredientRow : first };
  };
  const pass0 = plan();
  // The ingredient it matched, AND every candidate of a question: a decision the owner made last month is
  // remembered by the prices it left on one of those candidates (questionOrRemembered in the model).
  const ids = idsToCheck([pass0.row]);
  if (ids.length === 0) return { row: pass0.row, waiting: inList(WAITING, pass0.row.status) };
  const sets = await Promise.all(ids.map(id => read.pointIds(id)));
  const invoicePointIds: Record<string, PointIds> = {};
  ids.forEach((id, i) => { invoicePointIds[id] = sets[i] as PointIds; });
  const pass1 = plan({ invoicePointIds });
  let row = pass1.row;
  const matched = row.ingredientId as string | undefined;
  if (matched) {
    const price = await read.price(matched);
    row = plan({ invoicePointIds, pricesById: { [matched]: price as Record<string, unknown> | undefined } }).row;
  }
  // The matched ingredient and its stored invoice points come out of the reads above (the reader hangs the
  // points on the Set it returns): the price changes need them and must not read the same folder twice.
  const ingredient = matched ? ingredients.find(i => i.id === matched) || null : null;
  const matchedIds = matched ? invoicePointIds[matched] : undefined;
  const storedPoints = matchedIds && Array.isArray(matchedIds.points) ? matchedIds.points : [];
  return { row, waiting: inList(WAITING, row.status), ingredient, storedPoints };
}

// ── The end-of-run summary ───────────────────────────────────────────────────────

// One row's result in the run: `retry` is true when loading the same file again can fix the failure (a write that
// failed, a timeout, a catalogue that changed); a file entry that is invalid cannot be fixed that way.
export interface RunResult {
  key: string;
  name: string;
  outcome: string;
  pricesAdded?: number;
  namesSaved?: number;
  namesLost?: number;
  changesAdded?: number;
  changesFailed?: number;
  codesFull?: boolean;
  reason?: string;
  retry?: boolean;
}

export interface RunTotals {
  namesSaved: number;
  namesLost: number;
  created: number;
  updated: number;
  pricesAdded: number;
  changesAdded: number;
  changesFailed: number;
  unchanged: number;
  skipped: number;
  codesFull: number;
  failed: { key: string; name: string; reason: string; retry: boolean }[];
  stopped: string | null;
  notRun: number;
  retryable: number;
  notFixableByRetry: number;
}

// results: [{ key, name, outcome: 'created' | 'updated' | 'unchanged' | 'skipped' | 'failed', pricesAdded?, reason?,
//             retry? }] — `retry` is true when loading the same file again can fix the failure (a write that
// failed, a timeout, a catalogue that changed); a file entry that is invalid cannot be fixed that way.
export function summarizeRun(
  results?: readonly RunResult[] | null,
  { stopped = null, notRun = 0 }: { stopped?: string | null; notRun?: number } = {},
): RunTotals {
  const totals: RunTotals = {
    namesSaved: 0, namesLost: 0, created: 0, updated: 0, pricesAdded: 0, changesAdded: 0, changesFailed: 0, unchanged: 0, skipped: 0,
    codesFull: 0, failed: [], stopped, notRun, retryable: 0, notFixableByRetry: 0,
  };
  const counted = totals as unknown as Record<string, number>;
  (results || []).forEach(r => {
    // An ingredient whose list of pack codes is full: the new code was NOT remembered (the summary says so).
    if (r.codesFull) totals.codesFull += 1;
    if (r.outcome === 'failed') totals.failed.push({ key: r.key, name: r.name, reason: r.reason || '', retry: r.retry === true });
    else counted[r.outcome] = (counted[r.outcome] as number) + 1;
    totals.pricesAdded += r.pricesAdded || 0;
    totals.namesSaved += r.namesSaved || 0;
    totals.namesLost += r.namesLost || 0;
    totals.changesAdded += r.changesAdded || 0;
    totals.changesFailed += r.changesFailed || 0;
  });
  totals.retryable = totals.failed.filter(f => f.retry).length;
  totals.notFixableByRetry = totals.failed.length - totals.retryable;
  return totals;
}

// The reasons a second load of the same file can fix: the ingredient the owner picked is gone, so the
// question comes back. Every other reason of an error row is in the file itself.
export const isRetryableReason = (code?: unknown): boolean => code === 'target-not-found';

// «To skip this question next month …»: the rows the owner answered by hand with «Same as X» that carry NO
// article code — with a code the next run finds X by itself. → [{ name, target }], target = X's label.
export function rememberHints(
  entries: readonly { planned: Row; row: Row }[] | null | undefined,
  decisions: Record<string, unknown> | null | undefined,
  labelOf: (ingredientId: string, planned: Row) => string,
): { name: string; target: string }[] {
  const out: { name: string; target: string }[] = [];
  (entries || []).forEach(({ planned, row }) => {
    const d = decisions ? decisions[planned.key as string] as { sameAs?: unknown } | null | undefined : null;
    if (!d || typeof d.sameAs !== 'string' || planned.supplierCode) return;
    if (!inList(WRITES, row.status) && row.status !== 'unchanged') return;
    const target = labelOf(d.sameAs, planned);
    if (target) out.push({ name: planned.name as string, target });
  });
  return out;
}
