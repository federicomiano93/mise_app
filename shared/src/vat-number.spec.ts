// Unit tests for the canonical form of a VAT number (P15), run against BOTH implementations: the
// TypeScript port in shared/ and js/vat-number.js, which the live app uses today. Ported from the
// two normalizeVat tests of tests/invoice-import-model.test.mjs; the two must stay equal until the
// switch to Mise 2. The module is a FULL port, so parity.spec.ts also compares its exports.
//
// PORTED: both normalizeVat tests of tests/invoice-import-model.test.mjs, whole ('upper case, no
// whitespace at all, empty stays empty, NOVAT keys mean none' and 'a number typed without its
// country prefix is an Italian one; foreign prefixes are left alone'), plus a few cases of our own.
//
// NOT PORTED: the rest of that file — the invoice import itself, which is not in shared/.

import { describe, expect, test } from 'vitest';
import * as ported from './vat-number';
import * as legacyJs from '../../js/vat-number.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('upper case, no whitespace at all, empty stays empty, NOVAT keys mean none', () => {
    expect(m.normalizeVat('it 01234567890')).toBe('IT01234567890');
    expect(m.normalizeVat(' IT0123\t4567\n890 ')).toBe('IT01234567890');
    expect(m.normalizeVat('')).toBe('');
    expect(m.normalizeVat(null)).toBe('');
    expect(m.normalizeVat(undefined)).toBe('');
    expect(m.normalizeVat(12)).toBe('');
    expect(m.normalizeVat('NOVAT:0123456789ab')).toBe('');
    expect(m.normalizeVat(' novat:abc')).toBe('');
  });

  test('a number typed without its country prefix is an Italian one; foreign prefixes are left alone', () => {
    expect(m.normalizeVat('01234567890')).toBe('IT01234567890');
    expect(m.normalizeVat(' 012.345.678.90 ')).toBe('IT01234567890');
    expect(m.normalizeVat('it 012 345 678 90')).toBe('IT01234567890');
    expect(m.normalizeVat('IT01234567890')).toBe('IT01234567890');
    expect(m.normalizeVat('DE123456789'), 'a foreign prefix is never touched').toBe('DE123456789');
    expect(m.normalizeVat('fr12345678901'), 'eleven digits WITH country letters are not prefixed again').toBe('FR12345678901');
    expect(m.normalizeVat('ATU12345678')).toBe('ATU12345678');
    expect(m.normalizeVat('123456789'), 'a short number is not guessed at').toBe('123456789');
    expect(m.normalizeVat('0123456789012'), 'nor a long one').toBe('0123456789012');
    expect(m.normalizeVat('NOVAT:0123456789ab'), 'a NOVAT key is still «none»').toBe('');
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('eleven digits get the IT prefix', () => {
    expect(m.normalizeVat('12345678901')).toBe('IT12345678901');
  });

  test('spaces and dots are stripped, lower case becomes upper case', () => {
    expect(m.normalizeVat('gb 123 456 789')).toBe('GB123456789');
    expect(m.normalizeVat('1.2.3.4.5.6.7.8.9.0.1')).toBe('IT12345678901');
  });

  test('anything that is not text is empty', () => {
    for (const bad of [{}, [], true, 0, NaN, ['IT01234567890']]) expect(m.normalizeVat(bad)).toBe('');
  });
});
