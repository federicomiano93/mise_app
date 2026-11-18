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
};

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
};

// A product's line on the price list, or null when it cannot be one: no name, no selling price, no way of selling it
// (Food cost's «sold by» not chosen), a price past the bound, or a pack whose size is not said.
export function priceItemOf(product: PricedProductFields): PriceItem | null {
  const name = typeof product.name === 'string' ? product.name.trim().slice(0, MAX_PRICE_NAME) : '';
  const price = finitePositive(product.sellingPrice);
  if (product.id === '' || name === '' || price === null || price > MAX_PRICE) return null;
  const rounded = Math.round(price * 100) / 100;
  if (product.sellingMode === 'piece') return { productId: product.id, name, price: rounded, per: 'piece', packSize: null, packUnit: null };
  if (product.sellingMode === 'weight') return { productId: product.id, name, price: rounded, per: 'kg', packSize: null, packUnit: null };
  if (product.sellingMode === 'pack') {
    const packSize = finitePositive(product.packSize);
    const packUnit = product.packUnit === 'g' || product.packUnit === 'kg' || product.packUnit === 'pcs' ? product.packUnit : null;
    if (packSize === null || packUnit === null) return null;
    return { productId: product.id, name, price: rounded, per: 'pack', packSize, packUnit };
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
  if (per !== 'pack') return { productId, name, price, per, packSize: null, packUnit: null };
  const packSize = finitePositive(item.packSize);
  const packUnit = item.packUnit === 'g' || item.packUnit === 'kg' || item.packUnit === 'pcs' ? item.packUnit : null;
  return packSize === null || packUnit === null ? null : { productId, name, price, per, packSize, packUnit };
}

function millisOf(value: unknown): number | null {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof (value as { toMillis: unknown }).toMillis === 'function') {
    const ms = Number((value as { toMillis: () => unknown }).toMillis());
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

// The stored document as both sections read it. A missing document is an empty, never-published list. Duplicated product
// ids keep their first line; the list is sorted by name for the screens (the stored order means nothing).
export function readPriceList(data: Record<string, unknown> | null | undefined, locale?: string): PriceList {
  if (!data) return { items: [], publishedAtMs: null };
  const seen = new Set<string>();
  const items: PriceItem[] = [];
  for (const raw of Array.isArray(data.items) ? data.items.slice(0, MAX_PRICE_ITEMS) : []) {
    const item = readItem(raw);
    if (item === null || seen.has(item.productId)) continue;
    seen.add(item.productId);
    items.push(item);
  }
  items.sort((a, b) => a.name.localeCompare(b.name, locale));
  return { items, publishedAtMs: millisOf(data.publishedAt) };
}

// What is written for these items: plain objects, the pack fields only on a pack.
export function itemsToStore(items: readonly PriceItem[]): Array<Record<string, unknown>> {
  return items.slice(0, MAX_PRICE_ITEMS).map(item => (item.per === 'pack'
    ? { productId: item.productId, name: item.name, price: item.price, per: item.per, packSize: item.packSize, packUnit: item.packUnit }
    : { productId: item.productId, name: item.name, price: item.price, per: item.per }));
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

// What a line costs: quantity × unit price, to the cent. Never NaN: anything unreadable is 0.
export function lineAmount(qty: unknown, unitPrice: unknown): number {
  const q = typeof qty === 'number' && Number.isFinite(qty) && qty > 0 ? qty : 0;
  const p = typeof unitPrice === 'number' && Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : 0;
  return Math.round(q * p * 100) / 100;
}

// The item a typed product name stands for: an exact match of a name on the list (case and spaces aside), else null.
const fold = (text: string): string => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export function itemNamed(name: string, items: readonly PriceItem[]): PriceItem | null {
  const wanted = fold(name);
  if (wanted === '') return null;
  return items.find(item => fold(item.name) === wanted) ?? null;
}
