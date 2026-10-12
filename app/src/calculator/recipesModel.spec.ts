import { describe, expect, it } from 'vitest';
import { normalizeConfig } from '@mise/shared/calculator-config';
import {
  addIngredient, chooseLeavening, firstBadTray, firstInvalid, isEmptyRecipe, isFull, keyForRow, leaveningRows,
  leaveningValue, linkTo, logicOf, newId, newRecipe, patchIngredient, patchRecipe, removeIngredient, sameRecipes,
  settleRecipes, unlink, visibleCount,
} from './recipesModel';
import type { EditableRecipe } from './recipesModel';

// What the Recipes editor does with the working copy, as plain functions.

const FOCACCIA: EditableRecipe = {
  id: 'focaccia', name: 'Focaccia', logic: 'orders', order: 1, visible: true, trayWeight: 1000,
  ingredients: [
    { key: 'flour', label: 'Flour', grams: 1000 },
    { key: 'yeast', label: 'Yeast', grams: 5 },
  ],
  leaveningKey: 'yeast', leaveningDefaultPct: 0.5, baselinePct: 0.5, showLeavening: true,
};

describe('a new recipe', () => {
  it('has the current app\'s id and defaults', () => {
    expect(newId(() => 0.5)).toMatch(/^r-[0-9a-z]+$/);
    expect(newRecipe(3, true, () => 0.123456789)).toEqual({
      id: expect.stringMatching(/^r-[0-9a-z]{1,6}$/), name: '', logic: 'orders', trayWeight: 1000, ingredients: [],
      leaveningKey: null, leaveningDefaultPct: 0, showLeavening: true, baselinePct: null, order: 3, visible: true,
    });
  });

  it('is hidden when asked to be', () => {
    expect(newRecipe(0, false).visible).toBe(false);
  });

  it('is empty until it has a name, an ingredient or a link', () => {
    const fresh = newRecipe(0, true);
    expect(isEmptyRecipe(fresh)).toBe(true);
    expect(isEmptyRecipe(undefined)).toBe(true);
    expect(isEmptyRecipe({ ...fresh, name: '  ' })).toBe(true);
    expect(isEmptyRecipe({ ...fresh, name: 'Pizza' })).toBe(false);
    expect(isEmptyRecipe(addIngredient(fresh))).toBe(false);
    expect(isEmptyRecipe({ ...fresh, catalogueId: 'cat-1' })).toBe(false);
  });
});

describe('the four shown', () => {
  it('counts a missing visible as shown', () => {
    const shown = [FOCACCIA, { ...FOCACCIA, id: 'b', visible: undefined as unknown as boolean }, { ...FOCACCIA, id: 'c', visible: false }];
    expect(visibleCount(shown)).toBe(2);
    expect(isFull(shown)).toBe(false);
    expect(isFull([...shown, { ...FOCACCIA, id: 'd' }, { ...FOCACCIA, id: 'e' }])).toBe(true);
  });
});

describe('what Save refuses', () => {
  it('finds the first recipe with no name', () => {
    expect(firstInvalid([FOCACCIA, { ...FOCACCIA, id: 'x', name: ' ' }])).toBe('x');
  });

  it('finds a recipe with no ingredient, or one with an unnamed ingredient', () => {
    expect(firstInvalid([{ ...FOCACCIA, ingredients: [] }])).toBe('focaccia');
    expect(firstInvalid([addIngredient(FOCACCIA)])).toBe('focaccia');
    expect(firstInvalid([FOCACCIA])).toBeNull();
  });

  it('asks nothing of the ingredients of a linked recipe: they live in the Catalogue', () => {
    expect(firstInvalid([{ ...FOCACCIA, ingredients: [], catalogueId: 'cat-1' }])).toBeNull();
    // ...but it still needs a name.
    expect(firstInvalid([{ ...FOCACCIA, name: '', catalogueId: 'cat-1' }])).toBe('focaccia');
  });

  it('finds a trays recipe without a usable tray weight, whatever else it has', () => {
    const trays = { ...FOCACCIA, id: 't', logic: 'trays' as const };
    expect(firstBadTray([trays])).toBeNull();
    expect(firstBadTray([{ ...trays, trayWeight: '' }])).toBe('t');
    expect(firstBadTray([{ ...trays, trayWeight: 20 }])).toBe('t');
    expect(firstBadTray([{ ...trays, logic: 'traysTotal', trayWeight: '' }])).toBe('t');
    // Not a trays recipe: the weight is kept but not demanded.
    expect(firstBadTray([{ ...trays, logic: 'total', trayWeight: '' }])).toBeNull();
  });
});

describe('what is written', () => {
  it('turns an emptied tray weight into the default, and rounds the rest', () => {
    const [empty, typed] = settleRecipes([{ ...FOCACCIA, trayWeight: '' }, { ...FOCACCIA, id: 'b', trayWeight: 1200.4 }]);
    expect(empty?.trayWeight).toBe(1000);
    expect(typed?.trayWeight).toBe(1200);
  });

  it('keeps the link and the tray weight of a recipe that does not use trays', () => {
    const [kept] = settleRecipes([{ ...FOCACCIA, trayWeight: 1500, catalogueId: 'cat-1', leaveningRid: 'r1' }]);
    expect(kept).toMatchObject({ trayWeight: 1500, catalogueId: 'cat-1', leaveningRid: 'r1' });
  });

  it('reads two copies as the same only when nothing differs', () => {
    expect(sameRecipes([FOCACCIA], [{ ...FOCACCIA }])).toBe(true);
    expect(sameRecipes([FOCACCIA], [{ ...FOCACCIA, name: 'x' }])).toBe(false);
  });

  it('keeps the logic of a recipe whose stored logic is unknown as «orders»', () => {
    expect(logicOf({ logic: 'nonsense' })).toBe('orders');
    expect(logicOf({ logic: 'traysTotal' })).toBe('traysTotal');
  });
});

describe('editing a recipe', () => {
  it('patches one recipe and one ingredient without touching the others', () => {
    const other = { ...FOCACCIA, id: 'other' };
    const next = patchRecipe([FOCACCIA, other], 'focaccia', { name: 'Pizza' });
    expect(next.map(recipe => recipe.name)).toEqual(['Pizza', 'Focaccia']);
    expect(patchIngredient(FOCACCIA, 0, { grams: 900 }).ingredients.map(row => row.grams)).toEqual([900, 5]);
  });

  it('removing the ingredient that is the leavening leaves the recipe with none', () => {
    expect(removeIngredient(FOCACCIA, 1)).toMatchObject({ leaveningKey: null });
    expect(removeIngredient(FOCACCIA, 1).ingredients).toHaveLength(1);
    expect(removeIngredient(FOCACCIA, 0)).toMatchObject({ leaveningKey: 'yeast' });
  });

  it('a new ingredient starts empty', () => {
    expect(addIngredient(FOCACCIA).ingredients[2]).toEqual({ key: '', label: '', grams: 0 });
  });
});

describe('the leavening', () => {
  it('lists the rows of the recipe, with a position for a row that has no key yet', () => {
    expect(leaveningRows({ ...FOCACCIA, ingredients: [{ key: 'flour', label: 'Flour', grams: 1 }, { key: '', label: '', grams: 0 }] }, null))
      .toEqual([{ value: 'flour', label: 'Flour' }, { value: '#1', label: '' }]);
  });

  it('lists the Catalogue\'s rows instead when the recipe is linked', () => {
    expect(leaveningRows(FOCACCIA, [{ key: 'rabc', label: 'Starter', grams: 100 }])).toEqual([{ value: 'rabc', label: 'Starter' }]);
  });

  it('«nothing rises» is an answer: it clears the key', () => {
    expect(chooseLeavening(FOCACCIA, '', null)).toMatchObject({ leaveningKey: null });
    expect(chooseLeavening({ ...FOCACCIA, catalogueId: 'c', leaveningRid: 'rabc' }, '', [])).toMatchObject({ leaveningRid: null });
  });

  it('choosing a row sets its key and gives a recipe with no percentage a starting one', () => {
    const none = { ...FOCACCIA, leaveningKey: null, leaveningDefaultPct: 0, baselinePct: null };
    expect(chooseLeavening(none, 'flour', null)).toMatchObject({ leaveningKey: 'flour', leaveningDefaultPct: 1, baselinePct: 1 });
    // A percentage already there is kept.
    expect(chooseLeavening({ ...FOCACCIA, leaveningKey: null }, 'flour', null)).toMatchObject({ leaveningDefaultPct: 0.5, baselinePct: 0.5 });
  });

  it('a row with no key gets one made of its name and position when it is chosen', () => {
    const typed = { ...FOCACCIA, leaveningKey: null, ingredients: [...FOCACCIA.ingredients, { key: '', label: 'Sourdough starter!', grams: 50 }] };
    const next = chooseLeavening(typed, '#2', null);
    expect(keyForRow('Sourdough starter!', 2)).toBe('sourdough-starter--2');
    expect(next.leaveningKey).toBe('sourdough-starter--2');
    expect(next.ingredients[2]?.key).toBe('sourdough-starter--2');
  });

  it('a linked recipe stores the Catalogue row\'s id, and refuses a row the Catalogue does not have', () => {
    const rows = [{ key: 'rabc', label: 'Starter', grams: 100 }];
    const linked = { ...FOCACCIA, catalogueId: 'cat-1' };
    expect(chooseLeavening(linked, 'rabc', rows)).toMatchObject({ leaveningRid: 'rabc', leaveningKey: 'yeast' });
    expect(chooseLeavening(linked, 'nope', rows)).toBe(linked);
    expect(leaveningValue({ ...linked, leaveningRid: 'rabc' }, true)).toBe('rabc');
    expect(leaveningValue(linked, false)).toBe('yeast');
    expect(leaveningValue({ ...FOCACCIA, leaveningKey: null }, false)).toBe('');
  });
});

describe('the link to the Catalogue', () => {
  it('linking sets catalogueId and clears the leavening row, which must be chosen again', () => {
    const was = { ...FOCACCIA, catalogueId: 'cat-0', leaveningRid: 'rold' };
    const next = linkTo(was, 'cat-1');
    expect(next.catalogueId).toBe('cat-1');
    expect('leaveningRid' in next).toBe(false);
  });

  it('unlinking deletes both keys, not sets them to null', () => {
    const next = unlink({ ...FOCACCIA, catalogueId: 'cat-1', leaveningRid: 'r1' });
    expect('catalogueId' in next).toBe(false);
    expect('leaveningRid' in next).toBe(false);
  });

  it('survives the store\'s normaliser (parity 17), and an unlinked recipe carries no link keys at all', () => {
    const linked = normalizeConfig({ clients: [], recipes: [{ ...FOCACCIA, catalogueId: 'cat-1', leaveningRid: 'r1' }] }).recipes[0];
    expect(linked).toMatchObject({ catalogueId: 'cat-1', leaveningRid: 'r1' });
    const plain = normalizeConfig({ clients: [], recipes: [unlink({ ...FOCACCIA, catalogueId: 'cat-1', leaveningRid: 'r1' })] }).recipes[0];
    expect(plain && 'catalogueId' in plain).toBe(false);
    expect(plain && 'leaveningRid' in plain).toBe(false);
  });
});
