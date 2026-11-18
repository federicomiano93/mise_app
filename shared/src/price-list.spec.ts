import { describe, expect, it } from 'vitest';
import {
  sharedNames, MAX_PRICE_ITEMS, bookingUnitOf, itemIsStale, itemNamed, itemsToStore, lineAmount, priceItemOf, readPriceList,
} from './price-list';

// NEW IN MISE 2 (bookings step 2): no js/ original, so not paired. The price list the counter books from.

const product = (over: Record<string, unknown> = {}) => ({
  id: 'p1', name: ' Focaccia ', sellingMode: 'weight', sellingPrice: 12, packSize: null, packUnit: null, ...over,
}) as Parameters<typeof priceItemOf>[0];

describe('priceItemOf', () => {
  it('takes only the name, the price and what it is for', () => {
    expect(priceItemOf(product())).toEqual({ productId: 'p1', name: 'Focaccia', price: 12, per: 'kg', packSize: null, packUnit: null });
    expect(priceItemOf(product({ sellingMode: 'piece', sellingPrice: 2.505 }))).toMatchObject({ per: 'piece', price: 2.51 });
    expect(priceItemOf(product({ sellingMode: 'pack', packSize: 250, packUnit: 'g' }))).toMatchObject({ per: 'pack', packSize: 250, packUnit: 'g' });
  });

  it('⚠️ never copies a cost, a margin or a VAT rate', () => {
    const item = priceItemOf({ ...product(), vatRate: 10, foodCostTarget: 30, components: [{ qty: 1 }] } as never);
    expect(Object.keys(item ?? {}).sort()).toEqual(['name', 'packSize', 'packUnit', 'per', 'price', 'productId']);
  });

  it('refuses a product that cannot be priced', () => {
    for (const over of [{ sellingPrice: null }, { sellingPrice: 0 }, { sellingPrice: Number.NaN }, { sellingPrice: 200000 },
      { sellingMode: null }, { sellingMode: 'barter' }, { name: '  ' }, { id: '' },
      { sellingMode: 'pack', packSize: null, packUnit: 'g' }, { sellingMode: 'pack', packSize: 2, packUnit: 'l' }]) {
      expect(priceItemOf(product(over)), JSON.stringify(over)).toBeNull();
    }
  });
});

describe('readPriceList', () => {
  it('reads a stored list, sorted by name, the publish time from a timestamp', () => {
    const list = readPriceList({
      items: [
        { productId: 'b', name: 'Panettone', price: 25, per: 'piece' },
        { productId: 'a', name: 'Focaccia', price: 12, per: 'kg' },
        { productId: 'c', name: 'Grissini', price: 3.5, per: 'pack', packSize: 250, packUnit: 'g' },
      ],
      publishedAt: { toMillis: () => 1_700_000_000_000 },
    });
    expect(list.items.map(i => i.name)).toEqual(['Focaccia', 'Grissini', 'Panettone']);
    expect(list.publishedAtMs).toBe(1_700_000_000_000);
  });

  it('a missing document is an empty list never published', () => {
    expect(readPriceList(null)).toEqual({ items: [], publishedAtMs: null });
    expect(readPriceList({})).toEqual({ items: [], publishedAtMs: null });
  });

  it('drops what is not an item, and a product listed twice', () => {
    const list = readPriceList({ items: [
      null, 'x', { productId: 'a', name: 'A', price: -1, per: 'kg' }, { productId: 'a', name: 'A', price: 1, per: 'litre' },
      { productId: 'b', name: 'B', price: 1, per: 'pack' }, { productId: 'c', name: 'C', price: 2, per: 'piece' },
      { productId: 'c', name: 'C again', price: 3, per: 'piece' },
    ] });
    expect(list.items).toEqual([{ productId: 'c', name: 'C', price: 2, per: 'piece', packSize: null, packUnit: null }]);
  });

  it('never reads past the bound', () => {
    const items = Array.from({ length: MAX_PRICE_ITEMS + 5 }, (_, i) => ({ productId: `p${i}`, name: `P${i}`, price: 1, per: 'piece' }));
    expect(readPriceList({ items }).items).toHaveLength(MAX_PRICE_ITEMS);
  });
});

describe('the rest', () => {
  it('stores plain items, the pack fields only on a pack, and reads them back the same', () => {
    const items = [priceItemOf(product())!, priceItemOf(product({ id: 'p2', name: 'Grissini', sellingMode: 'pack', packSize: 6, packUnit: 'pcs' }))!];
    const stored = itemsToStore(items);
    expect(stored[0]).toEqual({ productId: 'p1', name: 'Focaccia', price: 12, per: 'kg' });
    expect(readPriceList({ items: stored }).items).toEqual(items);
  });

  it('tells a published item that no longer matches its product', () => {
    const published = priceItemOf(product())!;
    expect(itemIsStale(published, priceItemOf(product()))).toBe(false);
    expect(itemIsStale(published, priceItemOf(product({ sellingPrice: 13 })))).toBe(true);
    expect(itemIsStale(published, priceItemOf(product({ name: 'Focaccia alta' })))).toBe(true);
    expect(itemIsStale(published, null)).toBe(true);
  });

  it('counts a piece and a pack in pieces, a kilo in kilos', () => {
    expect(bookingUnitOf('piece')).toBe('pcs');
    expect(bookingUnitOf('pack')).toBe('pcs');
    expect(bookingUnitOf('kg')).toBe('kg');
  });

  it('works out a line to the cent, never NaN', () => {
    expect(lineAmount(1.5, 12)).toBe(18);
    expect(lineAmount(3, 2.35)).toBe(7.05);
    expect(lineAmount(Number.NaN, 2)).toBe(0);
    // A half cent goes up, as at a till, binary fractions aside.
    expect(lineAmount(0.5, 1.15)).toBe(0.58);
    expect(lineAmount(0.3, 3.05)).toBe(0.92);
    expect(lineAmount(1.5, 0.35)).toBe(0.53);
    expect(lineAmount(2, null)).toBe(0);
  });

  it('finds the item a typed name stands for', () => {
    const items = readPriceList({ items: [{ productId: 'a', name: 'Focaccia alta', price: 12, per: 'kg' }] }).items;
    expect(itemNamed('  focaccia   ALTA ', items)?.productId).toBe('a');
    expect(itemNamed('Focaccia', items)).toBeNull();
    expect(itemNamed('', items)).toBeNull();
  });

  it('two products of the same name: the reader keeps the first, and Food cost is told which names clash', () => {
    const list = readPriceList({ items: [
      { productId: 'a', name: 'Focaccia', price: 2.5, per: 'piece' },
      { productId: 'b', name: ' focaccia ', price: 12, per: 'kg' },
    ] });
    expect(list.items.map(i => i.productId)).toEqual(['a']);
    const both = [priceItemOf(product({ id: 'a', name: 'Focaccia', sellingMode: 'piece' }))!, priceItemOf(product({ id: 'b', name: 'focaccia ' }))!];
    expect(sharedNames(both)).toEqual(['Focaccia']);
    expect(sharedNames([both[0]!])).toEqual([]);
  });
});
