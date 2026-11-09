// Unit tests for the Orders lists' text folding, supplier search and the "All ingredients" rows (P15), run against
// BOTH implementations: the TypeScript port in shared/ and js/orders/ingredient-search.js, which the live app uses
// today. Ported from tests/ingredient-search.test.mjs; the module is a FULL port since step 3f-1, so
// parity.spec.ts also compares its exports.
//
// PORTED: 31 of 38 tests of tests/ingredient-search.test.mjs — every ingredient-search one (normalizeText,
// letterOf, matchesQuery, the 7 filterSuppliers ones, flatRows, the filter, orderSummary).
//
// NOT PORTED HERE: the 7 «no-supplier» tests at the top of that file. They are ported in no-supplier.spec.ts,
// where the adapted port lives; the pseudo-supplier's name is handed in as a word, so these tests pass it too.
// The lens (`resolveSuppliers` / `orderSuppliers`) is used below with each implementation's OWN no-supplier, the
// port's with the port's ingredient-search and js/ with js/.

import { describe, expect, test } from 'vitest';
import * as ported from './ingredient-search';
import * as portedNoSupplier from './no-supplier';
import * as legacyJs from '../../js/orders/ingredient-search.js';
import * as legacyNoSupplierJs from '../../js/orders/no-supplier.js';

const legacy = legacyJs as unknown as typeof ported;
const legacyNoSupplier = legacyNoSupplierJs as unknown as typeof portedNoSupplier;

const NO_SUPPLIER_ID = 'no-supplier';
const ALBA = { id: 'alba', name: 'Alba', active: true };
const CIELO = { id: 'cielo', name: 'Cielo', active: true };
const SUPPLIERS = [CIELO, ALBA];

const BACON = { id: 'bacon', name: 'Bacon', weight: '2.27kg', brand: 'Denny', supplierId: 'cielo' };
const MOZZARELLA = { id: 'mozza', name: 'Mozzarella', weight: '5kg', supplierId: 'alba' };
const ALMONDS = { id: 'almonds', name: 'Almond Flakes', weight: '1kg', supplierId: 'alba' };
const PAPER = { id: 'paper', name: 'Baking Paper', supplierId: NO_SUPPLIER_ID };
const GONE = { id: 'gone', name: 'Ghost Item', supplierId: 'deleted-supplier' };
const RETIRED = { id: 'retired', name: 'Old Stock', supplierId: 'alba', active: false };
const ALL = [BACON, MOZZARELLA, ALMONDS, PAPER, GONE, RETIRED];

const BORGO = { id: 'cat', name: 'Borgo', category: 'Dry goods' };
const DELTA = { id: 'con', name: 'Delta wine & food ltd.', category: 'Deli' };
const NO_SUPPLIER = { id: '__none__', name: 'No supplier', orderDays: [] };
const SUPPLIER_LIST = [CIELO, BORGO, DELTA, ALBA];

describe.each([
  ['shared/ (TypeScript)', ported, portedNoSupplier],
  ['js/ (current app)', legacy, legacyNoSupplier],
] as const)('%s', (_name, m, ns) => {
  const lens = (ingredients: unknown[]) => ns.resolveSuppliers(ingredients, SUPPLIERS, true);
  const withNone = (ingredients: unknown[]) => ns.orderSuppliers([CIELO, ALBA], lens(ingredients), 'No supplier');

  test('text is compared without accents or capitals', () => {
    expect(m.normalizeText('  Però  ')).toBe('pero');
    expect(m.normalizeText('ÀÈÌÒÙ')).toBe('aeiou');
    expect(m.normalizeText(null)).toBe('');
  });

  test('a row is filed under its first letter; anything else under #', () => {
    expect(m.letterOf('Bacon 2.27kg')).toBe('B');
    expect(m.letterOf('Èspresso')).toBe('E');
    expect(m.letterOf('00 Flour')).toBe('#');
    expect(m.letterOf('')).toBe('#');
  });

  // ── matchesQuery ───────────────────────────────────────────────────────────

  const ROW = { label: 'Bacon 2.27kg', ingredient: { brand: 'Denny' }, supplierName: 'Cielo' };

  test('an empty search matches everything', () => {
    expect(m.matchesQuery(ROW, '')).toBe(true);
    expect(m.matchesQuery(ROW, '   ')).toBe(true);
  });

  test('the search looks at name, weight, brand and supplier', () => {
    expect(m.matchesQuery(ROW, 'bac')).toBe(true);       // name
    expect(m.matchesQuery(ROW, '2.27')).toBe(true);      // weight, part of the label
    expect(m.matchesQuery(ROW, 'denny')).toBe(true);     // brand
    expect(m.matchesQuery(ROW, 'CIELO')).toBe(true);     // supplier, any case
    expect(m.matchesQuery(ROW, 'alba')).toBe(false);
  });

  // ── filterSuppliers ────────────────────────────────────────────────────────

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

  // ── flatRows ───────────────────────────────────────────────────────────────

  function rowsFor(query: string) {
    const ingredients = lens(ALL);
    return m.flatRows({ ingredients, suppliers: withNone(ALL), query });
  }

  test('every orderable ingredient, A→Z by the label the operator reads', () => {
    const { rows, total } = rowsFor('');
    expect(rows.map(r => r.label)).toStrictEqual([
      'Almond Flakes 1kg', 'Bacon 2.27kg', 'Baking Paper', 'Ghost Item', 'Mozzarella 5kg',
    ]);
    expect(total).toBe(5);   // "Old Stock" is deactivated and does not count
  });

  test('a deactivated ingredient is left out entirely', () => {
    expect(rowsFor('').rows.some(r => r.ingredient.id === 'retired')).toBe(false);
    expect(rowsFor('old stock').rows.length).toBe(0);
  });

  test('an ingredient of a DEACTIVATED supplier is hidden, exactly as on the cards', () => {
    const ingredients = lens([BACON, MOZZARELLA]);
    const { rows, total } = m.flatRows({ ingredients, suppliers: [ALBA], query: '' });
    expect(rows.map(r => r.label)).toStrictEqual(['Mozzarella 5kg']);
    expect(total).toBe(1);
  });

  test('the letter is carried by the FIRST row of each run only', () => {
    expect(rowsFor('').rows.map(r => r.letter)).toStrictEqual(['A', 'B', '', 'G', 'M']);
  });

  test('the letters follow the SEARCH, they are not a stale copy of the full list', () => {
    expect(rowsFor('mozz').rows.map(r => r.letter)).toStrictEqual(['M']);
  });

  test('searching a supplier name lists what is bought from them', () => {
    expect(rowsFor('alba').rows.map(r => r.label)).toStrictEqual(['Almond Flakes 1kg', 'Mozzarella 5kg']);
  });

  test('searching "no supplier" lists what is bought without one', () => {
    expect(rowsFor('no supplier').rows.map(r => r.label)).toStrictEqual(['Baking Paper', 'Ghost Item']);
  });

  test('the counter has both halves: what is shown and what exists', () => {
    const { rows, total } = rowsFor('bak');
    expect(rows.map(r => r.label)).toStrictEqual(['Baking Paper']);
    expect(total).toBe(5);
  });

  test('each row carries the supplier it is filed under, for the line under the name', () => {
    const byId = Object.fromEntries(rowsFor('').rows.map(r => [r.ingredient.id, r.supplierName]));
    expect(byId.bacon).toBe('Cielo');
    expect(byId.paper).toBe('No supplier');
    expect(byId.gone).toBe('No supplier');
  });

  test('nothing at all does not throw', () => {
    expect(m.flatRows({ ingredients: [], suppliers: [], query: '' })).toStrictEqual({ rows: [], total: 0 });
    expect(m.flatRows({})).toStrictEqual({ rows: [], total: 0 });
  });

  // ── The "just what I'm ordering" filter ────────────────────────────────────

  function filtered(only: Set<string>, query = '') {
    return m.flatRows({ ingredients: lens(ALL), suppliers: withNone(ALL), query, only });
  }

  test('the filter narrows the list to the given ids, and the total still counts all', () => {
    const { rows, total } = filtered(new Set(['bacon', 'paper']));
    expect(rows.map(r => r.label)).toStrictEqual(['Bacon 2.27kg', 'Baking Paper']);
    expect(total, 'the "All (N)" button must still say how many there are').toBe(5);
  });

  test('the search combines with the filter instead of replacing it', () => {
    const only = new Set(['bacon', 'paper', 'mozza']);
    expect(filtered(only, 'bak').rows.map(r => r.label)).toStrictEqual(['Baking Paper']);
    expect(filtered(only, 'alba').rows.map(r => r.label)).toStrictEqual(['Mozzarella 5kg']);
  });

  test('an id in the filter that no longer exists is simply not shown', () => {
    const { rows } = filtered(new Set(['bacon', 'deleted-since']));
    expect(rows.map(r => r.label)).toStrictEqual(['Bacon 2.27kg']);
  });

  test('the letters follow the filtered list too', () => {
    expect(filtered(new Set(['mozza', 'paper'])).rows.map(r => r.letter)).toStrictEqual(['B', 'M']);
  });

  // ── orderSummary ───────────────────────────────────────────────────────────

  function summaryFor(entries: unknown) {
    return m.orderSummary({ ingredients: lens(ALL), suppliers: withNone(ALL), entries });
  }

  test('the summary counts the items and the suppliers behind them', () => {
    const s = summaryFor({ bacon: { qty: 4 }, mozza: { qty: 2 }, almonds: { qty: 1 } });
    expect(s.itemCount).toBe(3);
    expect(s.supplierCount, 'Almonds and Mozzarella are both Alba').toBe(2);
    expect(s.ids.slice().sort()).toStrictEqual(['almonds', 'bacon', 'mozza']);
  });

  test('No supplier counts as a supplier of its own in the summary', () => {
    const s = summaryFor({ bacon: { qty: 1 }, paper: { qty: 2 } });
    expect(s.itemCount).toBe(2);
    expect(s.supplierCount).toBe(2);
  });

  test('stock without an order is not part of the order', () => {
    expect(summaryFor({ bacon: { qty: 0, stock: 9 }, mozza: { stock: 3 } })).toStrictEqual({ itemCount: 0, supplierCount: 0, ids: [] });
  });

  test('a corrupt stored quantity counts as nothing, never as NaN', () => {
    ['HELLO', null, undefined, -3, Infinity, NaN, ''].forEach(bad => {
      expect(summaryFor({ bacon: { qty: bad } }).itemCount, `quantity ${String(bad)} must not count`).toBe(0);
    });
    expect(summaryFor({ bacon: { qty: '4' } }).itemCount, 'a numeric string still counts').toBe(1);
  });

  test('a deactivated ingredient, or one of a hidden supplier, is out of the summary', () => {
    expect(summaryFor({ retired: { qty: 5 } }).itemCount).toBe(0);

    const ingredients = lens([BACON, MOZZARELLA]);
    const s = m.orderSummary({ ingredients, suppliers: [ALBA], entries: { bacon: { qty: 4 }, mozza: { qty: 1 } } });
    expect(s.ids, 'Cielo is not in the supplier list, so Bacon is not orderable').toStrictEqual(['mozza']);
  });

  test('an empty order summarises to zero without throwing', () => {
    expect(summaryFor({})).toStrictEqual({ itemCount: 0, supplierCount: 0, ids: [] });
    expect(m.orderSummary({})).toStrictEqual({ itemCount: 0, supplierCount: 0, ids: [] });
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('a supplier is found by its short name AND by its invoice name', () => {
    const aldo = { id: 'aldo', name: 'Aldo Legacy Foods Ltd Wholesale', shortName: 'Aldo', category: 'Dry' };
    expect(m.filterSuppliers([aldo, ALBA], 'aldo').map(s => s.id)).toStrictEqual(['aldo']);
    expect(m.filterSuppliers([aldo, ALBA], 'legacy').map(s => s.id)).toStrictEqual(['aldo']);
    expect(m.filterSuppliers([aldo, BORGO], 'dry').map(s => s.id)).toStrictEqual(['aldo', 'cat']);
  });
});
