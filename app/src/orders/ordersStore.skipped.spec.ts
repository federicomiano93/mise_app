// The store's half of «Close as not ordered» (the current app's PR #470): the close and the reopen go out on their own, a
// refusal is said, a quantity typed for a supplier closed today reopens it, and the kiosk's lines leave a closed supplier out.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
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

async function started(draft: Record<string, unknown>, prepare: (source: FakeOrdersSource) => void = () => undefined) {
  const source = fakeOrdersSource({ suppliers: [mill, shop], ingredients: [flour], draft });
  prepare(source);
  const busy = { held: 0 };
  const deps: OrdersDeps = {
    markBusy: () => { busy.held += 1; let done = false; return () => { if (!done) { done = true; busy.held -= 1; } }; },
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
  return { source, store, messages, busy };
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

  // ── The second port's extras (PR #496, compared after #495 was merged) ──

  it('⚠️ a close is held busy until the server answers, so a self-started reload cannot drop it', async () => {
    const h = await started({ entries: {}, days: {} });
    const release = h.source.holdWrites();
    const closing = h.store.closeNotOrdered('mill');
    expect(h.busy.held).toBe(1);
    await settle();
    expect(h.busy.held).toBe(1); // still in the air
    release();
    expect(await closing).toBe(true);
    expect(h.busy.held).toBe(0);
  });

  it('⚠️ a reopen is held busy the same way, and a refused one lets go too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = await started({ entries: {}, days: {}, skipped: { mill: TODAY } });
    const release = h.source.holdWrites();
    h.source.refuseSkipped = true;
    const reopening = h.store.reopenToday('mill');
    expect(h.busy.held).toBe(1);
    release();
    expect(await reopening).toBe(false);
    expect(h.busy.held).toBe(0);
  });

  it('⚠️ the reopen that typing sends is held busy until answered', async () => {
    const h = await started({ entries: {}, days: {}, skipped: { mill: TODAY } });
    const release = h.source.holdWrites();
    const before = h.busy.held;
    h.store.editLine(mill, { ...flour, usualSupplierId: '' } as never, { qty: 2 });
    // The typing's own hold, and the reopen's.
    expect(h.busy.held).toBe(before + 2);
    release();
    await settle();
    expect(h.source.skippedWrites).toEqual([{ op: 'clear', supplierId: 'mill' }]);
    expect(h.busy.held).toBe(before + 1); // only the typing's own hold, until its autosave
  });

  it('⚠️ the kiosk says nothing until the draft has arrived: a supplier closed this morning is never «to order» meanwhile', async () => {
    let letDraftIn = () => undefined as void;
    const h = await started({ entries: {}, days: {}, skipped: { mill: TODAY } }, source => {
      const watch = source.watchDraft.bind(source);
      source.watchDraft = (onChange, onError) => {
        let stop = () => undefined as void;
        letDraftIn = () => { stop = watch(onChange, onError); };
        return () => { stop(); };
      };
    });
    expect(h.store.kioskSections()).toBeNull();
    letDraftIn();
    await settle();
    const toOrder = (h.store.kioskSections() ?? []).find(s => s.titleKey === 'kiosk.rest.toOrderTitle');
    expect(toOrder?.names).toEqual(['Shop']);
  });

  it('a dead draft stream counts as arrived: the closes are unknown, and the kiosk errs on the side of the reminder', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = await started({ entries: {}, days: {}, skipped: { mill: TODAY } }, source => { source.refuse.draft = true; });
    expect(h.store.getSnapshot().draftBroken).toBe(true);
    const toOrder = (h.store.kioskSections() ?? []).find(s => s.titleKey === 'kiosk.rest.toOrderTitle');
    expect(toOrder?.names).toEqual(['Mill', 'Shop']);
  });
});
