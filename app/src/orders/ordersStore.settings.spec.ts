// Orders → Settings in the store (ordersStore.ts, step 3f-8): one merge into config/orders per change, nothing written on a refusal
// (settingsPatch.ts), the rules' refusal said apart; and the kiosk's Orders lines from what is held (parity M14, decision T13).

import { afterEach, describe, expect, it } from 'vitest';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import { createOrdersStore } from './ordersStore';
import type { OrdersDeps } from './ordersStore';
import type { StoredDoc } from './ordersSource';

// 2026-10-28 is a Wednesday.
const TODAY = '2026-10-28';
const NOW = '2026-10-28T15:00:00.000Z';

const MILL: StoredDoc = { id: 'mill', name: 'Mill', active: true, orderDays: ['Wednesday'], deliveryDays: ['Wednesday'] };
const DAIRY: StoredDoc = { id: 'dairy', name: 'Dairy', active: true, orderDays: [], deliveryDays: ['Wednesday'] };
const FLOUR: StoredDoc = { id: 'flour', name: 'Flour', supplierId: 'mill', unit: 'kg', active: true };

function record(date: string, supplierId: string) {
  return { date, supplierId, supplierName: supplierId, quantities: { flour: 2 }, stock: {}, names: {}, createdAt: `${date}T09:00:00.000Z` };
}

function setup(config: Record<string, unknown> | null = null) {
  const source = fakeOrdersSource({
    suppliers: [MILL, DAIRY],
    ingredients: [FLOUR],
    ordersConfig: config,
    records: { '2026-10-27_dairy': record('2026-10-27', 'dairy') },
  });
  let busy = 0;
  const deps: OrdersDeps = {
    markBusy: () => { busy += 1; return () => { busy -= 1; }; },
    today: () => TODAY,
    draft: { nowIso: () => NOW, setTimer: () => 1, clearTimer: () => {} },
    online: () => true,
  };
  const store = createOrdersStore(source, deps);
  return { source, store, busy: () => busy };
}

let stops: Array<() => void> = [];
afterEach(() => { stops.forEach(stop => stop()); stops = []; });

async function started(config: Record<string, unknown> | null = null) {
  const s = setup(config);
  s.store.start();
  stops.push(() => s.store.stop());
  await new Promise(resolve => setTimeout(resolve, 0));
  return s;
}

describe('saveSetting', () => {
  it('writes one merge of the setting, and the other settings stay', async () => {
    const s = await started({ deliveryCheck: false });
    expect(await s.store.saveSetting({ kind: 'showStock', on: false })).toBe('saved');
    expect(await s.store.saveSetting({ kind: 'historyDays', value: '30' })).toBe('saved');
    expect(await s.store.saveSetting({ kind: 'weekStart', day: 'Monday' })).toBe('saved');
    expect(await s.store.saveSetting({ kind: 'supplierOrder', ids: ['dairy', 'mill'] })).toBe('saved');
    expect(s.source.deliveryWrites).toStrictEqual([
      { kind: 'config', patch: { showStock: false } },
      { kind: 'config', patch: { historyDays: 30 } },
      { kind: 'config', patch: { weekStartsOn: 'Monday' } },
      { kind: 'config', patch: { supplierOrder: ['dairy', 'mill'] } },
    ]);
    const config = s.store.getSnapshot().config;
    expect([config.showStock, config.historyDays, config.weekStartsOn, config.supplierOrder]).toStrictEqual([false, 30, 'Monday', ['dairy', 'mill']]);
    expect(s.store.getSnapshot().deliveryCheck.on).toBe(false);
    expect(s.busy()).toBe(0);
  });

  it('a refusal of its own writes nothing', async () => {
    const s = await started({ sendRoutes: { manager: true, whatsapp: false, whatsappSupplier: false, email: false } });
    expect(await s.store.saveSetting({ kind: 'orderLists', on: false })).toBe('only-road');
    expect(await s.store.saveSetting({ kind: 'route', route: 'manager', on: false })).toBe('last-road');
    expect(await s.store.saveSetting({ kind: 'historyDays', value: '0' })).toBe('invalid');
    expect(await s.store.saveSetting({ kind: 'historyDays', value: 15 })).toBe('unchanged');
    expect(s.source.deliveryWrites).toStrictEqual([]);
  });

  it('a road judged on the config as it is now: two quick closes cannot shut the last one', async () => {
    const s = await started({ sendRoutes: { manager: false, whatsapp: true, whatsappSupplier: false, email: true } });
    expect(await s.store.saveSetting({ kind: 'route', route: 'email', on: false })).toBe('saved');
    expect(await s.store.saveSetting({ kind: 'route', route: 'whatsapp', on: false })).toBe('last-road');
  });

  it('a refusal by the rules is said apart', async () => {
    const s = await started();
    s.source.failDelivery.config = true;
    expect(await s.store.saveSetting({ kind: 'showStock', on: false })).toBe('refused');
    expect(s.store.getSnapshot().config.showStock).toBe(true);
  });
});

describe('kioskSections', () => {
  it('to order today and arriving today, from what is held', async () => {
    const s = await started();
    expect(s.store.kioskSections()).toStrictEqual([
      { titleKey: 'kiosk.rest.toOrderTitle', names: ['Mill'], more: 0 },
      { titleKey: 'kiosk.rest.arrivingTitle', names: ['Dairy'], more: 0 },
    ]);
  });

  it('with the goods-arrived check off there is no «arriving» line', async () => {
    const s = await started({ deliveryCheck: false });
    expect(s.store.kioskSections()).toStrictEqual([{ titleKey: 'kiosk.rest.toOrderTitle', names: ['Mill'], more: 0 }]);
  });
});
