import { describe, expect, it } from 'vitest';
import { normalizeConfig, DEFAULT_CONFIG } from '@mise/shared/calculator-config';
import { chooseLeavening, keyForRow, moveIngredientIn } from './recipesModel';
import type { EditableRecipe } from './recipesModel';

// Item 36 of docs/mise2-port-owed.md: the Recipes editor's side of reordering a recipe's ingredients. The pure move is
// shared/src/calculator-reorder.spec.ts (against the current app's own function); this file pins how the editor's working
// copy uses it.

const recipe = (over: Partial<EditableRecipe> = {}): EditableRecipe => ({
  id: 'r1', name: 'Test', logic: 'orders', trayWeight: 1000, visible: true, order: 0,
  ingredients: [
    { key: 'flour', label: 'Flour', grams: 1000 },
    { key: 'water', label: 'Water', grams: 700 },
    { key: 'yeast', label: 'Yeast', grams: 20 },
    { key: 'salt', label: 'Salt', grams: 25 },
  ],
  leaveningKey: 'yeast', leaveningDefaultPct: 2, showLeavening: true, baselinePct: 2,
  ...over,
});

describe('moving an ingredient in the working copy', () => {
  it('moves the very same row objects, so every row keeps its key and the leavening still points at the yeast', () => {
    const before = recipe();
    const after = moveIngredientIn(before, 2, 0);
    expect(after.ingredients.map(row => row.key)).toEqual(['yeast', 'flour', 'water', 'salt']);
    expect(after.ingredients[0]).toBe(before.ingredients[2]);
    expect(after.leaveningKey).toBe('yeast');
    expect(after.leaveningDefaultPct).toBe(2);
    expect(after.baselinePct).toBe(2);
    // The recipe it was handed is not touched.
    expect(before.ingredients.map(row => row.key)).toEqual(['flour', 'water', 'yeast', 'salt']);
  });

  it('a move that goes nowhere hands back the very recipe (nothing is marked as edited)', () => {
    const before = recipe();
    expect(moveIngredientIn(before, 1, 1)).toBe(before);
    expect(moveIngredientIn(before, -1, 2)).toBe(before);
    expect(moveIngredientIn(before, 0, 4)).toBe(before);
    expect(moveIngredientIn(before, Number.NaN, 1)).toBe(before);
  });

  it('⚠️ the dough does not change: the saved recipe holds the same amounts and the same leavening', () => {
    const saved = (r: EditableRecipe) => normalizeConfig({ ...DEFAULT_CONFIG, clients: [], recipes: [r] }).recipes[0]!;
    const before = saved(recipe());
    const after = saved(moveIngredientIn(recipe(), 3, 0));
    const amounts = (r: ReturnType<typeof saved>) => Object.fromEntries(r.ingredients.map(row => [row.key, row.grams]));
    expect(amounts(after)).toEqual(amounts(before));
    expect(after.leaveningKey).toBe(before.leaveningKey);
  });

  it('⚠️ a NEW row named like the leavening, dragged above it, never takes the leavening\'s key', () => {
    const withNew = recipe({
      ingredients: [
        { key: 'flour', label: 'Flour', grams: 1000 },
        { key: 'yeast', label: 'Yeast', grams: 20 },
        { key: '', label: 'Yeast', grams: 5 },
      ],
    });
    const moved = moveIngredientIn(withNew, 2, 0);
    const out = normalizeConfig({ ...DEFAULT_CONFIG, clients: [], recipes: [moved] }).recipes[0]!;
    const leavening = out.ingredients.find(row => row.key === out.leaveningKey);
    expect(leavening?.grams).toBe(20);
    expect(new Set(out.ingredients.map(row => row.key)).size).toBe(3);
  });
});

describe('the key a leavening picked on a keyless row gets', () => {
  it('is the name and the position, unless an older row already has it', () => {
    expect(keyForRow('Dry Yeast', 1)).toBe('dry-yeast-1');
    expect(keyForRow('Yeast', 2, ['flour', 'yeast-2'])).toBe('yeast-2-x');
    expect(keyForRow('Yeast', 2, ['flour', 'yeast-2', 'yeast-2-x'])).toBe('yeast-2-x-x');
  });

  it('⚠️ choosing a keyless row as the leavening never shares a key with another row', () => {
    const before = recipe({
      leaveningKey: null,
      ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }, { key: 'yeast-2', label: 'Old', grams: 9 }, { key: '', label: 'Yeast', grams: 20 }],
    });
    const after = chooseLeavening(before, '#2', null);
    expect(after.leaveningKey).not.toBe('yeast-2');
    expect(after.ingredients[2]!.key).toBe(after.leaveningKey);
    expect(after.ingredients.filter(row => row.key === after.leaveningKey)).toHaveLength(1);
  });
});
