// «Order to X sent at 10:42: did it go?» in the store (ordersStore.ts, the port of v1.145.0): the question written whole under
// drafts/current.awaitingSent, shown on every device, and answered once — whoever answers «Yes» first CLAIMS it and records the
// STORED quantities, never what the draft says now. Ports the cases of tests/awaiting-sent.test.mjs and
// tests/order-sent-check.test.mjs (on `main`), against an in-memory source whose claim and restore can be made to reject.

import { afterEach, describe, expect, it } from 'vitest';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { createOrdersStore } from './ordersStore';
import type { OrdersDeps, OrdersMessage, OrdersStore } from './ordersStore';
import type { StoredDoc } from './ordersSource';

const TODAY = '2026-11-15';
const NOW = '2026-11-15T09:00:00.000Z';
const NO_SUPPLIER = 'No supplier';
const RECORD = `${TODAY}_mill`;

const mill: StoredDoc = { id: 'mill', name: 'Mill' };
const dairy: StoredDoc = { id: 'dairy', name: 'Dairy' };
const flour: StoredDoc = { id: 'flour', name: 'Flour', supplierId: 'mill' };
const semola: StoredDoc = { id: 'semola', name: 'Semola', supplierId: 'mill' };
const butter: StoredDoc = { id: 'butter', name: 'Butter', supplierId: 'dairy' };

interface Device {
  store: OrdersStore;
  messages: OrdersMessage[];
  visible: (on: boolean) => void;
  online: (on: boolean) => void;
  comeOnline: () => void;
  setNow: (iso: string) => void;
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
let stops: Array<() => void> = [];
afterEach(() => { stops.forEach(stop => stop()); stops = []; });

function device(source: FakeOrdersSource, options: { visible?: boolean } = {}): Device {
  let connected = true;
  let visible = options.visible ?? true;
  let now = NOW;
  const visibleListeners = new Set<() => void>();
  const onlineListeners = new Set<() => void>();
  const deps: OrdersDeps = {
    markBusy: () => () => {},
    today: () => TODAY,
    draft: { nowIso: () => now, setTimer: () => 1, clearTimer: () => {} },
    online: () => connected,
    page: {
      visible: () => visible,
      onVisible: run => { visibleListeners.add(run); return () => { visibleListeners.delete(run); }; },
    },
    onOnline: run => { onlineListeners.add(run); return () => { onlineListeners.delete(run); }; },
  };
  const store = createOrdersStore(source, deps);
  const messages: OrdersMessage[] = [];
  store.onMessage(message => messages.push(message));
  store.start();
  stops.push(() => store.stop());
  return {
    store, messages,
    visible: on => { visible = on; if (on) visibleListeners.forEach(run => { run(); }); },
    online: on => { connected = on; },
    comeOnline: () => { connected = true; onlineListeners.forEach(run => { run(); }); },
    setNow: iso => { now = iso; },
  };
}

async function started(init: Parameters<typeof fakeOrdersSource>[0] = {}) {
  const source = fakeOrdersSource({ suppliers: [mill, dairy], ingredients: [flour, semola, butter], ...init });
  const first = device(source);
  await settle();
  return { source, ...first, device: first, another: () => { const d = device(source); return d; } };
}

const never = () => Promise.reject(new Error('the question must not be asked'));
const go = (h: { store: OrdersStore }, answer: 'yes' | 'no', at: string, ask: () => Promise<boolean> = never) =>
  h.store.answerAwaiting('mill', answer, at, ask, NO_SUPPLIER);
const waiting = (h: { source: FakeOrdersSource }) => (h.source.draft?.awaitingSent ?? {}) as Record<string, { at: string }>;

describe('ordersStore — «did it go?» written and shown', () => {
  it('writes ONE whole entry per supplier, with one `at` for the batch, and shows it', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4 }, butter: { qty: 2 } }, days: { mill: TODAY, dairy: TODAY } } });
    h.store.waitForAnswer([
      { supplierId: 'mill', quantities: { flour: 4 }, units: {} },
      { supplierId: 'dairy', quantities: { butter: 2 }, units: { butter: 'box' } },
    ], 'text');
    await settle();

    expect(h.source.awaitingWrites.map(w => w.op)).toStrictEqual(['set', 'set']);
    expect(waiting(h).mill).toStrictEqual({ at: NOW, date: TODAY, quantities: { flour: 4 }, units: {} });
    expect(waiting(h).dairy).toStrictEqual({ at: NOW, date: TODAY, quantities: { butter: 2 }, units: { butter: 'box' } });
    const questions = h.store.getSnapshot().awaiting.questions;
    expect(questions.map(q => q.supplierId)).toStrictEqual(['mill', 'dairy']);
    expect(questions.every(q => !q.local)).toBe(true);
  });

  it('keeps the draft`s `draft` field only when the confirmed numbers differ from what the draft said', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 5 } }, days: { mill: TODAY } } });
    h.store.waitForAnswer([{ supplierId: 'mill', quantities: { flour: 3 }, units: {}, draft: { quantities: { flour: 5 }, units: {} } }], 'text');
    await settle();
    expect(waiting(h).mill).toMatchObject({ quantities: { flour: 3 }, draft: { quantities: { flour: 5 }, units: {} } });
  });

  it('writes nothing for a supplier that sent no line', async () => {
    const h = await started();
    h.store.waitForAnswer([{ supplierId: 'mill', quantities: {}, units: {} }], 'text');
    await settle();
    expect(h.source.awaitingWrites).toStrictEqual([]);
  });

  it('files the entry under the day of the supplier`s lines when no day is given', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4 } }, days: { mill: '2026-11-14' } } });
    h.store.waitForAnswer([{ supplierId: 'mill', quantities: { flour: 4 }, units: {} }], 'text');
    await settle();
    expect((waiting(h).mill as unknown as { date: string }).date).toBe('2026-11-14');
  });

  it('a REFUSED write keeps the question on THIS device, says so, and answers it without a claim', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4 } }, days: { mill: TODAY } } });
    h.source.failAwaiting.set = true;
    h.store.waitForAnswer([{ supplierId: 'mill', quantities: { flour: 4 }, units: {} }], 'text');
    await settle();

    expect(h.messages).toContainEqual({ kind: 'awaiting-not-shared', supplierId: 'mill' });
    const [question] = h.store.getSnapshot().awaiting.questions;
    expect(question).toMatchObject({ supplierId: 'mill', local: true });
    expect(waiting(h).mill).toBeUndefined();

    const outcome = await go(h, 'yes', question!.entry.at);
    expect(outcome).toMatchObject({ kind: 'recorded', place: { kind: 'saved' } });
    expect(h.source.awaitingWrites.some(w => w.op === 'claim')).toBe(false);
    expect(h.source.records.get(RECORD)?.quantities).toStrictEqual({ flour: 4 });
    expect(h.store.getSnapshot().awaiting.questions).toStrictEqual([]);
  });

  it('shows the draft`s questions and the local ones, a question in both only once', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4 }, butter: { qty: 2 } }, days: {} } });
    h.source.failAwaiting.set = true;
    h.store.waitForAnswer([{ supplierId: 'mill', quantities: { flour: 4 }, units: {} }], 'text');
    await settle();
    h.setNow('2026-11-15T09:05:00.000Z');
    h.store.waitForAnswer([{ supplierId: 'dairy', quantities: { butter: 2 }, units: {} }], 'text');
    await settle();
    expect(h.store.getSnapshot().awaiting.questions.map(q => [q.supplierId, q.local])).toStrictEqual([['mill', true], ['dairy', false]]);
    // The shared order gets a question for the mill from somebody else: the draft`s wins, once.
    h.source.remoteMerge({ awaitingSent: { mill: { at: '2026-11-15T10:00:00.000Z', date: TODAY, quantities: { flour: 4 }, units: {} } } });
    await settle();
    expect(h.store.getSnapshot().awaiting.questions.map(q => [q.supplierId, q.local])).toStrictEqual([['dairy', false], ['mill', false]]);
  });

  it('shows no question for a supplier Orders cannot record for (switched off)', async () => {
    const h = await started({
      suppliers: [mill, { id: 'dairy', name: 'Dairy', active: false }],
      draft: { entries: { butter: { qty: 2 } }, days: {} },
    });
    h.store.waitForAnswer([{ supplierId: 'dairy', quantities: { butter: 2 }, units: {} }], 'text');
    await settle();
    expect(h.store.getSnapshot().awaiting.questions).toStrictEqual([]);
  });
});

describe('ordersStore — «Yes»: claim, then record what WENT', () => {
  async function sent() {
    const h = await started({ draft: { entries: { flour: { qty: 4 }, semola: { qty: 2 } }, days: { mill: TODAY } } });
    h.store.waitForAnswer([{ supplierId: 'mill', quantities: { flour: 4, semola: 2 }, units: {} }], 'text');
    await settle();
    return h;
  }

  it('records the STORED quantities on the stored day and clears only the lines still reading what went', async () => {
    const h = await sent();
    // Somebody types after the send: the flour is corrected to 6 and a new line is added.
    h.source.remoteMerge({ entries: { flour: { qty: 6 } } });
    await settle();

    const outcome = await go(h, 'yes', NOW);

    expect(outcome).toMatchObject({ kind: 'recorded', place: { kind: 'saved' } });
    expect(h.source.records.get(RECORD)?.quantities).toStrictEqual({ flour: 4, semola: 2 });
    expect(h.source.awaitingWrites.map(w => w.op)).toStrictEqual(['set', 'claim']);
    // The semola still read 2 and goes; the flour now says 6, which is the next order: it stays, and so does the day.
    const draft = h.source.draft as { entries: Record<string, unknown>; days: Record<string, string> };
    expect(draft.entries).toStrictEqual({ flour: { qty: 6 } });
    expect(draft.days).toStrictEqual({ mill: TODAY });
    expect(waiting(h).mill).toBeUndefined();
    expect(h.source.clears[0]!.paths).toStrictEqual(['entries.semola']);
  });

  it('clears the day stamp too when nothing of the supplier is left', async () => {
    const h = await sent();
    await go(h, 'yes', NOW);
    const draft = h.source.draft as { entries: Record<string, unknown>; days: Record<string, string> };
    expect(draft.entries).toStrictEqual({});
    expect(draft.days).toStrictEqual({});
    expect([...h.source.clears[0]!.paths].sort()).toStrictEqual(['days.mill', 'entries.flour', 'entries.semola']);
  });

  it('records on the day the order was for, not the day it is answered', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4 } }, days: { mill: '2026-11-13' } } });
    h.store.waitForAnswer([{ supplierId: 'mill', quantities: { flour: 4 }, units: {}, date: '2026-11-13' }], 'text');
    await settle();
    await go(h, 'yes', NOW);
    expect(h.source.records.has('2026-11-13_mill')).toBe(true);
    expect(h.source.records.has(RECORD)).toBe(false);
  });

  it('a line moved to another supplier since is still recorded under the one it went to', async () => {
    const h = await sent();
    h.source.remoteMerge({ entries: { semola: { supplierId: 'dairy' } } });
    await settle();
    await go(h, 'yes', NOW);
    expect(h.source.records.get(RECORD)?.quantities).toStrictEqual({ flour: 4, semola: 2 });
  });

  it('clears by what the DRAFT said when the review screen had corrected the numbers', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 5 } }, days: { mill: TODAY } } });
    h.store.waitForAnswer([{ supplierId: 'mill', quantities: { flour: 3 }, units: {}, draft: { quantities: { flour: 5 }, units: {} } }], 'text');
    await settle();
    await go(h, 'yes', NOW);
    expect(h.source.records.get(RECORD)?.quantities).toStrictEqual({ flour: 3 });
    expect((h.source.draft as { entries: object }).entries).toStrictEqual({});
  });

  it('two devices answering together record ONCE: the loser is told it was answered elsewhere', async () => {
    const h = await sent();
    const second = h.another();
    await settle();
    const [a, b] = await Promise.all([go(h, 'yes', NOW), go(second, 'yes', NOW)]);
    expect([a.kind, b.kind].sort()).toStrictEqual(['elsewhere', 'recorded']);
    expect(h.source.records.get(RECORD)?.quantities).toStrictEqual({ flour: 4, semola: 2 });
  });

  it('answers «elsewhere» when the question is gone or a newer send stands', async () => {
    const h = await sent();
    expect(await go(h, 'yes', '2026-11-15T08:00:00.000Z')).toStrictEqual({ kind: 'elsewhere' });
    h.source.remoteMerge({});
    await go(h, 'no', NOW);
    expect(await go(h, 'yes', NOW)).toStrictEqual({ kind: 'elsewhere' });
    expect(h.source.records.size).toBe(0);
  });

  it('a claim that cannot be made records nothing and leaves the question standing', async () => {
    const h = await sent();
    h.source.failAwaiting.claim = true;
    expect(await go(h, 'yes', NOW)).toStrictEqual({ kind: 'claim-failed' });
    expect(h.source.records.size).toBe(0);
    expect(waiting(h).mill).toBeDefined();
    expect(h.store.getSnapshot().awaiting.busy).toStrictEqual([]);
  });

  it('a recording that fails puts the question back, so it is asked again', async () => {
    const h = await sent();
    h.source.fail.record = true;
    const outcome = await go(h, 'yes', NOW);
    expect(outcome.kind).toBe('failed');
    await settle();
    expect(waiting(h).mill?.at).toBe(NOW);
    expect(h.source.records.size).toBe(0);
    // Asked again, and this time it works.
    expect((await go(h, 'yes', NOW)).kind).toBe('recorded');
    expect(h.source.records.get(RECORD)?.quantities).toStrictEqual({ flour: 4, semola: 2 });
  });

  it('a question put back is NOT written over a newer send that stands there now', async () => {
    const h = await sent();
    const newer = { at: '2026-11-15T10:00:00.000Z', date: TODAY, quantities: { flour: 9 }, units: {} };
    h.source.fail.record = true;
    h.source.duringRecord = () => { h.source.remoteMerge({ awaitingSent: { mill: newer } }); };
    await go(h, 'yes', NOW);
    await settle();
    expect(waiting(h).mill).toStrictEqual(newer);
    expect(h.store.getSnapshot().awaiting.questions.map(q => q.local)).toStrictEqual([false]);
  });

  it('offline, a question that cannot be put back stays on THIS device, is retried when the connection returns, and is not retried once answered', async () => {
    const h = await sent();
    h.source.fail.record = true;
    h.source.failAwaiting.restore = true;
    const outcome = await go(h, 'yes', NOW);
    expect(outcome.kind).toBe('failed');
    await settle();
    expect(waiting(h).mill).toBeUndefined();
    expect(h.store.getSnapshot().awaiting.questions).toMatchObject([{ supplierId: 'mill', local: true }]);
    expect(h.messages).toContainEqual({ kind: 'awaiting-not-shared', supplierId: 'mill' });

    // The connection returns: the question goes back to the shared order and the local copy goes.
    h.comeOnline();
    await settle();
    expect(waiting(h).mill?.at).toBe(NOW);
    expect(h.store.getSnapshot().awaiting.questions).toMatchObject([{ supplierId: 'mill', local: false }]);
  });

  it('a kept question answered here meanwhile is not put back later', async () => {
    const h = await sent();
    h.source.fail.record = true;
    h.source.failAwaiting.restore = true;
    await go(h, 'yes', NOW);
    await settle();
    // Answered «No» on this device: the local copy goes.
    expect((await go(h, 'no', NOW)).kind).toBe('kept');
    h.comeOnline();
    await settle();
    expect(waiting(h).mill).toBeUndefined();
    expect(h.source.awaitingWrites.filter(w => w.op === 'restore')).toHaveLength(1);
  });

  it('«Yes» offline is refused and nothing is done', async () => {
    const h = await sent();
    h.device.online(false);
    expect(await go(h, 'yes', NOW)).toStrictEqual({ kind: 'offline' });
    expect(h.source.awaitingWrites.some(w => w.op === 'claim')).toBe(false);
    expect(waiting(h).mill).toBeDefined();
  });

  it('a second tap while the answer is under way is ignored', async () => {
    const h = await sent();
    const first = go(h, 'yes', NOW);
    expect(h.store.getSnapshot().awaiting.busy).toStrictEqual(['mill']);
    expect(await go(h, 'yes', NOW)).toStrictEqual({ kind: 'busy' });
    await first;
    expect(h.store.getSnapshot().awaiting.busy).toStrictEqual([]);
    expect(h.source.records.get(RECORD)?.quantities).toStrictEqual({ flour: 4, semola: 2 });
  });
});

describe('ordersStore — «No» and «maybe already recorded»', () => {
  async function sent() {
    const h = await started({ draft: { entries: { flour: { qty: 4 }, semola: { qty: 2 } }, days: { mill: TODAY } } });
    h.store.waitForAnswer([{ supplierId: 'mill', quantities: { flour: 4, semola: 2 }, units: {} }], 'text');
    await settle();
    return h;
  }

  it('«No» removes only the key: the quantities stay in the order', async () => {
    const h = await sent();
    expect(await go(h, 'no', NOW)).toStrictEqual({ kind: 'kept' });
    await settle();
    expect(waiting(h).mill).toBeUndefined();
    expect((h.source.draft as { entries: object }).entries).toStrictEqual({ flour: { qty: 4 }, semola: { qty: 2 } });
    expect(h.source.records.size).toBe(0);
  });

  it('asks «maybe already recorded» ONLY when History holds every line at least as large', async () => {
    const h = await started({
      draft: { entries: { flour: { qty: 4 }, semola: { qty: 2 } }, days: { mill: TODAY } },
      records: { [RECORD]: { date: TODAY, supplierId: 'mill', supplierName: 'Mill', quantities: { flour: 4, semola: 2 } } },
    });
    h.store.waitForAnswer([{ supplierId: 'mill', quantities: { flour: 4, semola: 2 }, units: {} }], 'text');
    await settle();
    let asked = 0;
    const outcome = await go(h, 'yes', NOW, () => { asked += 1; return Promise.resolve(false); });
    expect(asked).toBe(1);
    // «Don't record»: handled as «No» — the key goes, nothing is recorded again.
    expect(outcome).toStrictEqual({ kind: 'declined' });
    await settle();
    expect(waiting(h).mill).toBeUndefined();
    expect(h.source.records.get(RECORD)?.quantities).toStrictEqual({ flour: 4, semola: 2 });
    expect(h.source.awaitingWrites.some(w => w.op === 'claim')).toBe(false);
  });

  it('«Record again» goes on to record', async () => {
    const h = await started({
      draft: { entries: { flour: { qty: 4 } }, days: { mill: TODAY } },
      records: { [RECORD]: { date: TODAY, supplierId: 'mill', supplierName: 'Mill', quantities: { flour: 4 } } },
    });
    h.store.waitForAnswer([{ supplierId: 'mill', quantities: { flour: 4 }, units: {} }], 'text');
    await settle();
    expect((await go(h, 'yes', NOW, () => Promise.resolve(true))).kind).toBe('recorded');
  });

  it('is NOT asked when History holds the order only in part, or not at all', async () => {
    const part = await started({
      draft: { entries: { flour: { qty: 4 }, semola: { qty: 2 } }, days: { mill: TODAY } },
      records: { [RECORD]: { date: TODAY, supplierId: 'mill', supplierName: 'Mill', quantities: { flour: 4 } } },
    });
    part.store.waitForAnswer([{ supplierId: 'mill', quantities: { flour: 4, semola: 2 }, units: {} }], 'text');
    await settle();
    expect((await go(part, 'yes', NOW)).kind).toBe('recorded');
  });

  it('answered on another device while the «maybe recorded» question was open: nothing is done', async () => {
    const h = await started({
      draft: { entries: { flour: { qty: 4 } }, days: { mill: TODAY } },
      records: { [RECORD]: { date: TODAY, supplierId: 'mill', supplierName: 'Mill', quantities: { flour: 4 } } },
    });
    h.store.waitForAnswer([{ supplierId: 'mill', quantities: { flour: 4 }, units: {} }], 'text');
    await settle();
    const outcome = await go(h, 'yes', NOW, () => {
      h.source.remoteMerge({ awaitingSent: { mill: { at: '2026-11-15T11:00:00.000Z', date: TODAY, quantities: { flour: 1 }, units: {} } } });
      return Promise.resolve(true);
    });
    expect(outcome).toStrictEqual({ kind: 'elsewhere' });
  });
});

describe('ordersStore — recording a supplier any other way answers its question', () => {
  it('a normal place removes the key (and a local copy)', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4 } }, days: { mill: TODAY } } });
    h.store.waitForAnswer([{ supplierId: 'mill', quantities: { flour: 4 }, units: {} }], 'text');
    await settle();
    expect(waiting(h).mill).toBeDefined();
    await h.store.place([{ supplierId: 'mill', date: TODAY, quantities: { flour: 4 }, units: { flour: '' } }], NO_SUPPLIER);
    await settle();
    expect(waiting(h).mill).toBeUndefined();
    expect(h.store.getSnapshot().awaiting.questions).toStrictEqual([]);
  });

  it('a local question is forgotten too', async () => {
    const h = await started({ draft: { entries: { flour: { qty: 4 } }, days: { mill: TODAY } } });
    h.source.failAwaiting.set = true;
    h.store.waitForAnswer([{ supplierId: 'mill', quantities: { flour: 4 }, units: {} }], 'text');
    await settle();
    expect(h.store.getSnapshot().awaiting.questions).toHaveLength(1);
    await h.store.place([{ supplierId: 'mill', date: TODAY, quantities: { flour: 4 }, units: { flour: '' } }], NO_SUPPLIER);
    expect(h.store.getSnapshot().awaiting.questions).toStrictEqual([]);
  });
});

describe('ordersStore — the sender`s own dialog', () => {
  async function sentWith(handOff: 'share' | 'text', visible = true) {
    const source = fakeOrdersSource({ suppliers: [mill, dairy], ingredients: [flour, semola, butter], draft: { entries: { flour: { qty: 4 } }, days: { mill: TODAY } } });
    const h = device(source, { visible });
    await settle();
    h.store.waitForAnswer([{ supplierId: 'mill', quantities: { flour: 4 }, units: {} }], handOff);
    await settle();
    return { source, h };
  }

  it('asks at once after the share sheet answered while the page is visible', async () => {
    const { h } = await sentWith('share');
    expect(h.store.getSnapshot().awaiting.ask).toStrictEqual({ supplierId: 'mill', at: NOW });
  });

  it('waits for the page to come back after a window was opened', async () => {
    const { h } = await sentWith('text');
    expect(h.store.getSnapshot().awaiting.ask).toBeNull();
    h.visible(false);
    h.visible(true);
    expect(h.store.getSnapshot().awaiting.ask).toStrictEqual({ supplierId: 'mill', at: NOW });
  });

  it('does not ask while the page is hidden', async () => {
    const { h } = await sentWith('share', false);
    expect(h.store.getSnapshot().awaiting.ask).toBeNull();
  });

  it('a device that did not send it never asks', async () => {
    const { source } = await sentWith('share');
    const other = device(source);
    other.visible(true);
    await settle();
    expect(other.store.getSnapshot().awaiting.ask).toBeNull();
    expect(other.store.getSnapshot().awaiting.questions).toHaveLength(1);
  });

  it('stops asking once another device answered, or a newer send stands', async () => {
    const { source, h } = await sentWith('share');
    source.remoteMerge({ awaitingSent: { mill: { at: '2026-11-15T12:00:00.000Z', date: TODAY, quantities: { flour: 4 }, units: {} } } });
    await settle();
    expect(h.store.getSnapshot().awaiting.ask).toBeNull();
  });

  it('is left to the banner by Escape: the question stays, the dialog does not come back', async () => {
    const { h } = await sentWith('share');
    h.store.leaveAskToBanner('mill');
    expect(h.store.getSnapshot().awaiting.ask).toBeNull();
    expect(h.store.getSnapshot().awaiting.questions).toHaveLength(1);
  });

  it('a question that could not be shared is asked here, in the dialog', async () => {
    const source = fakeOrdersSource({ suppliers: [mill], ingredients: [flour], draft: { entries: { flour: { qty: 4 } }, days: { mill: TODAY } } });
    const h = device(source);
    await settle();
    source.failAwaiting.set = true;
    h.store.waitForAnswer([{ supplierId: 'mill', quantities: { flour: 4 }, units: {} }], 'share');
    await settle();
    expect(h.store.getSnapshot().awaiting.ask).toStrictEqual({ supplierId: 'mill', at: NOW });
  });
});
