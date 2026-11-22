import { describe, expect, it } from 'vitest';
import { CAKES_PATH, cakePath, cakesScreenName, newCakePath, parseCakesPath, referencePath, startOf } from './cakesPath';

describe('the addresses of Cakes', () => {
  it('builds them', () => {
    expect(CAKES_PATH).toBe('/cakes');
    expect(newCakePath).toBe('/cakes/new');
    expect(referencePath).toBe('/cakes/reference');
    expect(cakePath('abc123')).toBe('/cakes/abc123');
    expect(cakePath('a/b')).toBe('/cakes/a%2Fb');
  });

  it('reads them back, with or without slashes around', () => {
    expect(parseCakesPath('')).toEqual({ kind: 'list' });
    expect(parseCakesPath('/')).toEqual({ kind: 'list' });
    expect(parseCakesPath('/new')).toEqual({ kind: 'new' });
    expect(parseCakesPath('/reference/')).toEqual({ kind: 'reference' });
    expect(parseCakesPath('/abc123')).toEqual({ kind: 'cake', id: 'abc123' });
    expect(parseCakesPath(cakePath('a/b').slice(CAKES_PATH.length))).toEqual({ kind: 'cake', id: 'a/b' });
  });

  it('sends anything else to the list', () => {
    for (const rest of ['/a/b', '/new/x', '/reference/x', '//', '/%E0%A4%A']) {
      expect(parseCakesPath(rest)).toEqual({ kind: 'list' });
    }
  });

  it('⚠️ names each screen exactly as the shell counts it', () => {
    expect(cakesScreenName('')).toBe('cakes');
    expect(cakesScreenName('/new')).toBe('cakes-editor');
    expect(cakesScreenName('/abc123')).toBe('cakes-editor');
    expect(cakesScreenName('/reference')).toBe('cakes-reference');
    expect(cakesScreenName('/a/b')).toBe('cakes');
    expect(cakesScreenName('/%E0%A4%A')).toBe('cakes');
  });

  it('reads how a new cake starts from the navigation state, «standard» when it says nothing', () => {
    expect(startOf({ cakeStart: 'zero' })).toBe('zero');
    expect(startOf({ cakeStart: 'standard' })).toBe('standard');
    for (const state of [null, undefined, {}, 'zero', 7, { cakeStart: 'other' }]) expect(startOf(state)).toBe('standard');
  });
});
