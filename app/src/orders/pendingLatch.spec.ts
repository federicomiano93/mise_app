import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT } from './draftSync';
import type { DraftView } from './draftSync';
import { buildOrdersLens } from './ordersLens';
import { pendingNow } from './pendingLatch';
import { pendingDayIn } from './PlaceConfirmScreen';

const TODAY = '2026-10-28';

function lensOf(entries: DraftView['entries']) {
  return buildOrdersLens({
    suppliers: [{ id: 's-alp', name: 'Alpine Mills' }, { id: 's-off', name: 'Closed', active: false }],
    suppliersLoaded: true,
    ingredients: [
      { id: 'i-flour', name: 'Flour', supplierId: 's-alp' },
      { id: 'i-loose', name: 'Loose' },
      { id: 'i-cold', name: 'Cold', supplierId: 's-off' },
    ],
    entries, supplierOrder: [], noSupplierName: 'No supplier',
  });
}

describe('pendingNow', () => {
  it('finds an order stamped before today, «No supplier» included, and nothing that is switched off or stamped today', () => {
    const entries = { 'i-flour': { qty: 2 }, 'i-loose': { qty: 1 }, 'i-cold': { qty: 3 } };
    const draft: DraftView = { ...EMPTY_DRAFT, entries, days: { 's-alp': '2026-10-27', 'no-supplier': '2026-10-26', 's-off': '2026-10-20' } };
    const found = pendingNow(lensOf(entries), draft, TODAY);
    // Oldest first.
    expect(found.map(row => [row.supplier.id, row.day, row.itemCount])).toEqual([['no-supplier', '2026-10-26', 1], ['s-alp', '2026-10-27', 1]]);
    expect(pendingNow(lensOf(entries), { ...draft, days: { 's-alp': TODAY, 'no-supplier': TODAY } }, TODAY)).toEqual([]);
  });

  it('falls back on the day the draft was last written for a draft that carries no stamps', () => {
    const entries = { 'i-flour': { qty: 2 } };
    const draft: DraftView = { ...EMPTY_DRAFT, entries, days: {}, updatedAt: '2026-10-27T12:00:00.000Z' };
    expect(pendingNow(lensOf(entries), draft, TODAY).map(row => row.day)).toEqual(['2026-10-27']);
  });
});

describe('pendingDayIn', () => {
  it('takes a real day that has come, today included, and nothing else', () => {
    expect(pendingDayIn({ pendingDay: '2026-10-27' }, TODAY)).toBe('2026-10-27');
    expect(pendingDayIn({ pendingDay: TODAY }, TODAY)).toBe(TODAY);
    expect(pendingDayIn({ pendingDay: '2026-10-29' }, TODAY)).toBeNull();
    expect(pendingDayIn({ pendingDay: 'yesterday' }, TODAY)).toBeNull();
    expect(pendingDayIn({ pendingDay: 5 }, TODAY)).toBeNull();
    expect(pendingDayIn(null, TODAY)).toBeNull();
    expect(pendingDayIn(undefined, TODAY)).toBeNull();
  });
});
