// Order lists in the store (ordersStore.ts, step 3f-7): sending a list (parity R14, R15), the warning before it (R17), the ticks and
// «Finish» (R19, R20), delete (R21) and this phone's mute switch (M7).

import { afterEach, describe, expect, it } from 'vitest';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { createOrdersStore } from './ordersStore';
import type { OrdersDeps } from './ordersStore';
import type { StoredDoc } from './ordersSource';

const TODAY = '2026-11-03';
const NOW = '2026-11-03T10:00:00.000Z';
const MILL: StoredDoc = { id: 'mill', name: 'Mill', active: true, orderDays: [] };
const DAIRY: StoredDoc = { id: 'dairy', name: 'Dairy', active: true, orderDays: [] };
const FLOUR: StoredDoc = { id: 'flour', name: 'Flour', supplierId: 'mill', active: true };
const RYE: StoredDoc = { id: 'rye', name: 'Rye', supplierId: 'mill', active: false };
const BUTTER: StoredDoc = { id: 'butter', name: 'Butter', supplierId: 'dairy', active: true };

const DRAFT = { entries: { flour: { qty: 4 }, rye: { qty: 2 }, butter: { qty: 1 } }, days: {} };
const LIST = {
  date: TODAY, fromUid: 'u', fromName: 'Marco', quantities: { flour: 4, butter: 1 }, names: { flour: 'Flour', butter: 'Butter' },
  supplierOf: { flour: 'mill', butter: 'dairy' }, supplierNames: { mill: 'Mill', dairy: 'Dairy' }, done: {}, note: '',
  createdAt: NOW, updatedAt: NOW,
};

let stops: Array<() => void> = [];
afterEach(() => { stops.forEach(stop => stop()); stops = []; });

async function started({ online = true, draft = DRAFT as Record<string, unknown> | null, requests = {} as Record<string, Record<string, unknown>> } = {}) {
  const source: FakeOrdersSource = fakeOrdersSource({ suppliers: [MILL, DAIRY], ingredients: [FLOUR, RYE, BUTTER], draft, requests });
  let busy = 0;
  const deps: OrdersDeps = {
    markBusy: () => { busy += 1; return () => { busy -= 1; }; },
    today: () => TODAY,
    draft: { nowIso: () => NOW, setTimer: () => 1, clearTimer: () => {} },
    online: () => online,
  };
  const store = createOrdersStore(source, deps);
  store.start();
  stops.push(() => { store.stop(); });
  await new Promise(resolve => setTimeout(resolve, 0));
  return { source, store, busy: () => busy };
}

const stored = (source: FakeOrdersSource, id = 'list-1') => source.requests.get(id) as Record<string, unknown>;

describe('watching the lists', () => {
  it('a list that came from the browser\'s own empty copy is not yet «none»', async () => {
    const source = fakeOrdersSource({});
    source.requestsCached = true;
    const store = createOrdersStore(source, {
      markBusy: () => () => {}, today: () => TODAY, draft: { nowIso: () => NOW, setTimer: () => 1, clearTimer: () => {} }, online: () => true,
    });
    store.start();
    stops.push(() => { store.stop(); });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(store.getSnapshot().requestsLoaded).toBe(false);
    source.requestsCached = false;
    source.emitRequests();
    expect(store.getSnapshot().requestsLoaded).toBe(true);
  });

  it('a stream that dies says so and stops the wait', async () => {
    const source = fakeOrdersSource({});
    source.refuse.requests = true;
    const store = createOrdersStore(source, {
      markBusy: () => () => {}, today: () => TODAY, draft: { nowIso: () => NOW, setTimer: () => 1, clearTimer: () => {} }, online: () => true,
    });
    store.start();
    stops.push(() => { store.stop(); });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(store.getSnapshot().requestsBroken).toBe(true);
    expect(store.getSnapshot().requestsLoaded).toBe(true);
  });

  it('newest first, as the query asks', async () => {
    const { store } = await started({ requests: { a: { ...LIST, createdAt: '2026-11-01T00:00:00Z' }, b: { ...LIST, createdAt: '2026-11-02T00:00:00Z' } } });
    expect(store.getSnapshot().requests.map(r => r.id)).toStrictEqual(['b', 'a']);
  });
});

describe('sending a list', () => {
  it('freezes the ticked suppliers only, under the sender\'s uid and name, and leaves the order alone', async () => {
    const { source, store } = await started();
    source.member = { firstName: 'Marco', lastName: 'Rossi' };
    await expect(store.sendList(['mill'], 'u-1', 'No supplier')).resolves.toBe('sent');
    const list = stored(source);
    expect(list.fromUid).toBe('u-1');
    expect(list.fromName).toBe('Marco Rossi');
    expect(list.date).toBe(TODAY);
    expect(list.supplierNames).toStrictEqual({ mill: 'Mill' });
    expect(list.done).toStrictEqual({});
    // A switched-off line with a quantity goes like any other (decision T10).
    expect(list.quantities).toStrictEqual({ flour: 4, rye: 2 });
    // ⚠️ THE DRAFT IS NOT CLEARED (his choice, 14 Aug 2026).
    expect(source.clears).toHaveLength(0);
    expect(store.getSnapshot().draft.entries.flour?.qty).toBe(4);
  });

  it('⚠️ somebody with no name on the roster is sent with NO name, and an address is never read onto the list', async () => {
    const { source, store } = await started();
    source.member = { email: 'marco@example.test', firstName: '', lastName: ' ' };
    await store.sendList(['mill'], 'u-1', 'No supplier');
    expect(stored(source).fromName).toBe('');
    expect(JSON.stringify(stored(source))).not.toContain('marco@example.test');
  });

  it('a roster read that fails can never stop the send', async () => {
    const { source, store } = await started();
    source.failRead = true;
    await expect(store.sendList(['mill'], 'u-1', 'No supplier')).resolves.toBe('sent');
    expect(stored(source).fromName).toBe('');
  });

  it('nothing left to send writes nothing', async () => {
    const { source, store } = await started({ draft: { entries: { flour: { qty: 0 } }, days: {} } });
    await expect(store.sendList(['mill'], 'u-1', 'No supplier')).resolves.toBe('nothing');
    await expect(store.sendList(['gone'], 'u-1', 'No supplier')).resolves.toBe('nothing');
    expect(source.requests.size).toBe(0);
  });

  it('a list over the cap is said here, before the rules would refuse it', async () => {
    const entries: Record<string, { qty: number }> = {};
    const { source, store } = await started({ draft: { entries, days: {} } });
    for (let n = 0; n <= 500; n += 1) {
      source.ingredients.set(`x${n}`, { id: `x${n}`, name: `Item ${n}`, supplierId: 'mill', active: true });
      entries[`x${n}`] = { qty: 1 };
    }
    source.emit();
    await expect(store.sendList(['mill'], 'u-1', 'No supplier')).resolves.toBe('too-many');
    expect(source.requests.size).toBe(0);
  });

  it('a refused list says failed, and is not left behind', async () => {
    const { source, store, busy } = await started();
    source.failRequest = true;
    await expect(store.sendList(['mill'], 'u-1', 'No supplier')).resolves.toBe('failed');
    expect(source.requests.size).toBe(0);
    expect(busy()).toBe(0);
  });

  it('⚠️ offline it answers at once and the marker stays held until the write lands (P20)', async () => {
    const { source, store, busy } = await started({ online: false });
    const release = source.holdWrites();
    await expect(store.sendList(['mill'], 'u-1', 'No supplier')).resolves.toBe('queued');
    expect(source.requests.size).toBe(1);
    expect(busy()).toBe(1);
    release();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(busy()).toBe(0);
  });
});

describe('the warning before a send', () => {
  const BOSS = { uid: 'boss', role: 'owner', firstName: 'Ada', lastName: 'Rossi' };

  it('asks only when everybody who runs the place is away, and names them', async () => {
    const { source, store } = await started();
    source.roster = [BOSS, { uid: 'staff', role: 'staff', firstName: 'Bo', lastName: '' }];
    await expect(store.whoIsAway('staff')).resolves.toStrictEqual({ nobody: false, names: [] });
    source.awayDays = [{ id: 'boss', until: '2026-11-10' }];
    await expect(store.whoIsAway('staff')).resolves.toStrictEqual({ nobody: true, names: ['Ada Rossi'] });
  });

  it('somebody away with no name is \'\' (the screen has the word), never an address', async () => {
    const { source, store } = await started();
    source.roster = [{ uid: 'boss', role: 'manager', firstName: '', lastName: '' }];
    source.awayDays = [{ id: 'boss', uid: 'boss', until: '2026-11-10' }];
    await expect(store.whoIsAway('staff')).resolves.toStrictEqual({ nobody: true, names: [''] });
  });

  it('an empty roster is «the app does not know», not «nobody is there»', async () => {
    const { store } = await started();
    await expect(store.whoIsAway('staff')).resolves.toStrictEqual({ nobody: false, names: [] });
  });

  it('⚠️ a read that fails, and a phone that is offline, answer «go ahead» without a word', async () => {
    const refused = await started();
    refused.source.failRead = true;
    await expect(refused.store.whoIsAway('staff')).resolves.toStrictEqual({ nobody: false, names: [] });
    const offline = await started({ online: false });
    await expect(offline.store.whoIsAway('staff')).resolves.toStrictEqual({ nobody: false, names: [] });
    expect(offline.source.reads).toBe(0);
  });
});

describe('ticks, Finish and delete', () => {
  it('a tick sends ONE key, and shows at once', async () => {
    const { source, store } = await started({ requests: { one: LIST } });
    const going = store.tickRequestLine('one', 'flour', true);
    expect(store.getSnapshot().requests[0]?.done).toStrictEqual({ flour: true });
    await expect(going).resolves.toBe('saved');
    expect(source.ticks).toStrictEqual([{ id: 'one', done: { flour: true }, updatedAt: NOW }]);
  });

  it('an untick writes false rather than removing the key', async () => {
    const { source, store } = await started({ requests: { one: { ...LIST, done: { flour: true } } } });
    await store.tickRequestLine('one', 'flour', false);
    expect(source.requests.get('one')?.done).toStrictEqual({ flour: false });
  });

  it('a refused tick comes back off, and says so', async () => {
    const { source, store } = await started({ requests: { one: LIST } });
    source.failRequest = true;
    await expect(store.tickRequestLine('one', 'flour', true)).resolves.toBe('refused');
    expect(store.getSnapshot().requests[0]?.done).toStrictEqual({});
  });

  it('Finish ticks every line still open in ONE write', async () => {
    const { source, store } = await started({ requests: { one: LIST } });
    await store.finishRequest('one', ['flour', 'butter']);
    expect(source.ticks).toHaveLength(1);
    expect(source.ticks[0]?.done).toStrictEqual({ flour: true, butter: true });
  });

  it('delete takes the list away at once; refused, it comes back', async () => {
    const { source, store } = await started({ requests: { one: LIST } });
    source.failRequest = true;
    const going = store.deleteRequest('one');
    expect(store.getSnapshot().requests).toHaveLength(0);
    await expect(going).resolves.toBe('refused');
    expect(store.getSnapshot().requests).toHaveLength(1);
    await expect(store.deleteRequest('one')).resolves.toBe('saved');
    expect(source.requests.size).toBe(0);
  });
});

describe('this phone\'s mute switch', () => {
  it('writes the token document, and a refusal says so', async () => {
    const { source, store } = await started();
    await expect(store.setPhoneMute('tok', true)).resolves.toBe('saved');
    expect(source.mutes).toStrictEqual([{ token: 'tok', mute: true }]);
    source.failRequest = true;
    await expect(store.setPhoneMute('tok', false)).resolves.toBe('refused');
  });
});
