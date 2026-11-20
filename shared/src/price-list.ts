// price-list.ts — the bookings price list (Mise 2 only, bookings step 2, 18 Nov 2026).
//
// NEW IN MISE 2, no original in the current app, so not paired with a js/ file.
//
// The owner chooses in Food cost which products the counter may book, and PUBLISHES them: one document,
// `locations/{lid}/price-list/bookings`, holding for each chosen product only its name, its selling price (VAT included,
// as Food cost stores it) and what that price is for (a piece, a kilo, a pack). ⚠️ NEVER A COST, A MARGIN OR A VAT RATE:
// employees at the counter read this document, and Food cost's own money stays behind its card (firestore.rules).
//
// Both sections read the shape from here — Food cost writes it, Bookings reads it — so the two can never disagree, and
// neither imports the other's folder. PURE: no Firebase, no DOM, no dictionary.

// The one document id under `price-list`: the list for bookings.
export const PRICE_LIST_DOC = 'bookings';

// The most products one list holds (the rules' own bound).
export const MAX_PRICE_ITEMS = 300;
// A product name's bound (the products' own rule).
export const MAX_PRICE_NAME = 200;
// A price's bound, the bookings' own money bound.
export const MAX_PRICE = 100_000;

// What a price is for: one piece, one kilo, or one pack (its size in packSize/packUnit).
export type PricePer = 'piece' | 'kg' | 'pack';
export const PRICE_PERS: readonly PricePer[] = ['piece', 'kg', 'pack'];

export type PackUnit = 'g' | 'kg' | 'pcs';

export type PriceItem = {
  readonly productId: string;
  readonly name: string;
  // Gross (VAT included), in the venue's money, > 0.
  readonly price: number;
  readonly per: PricePer;
  // Only for a pack: what one pack holds.
  readonly packSize: number | null;
  readonly packUnit: PackUnit | null;
  // ── Chosen in Bookings' «Impostazioni» (bookings settings, 18 Nov 2026), all optional on the stored item ──
  // A favourite: the booking form offers it first, as a tile (bookings step 2 of the rebuild).
  readonly favourite: boolean;
  // «Chiedi per pezzo»: the form asks for it piece by piece, each with its own slip (step 4 of the rebuild).
  readonly perPiece: boolean;
  // The weights the counter offers for it, in kilos, smallest first (empty: none). ≤ MAX_WEIGHTS, each in (0, MAX_WEIGHT_KG].
  readonly weights: readonly number[];
  // The ingredients a customer may ask to leave out. null: never chosen (the settings screen pre-fills it from the
  // product's recipe); [] chosen as none.
  readonly removable: readonly string[] | null;
};

// The bounds of the settings' own fields (the rules check only the list's size, so these are the only ones).
export const MAX_WEIGHTS = 12;
export const MAX_WEIGHT_KG = 50;
export const MAX_REMOVABLE = 30;
export const MAX_REMOVABLE_NAME = 80;

// What a product's line holds before anybody chose anything in the settings.
const NO_CHOICES = { favourite: false, perPiece: false, weights: [] as readonly number[], removable: null } as const;

export type PriceList = {
  readonly items: readonly PriceItem[];
  // When it was published (the server's time, in ms), or null when not known yet.
  readonly publishedAtMs: number | null;
};

const finitePositive = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

// The part of a Food cost product this file reads. Anything else on the product is ignored, and never copied.
export type PricedProductFields = {
  readonly id: string;
  readonly name: string;
  readonly sellingMode: unknown;
  readonly sellingPrice: unknown;
  readonly packSize: unknown;
  readonly packUnit: unknown;
  // Food cost model 4: a card of kind 'semi' (a ganache, a sponge) is never bookable. Absent = a finished product.
  readonly kind?: unknown;
};

// A product's line on the price list, or null when it cannot be one: no name, no selling price, no way of selling it
// (Food cost's «sold by» not chosen), a price past the bound, or a pack whose size is not said.
export function priceItemOf(product: PricedProductFields): PriceItem | null {
  // ⚠️ A SEMI-FINISHED CARD IS NEVER BOOKABLE: it has no selling price of its own and is used inside other cards.
  if (product.kind === 'semi') return null;
  const name = typeof product.name === 'string' ? product.name.trim().slice(0, MAX_PRICE_NAME) : '';
  const price = finitePositive(product.sellingPrice);
  if (product.id === '' || name === '' || price === null || price > MAX_PRICE) return null;
  const rounded = Math.round(price * 100) / 100;
  if (product.sellingMode === 'piece') return { productId: product.id, name, price: rounded, per: 'piece', packSize: null, packUnit: null, ...NO_CHOICES };
  if (product.sellingMode === 'weight') return { productId: product.id, name, price: rounded, per: 'kg', packSize: null, packUnit: null, ...NO_CHOICES };
  if (product.sellingMode === 'pack') {
    const packSize = finitePositive(product.packSize);
    const packUnit = product.packUnit === 'g' || product.packUnit === 'kg' || product.packUnit === 'pcs' ? product.packUnit : null;
    if (packSize === null || packUnit === null) return null;
    return { productId: product.id, name, price: rounded, per: 'pack', packSize, packUnit, ...NO_CHOICES };
  }
  return null;
}

// One stored item, read as untrusted data (the rules cannot look inside the list). Null when it is not one.
function readItem(raw: unknown): PriceItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const productId = typeof item.productId === 'string' ? item.productId : '';
  const name = typeof item.name === 'string' ? item.name.trim() : '';
  const price = finitePositive(item.price);
  const per = PRICE_PERS.find(p => p === item.per) ?? null;
  if (productId === '' || name === '' || price === null || price > MAX_PRICE || per === null) return null;
  // ⚠️ A WRONG CHOICE NEVER DROPS THE PRODUCT: each of the settings' fields is read on its own, and a bad one is as if unset.
  const choices = {
    favourite: item.favourite === true,
    perPiece: item.perPiece === true,
    weights: cleanWeights(item.weights),
    removable: Array.isArray(item.removable) ? cleanRemovable(item.removable) : null,
  };
  if (per !== 'pack') return { productId, name, price, per, packSize: null, packUnit: null, ...choices };
  const packSize = finitePositive(item.packSize);
  const packUnit = item.packUnit === 'g' || item.packUnit === 'kg' || item.packUnit === 'pcs' ? item.packUnit : null;
  return packSize === null || packUnit === null ? null : { productId, name, price, per, packSize, packUnit, ...choices };
}

// A weight as stored: kilos, rounded to the gram.
const toGram = (kg: number): number => Math.round(kg * 1000) / 1000;

// Weights as the list keeps them: numbers in (0, MAX_WEIGHT_KG], to the gram, each once, smallest first, at most MAX_WEIGHTS.
export function cleanWeights(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  for (const value of raw) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_WEIGHT_KG) continue;
    const kg = toGram(value);
    if (kg > 0) seen.add(kg);
  }
  return [...seen].sort((a, b) => a - b).slice(0, MAX_WEIGHTS);
}

// Ingredient names as the list keeps them: trimmed, cut to MAX_REMOVABLE_NAME, each once (case and spaces aside), in the
// order given, at most MAX_REMOVABLE.
export function cleanRemovable(raw: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const name = value.trim().replace(/\s+/g, ' ').slice(0, MAX_REMOVABLE_NAME);
    const key = foldName(name);
    if (name === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_REMOVABLE) break;
  }
  return out;
}

// A weight typed in the settings («3 kg», «800 g», «800 gr», «3 etti», «1,5», «500»), in kilos, or null when it is not one the list can hold.
// A bare number is kilos up to MAX_WEIGHT_KG and grams above it («500» is half a kilo, «3» three kilos).
export function parseWeight(text: string): number | null {
  const match = /^\s*([0-9]+(?:[.,][0-9]+)?)\s*(kg|gr|g|hg|etti|etto)?\s*$/i.exec(text);
  if (match === null) return null;
  const value = Number((match[1] ?? '').replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2]?.toLowerCase();
  // «gr» is grams, «hg» / «etto» / «etti» hectograms (a tenth of a kilo).
  const kg = unit === 'g' || unit === 'gr' || (unit === undefined && value > MAX_WEIGHT_KG)
    ? value / 1000
    : unit === 'hg' || unit === 'etto' || unit === 'etti' ? value / 10 : value;
  const rounded = toGram(kg);
  return rounded > 0 && rounded <= MAX_WEIGHT_KG ? rounded : null;
}

// A weight as a person reads it: «500 g» under a kilo, «1 kg», «1,5 kg» (the decimal mark of `locale`).
export function formatWeight(kg: number, locale?: string): string {
  if (kg < 1) return `${Math.round(kg * 1000)} g`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(kg)} kg`;
}

// The names of the ingredients in the recipes a product is made of, for the «Si può togliere» pre-fill: the rows of every recipe
// on its lines, and of the recipe it was made from (a product id `recipe-<id>`). Each once, in recipe order.
export function recipeIngredientNames(
  product: { readonly id: string; readonly components?: unknown },
  recipeById: (id: string) => unknown,
): string[] {
  const ids: string[] = [];
  if (product.id.startsWith('recipe-')) ids.push(product.id.slice('recipe-'.length));
  for (const component of Array.isArray(product.components) ? product.components : []) {
    const id = component && typeof component === 'object' ? (component as { recipeId?: unknown }).recipeId : null;
    if (typeof id === 'string' && id !== '' && !ids.includes(id)) ids.push(id);
  }
  const names: unknown[] = [];
  for (const id of ids) {
    const recipe = recipeById(id) as { ingredients?: unknown } | null | undefined;
    const rows = recipe && Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
    for (const row of rows) {
      if (row && typeof row === 'object') names.push((row as { label?: unknown }).label);
    }
  }
  return cleanRemovable(names);
}

function millisOf(value: unknown): number | null {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof (value as { toMillis: unknown }).toMillis === 'function') {
    const ms = Number((value as { toMillis: () => unknown }).toMillis());
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

// The stored document as both sections read it. A missing document is an empty, never-published list. Duplicated product
// ids — and duplicated NAMES, which the counter could not tell apart (a line is matched by its name) — keep their first line;
// the list is sorted by name for the screens (the stored order means nothing).
export function readPriceList(data: Record<string, unknown> | null | undefined, locale?: string): PriceList {
  if (!data) return { items: [], publishedAtMs: null };
  const seen = new Set<string>();
  const names = new Set<string>();
  const items: PriceItem[] = [];
  for (const raw of Array.isArray(data.items) ? data.items.slice(0, MAX_PRICE_ITEMS) : []) {
    const item = readItem(raw);
    if (item === null || seen.has(item.productId) || names.has(foldName(item.name))) continue;
    seen.add(item.productId);
    names.add(foldName(item.name));
    items.push(item);
  }
  items.sort((a, b) => a.name.localeCompare(b.name, locale));
  return { items, publishedAtMs: millisOf(data.publishedAt) };
}

// What is written for these items: plain objects, the pack fields only on a pack, and of the settings' choices only what was
// chosen (a favourite, per piece, some weights, the removable list once chosen — even empty).
export function itemsToStore(items: readonly PriceItem[]): Array<Record<string, unknown>> {
  return items.slice(0, MAX_PRICE_ITEMS).map(item => {
    const out: Record<string, unknown> = { productId: item.productId, name: item.name, price: item.price, per: item.per };
    if (item.per === 'pack') {
      out.packSize = item.packSize;
      out.packUnit = item.packUnit;
    }
    if (item.favourite) out.favourite = true;
    if (item.perPiece) out.perPiece = true;
    const weights = cleanWeights(item.weights);
    if (weights.length > 0) out.weights = weights;
    if (item.removable !== null) out.removable = cleanRemovable(item.removable);
    return out;
  });
}

// Whether a published item still says what its product says now (the name and the price): when not, Food cost tells the
// owner to publish again. An item whose product is gone or no longer priced is «changed» too.
export function itemIsStale(published: PriceItem, current: PriceItem | null): boolean {
  return current === null
    || current.name !== published.name
    || current.price !== published.price
    || current.per !== published.per
    || current.packSize !== published.packSize
    || current.packUnit !== published.packUnit;
}

// The booking line's unit for an item: a piece and a pack are counted in pieces, a kilo in kilos.
export function bookingUnitOf(per: PricePer): 'pcs' | 'kg' {
  return per === 'kg' ? 'kg' : 'pcs';
}

// What a line costs: quantity × unit price, to the cent, a half cent rounded UP. Never NaN: anything unreadable is 0.
// ⚠️ THROUGH toFixed BEFORE THE ROUNDING: 0.5 × 1.15 is 0.57499999… in binary, and a plain Math.round would make 0.57 of a
// till's 0.58.
export function lineAmount(qty: unknown, unitPrice: unknown): number {
  const q = typeof qty === 'number' && Number.isFinite(qty) && qty > 0 ? qty : 0;
  const p = typeof unitPrice === 'number' && Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : 0;
  return Math.round(Number((q * p * 100).toFixed(6))) / 100;
}

// A name as the counter's matching compares it: case and spaces aside.
export function foldName(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

// The item a typed product name stands for: an exact match of a name on the list (case and spaces aside), else null.
export function itemNamed(name: string, items: readonly PriceItem[]): PriceItem | null {
  const wanted = foldName(name);
  if (wanted === '') return null;
  return items.find(item => foldName(item.name) === wanted) ?? null;
}

// The names that two or more of these items share (case and spaces aside): the counter could book only one of them, so Food cost
// refuses to publish them together.
export function sharedNames(items: readonly PriceItem[]): string[] {
  const count = new Map<string, { name: string; n: number }>();
  for (const item of items) {
    const key = foldName(item.name);
    const seen = count.get(key);
    count.set(key, { name: seen?.name ?? item.name, n: (seen?.n ?? 0) + 1 });
  }
  return [...count.values()].filter(entry => entry.n > 1).map(entry => entry.name);
}
