// What one whole recipe weighs once made (wholeRecipeKg), run against BOTH implementations: the partial port in shared/ and
// js/foodcost/from-recipes.js. Only what from-recipes.ts ports (8 Nov 2026, the «too much of a recipe» warning); the rest of
// the original is item 29 of docs/mise2-port-owed.md.

import { describe, expect, test } from 'vitest';
import * as ported from './from-recipes';
import * as legacyJs from '../../js/foodcost/from-recipes.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('the weighable rows, less the oven loss, in kilos to the gram', () => {
    expect(m.wholeRecipeKg({ ingredients: [{ label: 'Flour', grams: 1, unit: 'kg' }, { label: 'Water', grams: 0.65, unit: 'l' }] })).toBe(1.65);
    expect(m.wholeRecipeKg({ lossPct: 12, ingredients: [{ label: 'Flour', grams: 1000, unit: 'g' }] })).toBe(0.88);
    expect(m.wholeRecipeKg({ ingredients: [{ label: 'Salt', grams: 333.3333, unit: 'g' }] }), 'rounded to the gram').toBe(0.333);
  });

  test('a recipe of pieces and spoons only, an empty one or nothing at all weighs 0', () => {
    expect(m.wholeRecipeKg({ ingredients: [{ label: 'Eggs', grams: 4, unit: 'pcs' }, { label: 'Salt', grams: 1, unit: 'pinch' }] })).toBe(0);
    expect(m.wholeRecipeKg({ ingredients: [] })).toBe(0);
    expect(m.wholeRecipeKg({})).toBe(0);
    expect(m.wholeRecipeKg(null)).toBe(0);
    expect(m.wholeRecipeKg(undefined)).toBe(0);
  });

  test('a loss that is not a number, or 0 and below, is no loss', () => {
    const rows = [{ label: 'Flour', grams: 500, unit: 'g' }];
    for (const lossPct of [null, 'abc', 0, -5]) expect(m.wholeRecipeKg({ lossPct, ingredients: rows }), String(lossPct)).toBe(0.5);
  });
});

test('the two files give the same answer for a handful of shapes', () => {
  const shapes: unknown[] = [
    { lossPct: 99.5, ingredients: [{ grams: 1000 }] },
    { lossPct: '15', ingredients: [{ grams: '700', unit: 'g' }, { grams: 2, unit: 'dl' }] },
    { ingredients: 'not a list' },
    { ingredients: [{ grams: 5, unit: 'KG' }] },
  ];
  for (const shape of shapes) expect(ported.wholeRecipeKg(shape), JSON.stringify(shape)).toBe(legacy.wholeRecipeKg(shape));
});
