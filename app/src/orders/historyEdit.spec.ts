// Correcting a recorded order (historyEdit.ts, parity H12): the editor's rows, the record a correction writes, and the check
// that refuses to overwrite a record that changed since the editor opened it (difference E1 of 3f-4). The record and the
// rows follow the current app's js/orders/history-edit.js; its cases are in tests/same-day-sends.test.mjs («a correction is
// added only to a record that already keeps sends»).

import { describe, expect, it } from 'vitest';
import { correctedRecord, editRows, sameOrder } from './historyEdit';

const AT = '2026-10-27T15:20:00.000Z';
const BY_ID = {
  flour25: { id: 'flour25', name: 'Farina', weight: '25kg', unit: 'sacco' },
  flour5: { id: 'flour5', name: 'Farina', weight: '5kg' },
  yeast: { id: 'yeast', name: 'Lievito', unit: 'cartone', packUnit: 'busta', packCount: 4 },
};

const RECORD = {
  id: '2026-10-27_mill',
  bakery: 'bakery',
  date: '2026-10-27', supplierId: 'mill', supplierName: 'Mill',
  quantities: { flour25: 2, flour5: 1, yeast: 3, gone: 4 },
  stock: { flour25: 1, yeast: 0 },
  names: { gone: 'Ricotta 1.5kg', flour25: 'Farina 25kg' },
  units: { yeast: 'busta', gone: 'kg' },
  sends: { s20261027090000000: { at: '2026-10-27T09:00:00.000Z', quantities: { flour25: 2, flour5: 1, yeast: 3, gone: 4 } } },
  createdAt: '2026-10-27T09:00:00.000Z', updatedAt: '2026-10-27T09:00:00.000Z',
  deliveredAt: '', missing: { yeast: true },
};

describe('editRows', () => {
  it('one row per ordered line, with the live name, then the frozen one, then the word handed in; sorted numerically', () => {
    const rows = editRows({ ...RECORD, names: { gone: 'Ricotta 1.5kg' }, quantities: { ...RECORD.quantities, lost: 1, zero: 0 } }, BY_ID, 'Deleted ingredient');
    expect(rows.map(r => r.name)).toStrictEqual(['Deleted ingredient', 'Farina 5kg', 'Farina 25kg', 'Lievito', 'Ricotta 1.5kg']);
    expect(rows.find(r => r.id === 'yeast')).toStrictEqual({ id: 'yeast', name: 'Lievito', unit: 'busta', qty: 3, stock: 0 });
    expect(rows.find(r => r.id === 'flour25')).toMatchObject({ unit: 'sacco', qty: 2, stock: 1 });
  });

  it('a record with nothing ordered, or odd maps, has no rows', () => {
    expect(editRows({}, BY_ID, 'x')).toStrictEqual([]);
    expect(editRows({ quantities: 'abc', stock: null }, BY_ID, 'x')).toStrictEqual([]);
  });
});

describe('correctedRecord', () => {
  it('keeps every other field (the delivery answer too), drops the id and the venue stamp, and adds the correction to the sends', () => {
    const next = correctedRecord(RECORD, { qty: { flour25: 3, flour5: 1, yeast: 2, gone: 4 }, stock: { flour25: 0, yeast: 1 } }, AT)!;
    expect(next).not.toHaveProperty('id');
    expect(next).not.toHaveProperty('bakery');
    expect(next).toMatchObject({
      date: '2026-10-27', supplierId: 'mill', supplierName: 'Mill', names: RECORD.names, createdAt: RECORD.createdAt,
      deliveredAt: '', missing: { yeast: true },
      quantities: { flour25: 3, flour5: 1, yeast: 2, gone: 4 },
      stock: { flour25: 0, flour5: 0, yeast: 1, gone: 0 },
      units: { yeast: 'busta', gone: 'kg' },
      updatedAt: AT,
    });
    const sends = next.sends as Record<string, { kind?: string; at: string; quantities: Record<string, number> }>;
    expect(Object.keys(sends)).toHaveLength(2);
    expect(sends.s20261027152000000).toStrictEqual({
      at: AT, kind: 'edit', quantities: { flour25: 3, flour5: 1, yeast: 2, gone: 4 }, units: { yeast: 'busta', gone: 'kg' },
    });
  });

  it('a line taken to 0 leaves the order, with its stock and its unit', () => {
    const next = correctedRecord(RECORD, { qty: { flour25: 2, flour5: 0, yeast: 0, gone: 4 }, stock: { yeast: 5 } }, AT)!;
    expect(next.quantities).toStrictEqual({ flour25: 2, gone: 4 });
    expect(next.stock).toStrictEqual({ flour25: 0, gone: 0 });
    expect(next.units).toStrictEqual({ gone: 'kg' });
  });

  it('no unit left: the field goes; a record from before sends gets none', () => {
    const old = { quantities: { flour5: 1 }, stock: {}, units: { flour5: '' }, date: '2026-07-01', supplierId: 'mill' };
    const next = correctedRecord(old, { qty: { flour5: 2 }, stock: {} }, AT)!;
    expect(next).not.toHaveProperty('units');
    expect(next).not.toHaveProperty('sends');
    expect(next.quantities).toStrictEqual({ flour5: 2 });
  });

  it('every line at 0 is not an order: null (the editor says so and offers Delete)', () => {
    expect(correctedRecord(RECORD, { qty: { flour25: 0, flour5: 0, yeast: 0, gone: 0 }, stock: {} }, AT)).toBe(null);
    expect(correctedRecord(RECORD, { qty: {}, stock: {} }, AT)).toBe(null);
  });

  it('numbers are made safe: whole, never negative, never NaN', () => {
    const next = correctedRecord(RECORD, { qty: { flour25: 2.6, flour5: -3, yeast: Number.NaN }, stock: { flour25: Number.NaN } }, AT)!;
    expect(next.quantities).toStrictEqual({ flour25: 3 });
    expect(next.stock).toStrictEqual({ flour25: 0 });
  });
});

describe('sameOrder', () => {
  it('the record as opened, read back with its keys in another order, is the same order', () => {
    const reread = {
      ...RECORD,
      quantities: { gone: 4, yeast: 3, flour5: 1, flour25: 2 },
      units: { gone: 'kg', yeast: 'busta' },
    };
    expect(sameOrder(reread, RECORD)).toBe(true);
  });

  it('a delivery answer written meanwhile does not count as a change', () => {
    expect(sameOrder({ ...RECORD, deliveredAt: '2026-10-28', missing: {}, missingResolved: { yeast: 'x' } }, RECORD)).toBe(true);
  });

  it('a colleague\'s second order, or their correction, IS a change; so is a record that is gone', () => {
    const added = { ...RECORD, quantities: { ...RECORD.quantities, flour5: 2 }, sends: { ...RECORD.sends, s1: { at: AT, quantities: { flour5: 1 } } } };
    expect(sameOrder(added, RECORD)).toBe(false);
    expect(sameOrder({ ...RECORD, stock: { flour25: 4 } }, RECORD)).toBe(false);
    expect(sameOrder({ ...RECORD, units: { yeast: 'cartone' } }, RECORD)).toBe(false);
    expect(sameOrder(null, RECORD)).toBe(false);
  });
});
