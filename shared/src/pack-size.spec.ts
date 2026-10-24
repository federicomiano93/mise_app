// Unit tests for how much one pack holds, read from free text (P15 — the owner cannot read code, so
// these tests are the safety net), run against BOTH implementations: the TypeScript port in shared/
// and js/pack-size.js, which the live app uses today. Ported from tests/pack-size-weight.test.mjs;
// the two must stay equal until the switch to Mise 2. Every one of that file's 7 tests is ported
// (none needs the dictionary or the DOM). The module is a FULL port, so parity.spec.ts also compares
// its exports name by name.
//
// The original file tests the weight boxes (splitWeight, joinWeight, isUnusableWeight) and only
// round-trips parsePackSize; the reading itself is exercised through the order and stocktake
// suites. The last block here ("Added") pins parsePackSize directly, because the money of every
// order line rests on it.

import { describe, expect, test } from 'vitest';
import * as ported from './pack-size';
import * as legacyJs from '../../js/pack-size.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('splitWeight opens a readable value into number and unit', () => {
    expect(m.splitWeight('25kg')).toStrictEqual({ amount: '25', unit: 'kg' });
    expect(m.splitWeight('kg 5')).toStrictEqual({ amount: '5', unit: 'kg' });
    expect(m.splitWeight('2,27 kg')).toStrictEqual({ amount: '2.27', unit: 'kg' });
    expect(m.splitWeight('500 G')).toStrictEqual({ amount: '500', unit: 'g' });
    expect(m.splitWeight('750ml')).toStrictEqual({ amount: '750', unit: 'ml' });
    expect(m.splitWeight('1 lt')).toStrictEqual({ amount: '1', unit: 'l' });
  });

  test('splitWeight keeps unreadable text as legacy, untouched', () => {
    expect(m.splitWeight('6x1kg')).toStrictEqual({ amount: '', unit: 'kg', legacy: '6x1kg' });
    expect(m.splitWeight(' sacco ')).toStrictEqual({ amount: '', unit: 'kg', legacy: 'sacco' });
    expect(m.splitWeight('50 cl').legacy).toBe('50 cl');
    expect(m.splitWeight('0 kg').legacy).toBe('0 kg');
  });

  test('splitWeight on nothing offers kilos', () => {
    expect(m.splitWeight('')).toStrictEqual({ amount: '', unit: 'kg' });
    expect(m.splitWeight(undefined)).toStrictEqual({ amount: '', unit: 'kg' });
    expect(m.splitWeight('   ')).toStrictEqual({ amount: '', unit: 'kg' });
  });

  test('joinWeight builds the stored text', () => {
    expect(m.joinWeight('2.5', 'kg')).toBe('2.5 kg');
    expect(m.joinWeight('2,5', 'kg')).toBe('2.5 kg');
    expect(m.joinWeight('25', 'g')).toBe('25 g');
  });

  test('joinWeight answers empty for nothing usable', () => {
    expect(m.joinWeight('', 'kg')).toBe('');
    expect(m.joinWeight('abc', 'kg')).toBe('');
    expect(m.joinWeight('0', 'kg')).toBe('');
    expect(m.joinWeight('-3', 'kg')).toBe('');
    expect(m.joinWeight('3', 'stone')).toBe('');
    expect(m.joinWeight(null, 'kg')).toBe('');
  });

  test('joinWeight output round-trips through parsePackSize and splitWeight', () => {
    for (const [amount, unit, kilos] of [['2.5', 'kg', 2.5], ['500', 'g', 0.5], ['750', 'ml', 0.75], ['1', 'l', 1]] as const) {
      const text = m.joinWeight(amount, unit);
      expect(m.parsePackSize(text)).toBe(kilos);
      expect(m.splitWeight(text)).toStrictEqual({ amount, unit });
    }
  });

  test('isUnusableWeight: only a typed, unusable number counts (an empty box is «no weight»)', () => {
    expect(m.isUnusableWeight('', 'kg')).toBe(false);
    expect(m.isUnusableWeight('   ', 'kg')).toBe(false);
    expect(m.isUnusableWeight(undefined, 'kg')).toBe(false);
    expect(m.isUnusableWeight('2.5', 'kg')).toBe(false);
    expect(m.isUnusableWeight('2,5', 'g')).toBe(false);
    expect(m.isUnusableWeight('2.27kg', 'kg')).toBe(true);
    expect(m.isUnusableWeight('abc', 'kg')).toBe(true);
    expect(m.isUnusableWeight('0', 'kg')).toBe(true);
    expect(m.isUnusableWeight('-3', 'kg')).toBe(true);
    expect(m.isUnusableWeight('2', 'bogus')).toBe(true);
  });

  // ── Added ──────────────────────────────────────────────────────────────────
  // Not in tests/pack-size-weight.test.mjs: parsePackSize read directly, and the menu's units.

  test('parsePackSize reads a plain weight, a multiplied case and a unit written first', () => {
    expect(m.parsePackSize('25kg')).toBe(25);
    expect(m.parsePackSize('2,27 kg')).toBe(2.27);
    expect(m.parsePackSize('500 g')).toBe(0.5);
    expect(m.parsePackSize('750ml')).toBe(0.75);
    expect(m.parsePackSize('50 cl')).toBe(0.5);
    expect(m.parsePackSize('6 x 1kg')).toBe(6);
    expect(m.parsePackSize('12x500g')).toBe(6);
    expect(m.parsePackSize('6×1kg')).toBe(6);
    expect(m.parsePackSize('12 * 500 g')).toBe(6);
    expect(m.parsePackSize('kg 5')).toBe(5);
    expect(m.parsePackSize('  25   KG  ')).toBe(25);
  });

  test('⚠️ one litre is one kilo, the app’s existing convention', () => {
    expect(m.parsePackSize('1l')).toBe(1);
    expect(m.parsePackSize('1 lt')).toBe(1);
    expect(m.parsePackSize('2,5 L')).toBe(2.5);
  });

  test('parsePackSize answers null far more often than it guesses', () => {
    for (const bad of ['sacco', '', '   ', '25', 'kg', '25 oz', '0 kg', '0x5kg', '6x', 'x1kg', '1 kg 2', undefined, null, 25, {}, ['25kg']]) {
      expect(m.parsePackSize(bad), `text=${JSON.stringify(bad)}`).toBe(null);
    }
  });

  test('the weight menu offers grams, kilos, millilitres and litres, and a caller cannot change it', () => {
    expect([...m.WEIGHT_UNIT_CHOICES]).toStrictEqual(['g', 'kg', 'ml', 'l']);
    expect(Object.isFrozen(m.WEIGHT_UNIT_CHOICES)).toBe(true);
  });
});
