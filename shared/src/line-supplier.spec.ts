// «Ordina da un altro fornitore» — one draft line ordered from ANOTHER supplier, for this order only (P15), run
// against BOTH implementations: the TypeScript port in shared/ and js/orders/line-supplier.js, which the live app
// uses today. Ported from tests/line-supplier.test.mjs; the module is a FULL port, so parity.spec.ts also
// compares its exports. Each implementation is run with its OWN no-supplier, archive and order-text (the port's
// with the port's, js/ with js/); the port's `orderSuppliers` is handed the pseudo-supplier's word.
//
// PORTED: 15 of 27 tests of tests/line-supplier.test.mjs — the helper (3), the lens (5), the archive test of the
// other supplier's record, but only its ingredientsOf / supplierHasItems half (1), «start again» (1), the delta
// writer (4: the override travels, an ordinary line keeps {qty, stock}, the two stored-leftover cases), and the
// message (1).
//
// NOT PORTED (12): the half of the archive test that builds the record (buildSupplierArchive) and the same-day
// merge (mergeArchives) — slice 3f-2; the six «Da riordinare» tests (stillToReorder, applyReorder: deliveries.js);
// and the five tests that read the source text of the current app's screens or its dictionary. The cases of
// tests/draft-override.test.mjs all drive draft.js through a recording stub of the data layer, so none is ported.
//
// What must never break:
//   - the line is in ONE supplier's order, never two and never none;
//   - the override only exists while the line has a quantity, and every write that takes the quantity away
//     takes the key away in the same write;
//   - a supplier that is gone or switched off never makes the line vanish.

import { describe, expect, test } from 'vitest';
import * as ported from './line-supplier';
import * as portedNoSupplier from './no-supplier';
import * as portedArchive from './archive';
import * as portedOrderText from './order-text';
import * as legacyJs from '../../js/orders/line-supplier.js';
import * as legacyNoSupplierJs from '../../js/orders/no-supplier.js';
import * as legacyArchiveJs from '../../js/orders/archive.js';
import * as legacyOrderTextJs from '../../js/orders/order-text.js';

const legacy = legacyJs as unknown as typeof ported;

interface Lens {
  resolveSuppliers: typeof portedNoSupplier.resolveSuppliers;
  orderSuppliers(active: readonly unknown[], resolved: readonly unknown[]): { id?: string }[];
}
const legacyNoSupplier = legacyNoSupplierJs as unknown as Lens & { NO_SUPPLIER_ID: string };
const portedLens: Lens = {
  resolveSuppliers: portedNoSupplier.resolveSuppliers,
  orderSuppliers: (active, resolved) => portedNoSupplier.orderSuppliers(active, resolved, 'No supplier') as { id?: string }[],
};

const NO_SUPPLIER_ID = 'no-supplier';
const ALDO = { id: 'aldo', name: 'Aldo Legacy Foods Ltd', shortName: 'Aldo' };
const BRUNO = { id: 'bruno', name: 'Bruno Wholesale Ltd', shortName: 'Bruno' };
const SUPPLIERS = [ALDO, BRUNO];
const FLOUR = { id: 'flour', name: 'Flour Invoice Name', weight: '25kg', supplierId: 'aldo' };
const YEAST = { id: 'yeast', name: 'Yeast', supplierId: 'aldo' };
const INGREDIENTS = [FLOUR, YEAST];
const ENTRIES = { flour: { qty: 4, stock: 0, supplierId: 'bruno' } };

describe.each([
  ['shared/ (TypeScript)', ported, portedLens, portedArchive, portedOrderText],
  ['js/ (current app)', legacy, legacyNoSupplier, legacyArchiveJs as unknown as typeof portedArchive, legacyOrderTextJs as unknown as typeof portedOrderText],
] as const)('%s', (_name, m, ns, archive, orderText) => {
  const { cleanSupplierId, overrideOf, lineSupplierId, withLineSuppliers, overrideSignature } = m;
  const { resolveSuppliers, orderSuppliers } = ns;
  const { ingredientsOf, supplierHasItems, quantityPathsFor, changedEntries } = archive;

  // ── The helper ─────────────────────────────────────────────────────────────

  test('a line goes to its override while it has a quantity, else to its usual supplier', () => {
    expect(lineSupplierId(FLOUR, { qty: 3, supplierId: 'bruno' })).toBe('bruno');
    expect(lineSupplierId(FLOUR, { qty: 3 })).toBe('aldo');
    expect(lineSupplierId(FLOUR, undefined)).toBe('aldo');
    expect(lineSupplierId(FLOUR, { qty: 0, supplierId: 'bruno' }), 'no quantity, no override').toBe('aldo');
    expect(lineSupplierId(FLOUR, { qty: '', supplierId: 'bruno' })).toBe('aldo');
    expect(lineSupplierId(FLOUR, { qty: 0.4, supplierId: 'bruno' }), 'rounds to nothing, like the rows do').toBe('aldo');
  });

  test('an empty or blank override reads as «no override» — how a cleared key travels in a merge write', () => {
    expect(lineSupplierId(FLOUR, { qty: 3, supplierId: '' })).toBe('aldo');
    expect(lineSupplierId(FLOUR, { qty: 3, supplierId: '   ' })).toBe('aldo');
    expect(lineSupplierId(FLOUR, { qty: 3, supplierId: null })).toBe('aldo');
    expect(lineSupplierId(FLOUR, { qty: 3, supplierId: 7 }), 'only a string counts').toBe('aldo');
    expect(cleanSupplierId(' bruno ')).toBe('bruno');
    expect(overrideOf({ qty: 2, supplierId: 'bruno' })).toBe('bruno');
    expect(overrideOf({ qty: 0, supplierId: 'bruno' })).toBe('');
  });

  test('overrideSignature changes when a line moves, never when only a number is typed', () => {
    const a = { flour: { qty: 3, supplierId: 'bruno' }, yeast: { qty: 1 } };
    expect(overrideSignature(a)).toBe('flour>bruno');
    expect(overrideSignature({ ...a, flour: { qty: 9, supplierId: 'bruno' } })).toBe('flour>bruno');
    expect(overrideSignature({ ...a, flour: { qty: 0, supplierId: 'bruno' } })).toBe('');
    expect(overrideSignature({})).toBe('');
    expect(overrideSignature(undefined)).toBe('');
  });

  // ── The lens: ONE place decides whose line a line is ───────────────────────

  test('the lens files an overridden line under the other supplier and remembers the usual one', () => {
    const lens = resolveSuppliers(INGREDIENTS, SUPPLIERS, true, ENTRIES) as Record<string, unknown>[];
    const flour = lens.find(i => i.id === 'flour');
    expect(flour?.supplierId).toBe('bruno');
    expect(flour?.usualSupplierId).toBe('aldo');
    expect(lens.find(i => i.id === 'yeast')?.supplierId).toBe('aldo');
    expect(lens.find(i => i.id === 'yeast')?.usualSupplierId).toBe(undefined);
    expect(FLOUR.supplierId, 'the ingredient itself is never changed').toBe('aldo');
  });

  test('without the draft the lens is exactly what it was: every ingredient with its usual supplier', () => {
    const lens = resolveSuppliers(INGREDIENTS, SUPPLIERS, true) as Record<string, unknown>[];
    expect(lens.map(i => i.supplierId)).toStrictEqual(['aldo', 'aldo']);
    expect(resolveSuppliers(INGREDIENTS, SUPPLIERS, false, ENTRIES), 'untouched until suppliers load').toBe(INGREDIENTS);
  });

  test('an override to a supplier that is gone, switched off or the pseudo one falls back — the line never vanishes', () => {
    const cases = {
      deleted: [ALDO],
      off: [ALDO, { ...BRUNO, active: false }],
    };
    for (const [label, suppliers] of Object.entries(cases)) {
      const lens = resolveSuppliers(INGREDIENTS, suppliers, true, ENTRIES) as Record<string, unknown>[];
      expect(lens.find(i => i.id === 'flour')?.supplierId, `${label}: back with Aldo`).toBe('aldo');
      expect(supplierHasItems('aldo', lens, ENTRIES), `${label}: still ordered from Aldo`).toBe(true);
    }
    const pseudo = resolveSuppliers(INGREDIENTS, SUPPLIERS, true, { flour: { qty: 4, supplierId: NO_SUPPLIER_ID } }) as Record<string, unknown>[];
    expect(pseudo.find(i => i.id === 'flour')?.supplierId).toBe('aldo');
    expect((withLineSuppliers(INGREDIENTS, ENTRIES, []) as Record<string, unknown>[]).find(i => i.id === 'flour')?.supplierId).toBe('aldo');
  });

  test('an override that names the usual supplier changes nothing', () => {
    const lens = resolveSuppliers(INGREDIENTS, SUPPLIERS, true, { flour: { qty: 4, supplierId: 'aldo' } }) as Record<string, unknown>[];
    expect(lens.find(i => i.id === 'flour')?.usualSupplierId).toBe(undefined);
  });

  test('a line ordered elsewhere can come from an ingredient whose own supplier is gone («No supplier»)', () => {
    const orphan = { id: 'o', name: 'Orphan', supplierId: 'deleted' };
    const lens = resolveSuppliers([orphan], SUPPLIERS, true, { o: { qty: 1, supplierId: 'bruno' } }) as Record<string, unknown>[];
    expect(lens[0]?.supplierId).toBe('bruno');
    expect(lens[0]?.usualSupplierId).toBe(NO_SUPPLIER_ID);
    const alone = resolveSuppliers([orphan], SUPPLIERS, true);
    expect(orderSuppliers(SUPPLIERS, alone).at(-1)?.id).toBe(NO_SUPPLIER_ID);
    expect(orderSuppliers(SUPPLIERS, lens).some(s => s.id === NO_SUPPLIER_ID), 'nothing is left under it').toBe(false);
  });

  // ── The archive: the line is the other supplier's, not the usual one's ─────

  test('the other supplier owns the line in the per-supplier lens', () => {
    const lens = resolveSuppliers(INGREDIENTS, SUPPLIERS, true, ENTRIES) as Record<string, unknown>[];
    expect(ingredientsOf('bruno', lens).map(i => i.id)).toStrictEqual(['flour']);
    expect(supplierHasItems('aldo', lens, { flour: ENTRIES.flour }), 'nothing left to place with Aldo').toBe(false);
    expect(supplierHasItems('bruno', lens, ENTRIES)).toBe(true);
  });

  // ── What is cleared, and when ──────────────────────────────────────────────

  test('«start again» for the other supplier clears the line AND its override; the usual supplier\'s clear does not touch it', () => {
    const lens = resolveSuppliers(INGREDIENTS, SUPPLIERS, true, ENTRIES);
    const bruno = quantityPathsFor(['bruno'], lens);
    expect(bruno).toContain('entries.flour.qty');
    expect(bruno).toContain('entries.flour.unit');
    expect(bruno, 'the override goes with the quantity').toContain('entries.flour.supplierId');
    expect(bruno).toContain('days.bruno');

    const aldo = quantityPathsFor(['aldo'], lens);
    expect(aldo.some(p => p.startsWith('entries.flour.')), 'the line is not Aldo\'s to clear').toBe(false);
    expect(aldo, 'every cleared row drops a stale override too').toContain('entries.yeast.supplierId');
  });

  // ── The delta writer: a key is sent, and sent again as '' when it goes ─────

  test('an overridden line is written with its supplier; going to zero or back writes \'\' (a merge cannot delete)', () => {
    expect(changedEntries({ flour: { qty: 4, stock: 0, supplierId: 'bruno' } }, {}))
      .toStrictEqual({ flour: { qty: 4, stock: 0, supplierId: 'bruno' } });

    const known = { flour: { qty: 4, stock: 0, supplierId: 'bruno' } };
    expect(changedEntries(known, known), 'unchanged -> nothing to say').toStrictEqual({});
    expect(changedEntries({ flour: { qty: 9, stock: 0, supplierId: 'bruno' } }, known),
      'a number typed on the other supplier\'s row keeps the override').toStrictEqual({ flour: { qty: 9, stock: 0, supplierId: 'bruno' } });
    expect(changedEntries({ flour: { qty: 0, stock: 0, supplierId: 'bruno' } }, known),
      'zero takes the key away even if memory still holds it').toStrictEqual({ flour: { qty: 0, stock: 0, supplierId: '' } });
    expect(changedEntries({ flour: { qty: 4, stock: 0, supplierId: '' } }, known),
      'typing on the usual supplier\'s row moves it back').toStrictEqual({ flour: { qty: 4, stock: 0, supplierId: '' } });
    expect(changedEntries({ flour: { qty: 0, stock: 0 } }, known),
      'a cleared row that lost the key entirely').toStrictEqual({ flour: { qty: 0, stock: 0, supplierId: '' } });
  });

  test('an ordinary line keeps exactly {qty, stock} — the key appears only when somebody used it', () => {
    expect(changedEntries({ yeast: { qty: 2, stock: 1 } }, {})).toStrictEqual({ yeast: { qty: 2, stock: 1 } });
    expect(changedEntries({ yeast: { qty: 2, stock: 1, supplierId: '' } }, { yeast: { qty: 1, stock: 1 } }))
      .toStrictEqual({ yeast: { qty: 2, stock: 1 } });
  });

  // ── «Da riordinare»: the line leaves when an order really names it ─────────

  test('a stored leftover override with no quantity is cleared by the next write (stock only)', () => {
    const known = { L: { qty: undefined, stock: 2, supplierId: 'X' } };
    expect(changedEntries({ L: { qty: 5, stock: 2, supplierId: '' } }, known))
      .toStrictEqual({ L: { qty: 5, stock: 2, supplierId: '' } });
  });

  test('«put back» over a stored {qty: 0, unit, supplierId} clears the override', () => {
    const known = { L: { qty: 0, stock: 0, unit: 'busta', supplierId: 'X' } };
    expect(changedEntries({ L: { qty: 5, stock: 0, unit: 'busta', supplierId: '' } }, known))
      .toStrictEqual({ L: { qty: 5, stock: 0, unit: 'busta', supplierId: '' } });
    expect(changedEntries({ L: { qty: 0, stock: 0, unit: 'busta', supplierId: 'X' } }, known),
      'even with nothing else changed').toStrictEqual({ L: { qty: 0, stock: 0, unit: 'busta', supplierId: '' } });
  });

  // ── The text a supplier receives ───────────────────────────────────────────

  test('the message to the other supplier carries the line under the INVOICE name; the usual supplier\'s does not', () => {
    const lens = resolveSuppliers(INGREDIENTS, SUPPLIERS, true, ENTRIES);
    const entries = { ...ENTRIES, yeast: { qty: 2, stock: 0 } };
    const itemsFor = (id: string) => orderText.orderedItems(ingredientsOf(id, lens), entries);

    const toBruno = orderText.buildOrderMessage([{ supplierName: 'Bruno', items: itemsFor('bruno') }]);
    expect(toBruno).toMatch(/Flour Invoice Name: 4/);
    expect(toBruno).not.toMatch(/Yeast/);

    const toAldo = orderText.buildOrderMessage([{ supplierName: 'Aldo', items: itemsFor('aldo') }]);
    expect(toAldo).toMatch(/Yeast: 2/);
    expect(toAldo).not.toMatch(/Flour/);
  });
});
