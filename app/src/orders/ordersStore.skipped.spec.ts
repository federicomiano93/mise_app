// The store's half of «Close as not ordered» (the current app's PR #470): the close and the reopen go out on their own, a
// refusal is said, a quantity typed for a supplier closed today reopens it, and the kiosk's lines leave a closed supplier out.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import { createOrdersStore } from './ordersStore';
import type { OrdersDeps, OrdersMessage } from './ordersStore';
import type { StoredDoc } from './ordersSource';

// 2026-10-27 is a Tuesday.
const TODAY = '2026-10-27';
const flour: StoredDoc = { id: 'flour', name: 'Flour', supplierId: 'mill' };
const mill: StoredDoc = { id: 'mill', name: 'Mill', orderDays: ['Tuesday'] };
const shop: StoredDoc = { id: 'shop', name: 'Shop', orderDays: ['Tuesday'] };

const settle = () => new Promise(resolve => { setTimeout(resolve, 0); });
let stops: Array<() => void> = [];
afterEach(() => { stops.forEach(stop => stop()); stops = []; vi.restoreAllMocks(); });

async function started(draft: Record<string, unknown>) {
  const source = fakeOrdersSource({ suppliers: [mill, shop], ingredients: [flour], draft });
  const deps: OrdersDeps = {
    markBusy: () => () => undefined,
    today: () => TODAY,
    draft: { nowIso: () => `${TODAY}T09:00:00.000Z`, setTimer: () => 1, clearTimer: () => undefined },
    online: () => true,
  };
  const store = createOrdersStore(source, deps);
  const messages: OrdersMessage[] = [];
  store.onMessage(m => messages.push(m));
  store.start();
  stops.push(() => store.stop());
  await settle();
  return { source, store, messages };
}

describe('ordersStore — closed as not ordered', () => {
  it('a close writes today\'s key on its own and is drawn from the draft at once; reopen takes only that key', async () => {
    const h = await started({ entries: {}, days: {}, skipped: { shop: TODAY } });
    const closing = h.store.closeNotOrdered('mill');
    expect(h.store.getSnapshot().draft.skipped).toEqual({ shop: TODAY, mill: TODAY }); // local-first
    expect(await closing).toBe(true);
    expect(h.source.writes).toEqual([]); // never the autosave
    expect(await h.store.reopenToday('mill')).toBe(true);
    expect(h.store.getSnapshot().draft.skipped).toEqual({ shop: TODAY });
    expect(h.source.skippedWrites).toEqual([{ op: 'set', supplierId: 'mill', day: TODAY }, { op: 'clear', supplierId: 'mill' }]);
  });

  it('a refused close is said and taken back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = await started({ entries: {}, days: {} });
    h.source.refuseSkipped = true;
    expect(await h.store.closeNotOrdered('mill')).toBe(false);
    expect(h.messages).toEqual([{ kind: 'close-not-saved' }]);
    expect(h.store.getSnapshot().draft.skipped).toEqual({});
  });

  it('reopening what is not closed writes nothing', async () => {
    const h = await started({ entries: {}, days: {} });
    expect(await h.store.reopenToday('mill')).toBe(true);
    expect(h.source.skippedWrites).toEqual([]);
  });

  it('⚠️ a quantity typed for a supplier closed today reopens it; a shelf count does not', async () => {
    const h = await started({ entries: {}, days: {}, skipped: { mill: TODAY } });
    h.store.editLine(mill, { ...flour, usualSupplierId: '' } as never, { stock: 4 });
    await settle();
    expect(h.source.skippedWrites).toEqual([]); // counting the shelves is not ordering
    h.store.editLine(mill, { ...flour, usualSupplierId: '' } as never, { qty: 2 });
    await settle();
    expect(h.source.skippedWrites).toEqual([{ op: 'clear', supplierId: 'mill' }]);
    expect(h.store.getSnapshot().draft.skipped).toEqual({});
  });

  it('a close from another day is not reopened by typing: it means nothing already', async () => {
    const h = await started({ entries: {}, days: {}, skipped: { mill: '2026-10-20' } });
    h.store.editLine(mill, { ...flour, usualSupplierId: '' } as never, { qty: 2 });
    await settle();
    expect(h.source.skippedWrites).toEqual([]);
  });

  it('the kiosk\'s «to order today» leaves a supplier closed today out', async () => {
    const h = await started({ entries: {}, days: {}, skipped: { mill: TODAY } });
    const toOrder = (h.store.kioskSections() ?? []).find(s => s.titleKey === 'kiosk.rest.toOrderTitle');
    expect(toOrder?.names).toEqual(['Shop']);
  });
});
