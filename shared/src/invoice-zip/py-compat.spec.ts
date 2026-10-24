// Unit tests for the Python-compatible helpers under the invoice reader (P15), run against BOTH
// implementations: the TypeScript port in shared/ and js/orders/invoice-zip/py-compat.js. Ported from
// tests/invoice-zip-support.test.mjs; the module is a FULL port, so parity.spec.ts also compares its exports.
//
// PORTED: the four py-compat tests of that file (pyFloat, roundHalfUp, pySum, stripChars). The file's other
// tests are in sha256.spec.ts (the two SHA-256 ones) or are NOT ported here: the test XML reader
// (tests/helpers/xml-tree.mjs) and `domToTree` of fatturapa.js — left for slice A2 with fatturapa.ts.
// Added: escapeRegex, and the word pieces B_START / B_END / WORD that stand for Python's `\b`.

import { describe, expect, test } from 'vitest';
import * as ported from './py-compat';
import * as legacyJs from '../../../js/orders/invoice-zip/py-compat.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('pyFloat reads a decimal like Python float() and refuses what is not one', () => {
    expect(m.pyFloat('25.00')).toBe(25);
    expect(m.pyFloat('-3.5')).toBe(-3.5);
    expect(m.pyFloat('.5')).toBe(0.5);
    expect(m.pyFloat('1e3')).toBe(1000);
    for (const bad of ['', ' ', 'abc', '1.2.3', '1,5', 'inf', 'nan', '1_000', null, undefined]) {
      expect(m.pyFloat(bad), String(bad)).toBe(null);
    }
  });

  test('roundHalfUp rounds the shortest decimal, ties away from zero (Decimal ROUND_HALF_UP)', () => {
    expect(m.roundHalfUp(0.00005, 4)).toBe(0.0001);
    expect(m.roundHalfUp(2.675, 2)).toBe(2.68); // toFixed(2) gives 2.67: the binary value is below the tie
    expect(m.roundHalfUp(1.005, 2)).toBe(1.01);
    expect(m.roundHalfUp(0.57, 4)).toBe(0.57);
    expect(m.roundHalfUp(15.323529411764707, 4)).toBe(15.3235);
    expect(m.roundHalfUp(9.090909090909092, 4)).toBe(9.0909);
    expect(m.roundHalfUp(-0.00005, 4)).toBe(-0.0001);
    expect(m.roundHalfUp(1.5e-6, 6)).toBe(0.000002);
    expect(m.roundHalfUp(1e21, 3)).toBe(1e21);
    expect(m.roundHalfUp(0.05, 6)).toBe(0.05);
  });

  test('pySum adds like Python 3.12+ (compensated)', () => {
    expect(m.pySum([0.1, 0.2, 0.3])).toBe(0.6); // a plain loop gives 0.6000000000000001
    expect(m.pySum([])).toBe(0);
    expect(m.pySum([1e100, 1.0, -1e100])).toBe(1);
  });

  test('stripChars is str.strip(chars)', () => {
    expect(m.stripChars('-- a b -.', ' -.')).toBe('a b');
    expect(m.stripChars('', ' ')).toBe('');
    expect(m.stripChars('xxx', 'x')).toBe('');
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('escapeRegex makes a code safe inside a pattern, including a slash', () => {
    expect(m.escapeRegex('F00-25.1/B (x)')).toBe('F00-25\\.1\\/B \\(x\\)');
    expect(new RegExp(m.escapeRegex('a+b*c'), 'u').test('a+b*c')).toBe(true);
    expect(m.escapeRegex(12)).toBe('12');
  });

  test('B_START and B_END treat an accented letter as a word character, as Python\'s \\b does', () => {
    const word = (text: string) => new RegExp(`${m.B_START}sale${m.B_END}`, 'iu').test(text);
    expect(word('sale grosso')).toBe(true);
    expect(word('un sale')).toBe(true);
    expect(word('salè')).toBe(false);
    expect(word('èsale')).toBe(false);
    expect(word('sale_')).toBe(false);
    expect(m.WORD).toBe('[\\p{L}\\p{N}_]');
  });
});
