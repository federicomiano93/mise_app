import { describe, expect, it } from 'vitest';
import { lineUnits, openingUnit } from './lineUnits';

describe('lineUnits', () => {
  it('priced per kilo (or litre): g and kg, pieces only with a piece weight', () => {
    expect(lineUnits({ priceUnit: 'kg', pricePerUnit: 2 }, 'g')).toEqual(['g', 'kg']);
    expect(lineUnits({ priceUnit: 'l', pricePerUnit: 2 }, 'kg')).toEqual(['g', 'kg']);
    expect(lineUnits({ priceUnit: 'kg', pricePerUnit: 2, unitWeightKg: 0.25 }, 'g')).toEqual(['g', 'kg', 'pcs']);
  });

  it('priced per piece: pieces, g and kg only with a piece weight', () => {
    expect(lineUnits({ priceUnit: 'pcs', pricePerUnit: 0.3 }, 'pcs')).toEqual(['pcs']);
    expect(lineUnits({ priceUnit: 'pcs', pricePerUnit: 0.3, unitWeightKg: 0.06 }, 'pcs')).toEqual(['g', 'kg', 'pcs']);
    expect(lineUnits({ priceUnit: 'pcs', pricePerUnit: 0.3, unitWeightKg: 0 }, 'pcs')).toEqual(['pcs']);
  });

  it('keeps the line\'s own unit, in its place, even outside the set', () => {
    expect(lineUnits({ priceUnit: 'kg', pricePerUnit: 2 }, 'pcs')).toEqual(['g', 'kg', 'pcs']);
    expect(lineUnits({ priceUnit: 'pcs', pricePerUnit: 0.3 }, 'kg')).toEqual(['kg', 'pcs']);
  });

  it('no price basis, or nothing known of the ingredient: all three', () => {
    expect(lineUnits({}, 'g')).toEqual(['g', 'kg', 'pcs']);
    expect(lineUnits(null, 'g')).toEqual(['g', 'kg', 'pcs']);
  });
});

describe('openingUnit', () => {
  it('grams whenever grams convert, else pieces', () => {
    expect(openingUnit({ priceUnit: 'kg', pricePerUnit: 2 })).toBe('g');
    expect(openingUnit({ priceUnit: 'pcs', pricePerUnit: 0.3, unitWeightKg: 0.06 })).toBe('g');
    expect(openingUnit({ priceUnit: 'pcs', pricePerUnit: 0.3 })).toBe('pcs');
    expect(openingUnit(null)).toBe('g');
  });
});
