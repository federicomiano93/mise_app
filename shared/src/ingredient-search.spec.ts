// Unit tests for the Orders lists' text folding and supplier search (P15), run against BOTH
// implementations: the TypeScript port in shared/ and js/orders/ingredient-search.js, which the live
// app uses today. Ported from tests/ingredient-search.test.mjs; the two must stay equal until the
// switch to Mise 2.
//
// ⚠️ ingredient-search.ts is a PARTIAL port, so parity.spec.ts does not pair it: the original also
// exports letterOf, matchesQuery, flatRows, orderSummary and the other row builders, which use
// order-text and belong to the Orders list. The last describe below compares what IS ported with the
// js/ file itself (names, arity), the way price-model.spec.ts does.
//
// PORTED: 'text is compared without accents or capitals' (normalizeText) and the 7 filterSuppliers
// tests ('an empty search…', 'it matches on the supplier name…', 'it matches the category too…',
// '"no supplier" finds the pseudo-supplier…', 'accents are ignored on both sides', 'no match returns
// nothing…', 'it never hands back the caller's own array').
//
// NOT PORTED: everything else of the file's tests — the no-supplier module, letterOf, matchesQuery,
// flatRows, orderSummary, the supplier ordering and the rest of the list: those functions are the
// Orders feature's and are not in shared/. The pseudo-supplier of 'no supplier' is written out as a
// literal below, instead of importing js/orders/no-supplier.js.

import { describe, expect, test } from 'vitest';
import * as ported from './ingredient-search';
import * as legacyJs from '../../js/orders/ingredient-search.js';

const legacy = legacyJs as unknown as typeof ported;

const CIELO = { id: 'cielo', name: 'Cielo', active: true };
const ALBA = { id: 'alba', name: 'Alba', active: true };
const BORGO = { id: 'cat', name: 'Borgo', category: 'Dry goods' };
const DELTA = { id: 'con', name: 'Delta wine & food ltd.', category: 'Deli' };
const NO_SUPPLIER = { id: '__none__', name: 'No supplier', orderDays: [] };
const SUPPLIER_LIST = [CIELO, BORGO, DELTA, ALBA];

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('text is compared without accents or capitals', () => {
    expect(m.normalizeText('  Però  ')).toBe('pero');
    expect(m.normalizeText('ÀÈÌÒÙ')).toBe('aeiou');
    expect(m.normalizeText(null)).toBe('');
  });

  test('an empty search returns every supplier, in the order given', () => {
    expect(m.filterSuppliers(SUPPLIER_LIST, '').map(s => s.name)).toStrictEqual(['Cielo', 'Borgo', 'Delta wine & food ltd.', 'Alba']);
    expect(m.filterSuppliers(SUPPLIER_LIST, '   ').length).toBe(4);
  });

  test('it matches on the supplier name, part-way through and in any case', () => {
    expect(m.filterSuppliers(SUPPLIER_LIST, 'org').map(s => s.name)).toStrictEqual(['Borgo']);
    expect(m.filterSuppliers(SUPPLIER_LIST, 'ALBA').map(s => s.name)).toStrictEqual(['Alba']);
  });

  test('it matches the category too — it is written on the row, so it must be searchable', () => {
    expect(m.filterSuppliers(SUPPLIER_LIST, 'deli').map(s => s.name)).toStrictEqual(['Delta wine & food ltd.']);
  });

  test('"no supplier" finds the pseudo-supplier, as it does in the ingredient list', () => {
    expect(m.filterSuppliers([...SUPPLIER_LIST, NO_SUPPLIER], 'no supp').map(s => s.name)).toStrictEqual(['No supplier']);
  });

  test('accents are ignored on both sides', () => {
    const accented = [{ id: 'x', name: 'Però & Figli', category: '' }];
    expect(m.filterSuppliers(accented, 'pero').length).toBe(1);
    expect(m.filterSuppliers([{ id: 'y', name: 'Pero', category: '' }], 'però').length).toBe(1);
  });

  test('no match returns nothing, and rubbish input does not throw', () => {
    expect(m.filterSuppliers(SUPPLIER_LIST, 'zzz')).toStrictEqual([]);
    expect(m.filterSuppliers([], 'a')).toStrictEqual([]);
    expect(m.filterSuppliers(null, 'a')).toStrictEqual([]);
    expect(m.filterSuppliers([{ id: 'n' }], 'a'), 'a supplier with no name must not crash').toStrictEqual([]);
  });

  test("it never hands back the caller's own array", () => {
    const out = m.filterSuppliers(SUPPLIER_LIST, '');
    expect(out).not.toBe(SUPPLIER_LIST);
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('a supplier is found by its short name AND by its invoice name', () => {
    const aldo = { id: 'aldo', name: 'Aldo Legacy Foods Ltd Wholesale', shortName: 'Aldo', category: 'Dry' };
    expect(m.filterSuppliers([aldo, ALBA], 'aldo').map(s => s.id)).toStrictEqual(['aldo']);
    expect(m.filterSuppliers([aldo, ALBA], 'legacy').map(s => s.id)).toStrictEqual(['aldo']);
    expect(m.filterSuppliers([aldo, BORGO], 'dry').map(s => s.id)).toStrictEqual(['aldo', 'cat']);
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port against the original', () => {
  // The functions this port leaves out: the Orders list's rows. The original still exports them.
  const LEFT_OUT = ['letterOf', 'matchesQuery', 'flatRows', 'orderSummary'];
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;
  const shared = ['normalizeText', 'filterSuppliers'];

  test('the original still exports everything this port leaves out', () => {
    // If it did not, the exclusion above would be hiding a rename instead of a decision.
    for (const name of LEFT_OUT) expect(typeof original[name], name).toBe('function');
  });

  test('exports exactly the two functions it ports, and the original has them', () => {
    expect(Object.keys(port).sort()).toStrictEqual([...shared].sort());
    for (const name of shared) expect(typeof original[name], name).toBe('function');
  });

  test('every function has the same name and the same number of required parameters', () => {
    for (const name of shared) {
      const mine = port[name] as (...args: unknown[]) => unknown;
      const theirs = original[name] as (...args: unknown[]) => unknown;
      expect(mine.name, name).toBe(theirs.name);
      expect(mine.length, `${name}: arity`).toBe(theirs.length);
    }
  });
});
