// Placing an order, in the store (ordersStore.ts, step 3f-2): the sequence of decision T5 against an in-memory source that
// can refuse each of its writes — what is recorded (the CONFIRMED numbers, parity X2), the point of no return (X5), what
// placing clears and keeps (X6), a second order the same day (H2), refusals offline (X3), the double tap (X1), «Clear
// quantities» (X11), the day line (D7) and the record check the confirm screen reads before it opens (X7).

import { afterEach, describe, expect, it } from 'vitest';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import { createOrdersStore } from './ordersStore';
import type { OrdersDeps, OrdersMessage } from './ordersStore';
import type { StoredDoc } from './ordersSource';

const TODAY = '2026-10-27';
const NOW = '2026-10-27T09:00:00.000Z';
const NO_SUPPLIER = 'No supplier';
const RECORD = `${TODAY}_mill`;

function setup(init: Parameters<typeof fakeOrdersSource>[0] = {}, { online = true } = {}) {
  const source = fakeOrdersSource(init);
  let timer: (() => void) | null = null;
  let busy = 0;
  let connected = online;
  const deps: OrdersDeps = {
    markBusy: () => { busy += 1; return () => { busy -= 1; }; },
    today: () => TODAY,
    draft: {
      nowIso: () => NOW,
      setTimer: run => { timer = run; return 1; },
      clearTimer: () => { timer = null; },
    },
    online: () => connected,
  };
  const store = createOrdersStore(source, deps);
  const messages: OrdersMessage[] = [];
  store.onMessage(m => messages.push(m));
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const autosave = async () => {
    const run = timer;
    timer = null;
    run?.();
    await settle();
  };
  return {
    source, store, messages, settle, autosave,
    busy: () => busy,
    pendingTimer: () => timer !== null,
    goOffline: () => { connected = false; },
  };
}

const mill: StoredDoc = { id: 'mill', name: 'Mill' };
const dairy: StoredDoc = { id: 'dairy', name: 'Dairy' };
const flour: StoredDoc = { id: 'flour', name: 'Flour', weight: '25kg', supplierId: 'mill' };
const semola: StoredDoc = { id: 'semola', name: 'Semola', supplierId: 'mill' };
const oldBag: StoredDoc = { id: 'oldbag', name: 'Old bag', supplierId: 'mill', active: false };
const yeast: StoredDoc = { id: 'yeast', name: 'Yeast', supplierId: 'mill', unit: 'cartone', packUnit: 'busta', packSize: 4 };
const butter: StoredDoc = { id: 'butter', name: 'Butter', supplierId: 'dairy' };

let stops: Array<() => void> = [];
afterEach(() => { stops.forEach(stop => stop()); stops = []; });

async function started(init: Parameters<typeof fakeOrdersSource>[0] = {}, options: { online?: boolean } = {}) {
  const h = setup({ suppliers: [mill, dairy], ingredients: [flour, semola, oldBag, yeast, butter], ...init }, options);
  h.store.start();
  stops.push(() => h.store.stop());
  await h.settle();
  return h;
}

const one = (quantities: Record<string, number>, units: Record<string, string> = {}) =>
  [{ supplierId: 'mill', date: TODAY, quantities, units }];

describe('ordersStore — placing one supplier\'s order', () => {
  it('records what was CONFIRMED, not what the shared order says now, and clears the supplier\'s lines and day', async () => {
    const h = await started({
      draft: {
        entries: { flour: { qty: 4, stock: 1 }, semola: { qty: 2, stock: 0 }, butter: { qty: 3, stock: 5 } },
        days: { mill: TODAY, dairy: TODAY },
      },
    });
    // A colleague changes the flour after the confirm screen opened: the person confirmed 4 and set the semola to 0.
    h.source.remoteMerge({ entries: { flour: { qty: 9 } } });
    await h.settle();

    // The screen showed both rows (its `units` name every row); the semola was set to 0.
    const report = await h.store.place(one({ flour: 4 }, { flour: '', semola: '' }), NO_SUPPLIER);

    expect(report).toStrictEqual({ offline: false, outcomes: [{ supplierId: 'mill', kind: 'saved' }] });
    const record = h.source.records.get(RECORD)!;
    expect(record.quantities).toStrictEqual({ flour: 4 });
    expect(record.supplierName).toBe('Mill');
    expect(record.date).toBe(TODAY);
    expect(record.names).toStrictEqual({ flour: 'Flour 25kg' });
    expect(record.bakery).toBe('bakery');
    // The mill's lines and day are gone; the dairy's line, stock reading included, is untouched (parity X6).
    expect(h.source.clears).toHaveLength(1);
    expect([...h.source.clears[0]!.paths].sort()).toStrictEqual(
      ['days.mill', 'entries.flour', 'entries.oldbag', 'entries.semola', 'entries.yeast'].sort());
    const draft = h.source.draft as { entries: Record<string, unknown>; days: Record<string, string> };
    expect(draft.entries).toStrictEqual({ butter: { qty: 3, stock: 5 } });
    expect(draft.days).toStrictEqual({ dairy: TODAY });
    expect(h.store.getSnapshot().draft.entries).toStrictEqual({ butter: { qty: 3, stock: 5 } });
    expect(h.store.getSnapshot().placing).toStrictEqual([]);
    expect(h.busy()).toBe(0);
  });

  it('records the unit each line SHOWED, frozen when the screen opened', async () => {
    const h = await started({ draft: { entries: { yeast: { qty: 2, stock: 0, unit: 'busta' } }, days: { mill: TODAY } } });
    // Another phone switches the line back to cartoni while the screen is open.
    h.source.remoteMerge({ entries: { yeast: { unit: '' } } });
    await h.settle();

    await h.store.place(one({ yeast: 2 }, { yeast: 'busta' }), NO_SUPPLIER);

    expect(h.source.records.get(RECORD)!.units).toStrictEqual({ yeast: 'busta' });
  });

  it('a second order the same day ADDS to the record, and the new goods are not «arrived» (parity H2)', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 2, stock: 0 } }, days: { mill: TODAY } } });
    h.source.records.set(RECORD, {
      date: TODAY, supplierId: 'mill', supplierName: 'Mill', quantities: { flour: 3 }, stock: {}, names: { flour: 'Flour 25kg' },
      sends: { s20261027070000000: { at: '2026-10-27T07:00:00.000Z', quantities: { flour: 3 } } },
      createdAt: '2026-10-27T07:00:00.000Z', updatedAt: '2026-10-27T07:00:00.000Z', deliveredAt: '2026-10-27T08:00:00.000Z',
    });

    await h.store.place(one({ flour: 2 }), NO_SUPPLIER);

    const record = h.source.records.get(RECORD)!;
    expect(record.quantities).toStrictEqual({ flour: 5 });
    expect(Object.keys(record.sends as object)).toHaveLength(2);
    expect('deliveredAt' in record).toBe(false);
    expect(record.createdAt).toBe('2026-10-27T07:00:00.000Z');
  });

  it('a switched-off line with a quantity is recorded like any other (decision T10)', async () => {
    const h = await started({ draft: { entries: { oldbag: { qty: 1, stock: 0 } }, days: { mill: TODAY } } });

    await h.store.place(one({ oldbag: 1 }), NO_SUPPLIER);

    expect(h.source.records.get(RECORD)!.quantities).toStrictEqual({ oldbag: 1 });
  });

  it('a line sent HERE from its usual supplier is recorded here and leaves the draft with its override; a line of this '
    + 'supplier\'s ordered elsewhere stays in the other order (parity L38, X6)', async () => {
    const h = await started({
      draft: {
        entries: { butter: { qty: 2, stock: 0, supplierId: 'mill' }, semola: { qty: 5, stock: 0, supplierId: 'dairy' } },
        days: { mill: TODAY, dairy: TODAY },
      },
    });

    await h.store.place(one({ butter: 2 }), NO_SUPPLIER);

    expect(h.source.records.get(RECORD)!.quantities).toStrictEqual({ butter: 2 });
    const draft = h.source.draft as { entries: Record<string, unknown> };
    expect(draft.entries).toStrictEqual({ semola: { qty: 5, stock: 0, supplierId: 'dairy' } });
  });

  it('typing still waiting for the autosave goes BEFORE the record, and survives the clear', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4, stock: 0 } }, days: { mill: TODAY } } });
    h.store.editLine(dairy, { ...butter, supplierId: 'dairy' }, { qty: 6 });
    expect(h.pendingTimer()).toBe(true);

    await h.store.place(one({ flour: 4 }), NO_SUPPLIER);

    expect(h.source.writes.at(-1)?.entries).toStrictEqual({ butter: { qty: 6, unit: '', supplierId: '' } });
    expect((h.source.draft as { entries: Record<string, unknown> }).entries).toStrictEqual({ butter: { qty: 6, unit: '', supplierId: '' } });
  });

  it('a refused record writes nothing and leaves the order as it was (before the point of no return)', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4, stock: 1 } }, days: { mill: TODAY } } });
    h.source.fail.record = true;

    const report = await h.store.place(one({ flour: 4 }), NO_SUPPLIER);

    expect(report).toStrictEqual({ offline: false, outcomes: [{ supplierId: 'mill', kind: 'failed' }] });
    expect(h.source.records.size).toBe(0);
    expect(h.source.clears).toHaveLength(0);
    expect(h.store.getSnapshot().draft.entries.flour).toMatchObject({ qty: 4, stock: 1 });
    expect(h.store.getSnapshot().placing).toStrictEqual([]);
    expect(h.busy()).toBe(0);
  });

  it('a refused clear AFTER the record says «recorded, not cleared» — never «not saved» (after the point of no return)', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4, stock: 0 } }, days: { mill: TODAY } } });
    h.source.fail.clear = true;

    const report = await h.store.place(one({ flour: 4 }), NO_SUPPLIER);

    expect(report).toStrictEqual({ offline: false, outcomes: [{ supplierId: 'mill', kind: 'not-cleared' }] });
    expect(h.source.records.get(RECORD)!.quantities).toStrictEqual({ flour: 4 });
    expect(h.store.getSnapshot().placing).toStrictEqual([]);
    expect(h.busy()).toBe(0);
  });

  it('a unit the day\'s record cannot add to is refused inside the write: nothing recorded, nothing cleared', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 2, stock: 0, unit: 'sacco' } }, days: { mill: TODAY } } });
    h.source.records.set(RECORD, {
      date: TODAY, supplierId: 'mill', supplierName: 'Mill', quantities: { flour: 3 }, stock: {}, names: {},
      createdAt: NOW, updatedAt: NOW,
    });

    const report = await h.store.place(one({ flour: 2 }, { flour: 'sacco' }), NO_SUPPLIER);

    expect(report).toStrictEqual({ offline: false, outcomes: [{ supplierId: 'mill', kind: 'unit-conflict', ids: ['flour'] }] });
    expect(h.source.records.get(RECORD)!.quantities).toStrictEqual({ flour: 3 });
    expect(h.source.clears).toHaveLength(0);
    expect(h.busy()).toBe(0);
  });

  it('is refused offline before anything is written (parity X3)', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4, stock: 0 } }, days: { mill: TODAY } } });
    h.goOffline();

    expect(await h.store.place(one({ flour: 4 }), NO_SUPPLIER)).toStrictEqual({ offline: true });
    expect(h.source.recordAttempts).toBe(0);
  });

  it('a second tap while the first is being written records nothing more (parity X1)', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4, stock: 0 } }, days: { mill: TODAY } } });

    const [first, second] = await Promise.all([
      h.store.place(one({ flour: 4 }), NO_SUPPLIER),
      h.store.place(one({ flour: 4 }), NO_SUPPLIER),
    ]);

    expect([first, second]).toContainEqual({ offline: false, outcomes: [{ supplierId: 'mill', kind: 'busy' }] });
    expect(h.source.recordAttempts).toBe(1);
    expect(h.source.records.get(RECORD)!.quantities).toStrictEqual({ flour: 4 });
  });

  it('nothing confirmed is not an order: no record, no clear', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4, stock: 0 } }, days: { mill: TODAY } } });

    const report = await h.store.place(one({}), NO_SUPPLIER);

    expect(report).toStrictEqual({ offline: false, outcomes: [{ supplierId: 'mill', kind: 'nothing' }] });
    expect(h.source.recordAttempts).toBe(0);
  });

  it('several suppliers are recorded one after the other, each under its own day; one failing does not stop the next', async () => {
    const h = await started({
      draft: { entries: { flour: { qty: 4, stock: 0 }, butter: { qty: 1, stock: 0 } }, days: { mill: TODAY, dairy: '2026-10-26' } },
    });
    h.source.fail.record = true;

    const report = await h.store.place([
      { supplierId: 'mill', date: TODAY, quantities: { flour: 4 }, units: {} },
      { supplierId: 'dairy', date: '2026-10-26', quantities: { butter: 1 }, units: {} },
    ], NO_SUPPLIER);

    expect(report).toStrictEqual({
      offline: false,
      outcomes: [{ supplierId: 'mill', kind: 'failed' }, { supplierId: 'dairy', kind: 'saved' }],
    });
    expect(h.source.records.get('2026-10-26_dairy')!.quantities).toStrictEqual({ butter: 1 });
    expect(h.store.getSnapshot().draft.entries.flour).toMatchObject({ qty: 4 });
  });
});

describe('ordersStore — placing while another phone works (found in the review of 3f-2)', () => {
  it('⚠️ a line a colleague types while the record is written, not on the confirm screen, stays in the order', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4, stock: 0 } }, days: { mill: TODAY } } });
    h.source.duringRecord = () => { h.source.remoteMerge({ entries: { semola: { qty: 5, stock: 0 } } }); };

    const report = await h.store.place(one({ flour: 4 }, { flour: '' }), NO_SUPPLIER);

    expect(report).toStrictEqual({ offline: false, outcomes: [{ supplierId: 'mill', kind: 'saved' }] });
    expect(h.source.records.get(RECORD)!.quantities).toStrictEqual({ flour: 4 });
    expect(h.source.clears[0]!.paths).not.toContain('entries.semola');
    expect((h.source.draft as { entries: Record<string, unknown> }).entries).toStrictEqual({ semola: { qty: 5, stock: 0 } });
    expect(h.store.getSnapshot().draft.entries.semola).toMatchObject({ qty: 5 });
  });

  it('a supplier gone since the screen opened is NOT recorded and says so; the others are', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4, stock: 0 } }, days: { mill: TODAY } } });

    const report = await h.store.place([
      { supplierId: 'gone', date: TODAY, quantities: { lost: 1 }, units: {} },
      { supplierId: 'mill', date: TODAY, quantities: { flour: 4 }, units: {} },
    ], NO_SUPPLIER);

    expect(report).toStrictEqual({
      offline: false,
      outcomes: [{ supplierId: 'gone', kind: 'failed' }, { supplierId: 'mill', kind: 'saved' }],
    });
    expect(h.source.recordAttempts).toBe(1);
  });

  it('⚠️ an autosave still in the air is answered BEFORE the record: refused twice, nothing is recorded and the typing stays', async () => {
    const h = await started({ draft: { entries: {}, days: {} } });
    h.source.refuseWrites = true;
    const release = h.source.holdWrites();
    h.store.editLine(mill, flour, { qty: 4 });
    await h.autosave();

    const placing = h.store.place(one({ flour: 4 }), NO_SUPPLIER);
    release();
    const report = await placing;

    expect(report).toStrictEqual({ offline: false, outcomes: [{ supplierId: 'mill', kind: 'failed' }] });
    expect(h.source.recordAttempts).toBe(0);
    expect(h.store.getSnapshot().draft.entries.flour).toMatchObject({ qty: 4 });
  });

  it('after placing, typing the same number again on that line is sent (the baseline forgot it)', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4, stock: 0 } }, days: { mill: TODAY } } });
    await h.store.place(one({ flour: 4 }), NO_SUPPLIER);
    const before = h.source.writes.length;

    h.store.editLine(mill, flour, { qty: 4 });
    await h.autosave();

    expect(h.source.writes.slice(before).at(-1)?.entries).toStrictEqual({ flour: { qty: 4, unit: '', supplierId: '' } });
    expect(h.busy()).toBe(0);
  });
});

describe('ordersStore — Clear quantities (parity X11)', () => {
  it('clears the quantities, units, overrides and days of the chosen suppliers in ONE write, and keeps the stock', async () => {
    const h = await started({
      draft: {
        entries: {
          flour: { qty: 4, stock: 2 }, yeast: { qty: 1, stock: 0, unit: 'busta' }, butter: { qty: 3, stock: 1 },
        },
        days: { mill: TODAY, dairy: TODAY },
      },
    });

    expect(await h.store.clearQuantities(['mill'], NO_SUPPLIER)).toBe('cleared');

    expect(h.source.clears).toHaveLength(1);
    expect(h.source.clears[0]!.paths).toContain('entries.flour.qty');
    expect(h.source.clears[0]!.paths).toContain('days.mill');
    const draft = h.source.draft as { entries: Record<string, unknown>; days: Record<string, string> };
    expect(draft.entries.flour).toStrictEqual({ stock: 2 });
    expect(draft.entries.butter).toStrictEqual({ qty: 3, stock: 1 });
    expect(draft.days).toStrictEqual({ dairy: TODAY });
    expect(h.source.records.size).toBe(0);
    expect(h.store.getSnapshot().draft.entries.flour).toStrictEqual({ stock: 2 });
  });

  it('is refused offline, and a refused clear is said', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4, stock: 0 } }, days: { mill: TODAY } } });
    h.source.fail.clear = true;
    expect(await h.store.clearQuantities(['mill'], NO_SUPPLIER)).toBe('failed');
    h.goOffline();
    expect(await h.store.clearQuantities(['mill'], NO_SUPPLIER)).toBe('offline');
  });

  it('a stock reading typed here and not yet sent survives the clear', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4, stock: 0 } }, days: { mill: TODAY } } });
    h.store.editLine(mill, { ...semola, supplierId: 'mill' }, { stock: 7 });
    expect(h.pendingTimer()).toBe(true);

    expect(await h.store.clearQuantities(['mill'], NO_SUPPLIER)).toBe('cleared');

    expect((h.source.draft as { entries: Record<string, unknown> }).entries.semola).toStrictEqual({ stock: 7 });
    expect(h.store.getSnapshot().draft.entries.semola).toStrictEqual({ stock: 7 });
  });
});

describe('ordersStore — the day line (parity D7)', () => {
  it('writes the chosen day at once, without the pause', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4, stock: 0 } }, days: { mill: TODAY } } });

    h.store.setDay(mill, '2026-10-29');
    await h.settle();

    expect(h.source.writes.at(-1)).toStrictEqual({ updatedAt: NOW, days: { mill: '2026-10-29' } });
    expect(h.store.getSnapshot().draft.days.mill).toBe('2026-10-29');
    expect(h.busy()).toBe(0);
  });

  it('a refused day goes back to the stored one and is said', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4, stock: 0 } }, days: { mill: TODAY } } });
    h.source.refuseWrites = true;

    h.store.setDay(mill, '2026-10-29');
    await h.settle();

    expect(h.store.getSnapshot().draft.days.mill).toBe(TODAY);
    expect(h.messages).toContainEqual({ kind: 'day-not-saved' });
  });
});

describe('ordersStore — the record check before the confirm screen (parity X2, X7)', () => {
  it('says whether today\'s record exists, and which lines it holds in a unit the order cannot be added to', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 2, stock: 0, unit: 'sacco' } }, days: { mill: TODAY } } });
    h.source.records.set(RECORD, { date: TODAY, supplierId: 'mill', quantities: { flour: 3 } });

    const [check] = await h.store.checkRecords([{ supplierId: 'mill', date: TODAY }], NO_SUPPLIER);

    expect(check).toMatchObject({ supplierId: 'mill', date: TODAY, exists: true });
    expect(check!.conflicts.map(c => c.id)).toStrictEqual(['flour']);
  });

  it('a record that cannot be read counts as none, and never stops the order', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 2, stock: 0 } }, days: { mill: TODAY } } });
    h.source.fail.read = true;

    const [check] = await h.store.checkRecords([{ supplierId: 'mill', date: TODAY }], NO_SUPPLIER);

    expect(check).toStrictEqual({ supplierId: 'mill', date: TODAY, exists: false, conflicts: [] });
  });
});
