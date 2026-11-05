import { describe, expect, test } from 'vitest';
import { normalizeMonth } from '@mise/shared/inventory-model';
import type { InventoryMonth } from '@mise/shared/inventory-model';
import { frozenFor, monthReady, productLabel, uncountedIn, withoutEmptyMaps } from './stocktakeModel';

// What closing a month freezes into it, worked out as the current app's handleClose() does
// (js/inventory/inventory-main.js): the label, what ONE counted unit cost, and the pack weight.

const month = (doc: Record<string, unknown>): InventoryMonth => normalizeMonth({ month: '2026-10', ...doc }) as InventoryMonth;

const FLOUR = { id: 'flour', name: 'Farina 00', shortName: 'Farina', weight: '25kg', priceUnit: 'kg', pricePerUnit: 0.9 };
const EGGS = { id: 'eggs', name: 'Uova', priceUnit: 'pcs', pricePerUnit: 0.25 };
const SACK = { id: 'sack', name: 'Sacco misterioso', weight: 'sacco', priceUnit: 'kg', pricePerUnit: 2 };
const UNPRICED = { id: 'salt', name: 'Sale', weight: '1kg' };

describe('the Stocktake’s own decisions', () => {
  test('a product is called by its short name (else its name), then its pack text', () => {
    expect(productLabel(FLOUR)).toBe('Farina 25kg');
    expect(productLabel(EGGS)).toBe('Uova');
    expect(productLabel({ id: 'x' })).toBe('');
  });

  test('closing freezes every row’s label, and the price and pack weight wherever they are known', () => {
    const frozen = frozenFor(month({ packKg: { sack: 20 } }), [FLOUR, EGGS, SACK, UNPRICED]);
    expect(frozen.names).toEqual({ flour: 'Farina 25kg', eggs: 'Uova', sack: 'Sacco misterioso sacco', salt: 'Sale 1kg' });
    // ONE counted unit: a 25 kg sack at 0.90/kg; one egg; the typed 20 kg sack at 2/kg.
    expect(frozen.unitPrice).toEqual({ flour: 22.5, eggs: 0.25, sack: 40 });
    // The weight typed into the month beats the pack text; a product priced by the piece has none.
    expect(frozen.packKg).toEqual({ flour: 25, sack: 20, salt: 1 });
  });

  test('the close question counts the rows nobody counted — a zero is counted', () => {
    const m = month({ closing: { flour: 0, eggs: 12 } });
    expect(uncountedIn(m, [FLOUR, EGGS, SACK, UNPRICED])).toBe(2);
  });
});

describe('⚠️ what may go out in a write', () => {
  test('an empty map never does: in a merge it wipes the stored one', () => {
    expect(withoutEmptyMaps({ month: '2026-09', opening: {}, packKg: { a: 25 }, names: {}, unitPrice: {} }))
      .toEqual({ month: '2026-09', packKg: { a: 25 } });
  });

  test('what is not an empty map goes out untouched: an empty string reopens a month, a removal is not empty', () => {
    class Sentinel {}
    const removal = new Sentinel();
    const kept = { closedAt: '', updatedAt: 'now', closing: { a: removal }, top: removal, nothing: null, zero: 0 };
    expect(withoutEmptyMaps(kept)).toEqual(kept);
    expect(withoutEmptyMaps(kept).top).toBe(removal);
  });
});

describe('⚠️ what «ready» is', () => {
  const ready = (over: Partial<Parameters<typeof monthReady>[0]> = {}) => monthReady({
    monthAnswered: true, ingredientsAnswered: true, pricesAnswered: true, closed: false, rows: 3, ...over,
  });

  test('an open month is ready only with its own answer, the ingredients’ and the prices’', () => {
    expect(ready()).toBe(true);
    expect(ready({ monthAnswered: false })).toBe(false);
    expect(ready({ ingredientsAnswered: false })).toBe(false);
    // A close would freeze no money.
    expect(ready({ pricesAnswered: false })).toBe(false);
  });

  test('a venue that has really answered with nothing is ready: the month can still be closed', () => {
    expect(ready({ rows: 0 })).toBe(true);
  });

  test('a closed month is ready on its own rows, whatever the rest is doing; with none it needs the answers', () => {
    expect(ready({ closed: true, monthAnswered: false, ingredientsAnswered: false, pricesAnswered: false })).toBe(true);
    expect(ready({ closed: true, ingredientsAnswered: false, rows: 0 })).toBe(false);
    expect(ready({ closed: true, monthAnswered: false, rows: 0 })).toBe(false);
    expect(ready({ closed: true, pricesAnswered: false, rows: 0 })).toBe(true);
  });
});
