// Unit tests for «which name of a supplier does the app show?» (P15 — the owner cannot read code,
// so these tests are the safety net), run against BOTH implementations: the TypeScript port in
// shared/ and js/supplier-label.js, which the live app uses today. Ported from
// tests/supplier-label.test.mjs; the two must stay equal until the switch to Mise 2. The module is
// a FULL port, so parity.spec.ts also compares its exports name by name.
//
// PORTED: the 4 pure tests of the file's 34: the rule, its fallbacks, nothing, and the search by
// either name ('supplierMatches: by short name, by invoice name, empty query matches all').
//
// NOT PORTED, because the test is about something else that uses the name:
//   * 'filterSuppliers finds by short name, invoice name and category' — ported in
//     ingredient-search.spec.ts, where filterSuppliers lives.
//   * 'ingredient search rows carry the label and match either name' — flatRows / matchesQuery are
//     js/orders/ and are not ported.
//   * the supplier card's payload (4 tests) — js/supplier-record-form.js, executed against a fake DOM.
//   * the 22 'shows a supplier through supplierLabel' tests, 'the calculator's own order text…',
//     'the new labels exist in both languages' and 'supplier-label.js is precached' — they read js
//     files as text, or the dictionary.

import { describe, expect, test } from 'vitest';
import * as ported from './supplier-label';
import * as legacyJs from '../../js/supplier-label.js';

const legacy = legacyJs as unknown as typeof ported;

// The caller's own text folding, as js/orders/ingredient-search.js normalizeText writes it
// (accents stripped, lower case, trimmed).
const normalizeText = (value: unknown): string =>
  String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('the short name wins, trimmed', () => {
    expect(m.supplierLabel({ name: 'Aldo Legacy Foods Ltd Wholesale', shortName: '  Aldo ' })).toBe('Aldo');
  });

  test('a blank, whitespace, missing or non-text short name falls back to the name', () => {
    expect(m.supplierLabel({ name: 'Aldo Ltd', shortName: '' })).toBe('Aldo Ltd');
    expect(m.supplierLabel({ name: 'Aldo Ltd', shortName: '   ' })).toBe('Aldo Ltd');
    expect(m.supplierLabel({ name: 'Aldo Ltd' })).toBe('Aldo Ltd');
    expect(m.supplierLabel({ name: 'Aldo Ltd', shortName: 42 })).toBe('Aldo Ltd');
  });

  test('never throws on nothing, and answers an empty string', () => {
    for (const bad of [null, undefined, 'text', 7, {}, { name: null }]) {
      expect(() => m.supplierLabel(bad)).not.toThrow();
    }
    expect(m.supplierLabel(null)).toBe('');
    expect(m.supplierLabel({})).toBe('');
  });

  test('supplierMatches: by short name, by invoice name, empty query matches all', () => {
    const aldo = { id: 'aldo', name: 'Aldo Legacy Foods Ltd Wholesale', shortName: 'Aldo', category: 'Dry' };
    const alba = { id: 'alba', name: 'Alba', category: 'Dairy' };
    expect(m.supplierMatches(aldo, 'aldo', normalizeText)).toBe(true);
    expect(m.supplierMatches(aldo, 'wholesale', normalizeText)).toBe(true);
    expect(m.supplierMatches(aldo, 'alba', normalizeText)).toBe(false);
    expect(m.supplierMatches(alba, '', normalizeText)).toBe(true);
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('the query is folded by the CALLER: the function folds the two names, never the query', () => {
    const s = { name: 'Però', shortName: '' };
    expect(m.supplierMatches(s, 'pero', normalizeText)).toBe(true);
    expect(m.supplierMatches(s, 'Pero', normalizeText)).toBe(false);
  });

  test('a missing supplier matches nothing, but an empty query still matches it', () => {
    expect(m.supplierMatches(undefined, 'x', normalizeText)).toBe(false);
    expect(m.supplierMatches(null, '', normalizeText)).toBe(true);
  });
});
