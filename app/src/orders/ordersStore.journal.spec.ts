// The Orders store wired to the note of typed quantities that outlives the page (F-15): the venue's note, the server's first
// answer, the orders read from the SERVER before anything comes back, the section told so it can look again for orders never
// placed, and the page going out of sight. What the note decides is draftSync.journal.spec.ts; here, only that the store hands
// it what it needs.

import { afterEach, describe, expect, it } from 'vitest';
import { DRAFT_JOURNAL_KEY } from '@mise/shared/draft-journal';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { createOrdersStore } from './ordersStore';
import type { OrdersDeps } from './ordersStore';
import type { StoredDoc } from './ordersSource';

// 2026-10-27 is a Tuesday.
const TODAY = '2026-10-27';
const NOW = Date.parse('2026-10-27T09:00:00.000Z');
const VENUE = 'venue-a';

const flour: StoredDoc = { id: 'flour', name: 'Flour', supplierId: 'mill' };
const mill: StoredDoc = { id: 'mill', name: 'Mill', orderDays: ['Thursday'] };

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, String(value)); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

const settle = () => new Promise(resolve => { setTimeout(resolve, 0); });
let stops: Array<() => void> = [];
afterEach(() => { stops.forEach(stop => stop()); stops = []; });

// One device: its storage, and the page-hidden listener the store registers.
function device() {
  const storage = fakeStorage();
  const hidden = { run: null as (() => void) | null, subscribed: 0 };
  function open(source: FakeOrdersSource, venue = VENUE) {
    let timer: (() => void) | null = null;
    const deps: OrdersDeps = {
      markBusy: () => () => undefined,
      today: () => TODAY,
      draft: {
        nowIso: () => new Date(NOW).toISOString(),
        setTimer: run => { timer = run; return 1; },
        clearTimer: () => { timer = null; },
      },
      online: () => true,
      journal: {
        storage: () => storage,
        now: () => NOW,
        retryLater: () => undefined,
        onPageHidden: run => {
          hidden.run = run;
          hidden.subscribed += 1;
          return () => { hidden.run = null; hidden.subscribed -= 1; };
        },
      },
    };
    const store = createOrdersStore(source, deps, venue);
    store.start();
    stops.push(() => store.stop());
    const autosave = async () => {
      const run = timer;
      timer = null;
      run?.();
      await settle();
    };
    return { store, autosave };
  }
  return { storage, hidden, open };
}

describe('ordersStore — the note of typed quantities (F-15)', () => {
  it('a number typed and the page gone comes back on the next opening, once the server has answered and the orders were read', async () => {
    const d = device();
    const first = fakeOrdersSource({ suppliers: [mill], ingredients: [flour], draft: { entries: {}, days: {} } });
    const page = d.open(first);
    await settle();
    page.store.editLine(mill, flour, { qty: 4 });
    expect(JSON.parse(d.storage.getItem(DRAFT_JOURNAL_KEY) ?? 'null')?.lid).toBe(VENUE);
    // No pause: the page is gone before anything left it.
    expect(first.writes).toEqual([]);

    const server = fakeOrdersSource({ suppliers: [mill], ingredients: [flour], draft: { entries: {}, days: {} } });
    const next = d.open(server);
    await settle();
    await settle();
    expect(server.recentReads).toEqual(['2026-10-20']); // the orders of the last seven days, from the server
    const snap = next.store.getSnapshot();
    expect(snap.draft.entries.flour?.qty).toBe(4);
    expect(snap.draftCameBack).toBe(1);
    await next.autosave();
    expect(server.writes).toEqual([{
      updatedAt: '2026-10-27T09:00:00.000Z', entries: { flour: { qty: 4, unit: '', supplierId: '' } }, days: { mill: '2026-10-29' },
    }]);
    expect(d.storage.getItem(DRAFT_JOURNAL_KEY)).toBeNull();
  });

  it('⚠️ an order placed since the typing keeps the number out', async () => {
    const d = device();
    const page = d.open(fakeOrdersSource({ suppliers: [mill], ingredients: [flour], draft: { entries: {}, days: {} } }));
    await settle();
    page.store.editLine(mill, flour, { qty: 4 });

    const server = fakeOrdersSource({
      suppliers: [mill], ingredients: [flour], draft: { entries: {}, days: {} },
      records: { '2026-10-29_mill': { date: '2026-10-29', sends: { s1: { at: new Date(NOW + 60_000).toISOString(), quantities: { flour: 4 } } } } },
    });
    const next = d.open(server);
    await settle();
    await settle();
    expect(next.store.getSnapshot().draft.entries.flour).toBeUndefined();
    expect(next.store.getSnapshot().draftCameBack).toBe(0);
    await next.autosave();
    expect(server.writes).toEqual([]);
  });

  it('another venue neither reads the note nor keeps it', async () => {
    const d = device();
    const page = d.open(fakeOrdersSource({ suppliers: [mill], ingredients: [flour], draft: { entries: {}, days: {} } }));
    await settle();
    page.store.editLine(mill, flour, { qty: 4 });
    const other = fakeOrdersSource({ suppliers: [mill], ingredients: [flour], draft: { entries: {}, days: {} } });
    const there = d.open(other, 'venue-b');
    await settle();
    await settle();
    expect(there.store.getSnapshot().draft.entries.flour).toBeUndefined();
    expect(other.recentReads).toEqual([]);
  });

  it('no venue, no note', async () => {
    const d = device();
    const page = d.open(fakeOrdersSource({ suppliers: [mill], ingredients: [flour], draft: { entries: {}, days: {} } }), '');
    await settle();
    page.store.editLine(mill, flour, { qty: 4 });
    expect(d.storage.getItem(DRAFT_JOURNAL_KEY)).toBeNull();
  });

  it('the page going out of sight sends what waits for its pause, at once; the listener lives only while the section is started', async () => {
    const d = device();
    const source = fakeOrdersSource({ suppliers: [mill], ingredients: [flour], draft: { entries: {}, days: {} } });
    const page = d.open(source);
    await settle();
    expect(d.hidden.subscribed).toBe(1);
    page.store.editLine(mill, flour, { qty: 4 });
    d.hidden.run?.();
    await settle();
    expect(source.writes).toHaveLength(1);
    page.store.stop();
    expect(d.hidden.subscribed).toBe(0);
  });
});
