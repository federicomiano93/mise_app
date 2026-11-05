// ingredient-merge.ts — «Unisci un'altra confezione…»: where an ingredient is still used, before it may be merged
// into another. ONLY `findUsage`, `monthKeyOf` and `previousMonthKeyOf`.
//
// TypeScript PARTIAL port of js/orders/ingredient-merge.js for Mise 2. The three functions are the same, input for
// input: ingredient-merge.spec.ts runs their tests against BOTH files, and odd-inputs.spec.ts feeds both the same
// strange values. They use `remainingIds` of order-request-model.ts (an unfinished order list still names the product).
//
// ⚠️ A PARTIAL PORT, SO parity.spec.ts DOES NOT PAIR IT. NOT PORTED (the merge itself comes in step 3e-7):
//   - `mergeCandidates` — which other ingredients B can be merged into A;
//   - `pointIdOnA`, `mergedCodes`, `planMerge`, `deletionBatches` — the plan of the merge, in batches, and the private
//     helpers behind them (`copyOf`, `priceTakeover`, `chunk`, `keptPriceState`, `POINT_KEYS` and the collection names),
//     which import the invoice-import and price-changes models of the Orders feature.
//
// ⚠️ NOTHING THAT NAMES B MAY SURVIVE ITS MERGE. B is refused (nothing written) while a product, a recipe row, an open
// stocktake (this month's or last month's), the order in progress or an order list not yet done still points at it:
// those would turn into «missing ingredient» and block labels. Moving them to A first is the owner's job — the merge
// never rewrites a recipe.

import { remainingIds } from './order-request-model';

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

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
