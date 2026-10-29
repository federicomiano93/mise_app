// Unit tests for the pseudo-supplier of things bought without one (P15). Ported from the «no-supplier» tests at
// the top of tests/ingredient-search.test.mjs.
//
// no-supplier.ts is an ADAPTED port, so parity.spec.ts does not pair it: the original names the pseudo-supplier
// with `t('orders.noSupplier')`, the port is handed that word (`noSupplier(name)` and the last argument of
// `orderSuppliers`). Here each case runs for the original as it is, after `setLanguage(...)`, and for the port
// with the original's own `t('orders.noSupplier')` handed in — and both must give the same answer, in both
// languages. `NO_SUPPLIER` (the constant the original builds at import) is left out of the port; its test is
// ported as a test of `noSupplier(name)`.
//
// PORTED: 7 of 7 of the no-supplier tests of tests/ingredient-search.test.mjs. tests/line-supplier.test.mjs
// (the lens with the draft) is ported in line-supplier.spec.ts.

import { describe, expect, test } from 'vitest';
import * as ported from './no-supplier';
import * as legacyJs from '../../js/orders/no-supplier.js';
import { DEFAULT_LANGUAGE, setLanguage, t } from '../../js/i18n.js';

const ALBA = { id: 'alba', name: 'Alba', active: true };
const CIELO = { id: 'cielo', name: 'Cielo', active: true };
const SUPPLIERS = [CIELO, ALBA];

const BACON = { id: 'bacon', name: 'Bacon', weight: '2.27kg', brand: 'Denny', supplierId: 'cielo' };
const MOZZARELLA = { id: 'mozza', name: 'Mozzarella', weight: '5kg', supplierId: 'alba' };
const PAPER = { id: 'paper', name: 'Baking Paper', supplierId: ported.NO_SUPPLIER_ID };
const GONE = { id: 'gone', name: 'Ghost Item', supplierId: 'deleted-supplier' };

interface Impl {
  readonly NO_SUPPLIER_ID: string;
  isNoSupplier(id: unknown): boolean;
  noSupplier(): ported.PseudoSupplier;
  resolveSuppliers: typeof ported.resolveSuppliers;
  orderSuppliers(active: readonly unknown[], resolved: readonly unknown[]): unknown[];
}

const legacyApi = legacyJs as unknown as {
  NO_SUPPLIER_ID: string;
  isNoSupplier(id: unknown): boolean;
  noSupplier(): ported.PseudoSupplier;
  resolveSuppliers: typeof ported.resolveSuppliers;
  orderSuppliers(active: readonly unknown[], resolved: readonly unknown[]): unknown[];
};

const IMPLS: ReadonlyArray<readonly [string, Impl]> = [
  ['shared/ (TypeScript)', {
    NO_SUPPLIER_ID: ported.NO_SUPPLIER_ID,
    isNoSupplier: ported.isNoSupplier,
    noSupplier: () => ported.noSupplier(t('orders.noSupplier')),
    resolveSuppliers: ported.resolveSuppliers,
    orderSuppliers: (active, resolved) => ported.orderSuppliers(active, resolved, t('orders.noSupplier')),
  }],
  ['js/ (current app)', legacyApi],
];

function inLanguage<T>(lang: string, fn: () => T): T {
  setLanguage(lang);
  try { return fn(); } finally { setLanguage(DEFAULT_LANGUAGE); }
}

describe.each(IMPLS)('%s', (_name, m) => {
  // ── no-supplier: where an ingredient belongs ───────────────────────────────

  test('the pseudo-supplier has no order days, so it never joins "order today"', () => {
    const none = m.noSupplier();
    expect(none.id).toBe(m.NO_SUPPLIER_ID);
    expect(none.name).toBe('No supplier');
    expect(none.orderDays).toStrictEqual([]);
    expect(m.isNoSupplier(m.NO_SUPPLIER_ID)).toBeTruthy();
    expect(m.isNoSupplier('alba')).toBeFalsy();
  });

  test('an ingredient whose supplier was DELETED is filed under No supplier', () => {
    const resolved = m.resolveSuppliers([BACON, GONE], SUPPLIERS, true);
    expect(resolved.find(i => i.id === 'bacon')?.supplierId).toBe('cielo');
    expect(resolved.find(i => i.id === 'gone')?.supplierId).toBe(m.NO_SUPPLIER_ID);
  });

  test('an ingredient saved WITHOUT a supplier stays under No supplier', () => {
    const resolved = m.resolveSuppliers([PAPER], SUPPLIERS, true);
    expect(resolved[0]?.supplierId).toBe(m.NO_SUPPLIER_ID);
  });

  // The trap: suppliers and ingredients arrive in separate Firestore snapshots.
  test('nothing is reclassified until the suppliers have actually arrived', () => {
    const resolved = m.resolveSuppliers([BACON, MOZZARELLA], [], false);
    expect(resolved.map(i => i.supplierId)).toStrictEqual(['cielo', 'alba']);
    // …and the stored objects are handed back untouched, not copied and rewritten.
    expect(resolved[0]).toBe(BACON);
  });

  test('resolving never mutates the stored ingredient', () => {
    const resolved = m.resolveSuppliers([GONE], SUPPLIERS, true);
    expect(GONE.supplierId).toBe('deleted-supplier');
    expect(resolved[0]).not.toBe(GONE);
  });

  test('No supplier appears only when something is filed under it, and always last', () => {
    const withNone = m.orderSuppliers([CIELO, ALBA], m.resolveSuppliers([BACON, PAPER], SUPPLIERS, true));
    expect(withNone.map(s => (s as { name: string }).name)).toStrictEqual(['Cielo', 'Alba', 'No supplier']);

    const withoutNone = m.orderSuppliers([CIELO, ALBA], m.resolveSuppliers([BACON], SUPPLIERS, true));
    expect(withoutNone.map(s => (s as { name: string }).name)).toStrictEqual(['Cielo', 'Alba']);
  });

  test('a DEACTIVATED no-supplier ingredient does not conjure up the card', () => {
    const hidden = { id: 'hidden', name: 'Hidden', supplierId: m.NO_SUPPLIER_ID, active: false };
    expect(m.orderSuppliers([ALBA], [hidden]).map(s => (s as { name: string }).name)).toStrictEqual(['Alba']);
  });
});

describe('the port against the original', () => {
  const mine = IMPLS[0]![1];
  const theirs = IMPLS[1]![1];

  test('the pseudo-supplier is the same object, field for field, in each language', () => {
    for (const lang of ['en', 'it']) {
      inLanguage(lang, () => {
        expect(mine.noSupplier(), lang).toStrictEqual(theirs.noSupplier());
        expect(Object.isFrozen(mine.noSupplier()), lang).toBe(true);
        expect(Object.isFrozen(mine.noSupplier().orderDays), lang).toBe(Object.isFrozen(theirs.noSupplier().orderDays));
        expect(Object.isFrozen(mine.noSupplier().deliveryDays), lang).toBe(Object.isFrozen(theirs.noSupplier().deliveryDays));
      });
    }
  });

  test('the list of order suppliers, with and without the leftovers bucket, is the same in each language', () => {
    const lensMine = mine.resolveSuppliers([BACON, PAPER, GONE], SUPPLIERS, true);
    const lensTheirs = theirs.resolveSuppliers([BACON, PAPER, GONE], SUPPLIERS, true);
    for (const lang of ['en', 'it']) {
      inLanguage(lang, () => {
        expect(mine.orderSuppliers(SUPPLIERS, lensMine), lang).toStrictEqual(theirs.orderSuppliers(SUPPLIERS, lensTheirs));
        expect(mine.orderSuppliers(SUPPLIERS, []), lang).toStrictEqual(theirs.orderSuppliers(SUPPLIERS, []));
        expect(mine.orderSuppliers(null as unknown as [], null as unknown as []), lang).toStrictEqual(
          theirs.orderSuppliers(null as unknown as [], null as unknown as []));
      });
    }
    expect(inLanguage('it', () => mine.noSupplier().name)).not.toBe(inLanguage('en', () => mine.noSupplier().name));
  });

  test('exports the original\'s names, but for the constant built at import', () => {
    const originalNames = Object.keys(legacyJs).filter(name => name !== 'NO_SUPPLIER').sort();
    expect(Object.keys(ported).sort()).toStrictEqual(originalNames);
    expect('NO_SUPPLIER' in legacyJs).toBe(true);
  });
});
