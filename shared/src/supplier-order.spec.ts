// The order the suppliers are listed in on the Orders main screen (config/orders.supplierOrder) (P15), run against
// BOTH implementations: the TypeScript port in shared/ and js/orders/supplier-order.js, which the live app uses
// today. Ported from tests/supplier-order.test.mjs; the module is a FULL port, so parity.spec.ts also compares its
// exports.
//
// PORTED: 7 of 14 tests of tests/supplier-order.test.mjs (the three normalizeSupplierOrder ones and the four
// sortSuppliersByOrder ones). The eighth pure one, 'normalizeOrdersConfig carries supplierOrder, empty by
// default', is ported in orders-config.spec.ts, where normalizeOrdersConfig lives.
//
// NOT PORTED: the six tests that read the source text of orders-main.js, management.js, supplier-order-screen.js
// and i18n.js (the wiring of the current app's screens and its dictionary): they test files that are not in
// shared/.

import { describe, expect, test } from 'vitest';
import * as ported from './supplier-order';
import * as legacyJs from '../../js/orders/supplier-order.js';

const legacy = legacyJs as unknown as typeof ported;

const labelOf = (s: { name: string }): string => s.name;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('normalizeSupplierOrder: anything that is not an array is empty', () => {
    for (const v of [undefined, null, 'a', 5, {}, true]) expect(m.normalizeSupplierOrder(v)).toStrictEqual([]);
  });

  test('normalizeSupplierOrder: drops duplicates, empties and non-strings, keeps first position', () => {
    expect(m.normalizeSupplierOrder(['b', 'a', 'b', '', 3, null, 'c', 'a'])).toStrictEqual(['b', 'a', 'c']);
  });

  test('normalizeSupplierOrder: caps the id length and the number of entries', () => {
    expect(m.normalizeSupplierOrder(['x'.repeat(201), 'ok'])).toStrictEqual(['ok']);
    expect(m.normalizeSupplierOrder(['x'.repeat(200)]).length).toBe(1);
    const many = Array.from({ length: 400 }, (_, i) => `id${i}`);
    expect(m.normalizeSupplierOrder(many).length).toBe(300);
  });

  test('sortSuppliersByOrder: stored order first, new suppliers alphabetical after', () => {
    const s = [
      { id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' },
      { id: 'z', name: 'Zulu' }, { id: 'm', name: 'Mike' }, { id: 'c', name: 'Charlie' },
    ];
    const out = m.sortSuppliersByOrder(s, ['z', 'a'], labelOf).map(x => x.id);
    expect(out).toStrictEqual(['z', 'a', 'b', 'c', 'm']);
  });

  test('sortSuppliersByOrder: ids that match no supplier are ignored', () => {
    const s = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];
    expect(m.sortSuppliersByOrder(s, ['ghost', 'b', 'a'], labelOf).map(x => x.id)).toStrictEqual(['b', 'a']);
  });

  test('sortSuppliersByOrder: an empty or missing order is alphabetical', () => {
    const s = [{ id: 'b', name: 'Beta' }, { id: 'a', name: 'Alpha' }];
    for (const order of [[], undefined, null, 'junk']) {
      expect(m.sortSuppliersByOrder(s, order, labelOf).map(x => x.id)).toStrictEqual(['a', 'b']);
    }
  });

  test('sortSuppliersByOrder: does not mutate its input', () => {
    const s = [{ id: 'b', name: 'Beta' }, { id: 'a', name: 'Alpha' }];
    const order = ['b'];
    const out = m.sortSuppliersByOrder(s, order, labelOf);
    expect(out).not.toBe(s);
    expect(s.map(x => x.id)).toStrictEqual(['b', 'a']);
    expect(order).toStrictEqual(['b']);
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('sortSuppliersByOrder: a list that is not an array is an empty list', () => {
    expect(m.sortSuppliersByOrder(null as unknown as { id: string; name: string }[], ['a'], labelOf)).toStrictEqual([]);
    expect(m.sortSuppliersByOrder('abc' as unknown as { id: string; name: string }[], ['a'], labelOf)).toStrictEqual([]);
  });
});
