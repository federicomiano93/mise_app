// Unit tests for «is this item food or packaging?» (P15), run against BOTH implementations: the
// TypeScript port in shared/ and js/ingredient-kind.js, which the live app uses today. The original
// has no test file of its own, so these are written from its comments (absent means food; only a
// literal 'packaging' is packaging). The module is a FULL port, so parity.spec.ts also compares its
// exports name by name.

import { describe, expect, test } from 'vitest';
import * as ported from './ingredient-kind';
import * as legacyJs from '../../js/ingredient-kind.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('⚠️ absent means food: only a literal «packaging» is packaging', () => {
    expect(m.isPackaging({ name: 'Flour' })).toBe(false);
    expect(m.isPackaging({ kind: 'ingredient' })).toBe(false);
    expect(m.isPackaging({ kind: 'Packaging' })).toBe(false);
    expect(m.isPackaging({ kind: 'packaging' })).toBe(true);
  });

  test('anything that is not an object is not packaging', () => {
    for (const odd of [null, undefined, 0, '', 'packaging', true]) expect(m.isPackaging(odd), String(odd)).toBe(false);
  });

  test('kindOf writes «packaging» or «ingredient», nothing else', () => {
    expect(m.kindOf({ kind: 'packaging' })).toBe('packaging');
    expect(m.kindOf({ kind: 'whatever' })).toBe('ingredient');
    expect(m.kindOf(null)).toBe('ingredient');
    expect(m.kindOf({})).toBe('ingredient');
  });

  test('the list of kinds is closed and frozen', () => {
    expect([...m.INGREDIENT_KINDS]).toStrictEqual(['ingredient', 'packaging']);
    expect(Object.isFrozen(m.INGREDIENT_KINDS)).toBe(true);
  });
});
