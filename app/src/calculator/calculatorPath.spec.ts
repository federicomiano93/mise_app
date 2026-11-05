import { describe, expect, it } from 'vitest';
import { CALCULATOR_PATH, parseCalculatorPath, recipePath, resolveCalculatorPath } from './calculatorPath';

describe('parseCalculatorPath', () => {
  it.each([
    ['', { kind: 'home' }],
    ['/', { kind: 'home' }],
    ['/brioche', { kind: 'recipe', id: 'brioche' }],
    ['/brioche/', { kind: 'recipe', id: 'brioche' }],
  ])('%j → %j', (rest, expected) => {
    expect(parseCalculatorPath(rest)).toEqual(expected);
  });

  it('reads no address at all as the home', () => {
    expect(parseCalculatorPath(undefined)).toEqual({ kind: 'home' });
  });

  // A recipe id is a Firestore document id: it may hold a slash, a percent sign or a space. The segments are
  // split BEFORE they are decoded.
  it('splits the segments before decoding them, so an id with a slash comes back whole', () => {
    expect(parseCalculatorPath('/a%2Fb%20c')).toEqual({ kind: 'recipe', id: 'a/b c' });
  });

  it('does not decode an id twice', () => {
    expect(parseCalculatorPath('/100%2525')).toEqual({ kind: 'recipe', id: '100%25' });
  });

  it.each(['/a/b', '/%', '/%E0%A4%A', '/a/b/c'])('%s is unknown', rest => {
    expect(parseCalculatorPath(rest)).toEqual({ kind: 'unknown' });
  });
});

describe('recipePath', () => {
  it('writes the id percent-encoded, and parse reads it back', () => {
    for (const id of ['brioche', 'a/b c', '100%', 'é']) {
      expect(recipePath(id)).toMatch(new RegExp(`^${CALCULATOR_PATH}/[^/]+$`));
      expect(parseCalculatorPath(recipePath(id).slice(CALCULATOR_PATH.length))).toEqual({ kind: 'recipe', id });
    }
  });
});

describe('resolveCalculatorPath', () => {
  const visible = ['focaccia', 'brioche'];

  it('shows the first visible recipe at the bare address', () => {
    expect(resolveCalculatorPath('', visible)).toEqual({ active: 'focaccia' });
  });

  it('shows the recipe in the address when it is visible', () => {
    expect(resolveCalculatorPath('/brioche', visible)).toEqual({ active: 'brioche' });
  });

  it('sends an unknown or hidden recipe to the first visible one', () => {
    expect(resolveCalculatorPath('/gone', visible)).toEqual({ redirect: '/calculator/focaccia' });
  });

  it('sends an address of another shape back to the Calculator', () => {
    expect(resolveCalculatorPath('/a/b', visible)).toEqual({ redirect: '/calculator' });
  });

  it('leaves the address alone while there is no visible recipe to judge it by', () => {
    expect(resolveCalculatorPath('/gone', [])).toEqual({ active: null });
    expect(resolveCalculatorPath('', [])).toEqual({ active: null });
  });
});
