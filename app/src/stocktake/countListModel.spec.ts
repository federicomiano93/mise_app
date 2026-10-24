import { describe, expect, it } from 'vitest';
import { categoryOf, fold, groupProducts, matches, stillToCount } from './countListModel';
import type { Product } from './countListModel';

const product = (id: string, fields: Record<string, unknown> = {}): Product => ({ id, name: id, ...fields });

describe('fold', () => {
  it('drops accents and case', () => {
    expect(fold('Però')).toBe('pero');
    expect(fold('CRÈME FRAÎCHE')).toBe('creme fraiche');
    expect(fold('Über')).toBe('uber');
  });

  it('reads nothing as nothing', () => {
    expect(fold(undefined)).toBe('');
    expect(fold(null)).toBe('');
    expect(fold(12)).toBe('12');
  });
});

describe('matches', () => {
  const flour = product('f', { name: 'Farina 00', shortName: 'Farina', brand: 'Caputo', category: 'Dispensa' });

  it('keeps everything when nothing is typed, or only spaces', () => {
    expect(matches(flour, '')).toBe(true);
    expect(matches(flour, '   ')).toBe(true);
  });

  it.each([
    ['name', 'farina 00'],
    ['short name', 'farina'],
    ['brand', 'caput'],
    ['category', 'dispe'],
  ])('finds a product by its %s', (_field, query) => {
    expect(matches(flour, query)).toBe(true);
  });

  it('folds accents and case on both sides', () => {
    expect(matches(product('p', { name: 'Però' }), 'PERO')).toBe(true);
    expect(matches(product('p', { name: 'Pero' }), 'però')).toBe(true);
    expect(matches(product('p', { brand: 'Crème' }), 'creme')).toBe(true);
  });

  it('does not count a space after a suggested word as part of the search', () => {
    expect(matches(product('p', { name: 'Farina' }), 'farina ')).toBe(true);
    expect(matches(product('p', { name: 'Farina' }), ' farina')).toBe(true);
  });

  it('keeps out what does not contain it', () => {
    expect(matches(flour, 'burro')).toBe(false);
  });

  it('does not fail on a product with no brand or category', () => {
    expect(matches(product('p'), 'x')).toBe(false);
  });
});

describe('categoryOf', () => {
  it('trims, and files «Other» and nothing under the same group', () => {
    expect(categoryOf(product('a', { category: ' Dispensa ' }))).toBe('Dispensa');
    expect(categoryOf(product('a', { category: 'Other' }))).toBe('');
    expect(categoryOf(product('a', { category: ' Other ' }))).toBe('');
    expect(categoryOf(product('a', { category: '' }))).toBe('');
    expect(categoryOf(product('a', { category: '   ' }))).toBe('');
    expect(categoryOf(product('a'))).toBe('');
    expect(categoryOf(product('a', { category: 7 }))).toBe('');
  });

  it('keeps a category that merely starts with «Other»', () => {
    expect(categoryOf(product('a', { category: 'Others' }))).toBe('Others');
  });
});

describe('groupProducts', () => {
  const names = (list: readonly Product[]) => list.map(item => item.id);

  it('orders the groups alphabetically and puts no category last', () => {
    const groups = groupProducts([
      product('a', { category: '' }),
      product('b', { category: 'Frigo' }),
      product('c', { category: 'Dispensa' }),
      product('d', { category: 'Other' }),
    ], 'en-GB');
    expect(groups.map(group => group.category)).toEqual(['Dispensa', 'Frigo', '']);
    expect(names(groups[2]?.products ?? [])).toEqual(['a', 'd']);
  });

  it('orders the groups by the language\'s own alphabet', () => {
    const groups = groupProducts([
      product('a', { category: 'Zucchero' }),
      product('b', { category: 'Éclair' }),
      product('c', { category: 'Farina' }),
    ], 'it-IT');
    expect(groups.map(group => group.category)).toEqual(['Éclair', 'Farina', 'Zucchero']);
  });

  it('orders the rows by the name shown: the short name, else the name', () => {
    const groups = groupProducts([
      product('a', { name: 'Zucchero velo', shortName: 'Aaa', category: 'X' }),
      product('b', { name: 'Burro', category: 'X' }),
      product('c', { name: 'Cacao', shortName: '  ', category: 'X' }),
    ], 'en-GB');
    expect(names(groups[0]?.products ?? [])).toEqual(['a', 'b', 'c']);
  });

  it('does not reorder or change the list it is given', () => {
    const given = [product('b', { name: 'B' }), product('a', { name: 'A' })];
    groupProducts(given, 'en-GB');
    expect(names(given)).toEqual(['b', 'a']);
  });

  it('is empty for no products', () => {
    expect(groupProducts([], 'en-GB')).toEqual([]);
  });
});

describe('stillToCount', () => {
  const list = [product('a'), product('b'), product('c')];
  const counted = (...ids: string[]) => (id: string) => ids.includes(id);

  it('keeps the products nobody has counted', () => {
    expect(stillToCount(list, new Set(), counted('b')).map(item => item.id)).toEqual(['a', 'c']);
  });

  it('keeps a product that was shown uncounted and has been counted since', () => {
    expect(stillToCount(list, new Set(['a']), counted('a', 'b')).map(item => item.id)).toEqual(['a', 'c']);
  });

  it('shows everything uncounted when nothing is counted', () => {
    expect(stillToCount(list, new Set(), counted()).map(item => item.id)).toEqual(['a', 'b', 'c']);
  });
});
