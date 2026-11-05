// ingredient-merge.ts — «Unisci un'altra confezione…»: two ingredients that are really ONE product bought in two
// packs (a 5 kg sack, a 1 kg bag) become one, and the history of the second moves onto the first.
//
// TypeScript port of js/orders/ingredient-merge.js for Mise 2 (full since step 3e-7). Behaviour is identical, input for
// input: ingredient-merge.spec.ts runs every test against BOTH files, parity.spec.ts compares their exports and
// odd-inputs.spec.ts feeds both the same strange values.
//
// PURE (P15): no Firebase, no DOM, no dictionary — the app's data layer reads and writes, the screen draws, and every
// rule that decides WHAT happens is here.
//
// ⚠️ THE ORDER IS THE SAFETY. A merge is several batches (the rules and the five-document cap forbid one big one),
// so it is planned so that stopping anywhere loses nothing: the prices of B go onto A first, then A learns B's
// codes, then A's current price, then B's price changes go, and B itself is deleted LAST. A second try finishes
// the job: invoice points keep their `inv-…` id and every other point gets an id derived from B's, so a point
// already copied is skipped, never doubled.
//
// ⚠️ NOTHING THAT NAMES B MAY SURVIVE ITS MERGE. B is refused (nothing written) while a product, a recipe row, an open
// stocktake (this month's or last month's), the order in progress or an order list not yet done still points at it:
// those would turn into «missing ingredient» and block labels. Moving them to A first is the owner's job — the merge
// never rewrites a recipe.

import { kindOf } from './ingredient-kind';
import { ingredientDisplayName } from './ingredient-name';
import { pricePatch, type PricePatch } from './price-model';
import { sameUnitWeight } from './price-changes-model';
import { remainingIds } from './order-request-model';
import {
  MAX_DOCS_PER_BATCH, MAX_SUPPLIER_CODES, MAX_PACK_LABEL, MAX_SUPPLIER_CODE, extraCodesOf, nameSimilarity, normalizeIngredientName,
  packLabelOf, type ExistingIngredient,
} from './invoice-import-model';

const INGREDIENTS = 'ingredients';
const INGREDIENT_PRICES = 'ingredient-prices';
const PRICES = 'prices';

// The keys a price point may carry (firestore.rules /prices/{priceId}); a copy never carries anything else.
const POINT_KEYS = Object.freeze([
  'recordedAt', 'priceUnit', 'pricePerUnit', 'packPrice', 'packSize', 'unitWeightKg', 'supplierId', 'source',
  'invoiceId', 'invoiceDate', 'invoiceQty', 'packLabel', 'packCode',
]);

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// ── What B can be merged INTO A ──────────────────────────────────────────────────

// An ingredient as the chooser and the plan read it. A document is data, so every field but the id may be anything.
export interface MergeIngredient extends ExistingIngredient {
  id: string;
}

export interface MergeCandidate<T extends MergeIngredient = MergeIngredient> {
  ingredient: T;
  label: string;
  score: number;
}

// The other ingredients of the SAME supplier and kind (active and inactive), most alike first, then by name.
// `search` narrows by every typed word (accents and case ignored) against both names.
export function mergeCandidates<T extends MergeIngredient>(
  a: MergeIngredient | null | undefined,
  ingredients: readonly T[] | null | undefined,
  search: unknown = '',
): MergeCandidate<T>[] {
  if (!a || typeof a.id !== 'string') return [];
  const words = normalizeIngredientName(search).split(' ').filter(Boolean);
  const mine = ingredientDisplayName(a);
  return (Array.isArray(ingredients) ? ingredients : [])
    .filter(i => i && typeof i.id === 'string' && i.id && i.id !== a.id
      && (i.supplierId || '') === (a.supplierId || '') && kindOf(i) === 'ingredient')
    .filter(i => {
      const names = `${normalizeIngredientName(i.name)} ${normalizeIngredientName(i.shortName)}`;
      return words.every(w => names.includes(w));
    })
    .map(i => ({
      ingredient: i,
      label: ingredientDisplayName(i),
      score: Math.max(nameSimilarity(mine, i.name), nameSimilarity(mine, ingredientDisplayName(i))),
    }))
    .sort((x, y) => y.score - x.score || x.label.localeCompare(y.label) || x.ingredient.id.localeCompare(y.ingredient.id));
}

// ── Where B is still used ────────────────────────────────────────────────────────

// '2026-10' from a moment in LOCAL time (the same key the stocktake uses, inventory-model.ts).
export function monthKeyOf(nowMs: unknown = Date.now()): string | null {
  const d = new Date(nowMs as number);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// The month BEFORE the one holding that moment: the stocktake of last month stays open until somebody closes it.
export function previousMonthKeyOf(nowMs: unknown = Date.now()): string | null {
  const d = new Date(nowMs as number);
  if (Number.isNaN(d.getTime())) return null;
  return monthKeyOf(new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime());
}

const COUNT_MAPS = ['opening', 'purchased', 'closing'] as const;

// One place B is still used.
export interface UsageFound {
  kind: 'product' | 'recipe' | 'inventory' | 'draft' | 'request';
  name?: string;
  month?: string;
}

// sources = { products: [{ name, components, packaging }], recipes: [{ name, ingredients }],
//             inventories: [{ month: '2026-10', data: { closedAt, opening, purchased, closing } | null }]  (this month AND
//             last month), draft: { entries } | null, requests: [order-requests documents] }
// → [{ kind: 'product' | 'recipe' | 'inventory' | 'draft' | 'request', name?, month? }], empty when B is free.
// ⚠️ A closed month is history: nothing there blocks; an OPEN one (closedAt empty or missing) that counts B does.
// An order list not yet done blocks while one of its lines naming B is still unticked. «Not counted» is a missing key, never zero (CLAUDE.md).
// The sources are documents (data): anything may arrive, and only what is named above is read.
export function findUsage(id: unknown, sources?: unknown): UsageFound[] {
  const found: UsageFound[] = [];
  if (typeof id !== 'string' || !id) return found;
  const s: Record<string, unknown> = isObject(sources) ? sources : {};
  (Array.isArray(s.products) ? s.products : []).forEach(p => {
    const parts = [...(Array.isArray(p?.components) ? p.components : []), ...(Array.isArray(p?.packaging) ? p.packaging : [])];
    if (parts.some(c => c && c.ingredientId === id)) found.push({ kind: 'product', name: text(p.name) });
  });
  (Array.isArray(s.recipes) ? s.recipes : []).forEach(r => {
    const rows: Array<Record<string, unknown> | null | undefined> = Array.isArray(r?.ingredients) ? r.ingredients : [];
    if (rows.some(row => row && row.refId === id && row.kind !== 'recipe')) found.push({ kind: 'recipe', name: text(r.name) });
  });
  const months: ReadonlyArray<{ month?: unknown; data?: unknown }> = Array.isArray(s.inventories) ? s.inventories : [{ month: s.month, data: s.inventory }];
  months.forEach(({ month, data: inv }) => {
    if (isObject(inv) && text(inv.closedAt) === ''
      && COUNT_MAPS.some(map => {
        const counts = inv[map];
        return isObject(counts) && Object.hasOwn(counts, id) && counts[id] !== null && counts[id] !== undefined;
      })) {
      found.push({ kind: 'inventory', month: (month || '') as string });
    }
  });
  if ((Array.isArray(s.requests) ? s.requests : []).some(r => isObject(r) && isObject(r.quantities) && remainingIds(r).includes(id))) {
    found.push({ kind: 'request' });
  }
  const draft = s.draft;
  const entry = isObject(draft) && isObject(draft.entries) ? draft.entries[id] : undefined;
  const qty = isObject(entry) ? Number(entry.qty) : 0;
  if (qty > 0) found.push({ kind: 'draft' });
  return found;
}

// ── The merge itself ─────────────────────────────────────────────────────────────

// The id a point of B gets on A: an invoice point keeps its own (the rules tie it to the invoice), any other is
// derived from B's id and its own, so a second try recognises it.
export function pointIdOnA(bId: unknown, pointId: unknown, data: unknown): string {
  if (isObject(data) && data.source === 'invoice' && /^inv-\d{1,20}-\d{1,6}$/.test(pointId as string)) return pointId as string;
  return `mrg-${bId}-${pointId}`;
}

// A's article codes after the merge: its own extras, then B's main code and extras; never A's main code again,
// no repeats (case-blind), at most MAX_SUPPLIER_CODES. → { codes, added (how many of B's are new to A), dropped }.
export function mergedCodes(
  a: ExistingIngredient | null | undefined,
  b: ExistingIngredient | null | undefined,
): { codes: string[]; added: number; dropped: number } {
  const aMain = text(a?.supplierCode).toLowerCase();
  const own = extraCodesOf(a);
  const seen = new Set([aMain, ...own.map(c => c.toLowerCase())].filter(Boolean));
  const fromB = [text(b?.supplierCode), ...extraCodesOf(b)].filter(Boolean);
  const added: string[] = [];
  fromB.forEach(code => {
    const key = code.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    added.push(code);
  });
  const room = Math.max(0, MAX_SUPPLIER_CODES - own.length);
  const kept = added.slice(0, room);
  return { codes: [...own, ...kept], added: kept.length, dropped: added.length - kept.length };
}

const MAX_NAME_FOR_LABEL = 200;

// One stored price point of B's history: its document id and its data.
export interface MergePoint {
  id: string;
  data: Record<string, unknown>;
}

// The copy of one of B's price points as it lands on A: only the keys the rules know, the supplier A has, and
// the pack it was paid for: its own code and label when it has them, else B's article code and B's name + weight
// (what tells the price changes that the pack changed).
function copyOf(bPoint: MergePoint, a: MergeIngredient, b: MergeIngredient): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  POINT_KEYS.forEach(key => { if (bPoint.data[key] !== undefined) data[key] = bPoint.data[key]; });
  if (typeof data.supplierId !== 'string' || !data.supplierId) data.supplierId = a.supplierId || b.supplierId || '';
  const label = text(bPoint.data.packLabel) || packLabelOf({ name: String(b.name || '').slice(0, MAX_NAME_FOR_LABEL), weight: b.weight });
  if (label) data.packLabel = label.slice(0, MAX_PACK_LABEL);
  const code = (text(bPoint.data.packCode) || text(b.supplierCode)).slice(0, MAX_SUPPLIER_CODE);
  if (code) data.packCode = code;
  else delete data.packCode;
  return data;
}

// A's current price after the merge, or null when it stays. B's takes over only when it is NEWER and in the SAME
// unit as A's (a rate per kilo laid over a rate per piece would silently re-price every recipe) — and a rate per
// PIECE only when the piece weighs the same: the piece of a 5 kg sack is not the piece of a 1 kg bag.
// The patch is pricePatch's own, so the retired keys and the case keys drain as on every save.
function priceTakeover(aPrice: unknown, bPrice: unknown): PricePatch | null {
  if (!isObject(bPrice) || typeof bPrice.pricePerUnit !== 'number' || !(bPrice.pricePerUnit > 0)) return null;
  const stamp = text(bPrice.priceUpdatedAt);
  if (!stamp || !['kg', 'l', 'pcs'].includes(bPrice.priceUnit as string)) return null;
  if (isObject(aPrice) && typeof aPrice.pricePerUnit === 'number') {
    if (aPrice.priceUnit !== bPrice.priceUnit) return null;
    if (bPrice.priceUnit === 'pcs' && !sameUnitWeight(aPrice.unitWeightKg, bPrice.unitWeightKg)) return null;
    const aStamp = text(aPrice.priceUpdatedAt);
    if (aStamp && aStamp >= stamp) return null;
  }
  const vatRate = bPrice.vatRate !== undefined && bPrice.vatRate !== null ? bPrice.vatRate : (isObject(aPrice) ? aPrice.vatRate : null);
  return pricePatch({
    priceUnit: bPrice.priceUnit, pricePerUnit: bPrice.pricePerUnit, unitWeightKg: bPrice.unitWeightKg, vatRate, keepRate: true,
  }, stamp);
}

function chunk<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += MAX_DOCS_PER_BATCH) out.push(list.slice(i, i + MAX_DOCS_PER_BATCH));
  return out;
}

// One document the merge writes: its path from the root, its data, and whether it is merged into what is there.
export interface MergeOp {
  path: string[];
  data: Record<string, unknown>;
  merge: boolean;
}

export interface MergePlanInput {
  a: MergeIngredient;
  b: MergeIngredient;
  bPoints?: readonly MergePoint[] | null;
  aPointIds?: ReadonlySet<string> | readonly string[] | null;
  aPrice?: unknown;
  bPrice?: unknown;
  changeIds?: readonly string[] | null;
}

export interface MergePlan {
  batches: MergeOp[][];
  counts: { prices: number; codes: number; droppedCodes: number };
  takeover: boolean;
  bLostPrice: 'history' | 'lost' | null;
  hasChanges: boolean;
}

// What the merge writes, in order. a, b = the stored ingredients; bPoints = [{ id, data }] of B's history;
// aPointIds = the ids A's history already holds; aPrice / bPrice = their `ingredient-prices` documents or null.
// → {
//     batches   — [[{ path, data, merge }]] each at most MAX_DOCS_PER_BATCH documents, in commit order:
//                 the points first (oldest first), then A's codes, then A's current price. `bakery` is stamped by the writer.
//     counts    — { prices (only the points that will really be COPIED), codes, droppedCodes } for the confirmation
//     takeover  — A's current price becomes B's (the patch is in the batches)
//     bLostPrice — B has a current price the merge does NOT carry over: 'history' when a point of its history holds
//                 the same price, 'lost' when none does (it goes with B), null when B has none or it is taken over
//     hasChanges — B has price changes (they go with it and are recomputed by the next import)
//   }
export function planMerge({ a, b, bPoints, aPointIds, aPrice, bPrice, changeIds }: MergePlanInput): MergePlan {
  const have: ReadonlySet<string> = aPointIds instanceof Set ? aPointIds : new Set(Array.isArray(aPointIds) ? aPointIds : []);
  const points = (Array.isArray(bPoints) ? bPoints : [])
    .filter((p): p is MergePoint => Boolean(p) && typeof p.id === 'string' && isObject(p.data));
  const ordered = points.slice()
    .sort((x, y) => String(x.data.recordedAt || '').localeCompare(String(y.data.recordedAt || '')) || x.id.localeCompare(y.id));
  const ops: MergeOp[] = [];
  let copied = 0;
  ordered.forEach(p => {
    const id = pointIdOnA(b.id, p.id, p.data);
    if (have.has(id)) return;
    copied += 1;
    ops.push({ path: [INGREDIENTS, a.id, PRICES, id], data: copyOf(p, a, b), merge: false });
  });

  const codes = mergedCodes(a, b);
  const before = extraCodesOf(a);
  if (codes.codes.length !== before.length) {
    ops.push({ path: [INGREDIENTS, a.id], data: { supplierCodes: codes.codes }, merge: true });
  }

  const takeover = priceTakeover(aPrice, bPrice);
  if (takeover) ops.push({ path: [INGREDIENT_PRICES, a.id], data: takeover as unknown as Record<string, unknown>, merge: true });

  return {
    batches: chunk(ops),
    counts: { prices: copied, codes: codes.added, droppedCodes: codes.dropped },
    takeover: Boolean(takeover),
    bLostPrice: takeover ? null : keptPriceState(bPrice, points),
    hasChanges: Array.isArray(changeIds) && changeIds.length > 0,
  };
}

// B has a current price that the merge does not carry over: is it still somewhere in B's history (which moves to A)?
function keptPriceState(bPrice: unknown, points: readonly MergePoint[]): 'history' | 'lost' | null {
  if (!isObject(bPrice) || typeof bPrice.pricePerUnit !== 'number' || !(bPrice.pricePerUnit > 0)) return null;
  const rate = bPrice.pricePerUnit;
  const same = (p: MergePoint): boolean => isObject(p.data) && p.data.priceUnit === bPrice.priceUnit
    && typeof p.data.pricePerUnit === 'number'
    && Math.abs(p.data.pricePerUnit - rate) <= 1e-6 * Math.max(1, rate)
    && (bPrice.priceUnit !== 'pcs' || sameUnitWeight(p.data.unitWeightKg, bPrice.unitWeightKg));
  return points.some(same) ? 'history' : 'lost';
}

// The documents to delete once everything above has landed: B's price changes, then B (and its price document).
export function deletionBatches(changeIds: unknown): string[][] {
  return chunk((Array.isArray(changeIds) ? changeIds : []).filter((id): id is string => typeof id === 'string' && id !== ''));
}
