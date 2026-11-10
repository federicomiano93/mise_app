// from-recipes.ts — which recipes of the catalogue have no Food cost product yet, and the product each of them would start
// as. PURE: no DOM, no Firestore.
//
// FULL port of js/foodcost/from-recipes.js (current app 5f2fcb67, 28 Oct 2026; item 29 of docs/mise2-port-owed.md): the input
// is the same, the output is the same, odd values included — parity.spec.ts pairs the exports and odd-inputs.spec.ts feeds both
// files the same junk. `wholeRecipeKg` came first (a7f4c75d, 8 Nov 2026, the «too much of a recipe» warning).
//
// Federico, 28 Oct 2026 (a note from the app): «per ogni ricetta presente nel ricettario aggiungi una scheda food cost con i
// dati che possono dare le ricette, il resto lo aggiungo a mano … così non devo registrare le schede due volte». Agreed with
// him the same evening: a button that lists the missing ones, he unticks what he does not want, a confirm, then they are
// written — never in the background.
//
// ⚠️⚠️ THE LINK IS THE DOCUMENT ID, NOT A FIELD. A product made from a recipe lives at products/recipe-<recipeId>. A field
// would need a rules change, and a phone still on an older version saves a product WHOLE with only the fields it knows — it
// would drop the link in silence and the recipe would be offered again: a duplicate. An id cannot be dropped by any save, and
// renaming either side never breaks it.
// ⚠️ A NAME IS NEVER A LINK. A product made by hand that already uses the recipe on a line, or bears its name, is only «maybe
// already there»: shown unticked, his call.
//
// ⚠️⚠️ AFTER THE SWITCH (Mise 2, 10 Nov 2026: «il calo è del prodotto» — foodcost-model.ts says it all) the product a recipe
// starts holds the whole recipe RAW on its line, and the recipe's oven loss as its own cooked weight: `productFromRecipe`, and so
// the `kg` `recipesWithoutProducts` lists, part from js/foodcost/from-recipes.js there (from-recipes.spec.ts, odd-inputs.spec.ts:
// «post-switch»). `wholeRecipeKg` stays the original's — what the whole recipe weighs once made.

import { normalizeLossPct, normalizeSearchText, weighableTotalGrams } from './catalogue-model';
import { PRODUCT_MODEL, productsUsingRecipe } from './foodcost-model';
import { roundTo } from './price-model';

const PREFIX = 'recipe-';
// The rules cap a product's name at 200 characters.
const MAX_NAME = 200;

// Whatever a document carries: a recipe or a product as the database (or a caller) hands it over, trusted for nothing.
type Loose = Record<string, unknown>;

function idText(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

// The id of the product made from this recipe, or '' for a recipe with no usable id.
export function recipeProductId(recipeId: unknown): string {
  const id = idText(recipeId);
  return id && !id.includes('/') ? PREFIX + id : '';
}

// The recipe a product was made from, or '' for a product made by hand.
export function recipeIdOfProduct(productId: unknown): string {
  const id = idText(productId);
  return id.startsWith(PREFIX) ? id.slice(PREFIX.length) : '';
}

// What one whole recipe weighs once made, in kilos: its weighable rows less its oven loss — the kilos its cost per kilo is
// counted on. 0 for a recipe of pieces and spoons only, which he then weighs himself.
export function wholeRecipeKg(recipe: unknown): number {
  const grams = weighableTotalGrams(recipe);
  if (!(grams > 0)) return 0;
  const loss = normalizeLossPct((recipe as { lossPct?: unknown } | null | undefined)?.lossPct);
  return roundTo(grams * (1 - loss / 100) / 1000, 3);
}

function recipeName(recipe: unknown): string {
  const card = recipe as Loose | null | undefined;
  return String(card && card['name'] != null ? card['name'] : '').trim().slice(0, MAX_NAME);
}

// The product a recipe starts, as the original builds it (the store writes it through its own `toProductDocument`).
export interface ProductFromRecipe {
  readonly id: string;
  readonly name: string;
  readonly components: readonly { readonly recipeId: string; readonly qtyKg: number }[];
  readonly packaging: readonly never[];
  readonly sellingMode: null;
  readonly piecesPerBatch: null;
  readonly packSize: null;
  readonly packUnit: null;
  readonly sellingPrice: null;
  readonly vatRate: null;
  readonly foodCostTarget: null;
  readonly labourMinutes: null;
  readonly labourPeople: null;
  // Mise 2 (post-switch): the product's own weighing — no raw typed apart from the line, and the recipe's oven loss as the
  // batch's cooked weight (null when the recipe loses nothing).
  readonly rawGrams: null;
  readonly cookedGrams: number | null;
  readonly model: number;
}

// The product a recipe starts: its name, and the whole recipe on the first line — the two things a recipe knows. ⚠️ Nothing
// else: no way of selling, no pieces, no price, no VAT. A value nobody typed is one somebody saves and trusts.
// ⚠️ MISE 2 (post-switch): the line is the whole recipe RAW, to the gram, and the cooked weight is that raw weight less the
// recipe's own loss, to a tenth of a gram — so the product costs a kilo of what comes out exactly as the recipe's price per kilo
// did before the switch, and «Cottura» shows the recipe's loss.
export function productFromRecipe(recipe: unknown): ProductFromRecipe | null {
  const card = recipe as Loose | null | undefined;
  const recipeId = idText(card && card['id']);
  const id = recipeProductId(recipeId);
  const name = recipeName(recipe);
  if (!id || !name) return null;
  const grams = weighableTotalGrams(recipe);
  const rawKg = grams > 0 ? roundTo(grams / 1000, 3) : 0;
  const loss = normalizeLossPct(card && card['lossPct']);
  return {
    id,
    name,
    components: [{ recipeId, qtyKg: rawKg }],
    packaging: [],
    sellingMode: null, piecesPerBatch: null, packSize: null, packUnit: null,
    sellingPrice: null, vatRate: null, foodCostTarget: null,
    labourMinutes: null, labourPeople: null,
    rawGrams: null,
    cookedGrams: rawKg > 0 && loss > 0 ? roundTo(rawKg * 1000 * (1 - loss / 100), 1) : null,
    model: PRODUCT_MODEL,
  };
}

// 'used' (a product has the recipe on a line) or 'same-name'.
export type MaybeReason = 'used' | 'same-name';

export interface MissingProduct<R> {
  readonly recipe: R;
  readonly kg: number;
}
export interface MaybeProduct<R> extends MissingProduct<R> {
  readonly reason: MaybeReason;
  readonly productName: string;
}

// The recipes that have no product made from them, in two groups:
//
//   { create: [{ recipe, kg }],                        — nothing in Food cost knows them
//     maybe:  [{ recipe, kg, reason, productName }] }  — a hand-made product may be theirs
//
// A recipe whose own product exists is in neither, whatever has happened to that product since. Recipes without a name are
// left out: the rules refuse a product without one.
export function recipesWithoutProducts<R = Loose>(recipes: unknown, products: unknown): { create: MissingProduct<R>[]; maybe: MaybeProduct<R>[] } {
  const recipeList: unknown[] = Array.isArray(recipes) ? recipes : Object.values((recipes || {}) as object);
  const productList: unknown[] = Array.isArray(products) ? products : [];
  const ids = new Set(productList.map(p => idText(p && (p as Loose)['id'])));
  const create: MissingProduct<R>[] = [];
  const maybe: MaybeProduct<R>[] = [];

  recipeList.forEach(recipe => {
    const product = productFromRecipe(recipe);
    if (!product || ids.has(product.id)) return;
    const kg = product.components[0]!.qtyKg;
    const asRecipe = recipe as R;
    const used = productsUsingRecipe(productList, (recipe as Loose)['id'])[0] as Loose | undefined;
    if (used) { maybe.push({ recipe: asRecipe, kg, reason: 'used', productName: String(used['name'] || '').trim() }); return; }
    const wanted = normalizeSearchText(product.name);
    const named = productList.find(p => p && normalizeSearchText((p as Loose)['name']) === wanted) as Loose | undefined;
    if (named) { maybe.push({ recipe: asRecipe, kg, reason: 'same-name', productName: String(named['name'] || '').trim() }); return; }
    create.push({ recipe: asRecipe, kg });
  });

  const byName = (a: { recipe: R }, b: { recipe: R }): number =>
    recipeName(a.recipe).localeCompare(recipeName(b.recipe), undefined, { sensitivity: 'base' });
  return { create: create.sort(byName), maybe: maybe.sort(byName) };
}
