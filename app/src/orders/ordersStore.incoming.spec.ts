// Incoming in the store (ordersStore.ts, step 3f-5): «did it all arrive?» (parity V4, V5), «Resolved» (V9, V11), «Put back» and
// «Another supplier» (V9, V10, L38's writer), and the goods-arrived switch (decision F4).

import { afterEach, describe, expect, it } from 'vitest';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import { createOrdersStore } from './ordersStore';
import type { OrdersDeps, OrdersMessage } from './ordersStore';
import type { StoredDoc } from './ordersSource';
import type { ReorderItem } from '@mise/shared/deliveries';

const TODAY = '2026-10-29';
const NOW = '2026-10-29T15:00:00.000Z';

const MILL: StoredDoc = { id: 'mill', name: 'Mill', active: true, orderDays: [] };
const DAIRY: StoredDoc = { id: 'dairy', name: 'Dairy', active: true, orderDays: [] };
const OFF: StoredDoc = { id: 'off', name: 'Closed', active: false };
const FLOUR: StoredDoc = { id: 'flour', name: 'Flour', supplierId: 'mill', unit: 'kg', active: true };
const BUTTER: StoredDoc = { id: 'butter', name: 'Butter', supplierId: 'dairy', unit: 'kg', active: true };
const STOPPED: StoredDoc = { id: 'stopped', name: 'Stopped', supplierId: 'mill', active: false };
const STRANDED: StoredDoc = { id: 'stranded', name: 'Stranded', supplierId: 'off', active: true };

function record(date: string, supplierId: string, quantities: Record<string, number>, extra: Record<string, unknown> = {}) {
  return { date, supplierId, supplierName: supplierId, quantities, stock: {}, names: {}, createdAt: `${date}T09:00:00.000Z`, ...extra };
}

function setup({ config = null as Record<string, unknown> | null, draft = null as Record<string, unknown> | null } = {}) {
  const source = fakeOrdersSource({
    suppliers: [MILL, DAIRY, OFF],
    ingredients: [FLOUR, BUTTER, STOPPED, STRANDED],
    ordersConfig: config,
    draft,
    records: { '2026-10-27_mill': record('2026-10-27', 'mill', { flour: 5, stopped: 2 }, { missing: { flour: true } }) },
  });
  let busy = 0;
  const deps: OrdersDeps = {
    markBusy: () => { busy += 1; return () => { busy -= 1; }; },
    today: () => TODAY,
    draft: { nowIso: () => NOW, setTimer: () => 1, clearTimer: () => {} },
    online: () => true,
  };
  const store = createOrdersStore(source, deps);
  const messages: OrdersMessage[] = [];
  store.onMessage(m => messages.push(m));
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  return { source, store, settle, messages, busy: () => busy };
}

let stops: Array<() => void> = [];
afterEach(() => { stops.forEach(stop => stop()); stops = []; });

async function started(options: Parameters<typeof setup>[0] = {}) {
  const s = setup(options);
  s.store.start();
  stops.push(() => s.store.stop());
  await s.settle();
  return s;
}

const item = (id: string, extra: Partial<ReorderItem> = {}): ReorderItem =>
  ({ id, supplierId: 'mill', recordId: '2026-10-27_mill', qty: 5, missedOn: '2026-10-27', ...extra });
const theRecord = (s: Awaited<ReturnType<typeof started>>) =>
  s.store.getSnapshot().history.find(r => r.id === '2026-10-27_mill') as StoredDoc;

describe('the goods-arrived switch (decision F4)', () => {
  it('reads as ON while config/orders says nothing', async () => {
    const s = await started();
    expect(s.store.getSnapshot().deliveryCheck).toStrictEqual({ on: true, from: '', offOn: '' });
  });

  it('reads an explicit false as OFF, and the day it was turned back on', async () => {
    expect((await started({ config: { deliveryCheck: false } })).store.getSnapshot().deliveryCheck.on).toBe(false);
    expect((await started({ config: { deliveryCheck: true, deliveryCheckFrom: '2026-10-20' } })).store.getSnapshot().deliveryCheck)
      .toStrictEqual({ on: true, from: '2026-10-20', offOn: '' });
  });

  it('OFF stamps the day it went off; ON the same day keeps the day it counted from; the other settings stay', async () => {
    const s = await started({ config: { showStock: false, deliveryCheckFrom: '2026-10-01' } });
    expect(await s.store.setDeliveryCheck(false)).toBe('saved');
    expect(s.store.getSnapshot().deliveryCheck.on).toBe(false);
    expect(await s.store.setDeliveryCheck(true)).toBe('saved');
    expect(s.source.deliveryWrites).toStrictEqual([
      { kind: 'config', patch: { deliveryCheck: false, deliveryCheckOffOn: TODAY } },
      { kind: 'config', patch: { deliveryCheck: true } },
    ]);
    expect(s.store.getSnapshot().deliveryCheck).toStrictEqual({ on: true, from: '2026-10-01', offOn: TODAY });
    expect(s.store.getSnapshot().config.showStock).toBe(false);
  });

  it('ON on a later day than it went off counts from today', async () => {
    const s = await started({ config: { deliveryCheck: false, deliveryCheckOffOn: '2026-10-20', deliveryCheckFrom: '2026-10-01' } });
    expect(await s.store.setDeliveryCheck(true)).toBe('saved');
    expect(s.source.deliveryWrites).toStrictEqual([{ kind: 'config', patch: { deliveryCheck: true, deliveryCheckFrom: TODAY } }]);
  });

  it('a refusal by the rules is said apart, and the switch is back as stored', async () => {
    const s = await started();
    s.source.failDelivery.config = true;
    expect(await s.store.setDeliveryCheck(false)).toBe('refused');
    expect(s.store.getSnapshot().deliveryCheck.on).toBe(true);
  });

  it('holds the busy marker until the server answers, and shows the change at once meanwhile', async () => {
    const s = await started();
    const release = s.source.holdWrites();
    const pending = s.store.setDeliveryCheck(false);
    expect(s.store.getSnapshot().deliveryCheck.on).toBe(false);
    expect(s.busy()).toBe(1);
    release();
    expect(await pending).toBe('saved');
    expect(s.busy()).toBe(0);
  });
});

describe('«did it all arrive?»', () => {
  it('all arrived: deliveredAt stamped now and `missing` REPLACED whole by nothing', async () => {
    const s = await started();
    expect(await s.store.confirmDelivery(theRecord(s), [])).toBe('saved');
    expect(s.source.deliveryWrites).toStrictEqual([
      { kind: 'confirm', id: '2026-10-27_mill', patch: { deliveredAt: NOW, missing: {}, updatedAt: NOW } },
    ]);
    expect(theRecord(s).missing).toStrictEqual({});
    expect(theRecord(s).quantities).toStrictEqual({ flour: 5, stopped: 2 });
  });

  it('something missing: exactly the ticked lines, and the quantities are never touched', async () => {
    const s = await started();
    await s.store.confirmDelivery(theRecord(s), ['stopped']);
    expect(theRecord(s).missing).toStrictEqual({ stopped: true });
    expect(theRecord(s).quantities).toStrictEqual({ flour: 5, stopped: 2 });
  });

  it('a record that is not there any more is not saved', async () => {
    const s = await started();
    const gone = { ...theRecord(s), id: '2026-10-01_mill' };
    expect(await s.store.confirmDelivery(gone, [])).toBe('failed');
  });

  it('a record with no id is addressed by its day and supplier', async () => {
    const s = await started();
    const { id: _id, ...rest } = theRecord(s);
    await s.store.confirmDelivery({ ...rest, id: '' } as StoredDoc, []);
    expect(s.source.deliveryWrites[0]).toMatchObject({ id: '2026-10-27_mill' });
  });

  it('a refused answer is not saved, and the record is as it was', async () => {
    const s = await started();
    s.source.failDelivery.confirm = true;
    expect(await s.store.confirmDelivery(theRecord(s), [])).toBe('refused');
    expect(theRecord(s).deliveredAt).toBeUndefined();
    expect(theRecord(s).missing).toStrictEqual({ flour: true });
    expect(s.busy()).toBe(0);
  });
});

describe('«Resolved»', () => {
  it('merges the one line into missingResolved and leaves `missing` alone', async () => {
    const s = await started();
    expect(await s.store.resolveMissing(item('flour'))).toBe('saved');
    expect(s.source.deliveryWrites).toStrictEqual([{ kind: 'resolve', id: '2026-10-27_mill', ingredientId: 'flour', at: NOW }]);
    expect(theRecord(s).missingResolved).toStrictEqual({ flour: NOW });
    expect(theRecord(s).missing).toStrictEqual({ flour: true });
  });

  it('a refused one is said as refused and changes nothing', async () => {
    const s = await started();
    s.source.failDelivery.resolve = true;
    expect(await s.store.resolveMissing(item('flour'))).toBe('refused');
    expect(theRecord(s).missingResolved).toBeUndefined();
  });
});

describe('«Put back»', () => {
  it('puts the missed quantity in its own supplier’s order, sent at once, the override cleared and the day stamped', async () => {
    const s = await started({ draft: { entries: { flour: { qty: 0, stock: 3, supplierId: 'dairy' } }, days: {} } });
    expect(s.store.putBack(item('flour'))).toBe('applied');
    expect(s.store.getSnapshot().draft.entries.flour).toMatchObject({ qty: 5, stock: 3, unit: '', supplierId: '' });
    expect(s.store.getSnapshot().draft.days.mill).toBe(TODAY);
    await s.settle();
    expect(s.source.writes.at(-1)?.entries?.flour).toMatchObject({ qty: 5, unit: '', supplierId: '' });
    expect(s.busy()).toBe(0);
  });

  it('keeps the unit the line was ordered in', async () => {
    const s = await started();
    s.store.putBack(item('butter', { unit: 'case', supplierId: 'dairy' }));
    expect(s.store.getSnapshot().draft.entries.butter).toMatchObject({ qty: 5, unit: 'case' });
  });

  it('never overwrites a quantity a person typed: skipped, nothing written', async () => {
    const s = await started({ draft: { entries: { flour: { qty: 2 } }, days: {} } });
    expect(s.store.putBack(item('flour'))).toBe('skipped');
    expect(s.store.getSnapshot().draft.entries.flour).toStrictEqual({ qty: 2 });
    await s.settle();
    expect(s.source.writes).toStrictEqual([]);
  });

  it('nothing for an ingredient that is gone, switched off, or whose supplier is not active', async () => {
    const s = await started();
    expect(s.store.putBack(item('ghost'))).toBe('gone');
    expect(s.store.putBack(item('stopped'))).toBe('gone');
    expect(s.store.putBack(item('stranded'))).toBe('gone');
    await s.settle();
    expect(s.source.writes).toStrictEqual([]);
  });

  it('a refused write is said like any typing, and the line stays on this phone', async () => {
    const s = await started();
    s.source.refuseWrites = true;
    s.store.putBack(item('flour'));
    await s.settle();
    expect(s.messages).toContainEqual({ kind: 'draft-not-saved' });
    expect(s.store.getSnapshot().draft.entries.flour).toMatchObject({ qty: 5 });
  });
});

describe('«Another supplier»', () => {
  it('puts the line in that supplier’s order THIS TIME (the override), stamps that supplier’s day, resolves nothing', async () => {
    const s = await started();
    expect(s.store.orderElsewhere(item('flour'), 'dairy')).toBe('applied');
    expect(s.store.getSnapshot().draft.entries.flour).toMatchObject({ qty: 5, supplierId: 'dairy' });
    expect(s.store.getSnapshot().draft.days.dairy).toBe(TODAY);
    await s.settle();
    expect(s.source.writes.at(-1)?.entries?.flour).toMatchObject({ qty: 5, supplierId: 'dairy' });
    expect(s.source.deliveryWrites).toStrictEqual([]);
  });

  it('choosing the usual supplier after all carries no override', async () => {
    const s = await started();
    s.store.orderElsewhere(item('flour'), 'mill');
    expect(s.store.getSnapshot().draft.entries.flour).toMatchObject({ qty: 5, supplierId: '' });
  });

  it('never overwrites a typed quantity, and refuses a supplier that is not active or not there', async () => {
    const s = await started({ draft: { entries: { butter: { qty: 1 } }, days: {} } });
    expect(s.store.orderElsewhere(item('butter'), 'mill')).toBe('skipped');
    expect(s.store.orderElsewhere(item('flour'), 'off')).toBe('gone');
    expect(s.store.orderElsewhere(item('flour'), 'nobody')).toBe('gone');
    expect(s.store.orderElsewhere(item('stopped'), 'dairy')).toBe('gone');
    await s.settle();
    expect(s.source.writes).toStrictEqual([]);
  });
});
