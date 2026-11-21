import { describe, expect, test } from 'vitest';
import { normalizeProduct } from '@mise/shared/foodcost-model';
import type { Product } from '@mise/shared/foodcost-model';
import {
  CAKES_GROUP_ID, MAX_CATEGORY_NAME, cardCounts, categoryIdOf, categoryNameProblem, groupRows, grouped, isGroupOpen, nextRank, readCategories,
} from './categoriesModel';

// The pure half of Food cost's categories (model 4, 20 Nov 2026): reading them, naming them, counting and grouping the cards.

const cats = readCategories([
  { id: 'b', name: 'Bread', rank: 2 }, { id: 'a', name: 'Cakes', rank: 1 }, { id: 'x', name: '  ', rank: 3 }, { id: '', name: 'No id', rank: 4 }, null,
]);
const card = (id: string, categoryId: string | null): Product => normalizeProduct({ id, name: id, categoryId }) as Product;
const rows = (...products: Product[]) => products.map(product => ({ product }));

describe('reading and ordering', () => {
  test('in the order of the list; a document with no name or no id is dropped; a bad rank counts as 0', () => {
    expect(cats.map(category => category.id)).toEqual(['a', 'b']);
    expect(readCategories([{ id: 'z', name: 'Z', rank: 'x' }, { id: 'y', name: 'Y', rank: 0 }]).map(category => category.id)).toEqual(['y', 'z']);
    expect(readCategories('nonsense')).toEqual([]);
  });

  test('a new category goes after every one there is, even when this phone\'s clock is behind', () => {
    expect(nextRank(cats, 1_000)).toBe(1_000);
    expect(nextRank([{ id: 'a', name: 'A', rank: 5_000 }], 1_000)).toBe(5_001);
  });
});

describe('the name', () => {
  test('empty, too long and duplicate (capitals and accents not counting) are refused; the category being renamed may keep its own', () => {
    expect(categoryNameProblem('   ', cats)).toBe('empty');
    expect(categoryNameProblem('x'.repeat(MAX_CATEGORY_NAME + 1), cats)).toBe('too-long');
    expect(categoryNameProblem('x'.repeat(MAX_CATEGORY_NAME), cats)).toBeNull();
    expect(categoryNameProblem('bread', cats)).toBe('duplicate');
    expect(categoryNameProblem('BREAD', cats, 'a')).toBe('duplicate');
    expect(categoryNameProblem('Bread', cats, 'b')).toBeNull();
    expect(categoryNameProblem('Pasticcini', cats)).toBeNull();
  });
});

describe('grouping the cards', () => {
  const list = rows(card('1', 'b'), card('2', 'a'), card('3', null), card('4', 'gone'), card('5', 'a'));

  test('the categories in order, then «No category» last; a stale id reads as none; an empty group is not drawn', () => {
    const groups = groupRows(list, cats);
    expect(groups.map(group => [group.id, group.items.map(row => row.product.id)])).toEqual([
      ['a', ['2', '5']], ['b', ['1']], [null, ['3', '4']],
    ]);
    expect(groupRows(rows(card('1', 'a')), cats).map(group => group.id)).toEqual(['a']);
  });

  test('how many cards each category holds, counting only categories that exist', () => {
    expect([...cardCounts(list.map(row => row.product), cats)]).toEqual([['b', 1], ['a', 2]]);
    expect(categoryIdOf(card('4', 'gone'), cats)).toBeNull();
    expect(categoryIdOf(card('2', 'a'), cats)).toBe('a');
  });
});

describe('which groups are open', () => {
  const group = { items: rows(card('1', 'a')) };
  const none = new Set<string>();

  test('all closed to begin with', () => {
    expect(isGroupOpen('a', group, { userOpen: none, searching: false, openProductId: null })).toBe(false);
    expect(isGroupOpen(null, group, { userOpen: none, searching: false, openProductId: null })).toBe(false);
  });

  test('a tap opens one, the open card\'s group opens by itself, and a search opens every group shown', () => {
    expect(isGroupOpen('a', group, { userOpen: new Set(['a']), searching: false, openProductId: null })).toBe(true);
    expect(isGroupOpen(null, group, { userOpen: new Set(['__none__']), searching: false, openProductId: null })).toBe(true);
    expect(isGroupOpen('a', group, { userOpen: none, searching: false, openProductId: '1' })).toBe(true);
    expect(isGroupOpen('a', group, { userOpen: none, searching: false, openProductId: '9' })).toBe(false);
    expect(isGroupOpen('a', group, { userOpen: none, searching: true, openProductId: null })).toBe(true);
  });
});

describe('the «Cakes» group', () => {
  const cake = card('cake-c1', 'a');
  const other = card('p1', 'a');
  const loose = card('p2', null);

  test('every cake card sits in it, whatever category it carries, after the categories and before «No category»', () => {
    const groups = groupRows(rows(cake, other, loose), cats);
    expect(groups.map(group => group.id)).toEqual(['a', CAKES_GROUP_ID, null]);
    expect(groups[0]?.items.map(row => row.product.id)).toEqual(['p1']);
    expect(groups[1]?.items.map(row => row.product.id)).toEqual(['cake-c1']);
  });

  test('a cake card is not counted in the category it carries', () => {
    expect(cardCounts([cake, other], cats).get('a')).toBe(1);
  });

  test('the list is grouped only when the venue has a real category; a cake alone does not group it', () => {
    expect(grouped([])).toBe(false);
    expect(grouped(cats)).toBe(true);
    expect(groupRows(rows(loose, cake), cats).map(group => group.id)).toEqual([CAKES_GROUP_ID, null]);
  });
});
