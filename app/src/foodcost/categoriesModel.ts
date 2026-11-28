// categoriesModel.ts — the groups the Food cost list is drawn in (Mise 2, model 4, 20 Nov 2026), the pure half.
//
// A category is `foodcost-categories/{id}` = { bakery, name, rank }. A card holds the category's id (`categoryId`); an id whose
// document is gone reads as «no category», so removing a category rewrites no card. `rank` is the order of the list (the order
// they were made, Date.now() at creation). Everything here is plain data in, plain data out: the store holds the state and the
// screens draw it.

import { normalizeSearchText } from '@mise/shared/catalogue-model';
import { isCakeProductId } from '@mise/shared/cake-model';
import { recipeIdOfProduct } from '@mise/shared/from-recipes';
import type { Product, ProductKind } from '@mise/shared/foodcost-model';
import { categoryKey, categoryOf, sortedCategories } from '@mise/shared/recipe-shelf';
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

// The rank a new category takes: the clock, but always after every category there is (two phones' clocks may disagree).
export function nextRank(categories: readonly Category[], nowMs: number): number {
  const last = categories.reduce((max, category) => Math.max(max, category.rank), 0);
  return Math.max(Math.floor(nowMs), last + 1);
}

// ── The Ricettario's words (28 Nov 2026) ──
// Categories are made ONLY in the Ricettario (`config/labels.recipeCategories`, a list of words) and Food cost follows them:
//   • a card born from a recipe (`recipe-<id>`) is in ITS RECIPE's category, so moving the recipe moves the card and no card is
//     written; a recipe with no category, or a word that is not on the list, puts the card in «No category»;
//   • any other card holds the id of a `foodcost-categories` document, and that document's NAME, matched to a word (capitals and
//     accents not counting), is its category; a name that is no word reads as «No category».
// ⚠️ When the words cannot be read (`words` null: the catalogue is off for this role, or they have not arrived) Food cost falls back to
// the names of its own category documents, in their own order, for every card: nothing breaks.

// The only word-folding both sides agree on: capitals and accents do not count.
const fold = normalizeSearchText;

export interface CardCategories {
  // The group names in the order they are drawn: the Ricettario's words alphabetically, or (fallback) the documents' names.
  readonly words: readonly string[];
  // Whether the words are the Ricettario's (false: the fallback).
  readonly fromRecipeBook: boolean;
  // The word a card is grouped under, spelled as `words` spells it, or '' for none.
  wordOf(product: Pick<Product, 'id' | 'categoryId'>): string;
  // Whether a card's category is its recipe's (read-only in the card's editor).
  followsRecipe(product: Pick<Product, 'id'>): boolean;
  // The `foodcost-categories` document that carries a word, or null when there is none yet.
  docOf(word: string): Category | null;
}

export function cardCategories(input: {
  readonly words: readonly string[] | null;
  readonly categories: readonly Category[];
  readonly recipes: Readonly<Record<string, StoredDoc>>;
  readonly locale?: string;
}): CardCategories {
  const { categories, recipes } = input;
  const book = input.words !== null;
  const words = input.words !== null ? sortedCategories(input.words, input.locale) : categories.map(category => category.name);
  const wordOfName = (name: string): string => words.find(word => fold(word) === fold(name)) ?? '';
  const followsRecipe = (product: Pick<Product, 'id'>): boolean => book && recipeIdOfProduct(product.id) !== '';
  return {
    words,
    fromRecipeBook: book,
    followsRecipe,
    wordOf(product) {
      if (followsRecipe(product)) {
        const recipe = recipes[recipeIdOfProduct(product.id)];
        return recipe ? categoryOf(recipe, words) : '';
      }
      const doc = product.categoryId === null ? undefined : categories.find(category => category.id === product.categoryId);
      return doc ? wordOfName(doc.name) : '';
    },
    docOf: word => categories.find(category => fold(category.name) === fold(word)) ?? null,
  };
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
export function groupRows<T extends { product: Product }>(rows: readonly T[], categories: CardCategories): Group<T>[] {
  const byId = new Map<string | null, T[]>();
  for (const row of rows) {
    const word = categories.wordOf(row.product);
    const id = isCakeProductId(row.product.id) ? CAKES_GROUP_ID : word === '' ? null : categoryKey(word);
    const bucket = byId.get(id);
    if (bucket) bucket.push(row); else byId.set(id, [row]);
  }
  const groups: Group<T>[] = [];
  for (const word of categories.words) {
    const items = byId.get(categoryKey(word));
    if (items) groups.push({ id: categoryKey(word), name: word, items });
  }
  const cakes = byId.get(CAKES_GROUP_ID);
  if (cakes) groups.push({ id: CAKES_GROUP_ID, name: null, items: cakes });
  const rest = byId.get(null);
  if (rest) groups.push({ id: null, name: null, items: rest });
  return groups;
}

// Whether the list is drawn in groups at all: only when the venue has at least one category. Without one the list stays flat (a
// cake's row keeps its «Cake» tag); with one, the cakes sit together in their own «Cakes» group.
export function grouped(categories: CardCategories): boolean {
  return categories.words.length > 0;
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
