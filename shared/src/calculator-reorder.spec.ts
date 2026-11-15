// Putting a Calculator recipe's ingredients in a different order (item 36 of docs/mise2-port-owed.md; current app
// 71627519 and 262efcfe; tests/calculator-reorder.test.mjs, the pure half), run against BOTH files: the TypeScript port
// in shared/ and js/calculator-config.js.

import { describe, expect, test } from 'vitest';
import * as ported from './calculator-config';
import * as legacyJs from '../../js/calculator-config.js';
import * as portedMath from './calculator-dough-math';
import * as legacyMathJs from '../../js/calculator-dough-math.js';

const legacy = legacyJs as unknown as typeof ported;
const legacyMath = legacyMathJs as unknown as typeof portedMath;

type Loose = any;

describe.each([
  ['shared/ (TypeScript)', ported, portedMath],
  ['js/ (current app)', legacy, legacyMath],
] as const)('%s — reordering the ingredients', (_name, m, math) => {
  const moveIngredient = m.moveIngredient as (list: unknown, from: unknown, to: unknown) => Loose[];
  const { recipeSpec, DEFAULT_CONFIG } = m;
  const { recipeTotal, scaleRecipe } = math as unknown as Record<string, Loose>;
  const normalizeConfig = (raw: unknown): Loose => m.normalizeConfig(raw);

  test('an ingredient moves to its new place, and the others close up around it', () => {
    const [a, b, c, d] = ['flour', 'water', 'salt', 'yeast'].map(label => ({ label }));
    expect(moveIngredient([a, b, c, d], 0, 2).map(r => r.label)).toEqual(['water', 'salt', 'flour', 'yeast']);
    expect(moveIngredient([a, b, c, d], 3, 0).map(r => r.label)).toEqual(['yeast', 'flour', 'water', 'salt']);
  });

  test('⚠️⚠️ the SAME row objects move, so an ingredient keeps its key', () => {
    const flour = { key: 'flour', label: 'flour', grams: 1000 };
    const yeast = { key: 'yeast', label: 'yeast', grams: 20 };
    const out = moveIngredient([flour, yeast], 1, 0);
    expect(out[0]).toBe(yeast);
    expect(out[0].key).toBe('yeast');
  });

  test('a move that goes nowhere, or off the end, changes nothing and never throws', () => {
    const rows = [{ label: 'a' }, { label: 'b' }];
    for (const [from, to] of [[0, 0], [-1, 0], [0, 2], [5, 1], ['x', 1], [null, undefined]]) {
      expect(moveIngredient(rows, from, to), `${from} → ${to}`).toEqual(rows);
    }
    expect(moveIngredient(rows, 0, 1)).not.toBe(rows);
    expect(moveIngredient(rows, 0, 0)).not.toBe(rows);
    expect(moveIngredient(null, 0, 1)).toEqual([]);
  });

  const RECIPE = {
    id: 'r1', name: 'Test', logic: 'orders', visible: true, order: 0,
    ingredients: [
      { key: 'flour', label: 'Flour', grams: 1000 },
      { key: 'water', label: 'Water', grams: 700 },
      { key: 'yeast', label: 'Yeast', grams: 20 },
      { key: 'salt', label: 'Salt', grams: 25 },
    ],
    leaveningKey: 'yeast', leaveningDefaultPct: 2, showLeavening: true, baselinePct: 2,
  };
  const build = (r: Loose): Loose => normalizeConfig({ ...DEFAULT_CONFIG, clients: [], recipes: [r] }).recipes.find((x: Loose) => x.id === 'r1');

  test('⚠️ reordering changes only the ORDER: the leavening and the dough stay the same', () => {
    const moved = { ...RECIPE, ingredients: moveIngredient(RECIPE.ingredients, 2, 0) };
    expect(moved.ingredients[0]!.key).toBe('yeast');
    const before = build(RECIPE);
    const after = build(moved);
    expect(after.leaveningKey).toBe(before.leaveningKey);
    expect(after.leaveningDefaultPct).toBe(before.leaveningDefaultPct);
    expect(after.baselinePct).toBe(before.baselinePct);
    const set = (r: Loose): string[] => r.ingredients.map((i: Loose) => `${i.key}|${i.label}|${i.grams}`).sort();
    expect(set(after)).toEqual(set(before));
    expect(after.ingredients.map((i: Loose) => i.key)).not.toEqual(before.ingredients.map((i: Loose) => i.key));
    const specBefore = recipeSpec(before);
    const specAfter = recipeSpec(after);
    expect(recipeTotal(specAfter.amounts)).toBe(recipeTotal(specBefore.amounts));
    const gramsFor = (spec: Loose, pct: number): Loose => {
      const out = scaleRecipe(spec, 5000, pct);
      return Object.fromEntries(Object.keys(spec.amounts).map((k, i) => [k, out[i]]));
    };
    for (const pct of [1, 2, 3.5]) expect(gramsFor(specAfter, pct), `per-key grams at ${pct}%`).toEqual(gramsFor(specBefore, pct));
  });

  test('⚠️⚠️ a NEW row with the leavening\'s name, dragged above it, never takes the leavening', () => {
    // The new «Yeast» has no key yet: on save its key is made from its name. It used to be the FIRST row asking for
    // `yeast` that got it, so dragged above the saved Yeast the new 5 g row became the leavening and every dough changed.
    const recipe = {
      ...RECIPE,
      ingredients: [
        { key: 'flour', label: 'Flour', grams: 1000 },
        { key: 'yeast', label: 'Yeast', grams: 20 },
        { key: '', label: 'Yeast', grams: 5 },
      ],
    };
    for (const ingredients of [recipe.ingredients, moveIngredient(recipe.ingredients, 2, 1), moveIngredient(recipe.ingredients, 2, 0)]) {
      const out = build({ ...recipe, ingredients: ingredients.map(i => ({ ...i })) });
      const leaven = out.ingredients.find((i: Loose) => i.key === out.leaveningKey);
      expect(leaven.grams, `order ${ingredients.map(i => i.grams)}`).toBe(20);
      expect(new Set(out.ingredients.map((i: Loose) => i.key)).size).toBe(3);
    }
  });

  test('rows that all have a key, or none, keep the keys they always had', () => {
    const none = build({ ...RECIPE, leaveningKey: null, ingredients: [{ label: 'Yeast', grams: 1 }, { label: 'Yeast', grams: 2 }] });
    expect(none.ingredients.map((i: Loose) => i.key)).toEqual(['yeast', 'yeast-1']);
    const all = build({ ...RECIPE, ingredients: [{ key: 'a', label: 'A', grams: 1 }, { key: 'a', label: 'B', grams: 2 }] });
    expect(all.ingredients.map((i: Loose) => i.key)).toEqual(['a', 'a-1']);
  });
});
