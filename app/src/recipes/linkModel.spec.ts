import { describe, expect, it } from 'vitest';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { en } from '../i18n/en';
import { linkText } from './linkModel';

const t = (key: keyof typeof en): string => String(en[key]);
const INGREDIENTS = {
  'ing-1': { id: 'ing-1', name: 'Farina 00 Caputo', shortName: 'Caputo', weight: '25 kg', supplierId: 'sup-1', pricePerUnit: 1.23 },
  'ing-2': { id: 'ing-2', name: 'Salt', weight: ' ', supplierId: 'nobody' },
};
const SUPPLIERS = { 'sup-1': { id: 'sup-1', name: 'Molino Rossi Srl', shortName: 'Rossi' } };
const RECIPES = [{ id: 'sub', name: 'Pizza base' }] as unknown as CatalogueRecipe[];
const text = (row: unknown) => linkText(row, INGREDIENTS, RECIPES, SUPPLIERS, t);

describe('the link line', () => {
  it('invites a link when there is none', () => {
    expect(text({ label: 'Flour' })).toBe('+ Link to an ingredient');
  });

  it('says name, pack weight and supplier (short name first) for an ingredient, two spaces either side of the dot, and no price', () => {
    expect(text({ kind: 'ingredient', refId: 'ing-1' })).toBe('→ Caputo  ·  25 kg  ·  Rossi');
  });

  it('leaves out what is missing', () => {
    expect(text({ refId: 'ing-2' })).toBe('→ Salt');
  });

  it('says «Recipe» for a sub-recipe', () => {
    expect(text({ kind: 'recipe', refId: 'sub' })).toBe('→ Pizza base  ·  Recipe');
  });

  it('says so when the target no longer exists', () => {
    expect(text({ kind: 'ingredient', refId: 'gone' })).toBe('→ an ingredient that no longer exists');
    expect(text({ kind: 'recipe', refId: 'gone' })).toBe('→ a recipe that no longer exists');
  });
});
