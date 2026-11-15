import { describe, expect, it } from 'vitest';
import {
  FOODCOST_PATH, NO_ORIGIN, entryPath, historyPath, newForRecipePath, newPath, parseFoodcostPath, productPath,
  resolveFoodcostPath, settingsPath, usingPath,
} from './foodcostPath';

describe('parseFoodcostPath', () => {
  it.each([
    ['', { kind: 'list' }],
    ['/', { kind: 'list' }],
    ['/new', { kind: 'new' }],
    ['/new/', { kind: 'new' }],
    ['/settings', { kind: 'settings' }],
    ['/product/abc', { kind: 'product', id: 'abc' }],
    ['/product/abc/', { kind: 'product', id: 'abc' }],
    ['/product/abc/history', { kind: 'history', id: 'abc' }],
  ])('%s → %j', (rest, expected) => {
    expect(parseFoodcostPath(rest)).toEqual(expected);
  });

  it('reads no address at all as the list', () => {
    expect(parseFoodcostPath(undefined)).toEqual({ kind: 'list' });
  });

  // A Firestore document id may hold a slash, a percent sign or a space: the segments are split
  // BEFORE they are decoded, so «a%2Fb» is one id and not two segments.
  it('splits the segments before decoding them, so an id with a slash comes back whole', () => {
    expect(parseFoodcostPath('/product/a%2Fb%20c')).toEqual({ kind: 'product', id: 'a/b c' });
    expect(parseFoodcostPath('/product/a%2Fb%20c/history')).toEqual({ kind: 'history', id: 'a/b c' });
  });

  it('does not decode an id twice', () => {
    expect(parseFoodcostPath('/product/100%2525')).toEqual({ kind: 'product', id: '100%25' });
  });

  it('leaves a product named «new» or «settings» to its own address', () => {
    expect(parseFoodcostPath('/product/new')).toEqual({ kind: 'product', id: 'new' });
    expect(parseFoodcostPath('/product/settings/history')).toEqual({ kind: 'history', id: 'settings' });
  });

  it.each([
    '/product', '/product/', '/product/a/b', '/product/a/history/more', '/product/a/other',
    '/new/more', '/settings/more', '/nonsense', '/product/%', '/product/%E0%A4%A',
  ])('%s is unknown', rest => {
    expect(parseFoodcostPath(rest)).toEqual({ kind: 'unknown' });
  });
});

describe('resolveFoodcostPath', () => {
  it('shows what it knows', () => {
    expect(resolveFoodcostPath('')).toEqual({ view: { kind: 'list' }, origin: NO_ORIGIN });
    expect(resolveFoodcostPath('/product/x/history')).toEqual({ view: { kind: 'history', id: 'x' }, origin: NO_ORIGIN });
  });

  it('reads a recipe in the query: the list becomes the entry, a product or a new product keeps it', () => {
    expect(resolveFoodcostPath('', '?recipe=r1')).toEqual({
      view: { kind: 'entry', recipeId: 'r1' }, origin: { recipe: 'r1', using: null },
    });
    expect(resolveFoodcostPath('/product/p', '?recipe=r1')).toEqual({
      view: { kind: 'product', id: 'p' }, origin: { recipe: 'r1', using: null },
    });
    expect(resolveFoodcostPath('/new', '?recipe=r1')).toEqual({ view: { kind: 'new' }, origin: { recipe: 'r1', using: null } });
  });

  it('reads «using» as the narrowed list, and keeps it on a product and its history', () => {
    expect(resolveFoodcostPath('', '?using=r1')).toEqual({ view: { kind: 'list' }, origin: { recipe: null, using: 'r1' } });
    expect(resolveFoodcostPath('/product/p/history', '?using=r1')).toEqual({
      view: { kind: 'history', id: 'p' }, origin: { recipe: null, using: 'r1' },
    });
  });

  it('a recipe wins over «using»; an id that cannot be one is the plain address; settings take no query', () => {
    expect(resolveFoodcostPath('/product/p', '?using=a&recipe=b')).toEqual({
      view: { kind: 'product', id: 'p' }, origin: { recipe: 'b', using: null },
    });
    expect(resolveFoodcostPath('', '?recipe=a%2Fb')).toEqual({ view: { kind: 'list' }, origin: NO_ORIGIN });
    expect(resolveFoodcostPath('', '?recipe=')).toEqual({ view: { kind: 'list' }, origin: NO_ORIGIN });
    expect(resolveFoodcostPath('/settings', '?recipe=r')).toEqual({ view: { kind: 'settings' }, origin: NO_ORIGIN });
  });

  it('sends anything else back to the list', () => {
    expect(resolveFoodcostPath('/nonsense')).toEqual({ redirect: FOODCOST_PATH });
    expect(resolveFoodcostPath('/product/a/b')).toEqual({ redirect: FOODCOST_PATH });
  });
});

describe('the paths with a recipe', () => {
  it('are built the way they are read', () => {
    for (const id of ['r1', 'a b', '100%25', 'é']) {
      const search = (path: string) => path.slice(path.indexOf('?'));
      expect(resolveFoodcostPath('', search(entryPath(id)))).toEqual({ view: { kind: 'entry', recipeId: id }, origin: { recipe: id, using: null } });
      expect(resolveFoodcostPath('', search(usingPath(id)))).toEqual({ view: { kind: 'list' }, origin: { recipe: null, using: id } });
      expect(resolveFoodcostPath('/new', search(newForRecipePath(id)))).toMatchObject({ origin: { recipe: id } });
      const withRecipe = productPath('p', { recipe: id, using: null });
      expect(resolveFoodcostPath('/product/p', search(withRecipe))).toMatchObject({ origin: { recipe: id } });
      const history = historyPath('p', { recipe: null, using: id });
      expect(history.startsWith('/food-cost/product/p/history?')).toBe(true);
      expect(resolveFoodcostPath('/product/p/history', search(history))).toMatchObject({ origin: { using: id } });
    }
    expect(productPath('p')).toBe('/food-cost/product/p');
    expect(entryPath('r')).toBe('/food-cost?recipe=r');
  });
});

describe('the paths', () => {
  it('are built the way they are read', () => {
    expect(FOODCOST_PATH).toBe('/food-cost');
    expect(newPath).toBe('/food-cost/new');
    expect(settingsPath).toBe('/food-cost/settings');
    for (const id of ['abc', 'a/b c', '100%25', 'é']) {
      expect(parseFoodcostPath(productPath(id).slice(FOODCOST_PATH.length))).toEqual({ kind: 'product', id });
      expect(parseFoodcostPath(historyPath(id).slice(FOODCOST_PATH.length))).toEqual({ kind: 'history', id });
    }
  });
});
