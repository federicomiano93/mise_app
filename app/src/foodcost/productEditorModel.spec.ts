import { describe, expect, it } from 'vitest';
import { normalizeProduct } from '@mise/shared/foodcost-model';
import type { Product } from '@mise/shared/foodcost-model';
import {
  clearNumber, emptyWorking, isShown, readNumber, readQty, recipeIdsOn, toProduct, vatRateOf, workingFrom,
} from './productEditorModel';

describe('reading a box', () => {
  it.each([
    ['', null], ['  ', null], ['12', 12], ['12.5', 12.5], ['12,5', 12.5], ['12.', 12], ['.5', 0.5], [' 3 ', 3],
  ])('reads «%s» as %s', (text, expected) => {
    expect(readNumber(text)).toBe(expected);
  });

  it.each(['abc', '-1', '1e3', '1.2.3', '12,5,5'])('reads «%s» as not a number', text => {
    expect(readNumber(text)).toBeNaN();
  });

  it('counts anything that is not a plain number as no quantity', () => {
    expect(readQty('')).toBe(0);
    expect(readQty('abc')).toBe(0);
    expect(readQty('-5')).toBe(0);
    expect(readQty('2,5')).toBe(2.5);
  });
});

describe('the working copy', () => {
  const stored = normalizeProduct({
    id: 'p1', name: 'Cornetto', sellingMode: 'pack', packSize: 6, packUnit: 'pcs', sellingPrice: 3.5, vatRate: 20,
    foodCostTarget: 30, labourMinutes: 45, labourPeople: 2, piecesPerBatch: 12,
    components: [{ recipeId: 'r1', qtyKg: 1.5 }, { kind: 'ingredient', ingredientId: 'i1', qty: 200, unit: 'g' }],
    packaging: [{ ingredientId: 'b1', qtyPcs: 2 }],
  }) as Product;

  it('round-trips a product, line for line, without leaving an id on a line', () => {
    const back = toProduct(workingFrom(stored, 'GB'), 'p1');
    expect(back).toEqual({ ...stored, model: 2 });
    expect(JSON.stringify(back)).not.toContain('line-');
  });

  it('gives every line an id of its own', () => {
    const keys = [...workingFrom(stored, 'GB').components, ...workingFrom(stored, 'GB').packaging].map(line => line.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('opens an empty one with nothing said', () => {
    const product = toProduct(emptyWorking(), '');
    expect(product).toMatchObject({
      name: '', components: [], packaging: [], sellingMode: null, sellingPrice: null, vatRate: null, packUnit: null,
    });
  });

  it('keeps a stored rate the country lacks in «another rate», unchanged', () => {
    const working = workingFrom(stored, 'IT');
    expect(working.vatSelect).toBe('other');
    expect(working.vatOther).toBe('20');
    expect(vatRateOf(working)).toBe(20);
    expect(vatRateOf(workingFrom(stored, 'GB'))).toBe(20);
    expect(workingFrom(stored, 'GB').vatSelect).toBe('20');
  });

  it('tells a rate of zero from none', () => {
    expect(vatRateOf({ ...emptyWorking(), vatSelect: '0' })).toBe(0);
    expect(vatRateOf(emptyWorking())).toBeNull();
  });

  it('says which boxes are shown for each way of selling', () => {
    const mode = (sellingMode: 'piece' | 'weight' | 'pack' | '', packUnit: 'g' | 'pcs' | '' = '') => ({ ...emptyWorking(), sellingMode, packUnit });
    expect(isShown(mode(''), 'piecesPerBatch')).toBe(false);
    expect(isShown(mode('piece'), 'piecesPerBatch')).toBe(true);
    expect(isShown(mode('weight'), 'piecesPerBatch')).toBe(false);
    expect(isShown(mode('pack', 'g'), 'piecesPerBatch')).toBe(false);
    expect(isShown(mode('pack', 'pcs'), 'piecesPerBatch')).toBe(true);
    expect(isShown(mode('pack'), 'packSize')).toBe(true);
    expect(isShown(mode('piece'), 'packSize')).toBe(false);
    expect(isShown(mode(''), 'sellingPrice')).toBe(true);
  });

  it('empties a number\'s own box', () => {
    const working = { ...emptyWorking(), piecesPerBatch: '0', vatSelect: 'other', vatOther: '999' };
    expect(clearNumber(working, 'piecesPerBatch').piecesPerBatch).toBe('');
    expect(clearNumber(working, 'vatRate').vatOther).toBe('');
  });

  it('lists each recipe once, in the order it first appears', () => {
    const working = workingFrom(normalizeProduct({
      id: 'p', name: 'x', components: [{ recipeId: 'a', qtyKg: 1 }, { kind: 'ingredient', ingredientId: 'i', qty: 1, unit: 'g' }, { recipeId: 'b', qtyKg: 1 }, { recipeId: 'a', qtyKg: 2 }],
    }) as Product, 'GB');
    expect(recipeIdsOn(working)).toEqual(['a', 'b']);
  });
});
