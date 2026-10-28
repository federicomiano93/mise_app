// The store's half of the suggestions (step 3f-2b): the live window of records it watches, the engine it hands the screens,
// and the Stock box filling the Order box (parity L28, decision 1 of 3f-2b) — what that one edit writes, and the day it stamps.

import { afterEach, describe, expect, it } from 'vitest';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import { createOrdersStore } from './ordersStore';
import type { OrdersDeps } from './ordersStore';
import type { StoredDoc } from './ordersSource';

// 2026-10-27 is a Tuesday; the mill is ordered on Thursdays.
const TODAY = '2026-10-27';
const NOW = '2026-10-27T09:00:00.000Z';

const mill: StoredDoc = { id: 'mill', name: 'Mill', orderDays: ['Thursday'] };
const shop: StoredDoc = { id: 'shop', name: 'Shop' };
const flour: StoredDoc = { id: 'flour', name: 'Flour', supplierId: 'mill', unit: 'sacco', packUnit: 'busta' };

// Four orders of flour, 10 ordered with 2 on the shelf: par 12. One older than the window, which must not count.
const records = Object.fromEntries([
  ['2026-08-20', 500],
  ['2026-10-01', 10], ['2026-10-08', 10], ['2026-10-15', 10], ['2026-10-22', 10],
].map(([date, qty]) => [`${String(date)}_mill`, { date, supplierId: 'mill', quantities: { flour: qty }, stock: { flour: 2 } }]));

let stops: Array<() => void> = [];
afterEach(() => { stops.forEach(stop => stop()); stops = []; });

async function started(init: Parameters<typeof fakeOrdersSource>[0] = {}) {
  const source = fakeOrdersSource({ suppliers: [mill, shop], ingredients: [flour], records, ...init });
  let timer: (() => void) | null = null;
  const deps: OrdersDeps = {
    markBusy: () => () => {},
    today: () => TODAY,
    draft: { nowIso: () => NOW, setTimer: run => { timer = run; return 1; }, clearTimer: () => { timer = null; } },
    online: () => true,
  };
  const store = createOrdersStore(source, deps);
  store.start();
  stops.push(() => store.stop());
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  await settle();
  const autosave = async () => {
    const run = timer;
    timer = null;
    run?.();
    await settle();
  };
  return { source, store, settle, autosave };
}

describe('ordersStore — the records behind the suggestions', () => {
  it('watches the last two calendar months, and the engine reads them', async () => {
    const h = await started();
    expect(h.source.historyFrom).toBe('2026-08-27');
    expect(h.store.getSnapshot().history.map(r => r.id)).toHaveLength(4);
    // The August order of 500 is outside the window: par stays 12.
    expect(h.store.getSnapshot().suggester.hint(flour, { stock: 5 })).toStrictEqual({ kind: 'suggested', n: 7 });
  });

  it('keeps the same engine across a keystroke, and makes a new one when the records change', async () => {
    const h = await started();
    const before = h.store.getSnapshot().suggester;
    h.store.editLine(mill, flour, { qty: 3 });
    expect(h.store.getSnapshot().suggester).toBe(before);
    h.source.records.set('2026-10-26_mill', { date: '2026-10-26', supplierId: 'mill', quantities: { flour: 30 }, stock: { flour: 2 } });
    h.source.emitHistory();
    expect(h.store.getSnapshot().suggester).not.toBe(before);
  });

  it('a refused history stream leaves the rest of the page working, with no suggestions', async () => {
    const source = fakeOrdersSource({ suppliers: [mill], ingredients: [flour], records });
    source.refuse.history = true;
    const store = createOrdersStore(source, {
      markBusy: () => () => {}, today: () => TODAY, online: () => true,
      draft: { nowIso: () => NOW, setTimer: () => 1, clearTimer: () => {} },
    });
    store.start();
    stops.push(() => store.stop());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(store.getSnapshot().suppliersLoaded).toBe(true);
    expect(store.getSnapshot().suggester.hint(flour, { stock: 1 })).toStrictEqual({ kind: 'none' });
  });
});

describe('ordersStore — the Stock box fills the suggestion', () => {
  it('fills an empty Order box, stamps the day like typing it, and sends both in ONE autosave', async () => {
    const h = await started();
    h.store.editLine(mill, flour, { stock: 5 });
    expect(h.store.getSnapshot().draft.entries.flour).toMatchObject({ qty: 7, stock: 5 });
    expect(h.store.getSnapshot().draft.days.mill).toBe('2026-10-29');
    await h.autosave();
    expect(h.source.writes).toHaveLength(1);
    expect(h.source.writes[0]).toMatchObject({ entries: { flour: { qty: 7, stock: 5 } }, days: { mill: '2026-10-29' } });
  });

  it('⚠️ leaves a number typed by hand, and the reading alone never moves the day (parity L28)', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 9, stock: 5 } }, days: { mill: '2026-10-22' } } });
    h.store.editLine(mill, flour, { stock: 4 });
    expect(h.store.getSnapshot().draft.entries.flour).toMatchObject({ qty: 9, stock: 4 });
    expect(h.store.getSnapshot().draft.days.mill).toBe('2026-10-22');
    await h.autosave();
    expect(h.source.writes[0]).toEqual({ updatedAt: NOW, entries: { flour: { stock: 4 } } });
  });

  it('follows its own number while the reading is typed digit by digit', async () => {
    const h = await started();
    h.store.editLine(mill, flour, { stock: 1 });
    expect(h.store.getSnapshot().draft.entries.flour?.qty).toBe(11);
    h.store.editLine(mill, flour, { stock: 10 });
    expect(h.store.getSnapshot().draft.entries.flour?.qty).toBe(2);
  });

  it('⚠️ never fills a row whose line is in another supplier\'s order this time', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 3, stock: 0, supplierId: 'shop' } } } });
    h.store.editLine(mill, flour, { stock: 1 });
    const entry = h.store.getSnapshot().draft.entries.flour;
    // The 3 belongs to the shop's order: the mill's reading leaves it, and the line where it is.
    expect(entry?.qty).toBe(3);
    expect(entry?.supplierId).toBe('shop');
  });

  it('⚠️ never fills a line in another unit than the card\'s', async () => {
    const h = await started({ draft: { entries: { flour: { unit: 'busta' } } } });
    h.store.editLine(mill, flour, { stock: 1 });
    expect(h.store.getSnapshot().draft.entries.flour?.qty ?? 0).toBe(0);
  });

  it('a placed order reaches the records at once: the engine counts it', async () => {
    const h = await started();
    const before = h.store.getSnapshot().suggester;
    h.store.editLine(mill, flour, { qty: 7 });
    const report = await h.store.place([{ supplierId: 'mill', date: TODAY, quantities: { flour: 7 }, units: { flour: '' } }], 'No supplier');
    expect(report).toEqual({ offline: false, outcomes: [{ supplierId: 'mill', kind: 'saved' }] });
    expect(h.store.getSnapshot().history.some(r => r.id === `${TODAY}_mill`)).toBe(true);
    expect(h.store.getSnapshot().suggester).not.toBe(before);
  });
});
