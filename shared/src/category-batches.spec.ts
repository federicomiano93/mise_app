// Unit tests for how «delete a category» is split into batches (P15), run against BOTH
// implementations: the TypeScript port in shared/ and js/orders/category-batches.js, which the live
// app uses today. Ported from tests/category-batches.test.mjs; the two must stay equal until the
// switch to Mise 2. The module is a FULL port, so parity.spec.ts also compares its exports.
//
// PORTED: the 5 pure tests (of 6).
//
// NOT PORTED: 'the data layer uses update() … through the planner' — it reads
// js/orders/firebase-orders.js as text.

import { describe, expect, test } from 'vitest';
import * as ported from './category-batches';
import * as legacyJs from '../../js/orders/category-batches.js';
import { INGREDIENT_DRAINED_FIELDS } from './price-model';

const legacy = legacyJs as unknown as typeof ported;

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `i${i}`);

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const slots = (plan: ReturnType<typeof m.planBatches>): number[] => plan.map(step => step.ids.length + (step.config ? 1 : 0));

  test('no more than six writes in a batch, the config write counting as one', () => {
    expect(m.INGREDIENT_WRITES_PER_BATCH).toBe(6);
    const plan = m.planBatches(ids(20), 6, true);
    expect(slots(plan).every(n => n <= 6)).toBe(true);
    expect(plan[0]!.config).toBe(true);
    expect(plan.slice(1).map(s => s.config)).toStrictEqual(plan.slice(1).map(() => false));
    expect(plan.flatMap(s => s.ids)).toStrictEqual(ids(20));
  });

  test('the list goes alone when nobody used the category; nothing at all without either', () => {
    expect(m.planBatches([], 6, true)).toStrictEqual([{ config: true, ids: [] }]);
    expect(m.planBatches([], 6, false)).toStrictEqual([]);
    expect(m.planBatches(null, 6, false)).toStrictEqual([]);
  });

  test('without the config write the batches are full', () => {
    expect(m.planBatches(ids(13), 6, false).map(s => s.ids.length)).toStrictEqual([6, 6, 1]);
    expect(slots(m.planBatches(ids(6), 6, true))).toStrictEqual([6, 1]);
  });

  test('empty ids are dropped and a bad batch size falls back to the default', () => {
    expect(m.planBatches(['a', '', null, 'b'], 6, false)).toStrictEqual([{ config: false, ids: ['a', 'b'] }]);
    expect(m.planBatches(ids(7), 0, false).map(s => s.ids.length)).toStrictEqual([6, 1]);
  });

  test('an ingredient write carries the category and every legacy price key as null', () => {
    const patch = m.categoryPatch('Other');
    expect(patch.category).toBe('Other');
    expect(INGREDIENT_DRAINED_FIELDS.length).toBeGreaterThan(0);
    for (const key of INGREDIENT_DRAINED_FIELDS) expect(patch[key], key).toBeNull();
    expect(patch.vatRate).toBeUndefined();
    expect(Object.keys(patch).length).toBe(INGREDIENT_DRAINED_FIELDS.length + 1);
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('the defaults: a missing size is six, a missing withConfig is «no config write»', () => {
    expect(m.planBatches(ids(7)).map(s => s.ids.length)).toStrictEqual([6, 1]);
    expect(m.planBatches(ids(7), undefined, undefined).every(s => !s.config)).toBe(true);
  });

  test('a batch of one with the config write carries the list alone, then one ingredient per batch', () => {
    expect(m.planBatches(ids(2), 1, true)).toStrictEqual([
      { config: true, ids: [] },
      { config: false, ids: ['i0'] },
      { config: false, ids: ['i1'] },
    ]);
  });
});
