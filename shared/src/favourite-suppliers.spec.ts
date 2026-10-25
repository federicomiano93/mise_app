// Unit tests for the favourite suppliers' pure helpers (P15), run against BOTH implementations: the
// TypeScript port in shared/ and js/orders/favourite-suppliers.js, which the live app uses today.
// Ported from tests/favourite-suppliers.test.mjs; the two must stay equal until the switch to
// Mise 2. The module is a FULL port, so parity.spec.ts also compares its exports name by name.
//
// PORTED: the 5 pure tests (of 11): the three normalizeFavourites ones and the two
// splitByFavourite ones. favouriteGroups has no test in the original file (the screen draws it
// inline in js/orders/registry.js), so its cases are added below, written from the screen's own
// branches.
//
// NOT PORTED:
//   * 'the module stays pure: no DOM, no Firestore, no imports' and every test that reads
//     registry.js, registry-main.js or firebase-orders.js as text (5 tests).
//   * 'the four labels exist in English and Italian' — the dictionary.

import { describe, expect, test } from 'vitest';
import * as ported from './favourite-suppliers';
import * as legacyJs from '../../js/orders/favourite-suppliers.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('normalizeFavourites: anything that is not an array is no favourites', () => {
    for (const bad of [undefined, null, 'a', 3, {}, { 0: 'a' }, true]) {
      expect(m.normalizeFavourites(bad)).toStrictEqual([]);
    }
  });

  test('normalizeFavourites: unique non-empty strings, order kept', () => {
    expect(m.normalizeFavourites(['b', 'a', 'b', '', 3, null, 'c', 'a'])).toStrictEqual(['b', 'a', 'c']);
  });

  test('normalizeFavourites: at most 300', () => {
    const many = Array.from({ length: 450 }, (_, i) => `s${i}`);
    const out = m.normalizeFavourites(many);
    expect(m.MAX_FAVOURITES).toBe(300);
    expect(out.length).toBe(300);
    expect(out[299]).toBe('s299');
  });

  test('splitByFavourite: splits, keeping the input order in both groups', () => {
    const suppliers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const { favourites, others } = m.splitByFavourite(suppliers, ['d', 'b']);
    expect(favourites.map(s => s.id)).toStrictEqual(['b', 'd']);
    expect(others.map(s => s.id)).toStrictEqual(['a', 'c']);
  });

  test('splitByFavourite: ids that match no supplier are ignored; bad input is safe', () => {
    const { favourites, others } = m.splitByFavourite([{ id: 'a' }], ['gone', 'a']);
    expect(favourites).toStrictEqual([{ id: 'a' }]);
    expect(others).toStrictEqual([]);
    expect(m.splitByFavourite([{ id: 'a' }], undefined)).toStrictEqual({ favourites: [], others: [{ id: 'a' }] });
    expect(m.splitByFavourite(undefined, ['a'])).toStrictEqual({ favourites: [], others: [] });
  });

  // ── Added: favouriteGroups ─────────────────────────────────────────────────

  test('favouriteGroups: no starred supplier in view = one group with no heading', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(m.favouriteGroups(rows, [])).toStrictEqual([{ headingKey: null, suppliers: rows }]);
    expect(m.favouriteGroups(rows, ['gone'])).toStrictEqual([{ headingKey: null, suppliers: rows }]);
    expect(m.favouriteGroups([], ['a'])).toStrictEqual([{ headingKey: null, suppliers: [] }]);
    expect(m.favouriteGroups(undefined, undefined)).toStrictEqual([{ headingKey: null, suppliers: [] }]);
  });

  test('favouriteGroups: the starred first, then the others, each under its heading KEY', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(m.favouriteGroups(rows, ['c'])).toStrictEqual([
      { headingKey: 'orders.favourites.title', suppliers: [{ id: 'c' }] },
      { headingKey: 'orders.favourites.others', suppliers: [{ id: 'a' }, { id: 'b' }] },
    ]);
  });

  test('favouriteGroups: when every supplier in view is starred there is no «others» group', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    expect(m.favouriteGroups(rows, ['b', 'a'])).toStrictEqual([
      { headingKey: 'orders.favourites.title', suppliers: rows },
    ]);
  });
});
