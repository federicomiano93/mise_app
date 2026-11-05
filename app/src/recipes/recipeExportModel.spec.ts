import { describe, expect, it } from 'vitest';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { exportFileName, hasRoundableRows, rowTextOf, xlsxSheet } from '@mise/shared/recipe-export';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { format } from '../i18n/i18n';
import { recipeAmounts } from './recipeAmounts';
import { recipeExportModel } from './recipeExportModel';

// The recipe screen's rows as the export reads them (port of tests/catalogue-export-model.test.mjs). The model is
// built from the amounts the card DREW, so the file starts from what the screen says; only the PDF's own switch prints a
// gram row differently. Fake recipes only.

const tEn = (key: keyof typeof en, params?: Record<string, string | number>) => format('en', en[key], params);
const tIt = (key: keyof typeof italian, params?: Record<string, string | number>) => format('it', italian[key], params);

const RECIPE = {
  id: 'r1',
  name: 'Crema di prova',
  ingredients: [
    { label: 'Latte di prova', grams: 500, unit: 'ml' },
    { label: 'Farina di prova', grams: 2, unit: 'kg' },
    { label: 'Uova di prova', grams: 3, unit: 'pcs' },
    { label: 'Zucchero di prova', grams: 250 },
    { label: 'Sale di prova', grams: 0, unit: 'to taste' },
  ],
} as unknown as CatalogueRecipe;

const DECIMALS = {
  id: 'r2',
  name: 'Impasto di prova',
  ingredients: [
    { label: 'Farina di prova', grams: 0.4, unit: 'kg' },
    { label: 'Latte di prova', grams: 1.25, unit: 'l' },
    { label: 'Uova di prova', grams: 2, unit: 'pcs' },
  ],
} as unknown as CatalogueRecipe;

describe('recipeExportModel', () => {
  it('keeps each row in its own unit, with grams-per-unit (0 when not weighable)', () => {
    const model = recipeExportModel(RECIPE, recipeAmounts(RECIPE, null, tEn, 'en-GB'));
    expect(model.name).toBe('Crema di prova');
    expect(model.trays).toBe(0);
    expect(model.totalG).toBe(2750);
    expect(model.rows.map(row => [row.name, row.value, row.factor])).toEqual([
      ['Latte di prova', 500, 1],
      ['Farina di prova', 2, 1000],
      ['Uova di prova', 3, 0],
      ['Zucchero di prova', 250, 1],
      ['Sale di prova', null, 0],
    ]);
    // The unit is the word the screen prints.
    expect(model.rows.map(row => row.unit)).toEqual(['ml', 'kg', 'pcs', 'g', 'to taste']);
  });

  it('carries a divider on the rows that have one, and no key at all on the others', () => {
    const divided = {
      ...RECIPE,
      ingredients: RECIPE.ingredients.map((ingredient, index) => (index === 1 ? { ...ingredient, dividerAfter: true } : index === 2 ? { ...ingredient, dividerAfter: 'yes' } : ingredient)),
    } as unknown as CatalogueRecipe;
    const model = recipeExportModel(divided, recipeAmounts(divided, null, tEn, 'en-GB'));
    expect(model.rows.map(row => 'dividerAfter' in row)).toEqual([false, true, false, false, false]);
    expect((model.rows[1] as { dividerAfter?: unknown }).dividerAfter).toBe(true);
    const plain = recipeExportModel(RECIPE, recipeAmounts(RECIPE, null, tEn, 'en-GB'));
    expect(plain.rows.some(row => 'dividerAfter' in row)).toBe(false);
  });

  it('says the unit in the interface’s words, as the screen does', () => {
    const model = recipeExportModel(RECIPE, recipeAmounts(RECIPE, null, tIt, 'it-IT'));
    expect(model.rows.map(row => row.unit)).toEqual(['ml', 'kg', 'pz', 'g', 'q.b.']);
    expect(model.rows.map(row => rowTextOf(row))).toEqual(['500 ml', '2 kg', '3 pz', '250 g', 'q.b.']);
  });

  it('reaches the lab rounding in Italian: the gram rows only, from the number on screen', () => {
    const recipe = { ...RECIPE, ingredients: [...RECIPE.ingredients, { rid: 'odd', label: 'Lievito di prova', grams: 293, unit: 'g' }] } as CatalogueRecipe;
    const model = recipeExportModel(recipe, recipeAmounts(recipe, null, tIt, 'it-IT'));
    expect(hasRoundableRows(model)).toBe(true);
    expect(model.rows.map(row => rowTextOf(row, { rounded: true }))).toEqual(['500 ml', '2 kg', '3 pz', '250 g', 'q.b.', '290 g']);
  });

  it('takes the amounts as drawn (scaled) and the total rounded', () => {
    const amounts = recipeAmounts(RECIPE, 5500.4, tEn, 'en-GB');
    const model = recipeExportModel(RECIPE, amounts);
    expect(model.totalG).toBe(5500);
    model.rows.forEach((row, index) => { expect((row as { value: number | null }).value).toBe(amounts.values[index]); });
  });

  it('⚠️ a 0.727 kg row is «0,727 kg» in the Italian PDF, as on the screen, never «1 kg»', () => {
    const amounts = recipeAmounts(DECIMALS, 3000, tIt, 'it-IT');
    const model = recipeExportModel(DECIMALS, amounts);
    expect(model.rows.map(row => (row as { decimals: number }).decimals)).toEqual([3, 3, 0]);
    expect(model.rows.map(row => rowTextOf(row))).toEqual(['0,727 kg', '2,273 l', '4 pz']);
    expect(amounts.rows.map(row => row.num)).toEqual(['0,727', '2,273', '4']);
  });

  it('⚠️ in the Excel a kg / l cell holds the decimals and its format does not round them away', () => {
    const model = recipeExportModel(DECIMALS, recipeAmounts(DECIMALS, 3000, tIt, 'it-IT'));
    const { data } = xlsxSheet({ title: 'T', rows: model.rows, totalLabel: 'Totale', totalG: model.totalG });
    expect(data[2]?.[1]?.value).toBeCloseTo(0.727, 3);
    expect(data[2]?.[1]?.format).toBe('General "kg"');
    expect(data[3]?.[1]?.format).toBe('General "l"');
    expect(data[4]?.[1]?.format).toBe('0 "pz"');
    // 0.727 kg + 2.273 l = 3000 g, the screen's total: the spreadsheet computes it itself.
    expect([data.at(-1)?.[1]?.value, data.at(-1)?.[1]?.type]).toEqual(['B3*1000+B4*1000', 'Formula']);
  });

  it('a recipe with no weighable row has a total of 0, and a file name with no weight', () => {
    const pieces = { id: 'p', name: 'Decori di prova', ingredients: [{ label: 'Ciliegie di prova', grams: 6, unit: 'pcs' }] } as unknown as CatalogueRecipe;
    const model = recipeExportModel(pieces, recipeAmounts(pieces, null, tEn, 'en-GB'));
    expect(model.totalG).toBe(0);
    expect(exportFileName(model, 'pdf')).toBe('Decori_di_prova.pdf');
  });

  it('a total that is not a positive finite number is 0', () => {
    const amounts = recipeAmounts(RECIPE, null, tEn, 'en-GB');
    for (const totalGrams of [0, Number.NaN, -5, Number.POSITIVE_INFINITY]) {
      expect(recipeExportModel(RECIPE, { ...amounts, totalGrams }).totalG).toBe(0);
    }
  });
});
