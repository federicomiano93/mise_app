import { describe, expect, it } from 'vitest';
import { sectionById } from '../shell/sections';
import {
  STOCKTAKE_PATH, costPath, currentMonthId, monthPath, parseStocktakePath, productPath, resolveStocktakePath,
} from './stocktakePath';

describe('parseStocktakePath', () => {
  it.each([undefined, '', '/'])('%j names no month', rest => {
    expect(parseStocktakePath(rest)).toEqual({ kind: 'start' });
  });

  it.each(['2026-10', '2026-10/', '/2026-10', '2000-01', '2099-12'])('%s is that month\'s list', rest => {
    expect(parseStocktakePath(rest)).toEqual({ kind: 'list', month: rest.replaceAll('/', '') });
  });

  it('cost is «What it cost» of that month, with or without a trailing slash', () => {
    expect(parseStocktakePath('2026-10/cost')).toEqual({ kind: 'cost', month: '2026-10' });
    expect(parseStocktakePath('2026-10/cost/')).toEqual({ kind: 'cost', month: '2026-10' });
  });

  it('product/<id> is that product of that month', () => {
    expect(parseStocktakePath('2026-10/product/flour')).toEqual({ kind: 'product', month: '2026-10', id: 'flour' });
    expect(parseStocktakePath('2026-10/product/flour/')).toEqual({ kind: 'product', month: '2026-10', id: 'flour' });
  });

  // An id is a Firestore document id: it may hold almost anything, and must come back whole.
  it.each([
    'a/b', 'a b', 'a%b', 'a.b', '100%', 'farina 00/25kg', 'ünï', 'a#b', 'a?b', 'a+b', '%2F', '日本',
  ])('reads the id %j back from the address built for it', id => {
    const rest = productPath('2026-10', id).slice(STOCKTAKE_PATH.length);
    expect(parseStocktakePath(rest)).toEqual({ kind: 'product', month: '2026-10', id });
  });

  it('splits before it decodes: an encoded slash stays inside the id', () => {
    expect(parseStocktakePath('2026-10/product/a%2Fb')).toEqual({ kind: 'product', month: '2026-10', id: 'a/b' });
  });

  // The month in the address is the id of the month's document, never a word or a guess.
  it.each([
    '2026-13',
    '2026-00',
    '2026-1',
    '26-10',
    '2026-10-01',
    'october',
    '2026/10',
    '2026-10/products/flour',
    '2026-10/product',
    '2026-10/product/',
    '2026-10/product/flour/extra',
    '2026-10/cost/extra',
    '2026-10/Cost',
    '2026-10/edit',
    'product/flour',
    'cost',
    '2026-10/product/%',
    '2026-10/product/%E0%A4%A',
    'a/b/c/d',
  ])('%s is unknown', rest => {
    expect(parseStocktakePath(rest)).toEqual({ kind: 'unknown' });
  });
});

describe('the addresses of the Stocktake', () => {
  it('start at the section\'s own path', () => {
    expect(STOCKTAKE_PATH).toBe(sectionById('stocktake').path);
    expect(monthPath('2026-10')).toBe('/stocktake/2026-10');
    expect(costPath('2026-10')).toBe('/stocktake/2026-10/cost');
    expect(productPath('2026-10', 'flour')).toBe('/stocktake/2026-10/product/flour');
  });

  it('encode a product id as a single segment', () => {
    expect(productPath('2026-10', 'a/b')).toBe('/stocktake/2026-10/product/a%2Fb');
    expect(productPath('2026-10', 'a b')).toBe('/stocktake/2026-10/product/a%20b');
    expect(productPath('2026-10', '100%')).toBe('/stocktake/2026-10/product/100%25');
  });

  it('are read back to what they were built from', () => {
    expect(parseStocktakePath(monthPath('2026-10').slice(STOCKTAKE_PATH.length))).toEqual({ kind: 'list', month: '2026-10' });
    expect(parseStocktakePath(costPath('2026-10').slice(STOCKTAKE_PATH.length))).toEqual({ kind: 'cost', month: '2026-10' });
  });
});

describe('currentMonthId', () => {
  it('is the month of the LOCAL clock', () => {
    expect(currentMonthId(new Date(2026, 9, 14, 21, 0, 0).getTime())).toBe('2026-10');
    // Half past midnight on the 1st is already the new month, whatever UTC says.
    expect(currentMonthId(new Date(2026, 10, 1, 0, 30, 0).getTime())).toBe('2026-11');
    expect(currentMonthId(new Date(2026, 9, 31, 23, 59, 0).getTime())).toBe('2026-10');
  });

  it('is a valid month even for a moment that is not a date', () => {
    expect(currentMonthId(Number.NaN)).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('resolveStocktakePath', () => {
  const NOW = '2026-10';

  it('lands on the current month when none is named', () => {
    expect(resolveStocktakePath('', NOW)).toEqual({ redirect: '/stocktake/2026-10' });
    expect(resolveStocktakePath(undefined, NOW)).toEqual({ redirect: '/stocktake/2026-10' });
  });

  it('goes back to /stocktake for an address that leads nowhere', () => {
    expect(resolveStocktakePath('2026-13', NOW)).toEqual({ redirect: '/stocktake' });
    expect(resolveStocktakePath('2026-10/nope', NOW)).toEqual({ redirect: '/stocktake' });
  });

  it('shows the current month and every earlier one', () => {
    expect(resolveStocktakePath('2026-10', NOW)).toEqual({ view: { kind: 'list', month: '2026-10' } });
    expect(resolveStocktakePath('2026-09', NOW)).toEqual({ view: { kind: 'list', month: '2026-09' } });
    expect(resolveStocktakePath('2019-02', NOW)).toEqual({ view: { kind: 'list', month: '2019-02' } });
  });

  it('replaces a month that has not happened with the current month\'s list', () => {
    expect(resolveStocktakePath('2026-11', NOW)).toEqual({ redirect: '/stocktake/2026-10' });
    expect(resolveStocktakePath('2027-01', NOW)).toEqual({ redirect: '/stocktake/2026-10' });
    expect(resolveStocktakePath('2026-11/cost', NOW)).toEqual({ redirect: '/stocktake/2026-10' });
    expect(resolveStocktakePath('2026-11/product/flour', NOW)).toEqual({ redirect: '/stocktake/2026-10' });
  });

  it('compares across the turn of the year as the calendar does', () => {
    expect(resolveStocktakePath('2026-12', '2027-01')).toEqual({ view: { kind: 'list', month: '2026-12' } });
    expect(resolveStocktakePath('2027-02', '2027-01')).toEqual({ redirect: '/stocktake/2027-01' });
  });

  it('keeps the product and the cost of a month that has happened', () => {
    expect(resolveStocktakePath('2026-09/cost', NOW)).toEqual({ view: { kind: 'cost', month: '2026-09' } });
    expect(resolveStocktakePath('2026-10/product/flour', NOW)).toEqual({
      view: { kind: 'product', month: '2026-10', id: 'flour' },
    });
  });
});
