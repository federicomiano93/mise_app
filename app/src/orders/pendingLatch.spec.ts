import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT } from './draftSync';
import type { DraftView } from './draftSync';
import { buildOrdersLens } from './ordersLens';
import { latchCanLook, pendingNow, stillPendingOn } from './pendingLatch';
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
      { id: 'i-rye', name: 'Rye', supplierId: 's-alp', active: false },
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

  it('⚠️ a switched-off line with a quantity is in the order like any other (decision T10)', () => {
    const entries = { 'i-rye': { qty: 4 } };
    const draft: DraftView = { ...EMPTY_DRAFT, entries, days: { 's-alp': '2026-10-27' } };
    expect(pendingNow(lensOf(entries), draft, TODAY).map(row => [row.supplier.id, row.itemCount])).toEqual([['s-alp', 1]]);
  });
});

describe('stillPendingOn', () => {
  const entries = { 'i-flour': { qty: 2 } };
  const draft: DraftView = { ...EMPTY_DRAFT, entries, days: { 's-alp': '2026-10-27' } };

  it('yes while the order is still the one typed that day', () => {
    expect(stillPendingOn(lensOf(entries), draft, TODAY, 's-alp', '2026-10-27')).toBe(true);
  });

  it('⚠️ no once it was restamped, placed or cleared meanwhile', () => {
    expect(stillPendingOn(lensOf(entries), draft, TODAY, 's-alp', '2026-10-26')).toBe(false);
    expect(stillPendingOn(lensOf(entries), { ...draft, days: { 's-alp': TODAY } }, TODAY, 's-alp', '2026-10-27')).toBe(false);
    expect(stillPendingOn(lensOf({}), { ...draft, entries: {} }, TODAY, 's-alp', '2026-10-27')).toBe(false);
  });
});

describe('latchCanLook', () => {
  const none = { suppliers: false, ingredients: false, draft: false };
  const all = { suppliers: true, ingredients: true, draft: true };

  it('⚠️⚠️ waits for the server on all three while online and within the grace', () => {
    expect(latchCanLook(none, true, false)).toBe(false);
    expect(latchCanLook({ ...all, draft: false }, true, false)).toBe(false);
    expect(latchCanLook(all, true, false)).toBe(true);
  });

  it('offline, or past the grace, the copy on the phone is used', () => {
    expect(latchCanLook(none, false, false)).toBe(true);
    expect(latchCanLook(none, true, true)).toBe(true);
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
