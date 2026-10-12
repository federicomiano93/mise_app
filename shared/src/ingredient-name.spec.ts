// Unit tests for «which name of an ingredient does the app show?» (P15 — the owner cannot read code,
// so these tests are the safety net), run against BOTH implementations: the TypeScript port in
// shared/ and js/ingredient-name.js, which the live app uses today. Ported from
// tests/ingredient-name.test.mjs; the two must stay equal until the switch to Mise 2. The module is
// a FULL port, so parity.spec.ts also compares its exports name by name.
//
// PORTED: the 5 tests (of 27) that exercise the two functions purely — the rule, its fallbacks,
// nothing, the search by either name, and 'search finds an ingredient by its invoice name too' (only
// its first assertion: the second one calls matchesQuery, which is js/orders/).
//
// NOT PORTED, because the test is about something else that uses the name, and that something is not
// ported (or reads a file as text, or needs the DOM or the dictionary):
//   * 'the screen label shows the short name; the label of what was sent keeps the invoice name',
//     'a record freezes the INVOICE name…', 'lists of a supplier's products sort and read by the
//     display name', 'a unit conflict names the line as the screen shows it', 'the All-ingredients
//     list shows the display name and is found by BOTH names' — js/orders/ (archive, supplier-items,
//     ingredient-search) is not in shared/.
//   * '⚠️ the message to a supplier keeps the invoice name' — js/orders/order-text.js and
//     order-summary.js.
//   * 'the source: …' (4 tests) — they read js files as text.
//   * 'the Catalogue picker…', 'a typed name equal to the display name counts as taken' —
//     js/catalogue/.
//   * 'the card draws «Name to show»…', 'Save sends a trimmed shortName…', 'the card of before sends
//     it too', 'the card gives each hint a counter id', 'the card shows the invoice name…', 'the card
//     has no invoice-name block…', 'saving never sends invoiceName…' — the ingredient card, executed
//     against a fake DOM.
//   * 'firestore.rules: ingredients accept shortName…' — reads firestore.rules as text.
//   * '⚠️ a closed month shows each product's frozen label…' — js/inventory/inventory-model.js
//     (productsOfMonth).
//   * 'a supplier screen with no products points to the Ingredients tab…' — the dictionary.

import { describe, expect, test } from 'vitest';
import * as ported from './ingredient-name';
import * as legacyJs from '../../js/ingredient-name.js';

const legacy = legacyJs as unknown as typeof ported;

// The caller's own text folding, as js/orders/ingredient-search.js normalizeText writes it
// (the original test imports that one; it belongs to the Orders feature, which shared/ may not
// reach into, so the same four steps are written out here): accents stripped, lower case, trimmed.
const normalizeText = (value: unknown): string =>
  String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  // ── The rule ───────────────────────────────────────────────────────────────

  test('the short name wins, trimmed', () => {
    expect(m.ingredientDisplayName({ name: 'Caputo Farina Tipo 00 Rosso 25kg', shortName: '  Farina 00 ' })).toBe('Farina 00');
  });

  test('a blank, whitespace, missing or non-text short name falls back to the name', () => {
    expect(m.ingredientDisplayName({ name: 'Flour', shortName: '' })).toBe('Flour');
    expect(m.ingredientDisplayName({ name: 'Flour', shortName: '   ' })).toBe('Flour');
    expect(m.ingredientDisplayName({ name: 'Flour' })).toBe('Flour');
    expect(m.ingredientDisplayName({ name: 'Flour', shortName: 42 })).toBe('Flour');
  });

  test('never throws on nothing, and answers an empty string', () => {
    for (const bad of [null, undefined, 'text', 7, {}, { name: null }]) {
      expect(() => m.ingredientDisplayName(bad)).not.toThrow();
    }
    expect(m.ingredientDisplayName(null)).toBe('');
    expect(m.ingredientDisplayName({})).toBe('');
  });

  test('ingredientNameMatches: by either name, empty query matches all', () => {
    const ing = { name: 'Caputo Rosso', shortName: 'Farina' };
    expect(m.ingredientNameMatches(ing, 'farina', normalizeText)).toBe(true);
    expect(m.ingredientNameMatches(ing, 'caputo', normalizeText)).toBe(true);
    expect(m.ingredientNameMatches(ing, 'burro', normalizeText)).toBe(false);
    expect(m.ingredientNameMatches(ing, '', normalizeText)).toBe(true);
    expect(m.ingredientNameMatches(undefined, 'x', normalizeText)).toBe(false);
  });

  test('search finds an ingredient by its invoice name too', () => {
    // Only the first assertion of the original: the second one calls matchesQuery (js/orders/).
    const ing = { name: 'Farina', shortName: '', invoiceName: 'CAPUTO ROSSO SACCO KG 25' };
    expect(m.ingredientNameMatches(ing, 'caputo', normalizeText)).toBe(true);
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('the query is folded by the CALLER: a query that was not folded finds nothing', () => {
    // «query is already normalized» — the function folds the three names, never the query.
    const ing = { name: 'Perché', shortName: '', invoiceName: '' };
    expect(m.ingredientNameMatches(ing, 'perche', normalizeText)).toBe(true);
    expect(m.ingredientNameMatches(ing, 'Perché', normalizeText)).toBe(false);
  });

  test('the name is a string even when the document holds a number', () => {
    expect(m.ingredientDisplayName({ name: 42 })).toBe('42');
    expect(m.ingredientDisplayName({ name: 0 })).toBe('');
  });
});
