// Unit tests for the rows Food cost cannot price (P15 — the owner cannot read code, so these tests are the safety net), run
// against BOTH implementations: the TypeScript port in shared/ and js/catalogue/unpriced-rows.js, which the live app uses today.
// Ported from the `unpricedRowFlags` cases of tests/catalogue-no-money.test.mjs (28 Oct 2026, ff1a2d38). The module is a FULL port,
// so parity.spec.ts also compares its exports name by name. Fake data only.

import { describe, expect, test } from 'vitest';
import * as ported from './unpriced-rows';
import * as legacyJs from '../../js/catalogue/unpriced-rows.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const ingredients = {
    FLOUR: { name: 'Flour' },
    SALT: { name: 'Salt' },
  };
  const prices = { FLOUR: { priceUnit: 'kg', pricePerUnit: 2 } };
  const unpricedSub = { id: 'EMPTY', name: 'Empty', ingredients: [{ label: 'Mystery', grams: 100, unit: 'g' }] };
  const pricedSub = { id: 'DOUGH', name: 'Dough', ingredients: [
    { label: 'Flour', grams: 500, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Mystery', grams: 500, unit: 'g' },
  ] };
  const rows = [
    { label: 'Flour', grams: 100, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },        // 0 priced
    { label: 'Salt', grams: 10, unit: 'g', kind: 'ingredient', refId: 'SALT' },           // 1 no price
    { label: 'Gone', grams: 10, unit: 'g', kind: 'ingredient', refId: 'NOPE' },           // 2 missing
    { label: 'Loose', grams: 10, unit: 'g' },                                             // 3 not linked
    { label: 'Ghost', grams: 10, unit: 'g', kind: 'recipe', refId: 'GHOST' },             // 4 missing recipe
    { label: 'Empty', grams: 10, unit: 'g', kind: 'recipe', refId: 'EMPTY' },             // 5 sub not costable
    { label: 'Dough', grams: 10, unit: 'g', kind: 'recipe', refId: 'DOUGH' },             // 6 partly priced sub
    { label: 'Later', grams: '', unit: 'g' },                                             // 7 no amount
    { label: 'Pinch', grams: '', unit: 'to taste' },                                      // 8 to taste
  ];

  test('answers with booleans only, one per row, marking exactly the rows Food cost cannot price', () => {
    const flags = m.unpricedRowFlags({ id: 'TOP', name: 'Top', ingredients: rows }, {
      ingredients, recipes: [unpricedSub, pricedSub], prices,
    });
    expect(flags).toHaveLength(rows.length);
    for (const flag of flags) expect(typeof flag).toBe('boolean');
    expect(flags).toStrictEqual([false, true, true, true, true, true, false, false, false]);
  });

  test('a price document on the ingredient is the only price: one written on the ingredient itself is ignored', () => {
    const sneaky = { FLOUR: { name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 } };
    const flags = m.unpricedRowFlags(
      { id: 'T', ingredients: [{ label: 'Flour', grams: 100, unit: 'g', kind: 'ingredient', refId: 'FLOUR' }] },
      { ingredients: sneaky, recipes: [], prices: {} });
    expect(flags).toStrictEqual([true]);
  });

  test('no prices read means every linked ingredient row is unpriced, never a throw', () => {
    const flags = m.unpricedRowFlags(
      { id: 'T', ingredients: [{ label: 'Flour', grams: 100, unit: 'g', kind: 'ingredient', refId: 'FLOUR' }] },
      { ingredients: { FLOUR: { name: 'Flour' } }, recipes: [], prices: null });
    expect(flags).toStrictEqual([true]);
    expect(m.unpricedRowFlags(null, {})).toStrictEqual([]);
    expect(m.unpricedRowFlags(undefined)).toStrictEqual([]);
  });

  test('the ingredients may be a list that carries its ids, and the recipes a map by id', () => {
    const flags = m.unpricedRowFlags({ id: 'T', ingredients: rows.slice(0, 2) }, {
      ingredients: [{ id: 'FLOUR', name: 'Flour' }, { id: 'SALT', name: 'Salt' }], recipes: { EMPTY: unpricedSub }, prices,
    });
    expect(flags).toStrictEqual([false, true]);
  });

  test('a sub-recipe that reaches itself is a cycle, so its row is marked', () => {
    const loop = { id: 'LOOP', name: 'Loop', ingredients: [{ label: 'Me', grams: 10, unit: 'g', kind: 'recipe', refId: 'LOOP' }] };
    expect(m.unpricedRowFlags(loop, { recipes: [loop], prices })).toStrictEqual([true]);
  });
});
