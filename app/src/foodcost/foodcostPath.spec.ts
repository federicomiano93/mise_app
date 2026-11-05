import { describe, expect, it } from 'vitest';
import {
  FOODCOST_PATH, historyPath, newPath, parseFoodcostPath, productPath, resolveFoodcostPath, settingsPath,
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
    expect(resolveFoodcostPath('')).toEqual({ view: { kind: 'list' } });
    expect(resolveFoodcostPath('/product/x/history')).toEqual({ view: { kind: 'history', id: 'x' } });
  });

  it('sends anything else back to the list', () => {
    expect(resolveFoodcostPath('/nonsense')).toEqual({ redirect: FOODCOST_PATH });
    expect(resolveFoodcostPath('/product/a/b')).toEqual({ redirect: FOODCOST_PATH });
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
