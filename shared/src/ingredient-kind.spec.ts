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

  test('the list of kinds is frozen and starts with the original two', () => {
    expect([...m.INGREDIENT_KINDS].slice(0, 2)).toStrictEqual(['ingredient', 'packaging']);
    expect(Object.isFrozen(m.INGREDIENT_KINDS)).toBe(true);
  });
});

// ⚠️ A DELIBERATE MISE 2 DIFFERENCE (14 Nov 2026): 'resale' and 'other'. The current app is frozen and never writes
// them; its kindOf reads them as 'ingredient'. These run against the port only, and one test pins the original's
// answer so the difference is seen, not assumed.
describe('Mise 2 only: resale and other', () => {
  test('the list of kinds is closed: the four the rules allow', () => {
    expect([...ported.INGREDIENT_KINDS]).toStrictEqual(['ingredient', 'packaging', 'resale', 'other']);
  });

  test('kindOf keeps resale and other (the original turns them into ingredient)', () => {
    expect(ported.kindOf({ kind: 'resale' })).toBe('resale');
    expect(ported.kindOf({ kind: 'other' })).toBe('other');
    expect(legacy.kindOf({ kind: 'resale' })).toBe('ingredient');
    expect(legacy.kindOf({ kind: 'other' })).toBe('ingredient');
    expect(ported.kindOf({ kind: 'Resale' })).toBe('ingredient');
    expect(ported.kindOf({ kind: 'other ' })).toBe('ingredient');
  });

  test('isResale and isOther answer only for their literal value', () => {
    expect(ported.isResale({ kind: 'resale' })).toBe(true);
    expect(ported.isResale({ kind: 'other' })).toBe(false);
    expect(ported.isOther({ kind: 'other' })).toBe(true);
    expect(ported.isOther({ kind: 'resale' })).toBe(false);
    for (const odd of [null, undefined, 0, '', 'resale', 'other', {}, { kind: null }]) {
      expect(ported.isResale(odd), String(odd)).toBe(false);
      expect(ported.isOther(odd), String(odd)).toBe(false);
    }
  });

  test('⚠️ isFood: absent, null and «ingredient» are food; packaging, resale and other are not', () => {
    expect(ported.isFood({ name: 'Flour' })).toBe(true);
    expect(ported.isFood({ kind: null })).toBe(true);
    expect(ported.isFood({ kind: undefined })).toBe(true);
    expect(ported.isFood({ kind: 'ingredient' })).toBe(true);
    expect(ported.isFood({ kind: 'packaging' })).toBe(false);
    expect(ported.isFood({ kind: 'resale' })).toBe(false);
    expect(ported.isFood({ kind: 'other' })).toBe(false);
  });

  test('isFood agrees with kindOf on every item, and something that is not an item is not food', () => {
    for (const item of [{}, { kind: 'whatever' }, { kind: 1 }, { kind: 'packaging' }, { kind: 'resale' }, { kind: 'other' }, { kind: 'ingredient' }]) {
      expect(ported.isFood(item), JSON.stringify(item)).toBe(ported.kindOf(item) === 'ingredient');
    }
    for (const odd of [null, undefined, 0, '', 'ingredient', true]) expect(ported.isFood(odd), String(odd)).toBe(false);
  });
});
