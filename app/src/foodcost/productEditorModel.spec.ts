import { describe, expect, it } from 'vitest';
import { PRODUCT_MODEL, normalizeProduct } from '@mise/shared/foodcost-model';
import type { Product } from '@mise/shared/foodcost-model';
import { draftFromRecipe } from '@mise/shared/foodcost-model';
import {
  clearNumber, emptyWorking, firstBadWeight, followsTotal, isShown, rawBoxText, readNumber, readQty, recipeLineKg, recipeLossHint,
  recipeWeighing, settleRaw, toProduct, vatRateOf, waitsForTables, weightText, workingFrom, workingFromDraft,
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
    // The model it is saved as is always the current one (workingFrom is handed the converted product).
    expect(back).toEqual({ ...stored, model: PRODUCT_MODEL });
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

});

describe('a product’s own weighing in the working copy (model 3)', () => {
  const stored = (extra: object) => normalizeProduct({ id: 'p', name: 'Loaf', components: [{ recipeId: 'r', qtyKg: 1 }], model: 3, ...extra }) as Product;

  it('travels from the product and back into what is saved, with no noWeightLoss and the current model', () => {
    const working = workingFrom(stored({ rawGrams: 1000, cookedGrams: 880, noWeightLoss: true }), 'GB');
    expect(working.rawText).toBe('1000');
    expect(working.cookedText).toBe('880');
    const saved = toProduct(working, 'p');
    expect(saved).toMatchObject({ rawGrams: 1000, cookedGrams: 880, noWeightLoss: false, model: PRODUCT_MODEL });
  });

  it('a new product and a draft start with no weighing', () => {
    expect(emptyWorking()).toMatchObject({ rawText: null, cookedText: '', cookingTyped: false });
    const draft = draftFromRecipe({ id: 'r', name: 'Loaf' });
    if (!draft) throw new Error('no draft');
    expect(workingFromDraft(draft)).toMatchObject({ rawText: null, cookedText: '', cookingTyped: false });
    expect(toProduct(emptyWorking(), 'p')).toMatchObject({ rawGrams: null, cookedGrams: null });
  });

  it('a weight opens with at most one decimal and is handed back EXACTLY while its box is untouched', () => {
    const working = workingFrom(stored({ cookedGrams: 416.6667 }), 'GB');
    expect(working.cookedText).toBe('416.7');
    expect(weightText(1030.449734)).toBe('1030.4');
    expect(toProduct(working, 'p').cookedGrams).toBe(416.6667);
    // Typed in, it is what the box says: a comma is a decimal point; empty is no loss; text that is not a number stays NaN.
    expect(toProduct({ ...working, cookedText: '416,7' }, 'p').cookedGrams).toBe(416.7);
    expect(toProduct({ ...working, cookedText: '' }, 'p').cookedGrams).toBeNull();
    expect(toProduct({ ...working, cookedText: 'abc' }, 'p').cookedGrams).toBeNaN();
  });

  it('a raw box that follows the total saves no raw weight, even when the product opened with one apart', () => {
    const working = workingFrom(stored({ rawGrams: 1234.56, cookedGrams: 880 }), 'GB');
    expect(toProduct(working, 'p').rawGrams).toBe(1234.56);
    expect(toProduct({ ...working, rawText: null }, 'p').rawGrams).toBeNull();
  });
});

describe('the raw box following the total', () => {
  const stored = (extra: object) => normalizeProduct({ id: 'p', name: 'Loaf', components: [{ recipeId: 'r', qtyKg: 1 }], model: 3, ...extra }) as Product;

  it.each([
    ['', true], ['  ', true], ['1000', true], ['1000.04', true], ['999.96', true], ['1000.06', false], ['999.9', false], ['abc', false],
  ])('«%s» against a total of 1000 g follows it: %s', (text, follows) => {
    expect(followsTotal(text, 1000)).toBe(follows);
  });

  it('is compared with the EXACT total, not the one-decimal figure the box shows', () => {
    // 1000.04 g: the box shows 1000, but 1000.1 is 0.06 g away.
    expect(followsTotal('1000.1', 1000.04)).toBe(false);
    expect(followsTotal('1000.08', 1000.04)).toBe(true);
  });

  it('settleRaw hands a near-total weight back to the total, and returns the same object when nothing changes', () => {
    const typed = { ...emptyWorking(), rawText: '1000.02' };
    expect(settleRaw(typed, 1000).rawText).toBeNull();
    expect(settleRaw({ ...emptyWorking(), rawText: '' }, 1000).rawText).toBeNull();
    const apart = { ...emptyWorking(), rawText: '1200' };
    expect(settleRaw(apart, 1000)).toBe(apart);
    const following = emptyWorking();
    expect(settleRaw(following, 1000)).toBe(following);
  });

  it('⚠️ settleRaw leaves a box as it opened: a stored raw weight 0.03 g off the total stays what it was', () => {
    const working = workingFrom(stored({ rawGrams: 1000.03, cookedGrams: 900 }), 'GB');
    expect(settleRaw(working, 1000)).toBe(working);
    expect(toProduct(settleRaw(working, 1000), 'p').rawGrams).toBe(1000.03);
  });

  it('shows the total, to one decimal, until a weight is typed apart', () => {
    expect(rawBoxText(emptyWorking(), 1030.449734)).toBe('1030.4');
    expect(rawBoxText(emptyWorking(), 0)).toBe('');
    expect(rawBoxText({ ...emptyWorking(), rawText: '12.' }, 1000)).toBe('12.');
  });
});

describe('the weights Save refuses', () => {
  it.each([
    ['0', 'rawGrams'], ['abc', 'rawGrams'], ['20000000', 'rawGrams'], ['-1', 'rawGrams'],
  ])('a raw weight of «%s» is refused', (text, field) => {
    expect(firstBadWeight(toProduct({ ...emptyWorking(), rawText: text }, 'p'))).toBe(field);
  });

  it('names the cooked box for a bad cooked weight, and lets a good pair and an empty one through', () => {
    expect(firstBadWeight(toProduct({ ...emptyWorking(), cookedText: '0' }, 'p'))).toBe('cookedGrams');
    expect(firstBadWeight(toProduct({ ...emptyWorking(), cookedText: '10000001' }, 'p'))).toBe('cookedGrams');
    expect(firstBadWeight(toProduct({ ...emptyWorking(), rawText: '1000', cookedText: '900' }, 'p'))).toBeNull();
    expect(firstBadWeight(toProduct(emptyWorking(), 'p'))).toBeNull();
  });
});

describe('the weighing a product of one recipe writes onto its recipe', () => {
  const recipes = { Dough: { id: 'Dough', name: 'Dough', lossPct: 0 }, Other: { id: 'Other', name: 'Other', lossPct: 5 } };
  const one = (extra: object) => ({
    ...emptyWorking(),
    components: [{ key: 'k', kind: 'recipe' as const, recipeId: 'Dough', qty: '1000', unit: 'g' as const }],
    ...extra,
  });

  it('is nothing until a person typed in «Cottura»', () => {
    expect(recipeWeighing(one({ cookedText: '900' }), 1000, recipes)).toBeNull();
  });

  it('is the product’s raw weight (typed apart, else the total) and its cooked one', () => {
    const own = recipeWeighing(one({ cookedText: '900', cookingTyped: true }), 1000, recipes);
    expect(own).toMatchObject({ recipeId: 'Dough', state: { raw: 1000, cooked: 900, touched: true } });
    const apart = recipeWeighing(one({ rawText: '1200', cookedText: '900', cookingTyped: true }), 1000, recipes);
    expect(apart?.state).toMatchObject({ raw: 1200, cooked: 900 });
  });

  it('is nothing for a mixed product, a missing recipe, or an ingredient alone', () => {
    const mixed = one({
      cookedText: '900',
      cookingTyped: true,
      components: [
        { key: 'a', kind: 'recipe', recipeId: 'Dough', qty: '1000', unit: 'g' },
        { key: 'b', kind: 'ingredient', ingredientId: 'flour', qty: '100', unit: 'g' },
      ],
    });
    expect(recipeWeighing(mixed, 1100, recipes)).toBeNull();
    expect(recipeWeighing(one({ cookedText: '900', cookingTyped: true }), 1000, {})).toBeNull();
    const ingredientAlone = one({
      cookedText: '900',
      cookingTyped: true,
      components: [{ key: 'a', kind: 'ingredient', ingredientId: 'flour', qty: '1000', unit: 'g' }],
    });
    expect(recipeWeighing(ingredientAlone, 1000, recipes)).toBeNull();
    expect(recipeWeighing({ ...one({ cookedText: '900', cookingTyped: true }), components: [] }, 0, recipes)).toBeNull();
  });

  it('does not count packaging as a line: one recipe and a box is still a product of one recipe', () => {
    const boxed = one({ cookedText: '900', cookingTyped: true, packaging: [{ key: 'p', ingredientId: 'box', qty: '1' }] });
    expect(recipeWeighing(boxed, 1000, recipes)).toMatchObject({ recipeId: 'Dough', state: { raw: 1000, cooked: 900 } });
  });

  it('⚠️ rounds the lines’ total to a thousandth of a gram: 2.01 kg is 2010 g, not 2009.9999999999998', () => {
    const noisy = recipeWeighing(one({ cookedText: '1800', cookingTyped: true }), 2.01 * 1000, recipes);
    expect(noisy?.state.raw).toBe(2010);
  });
});

describe('the hint that a recipe loses weight', () => {
  const recipes = { A: { name: 'Plain', lossPct: 0 }, B: { name: 'Bread', lossPct: 12.5 }, C: { name: 'Roll', lossPct: 8 } };
  const lines = (...ids: string[]) => ids.map((recipeId, i) => ({ key: `k${i}`, kind: 'recipe' as const, recipeId, qty: '1000', unit: 'g' as const }));

  it('names the FIRST recipe of the lines that loses weight, while the cooked box is empty', () => {
    expect(recipeLossHint({ ...emptyWorking(), components: lines('A', 'B', 'C') }, recipes)).toEqual({ name: 'Bread', pct: 12.5 });
  });

  it('says nothing once a cooked weight is typed, or when no recipe loses weight', () => {
    expect(recipeLossHint({ ...emptyWorking(), components: lines('B'), cookedText: '900' }, recipes)).toBeNull();
    expect(recipeLossHint({ ...emptyWorking(), components: lines('A') }, recipes)).toBeNull();
    expect(recipeLossHint({ ...emptyWorking(), components: lines('B') }, {})).toBeNull();
  });
});

describe('waitsForTables', () => {
  const recipeLine = { recipeId: 'r', qtyKg: 1 };
  const ingredientLine = { kind: 'ingredient', ingredientId: 'i', qty: 100, unit: 'g' };
  const make = (components: object[], model: number | undefined) =>
    normalizeProduct({ id: 'p', name: 'x', components, ...(model === undefined ? {} : { model }) }) as Product;

  it('a legacy product with a recipe line waits for the recipes and the prices', () => {
    expect(waitsForTables(make([recipeLine], 2))).toBe(true);
    expect(waitsForTables(make([ingredientLine, recipeLine], undefined))).toBe(true);
  });
  it('a legacy product with ingredient lines only does not', () => {
    expect(waitsForTables(make([ingredientLine], 2))).toBe(false);
  });
  it('a model 3 product does not', () => {
    expect(waitsForTables(make([recipeLine], 3))).toBe(false);
  });
});

// ⚠️ A RECIPE LINE OPENS IN GRAMS AND IS STORED IN KILOS (current app a7f4c75d, 8 Nov 2026): the unit lives only in the
// working copy, and the stored `qtyKg` is worked out from the box and the unit beside it.
describe('a recipe line in the working copy', () => {
  const stored = (qtyKg: number) => normalizeProduct({ id: 'p', name: 'Loaf', components: [{ recipeId: 'r', qtyKg }] }) as Product;

  it('opens in grams: 3.233 kg shows «3233», 0.522 shows «522», nothing shows the placeholder', () => {
    expect(workingFrom(stored(3.233), 'IT').components[0]).toMatchObject({ kind: 'recipe', qty: '3233', unit: 'g' });
    expect(workingFrom(stored(0.522), 'IT').components[0]).toMatchObject({ qty: '522', unit: 'g' });
    expect(workingFrom(stored(0), 'IT').components[0]).toMatchObject({ qty: '', unit: 'g' });
  });

  it('a draft from a recipe opens in grams too', () => {
    const draft = draftFromRecipe({ id: 'r', name: 'Loaf' });
    if (!draft) throw new Error('no draft');
    expect(workingFromDraft(draft).components[0]).toMatchObject({ kind: 'recipe', qty: '', unit: 'g' });
  });

  it('an untouched line is saved as the very kilos stored — even past six decimals (the old kilo box saved what was typed)', () => {
    for (const kilos of [0.522, 1.7, 0.001, 12.345678, 0.000001, 25, 3.233, 0.0416667, 1.23456789]) {
      expect(toProduct(workingFrom(stored(kilos), 'IT'), 'p').components, String(kilos)).toEqual([{ recipeId: 'r', qtyKg: kilos }]);
    }
  });

  it('the box is read in its unit, a comma as a decimal mark, and never with float noise', () => {
    expect(recipeLineKg({ qty: '522', unit: 'g' })).toBe(0.522);
    expect(recipeLineKg({ qty: '522', unit: 'kg' }), 'g → kg keeps the number: now 522 kg').toBe(522);
    expect(recipeLineKg({ qty: '1,5', unit: 'kg' })).toBe(1.5);
    expect(recipeLineKg({ qty: '0,5', unit: 'g' })).toBe(0.0005);
    expect(recipeLineKg({ qty: '', unit: 'kg' }), 'an empty box is nothing in either unit').toBe(recipeLineKg({ qty: '', unit: 'g' }));
    expect(recipeLineKg({ qty: 'abc', unit: 'g' })).toBe(0);
  });

  it('a line opened past six decimals and then touched is read from its box', () => {
    const [line] = workingFrom(stored(0.0416667), 'IT').components;
    if (line?.kind !== 'recipe') throw new Error('no recipe line');
    expect(line.qty).toBe('41.6667');
    expect(recipeLineKg({ ...line, qty: '42' })).toBe(0.042);
    expect(recipeLineKg({ ...line, unit: 'kg' }), 'the switch keeps the number: now 41.6667 kg').toBe(41.6667);
    expect(recipeLineKg(line), 'as it opened: the stored kilos').toBe(0.0416667);
  });
});
