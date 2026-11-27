import { describe, expect, it } from 'vitest';
import type { PlanEntry } from '@mise/shared/invoice-import-plan';
import { isPriceConfirmed, replacedPrice } from './priceConfirmed';

type Row = PlanEntry['row'];

const row = (rate: number, over: Record<string, unknown> = {}) => ({
  status: 'update-price', ingredientId: 'a', updateCurrent: true,
  newPoints: [{ date: '2026-11-20', pricePerUnit: rate }], allPoints: [{ date: '2026-11-20', pricePerUnit: rate }], ...over,
}) as unknown as Row;

const prices = { a: { pricePerUnit: 10, priceUnit: 'kg' } };

describe('isPriceConfirmed', () => {
  it('is true when a newer invoice repeats the stored price', () => {
    expect(isPriceConfirmed(row(10), prices, 'kg')).toBe(true);
  });

  it('is true within the half percent the «(=)» on the row allows, and says the same thing as it', () => {
    expect(isPriceConfirmed(row(10.04), prices, 'kg')).toBe(true);
    expect(replacedPrice(row(10.04), prices, 'kg')?.percent).toBe(0);
  });

  it('is false when the price moves', () => {
    expect(isPriceConfirmed(row(11), prices, 'kg')).toBe(false);
    expect(replacedPrice(row(11), prices, 'kg')?.percent).toBe(10);
  });

  it('is false when the units differ (the two cannot be compared) or the row is not a price update', () => {
    expect(isPriceConfirmed(row(10), prices, 'l')).toBe(false);
    expect(isPriceConfirmed(row(10, { status: 'history-only' }), prices, 'kg')).toBe(false);
    expect(isPriceConfirmed(row(10), {}, 'kg')).toBe(false);
  });

  it('changes nothing in the row: what is written for a same-price row stays as it was', () => {
    const same = row(10);
    const before = JSON.stringify(same);
    isPriceConfirmed(same, prices, 'kg');
    expect(JSON.stringify(same)).toBe(before);
    expect(same.status).toBe('update-price');
    expect(same.updateCurrent).toBe(true);
    expect(same.newPoints).toHaveLength(1);
  });
});
