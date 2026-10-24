import { describe, expect, it } from 'vitest';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { en } from '../i18n/en';
import { format } from '../i18n/i18n';
import { amountNumber, amountText, recipeAmounts } from './recipeAmounts';

// kg and litres keep their decimals on the recipe screen (14 Oct 2026): 0.4 kg of flour used to read «0 kg».
const t = (key: keyof typeof en, params?: Record<string, string | number>) => format('en', en[key], params);

const MIXED = {
  id: 'r1',
  name: 'Crema di prova',
  ingredients: [
    { label: 'Farina di prova', grams: 0.4, unit: 'kg' },
    { label: 'Latte di prova', grams: 1.25, unit: 'l' },
    { label: 'Zucchero di prova', grams: 250, unit: 'g' },
  ],
} as unknown as CatalogueRecipe;

describe('amountNumber', () => {
  it('writes kg and l with the language\'s decimal mark, no trailing zeros, no grouping', () => {
    expect(amountNumber(1.846, 'kg', 'it-IT')).toBe('1,846');
    expect(amountNumber(1.846, 'kg', 'en-GB')).toBe('1.846');
    expect(amountNumber(1.8, 'l', 'it-IT')).toBe('1,8');
    expect(amountNumber(2, 'kg', 'it-IT')).toBe('2');
    expect(amountNumber(12000, 'g', 'it-IT')).toBe('12000');
    expect(amountNumber(2.6, 'pcs', 'it-IT')).toBe('3');
  });
});

describe('recipeAmounts', () => {
  it('⚠️ the base recipe shows 0,4 kg and 1,25 l in Italian, never «0 kg»', () => {
    const { rows, total } = recipeAmounts(MIXED, null, t, 'it-IT');
    expect(rows.map(amountText)).toStrictEqual(['0,4 kg', '1,25 l', '250 g']);
    expect(amountText(total)).toBe('1900 g');
  });

  it('scaled to 3800 g every row doubles, kg and l keeping their decimals', () => {
    const { rows, total } = recipeAmounts(MIXED, 3800, t, 'en-GB');
    expect(rows.map(amountText)).toStrictEqual(['0.8 kg', '2.5 l', '500 g']);
    expect(amountText(total)).toBe('3800 g');
  });
});
