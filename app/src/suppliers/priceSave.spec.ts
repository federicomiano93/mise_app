import { describe, expect, test } from 'vitest';
import { formatPriceInput, pricePatch, storedPriceInput, singleFromCaseInput } from '@mise/shared/price-model';
import type { PricePatch } from '@mise/shared/price-model';
import { priceDiffers, priceWriteOf } from './priceSave';

// What an ingredient card's save does to the money (priceSave.ts). The rule that matters most: UNTOUCHED MEANS
// UNCHANGED — a save that moved no money writes no price, plants no history and keeps the price's date (his F4).

const THEN = '2026-09-01T08:00:00.000Z';
const NOW = '2026-10-21T10:00:00.000Z';

// A stored price as the card writes it, then laid on the ingredient (withPrices).
const flourKg = {
  id: 'i1', name: 'Flour', weight: '', supplierId: 's1',
  ...pricePatch({ priceUnit: 'kg', pricePerUnit: 2, vatRate: 4 }, THEN),
};
// A carton: 4 bags of 2.5 kg at 20, stored per item.
const cartonBags = {
  id: 'i2', name: 'Flour bags', weight: '2.5 kg', packCount: 4, packUnit: 'busta', unit: 'cartone', supplierId: 's1',
  ...pricePatch(formatPriceInput({ kind: 'carton', count: 4 }, '2.5 kg', { price: 20, vat: 4 }), THEN, '2.5 kg'),
};

describe('priceWriteOf: untouched means unchanged', () => {
  test('a rename with the price untouched writes NO price and NO history (the stored price fed back)', () => {
    expect(priceWriteOf(flourKg, pricePatch(storedPriceInput(flourKg, 4), NOW), 's1', NOW)).toBeNull();
    expect(priceWriteOf(cartonBags, pricePatch(storedPriceInput(cartonBags, 4), NOW, '2.5 kg'), 's1', NOW)).toBeNull();
  });

  test('a stored price on an old phone with the retired pack keys is not rewritten for those keys alone', () => {
    const old = { ...flourKg, packPrice: 50, packSize: 25 };
    expect(priceWriteOf(old, pricePatch(storedPriceInput(old, 4), NOW), 's1', NOW)).toBeNull();
  });

  test('a new ingredient with no price writes no price document at all', () => {
    expect(priceWriteOf(null, pricePatch({ priceUnit: null, pricePerUnit: '' }, NOW), '', NOW)).toBeNull();
  });
});

describe('priceWriteOf: the date moves only with the money (F4)', () => {
  test('a VAT-only change writes the price, KEEPS its date and plants no history', () => {
    const write = priceWriteOf(flourKg, pricePatch(storedPriceInput(flourKg, 10), NOW), 's1', NOW);
    expect(write?.doc.vatRate).toBe(10);
    expect(write?.doc.priceUpdatedAt).toBe(THEN);
    expect(write?.history).toBeNull();
  });

  test('a basis-only tap (the same money remembered another way) keeps the date and plants no history', () => {
    const write = priceWriteOf(cartonBags, { ...pricePatch(storedPriceInput(cartonBags, 4), NOW, '2.5 kg'), priceBasis: 'rate' }, 's1', NOW);
    expect(write?.doc.priceBasis).toBe('rate');
    expect(write?.doc.priceUpdatedAt).toBe(THEN);
    expect(write?.history).toBeNull();
  });

  test('a Cartone turned into a Singola (the same cost per item) keeps the date and plants no history', () => {
    const write = priceWriteOf(cartonBags, pricePatch(singleFromCaseInput(cartonBags, 4), NOW, '2.5 kg'), 's1', NOW);
    expect(write).not.toBeNull();
    expect(write?.doc.caseCount).toBeNull();
    expect(write?.doc.priceUpdatedAt).toBe(THEN);
    expect(write?.history).toBeNull();
  });

  test('a retyped identical price writes nothing', () => {
    expect(priceWriteOf(flourKg, pricePatch({ priceUnit: 'kg', pricePerUnit: '2.00', vatRate: 4 }, NOW), 's1', NOW)).toBeNull();
  });

  test('a stored price with no date takes today, with no history (the money did not move)', () => {
    const undated = { ...flourKg, priceUpdatedAt: null };
    const write = priceWriteOf(undated, pricePatch(storedPriceInput(undated, 4), NOW), 's1', NOW);
    expect(write?.doc.priceUpdatedAt).toBe(NOW);
    expect(write?.history).toBeNull();
  });
});

describe('priceWriteOf: a real change', () => {
  test('a new rate is written with today\'s date and ONE history entry naming the supplier being saved', () => {
    const write = priceWriteOf(flourKg, pricePatch({ priceUnit: 'kg', pricePerUnit: 2.4, vatRate: 4 }, NOW), 's2', NOW);
    expect(write?.doc).toMatchObject({ priceUnit: 'kg', pricePerUnit: 2.4, priceUpdatedAt: NOW, packPrice: null, packSize: null });
    expect(write?.history).toEqual({
      recordedAt: NOW, priceUnit: 'kg', pricePerUnit: 2.4, unitWeightKg: null, supplierId: 's2', source: 'manual',
    });
  });

  test('a first price on a new ingredient is written and recorded', () => {
    const write = priceWriteOf(null, pricePatch({ priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 }, NOW), '', NOW);
    expect(write?.doc.pricePerUnit).toBe(0.25);
    expect(write?.history).toMatchObject({ priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06, supplierId: '' });
  });

  test('emptying the price box CLEARS the stored price (every key null) and records nothing', () => {
    const write = priceWriteOf(flourKg, pricePatch({ priceUnit: null, pricePerUnit: '', vatRate: 4 }, NOW), 's1', NOW);
    expect(write?.doc).toMatchObject({ priceUnit: null, pricePerUnit: null, priceUpdatedAt: null, vatRate: 4 });
    expect(write?.history).toBeNull();
  });

  test('a new piece weight is a price change: new date, a history entry', () => {
    const egg = { id: 'e', weight: '', ...pricePatch({ priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 }, THEN) };
    const write = priceWriteOf(egg, pricePatch({ priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.065 }, NOW), '', NOW);
    expect(write?.doc.priceUpdatedAt).toBe(NOW);
    expect(write?.history?.unitWeightKg).toBe(0.065);
  });
});

describe('priceDiffers', () => {
  const patch = pricePatch({ priceUnit: 'kg', pricePerUnit: 2 }, THEN) as PricePatch;

  test('a missing key and a null one are the same absence', () => {
    expect(priceDiffers({ priceUnit: 'kg', pricePerUnit: 2, priceUpdatedAt: THEN }, patch)).toBe(false);
  });

  test('priceBasis counts only when the patch carries it', () => {
    const { priceBasis: _left, ...noBasis } = { ...patch, priceBasis: null };
    expect(priceDiffers({ ...patch, priceBasis: 'rate' }, noBasis)).toBe(false);
    expect(priceDiffers({ ...patch, priceBasis: 'rate' }, { ...patch, priceBasis: null })).toBe(true);
  });
});
