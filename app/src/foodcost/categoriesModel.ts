// categoriesModel.ts — the groups the Food cost list is drawn in (Mise 2, model 4, 20 Nov 2026), the pure half.
//
// A category is `foodcost-categories/{id}` = { bakery, name, rank }. A card holds the category's id (`categoryId`); an id whose
// document is gone reads as «no category», so removing a category rewrites no card. `rank` is the order of the list (the order
// they were made, Date.now() at creation). Everything here is plain data in, plain data out: the store holds the state and the
// screens draw it.

import { normalizeSearchText } from '@mise/shared/catalogue-model';
import { isCakeProductId } from '@mise/shared/cake-model';
import type { Product, ProductKind } from '@mise/shared/foodcost-model';
import type { StoredDoc } from './foodcostSource';

// The rules' bound on a category name (firestore.rules, foodcost-categories).
export const MAX_CATEGORY_NAME = 60;

// ⚠️ A CAKE'S CARD IS A FINISHED PRODUCT whatever its `kind` says: Cakes make them, and they sit in Food cost's own «Cakes» group.
export const kindOf = (product: Product): ProductKind => (isCakeProductId(product.id) ? 'finished' : product.kind);

export interface Category {
  readonly id: string;
  readonly name: string;
  readonly rank: number;
}

// The categories as the source hands them over: a document without a usable name is dropped, a rank that is not a number
// counts as 0. In the order of the list: rank, then name, then id (so two made in the same millisecond keep a stable order).
export function readCategories(list: unknown): Category[] {
  if (!Array.isArray(list)) return [];
  const out: Category[] = [];
  for (const item of list as StoredDoc[]) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || item.id === '') continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (name === '') continue;
    const rank = typeof item.rank === 'number' && Number.isFinite(item.rank) ? item.rank : 0;
    out.push({ id: item.id, name, rank });
  }
  return out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// Why a typed name cannot be saved, or null: 'empty' (nothing but spaces), 'too-long' (over the rules' bound), 'duplicate' (another
// category already has it, capitals and accents not counting). `ignoreId` is the category being renamed, which may keep its own name.
export type CategoryNameProblem = 'empty' | 'too-long' | 'duplicate';

export function categoryNameProblem(
  typed: string, categories: readonly Category[], ignoreId: string | null = null,
): CategoryNameProblem | null {
  const name = typed.trim();
  if (name === '') return 'empty';
  if (name.length > MAX_CATEGORY_NAME) return 'too-long';
  const wanted = normalizeSearchText(name);
  if (categories.some(category => category.id !== ignoreId && normalizeSearchText(category.name) === wanted)) return 'duplicate';
  return null;
}

// The rank a new category takes: the clock, but always after every category there is (two phones' clocks may disagree).
export function nextRank(categories: readonly Category[], nowMs: number): number {
  const last = categories.reduce((max, category) => Math.max(max, category.rank), 0);
  return Math.max(Math.floor(nowMs), last + 1);
}

// How many cards sit in each category: only counted for a category that exists, and never a cake's card (it sits in «Cakes»).
export function cardCounts(products: readonly Product[], categories: readonly Category[]): Map<string, number> {
  const known = new Set(categories.map(category => category.id));
  const counts = new Map<string, number>();
  for (const product of products) {
    if (isCakeProductId(product.id)) continue;
    if (product.categoryId !== null && known.has(product.categoryId)) counts.set(product.categoryId, (counts.get(product.categoryId) ?? 0) + 1);
  }
  return counts;
}

// The id a card is grouped under: its category's, or null when it has none or the category is gone.
export function categoryIdOf(product: Pick<Product, 'categoryId'>, categories: readonly Category[]): string | null {
  return product.categoryId !== null && categories.some(category => category.id === product.categoryId) ? product.categoryId : null;
}

// The group every cake's card is drawn in, whatever category it may carry (his call, 21 Nov 2026: a cake has no category of its own,
// all cakes sit together). Not a category document: nothing is saved for it, and it cannot be renamed or removed.
export const CAKES_GROUP_ID = '__cakes__';

// One drawn group of the list. `id` null is «No category», CAKES_GROUP_ID is «Cakes».
export interface Group<T> {
  readonly id: string | null;
  readonly name: string | null;
  readonly items: readonly T[];
}

// The rows split into groups: the categories in order, then «Cakes» (every cake's card), then «No category» last. A group with no
// rows is not drawn. The screen calls this only when the venue has a category (see `grouped`); with none the list is flat and has no
// headers. `rows` keep their own order inside each group (the list's worst-first order).
export function groupRows<T extends { product: Product }>(rows: readonly T[], categories: readonly Category[]): Group<T>[] {
  const byId = new Map<string | null, T[]>();
  for (const row of rows) {
    const id = isCakeProductId(row.product.id) ? CAKES_GROUP_ID : categoryIdOf(row.product, categories);
    const bucket = byId.get(id);
    if (bucket) bucket.push(row); else byId.set(id, [row]);
  }
  const groups: Group<T>[] = [];
  for (const category of categories) {
    const items = byId.get(category.id);
    if (items) groups.push({ id: category.id, name: category.name, items });
  }
  const cakes = byId.get(CAKES_GROUP_ID);
  if (cakes) groups.push({ id: CAKES_GROUP_ID, name: null, items: cakes });
  const rest = byId.get(null);
  if (rest) groups.push({ id: null, name: null, items: rest });
  return groups;
}

// Whether the list is drawn in groups at all: only when the venue has at least one category. Without one the list stays flat (a
// cake's row keeps its «Cake» tag); with one, the cakes sit together in their own «Cakes» group.
export function grouped(categories: readonly Category[]): boolean {
  return categories.length > 0;
}

// Which groups are open. All start CLOSED (the owner's ask); a search shows the matching cards with their groups open; the group of
// the card that is open opens by itself. `userOpen` is the person's own taps, kept in the screen's state only.
export function isGroupOpen(
  groupId: string | null, group: { items: readonly { product: Product }[] },
  state: { userOpen: ReadonlySet<string>; searching: boolean; openProductId: string | null },
): boolean {
  if (state.searching) return true;
  const key = groupId ?? NO_CATEGORY_KEY;
  if (state.userOpen.has(key)) return true;
  return state.openProductId !== null && group.items.some(row => row.product.id === state.openProductId);
}

// The key of the «No category» group in the set of the person's taps.
export const NO_CATEGORY_KEY = '__none__';
