// The Orders lines of the kiosk's rest screen (staff slice 6): the reads (fetchRestSections) and the scheduler (createRestOrdersFeed),
// ported from tests/kiosk-rest-orders.test.mjs.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { fakeKioskOrdersSource } from '../testing/fakeKioskOrdersSource';
import { REFRESH_MS, createRestOrdersFeed, fetchRestSections } from './restOrders';
import type { RestOrdersFeedDeps } from './restOrders';

const LINE = { titleKey: 'k', names: ['A'], more: 0 };

function fakeTimers() {
  const jobs = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  return {
    set: (fn: () => void, ms: number) => { const id = next++; jobs.set(id, { fn, ms }); return id; },
    clear: (id: unknown) => { jobs.delete(id as number); },
    jobs,
    fire: () => { [...jobs.values()].forEach(j => { j.fn(); }); },
  };
}
const settle = () => new Promise(resolve => { setTimeout(resolve, 0); });

function feed({ allowed = true as boolean | (() => boolean), pageAnswers = false, fetchSections, today = () => '2026-10-07' }: {
  allowed?: boolean | (() => boolean);
  pageAnswers?: boolean;
  fetchSections?: (n: number) => unknown;
  today?: () => string;
} = {}) {
  const timers = fakeTimers();
  const calls = { fetch: 0, changed: 0 };
  const f = createRestOrdersFeed({
    allowed: () => (typeof allowed === 'function' ? allowed() : allowed),
    pageAnswers: () => pageAnswers,
    fetchSections: async () => { calls.fetch++; return (fetchSections ? fetchSections(calls.fetch) : [LINE]) as never; },
    onChange: () => { calls.changed++; },
    today, timers,
  } satisfies RestOrdersFeedDeps);
  return { f, timers, calls };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('the scheduler', () => {
  test('a feed that is not allowed never reads and never repeats', async () => {
    const { f, timers, calls } = feed({ allowed: false });
    f.start();
    await settle();
    expect(calls.fetch).toBe(0);
    expect(timers.jobs.size).toBe(0);
    expect(f.current()).toStrictEqual([]);
  });

  test('reads at once on rest entry, then every 15 minutes, and stops for good', async () => {
    const { f, timers, calls } = feed();
    f.start();
    await settle();
    expect(calls.fetch).toBe(1);
    expect(REFRESH_MS).toBe(15 * 60 * 1000);
    expect([...timers.jobs.values()].map(j => j.ms)).toStrictEqual([REFRESH_MS]);
    timers.fire();
    await settle();
    expect(calls.fetch).toBe(2);
    f.start();   // idempotent: no second timer, no extra read
    await settle();
    expect(calls.fetch).toBe(2);
    expect(timers.jobs.size).toBe(1);
    f.stop();    // woken, or the night begins
    expect(timers.jobs.size).toBe(0);
    expect(f.isRunning()).toBe(false);
  });

  test('an answer that arrives after stop() is thrown away', async () => {
    let release: (value: unknown) => void = () => {};
    const { f, calls } = feed({ fetchSections: () => new Promise(resolve => { release = resolve; }) });
    f.start();
    f.stop();
    release([{ titleKey: 'k', names: ['Late'], more: 0 }]);
    await settle();
    expect(calls.changed).toBe(0);
    expect(f.current()).toStrictEqual([]);
  });

  test('the last answer is kept in memory and a repaint is asked for', async () => {
    const { f, calls } = feed();
    f.start();
    await settle();
    expect(calls.changed).toBe(1);
    expect(f.current()).toStrictEqual([LINE]);
  });

  test('yesterday’s answer is never shown', async () => {
    let day = '2026-10-07';
    const { f } = feed({ today: () => day });
    f.start();
    await settle();
    expect(f.current()).toHaveLength(1);
    day = '2026-10-08';
    expect(f.current()).toStrictEqual([]);
  });

  test('a failed read keeps the previous answer, never throws, and logs the error’s code only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { f, timers } = feed({
      fetchSections: n => {
        if (n === 2) throw Object.assign(new Error('Jane Doe offline'), { code: 'unavailable' });
        return [LINE];
      },
    });
    f.start();
    await settle();
    timers.fire();
    await settle();
    expect(f.current()).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Jane');
    expect(JSON.stringify(warn.mock.calls)).toContain('unavailable');
  });

  test('silence while the Orders section answers: nothing is read', async () => {
    const { f, timers, calls } = feed({ pageAnswers: true });
    f.start();
    await settle();
    expect(calls.fetch).toBe(0);
    expect(timers.jobs.size).toBe(0);
  });

  test('permission lost while resting: the next refresh reads nothing and nothing is shown', async () => {
    let allowed = true;
    const { f, timers, calls } = feed({ allowed: () => allowed });
    f.start();
    await settle();
    allowed = false;
    timers.fire();
    await settle();
    expect(calls.fetch).toBe(1);
    expect(f.current()).toStrictEqual([]);
  });

  test('P14: a fresh answer is not read again at once; a stale or hidden page is handled', async () => {
    let clock = 1_000_000;
    let visible = true;
    const timers = fakeTimers();
    let fetches = 0;
    const f = createRestOrdersFeed({
      allowed: () => true, pageAnswers: () => false, today: () => '2026-10-07',
      fetchSections: async () => { fetches++; return [LINE]; },
      onChange() {}, now: () => clock, visible: () => visible, timers,
    });
    f.start();
    await settle();
    expect(fetches).toBe(1);
    f.stop();
    clock += 10 * 60 * 1000;   // a second rest 10 minutes later: still fresh
    f.start();
    await settle();
    expect(fetches, 'no read for an answer younger than 15 minutes').toBe(1);
    f.stop();
    clock += 6 * 60 * 1000;    // 16 minutes old: stale
    visible = false;
    f.start();
    await settle();
    expect(fetches, 'nothing is read while the page is hidden').toBe(1);
    visible = true;
    f.refreshIfStale();        // back in view while resting
    await settle();
    expect(fetches).toBe(2);
    f.refreshIfStale();        // fresh now: no read
    await settle();
    expect(fetches).toBe(2);
  });
});

describe('the reads', () => {
  // 2026-10-07 is a Wednesday.
  const suppliers = [
    { id: 'm', name: 'Molino', orderDays: ['Wednesday'], deliveryDays: ['Wednesday'], active: true },
    { id: 'p', name: 'Placed', orderDays: ['Wednesday'], deliveryDays: ['Friday'], active: true },
  ];
  const history = [
    { id: '2026-10-07_p', date: '2026-10-07', supplierId: 'p' },
    { id: '2026-10-06_m', date: '2026-10-06', supplierId: 'm' },
    { id: '2026-09-20_m', date: '2026-09-20', supplierId: 'm' },
  ];

  test('to order today and arriving today, from this week’s records only', async () => {
    const source = fakeKioskOrdersSource({ suppliers, history });
    const sections = await fetchRestSections(source, '2026-10-07');
    expect(sections).toStrictEqual([
      { titleKey: 'kiosk.rest.toOrderTitle', names: ['Molino'], more: 0 },
      { titleKey: 'kiosk.rest.arrivingTitle', names: ['Molino'], more: 0 },
    ]);
    // The week starts on Sunday by default: from 4 October.
    expect(source.readHistoryFrom).toHaveBeenCalledWith('2026-10-04');
  });

  test('the week start comes from config/orders', async () => {
    const source = fakeKioskOrdersSource({ suppliers, history, config: { weekStartsOn: 'Monday' } });
    await fetchRestSections(source, '2026-10-07');
    expect(source.readHistoryFrom).toHaveBeenCalledWith('2026-10-05');
  });

  test('the goods-arrived switch off: no «arriving» line (decision F4)', async () => {
    const source = fakeKioskOrdersSource({ suppliers, history, config: { deliveryCheck: false } });
    const sections = await fetchRestSections(source, '2026-10-07');
    expect(sections.map(s => s.titleKey)).toStrictEqual(['kiosk.rest.toOrderTitle']);
  });

  test('a supplier closed today as not ordered is not «to order»', async () => {
    const source = fakeKioskOrdersSource({ suppliers, history, draft: { skipped: { m: '2026-10-07' } } });
    const sections = await fetchRestSections(source, '2026-10-07');
    expect(sections.map(s => s.titleKey)).toStrictEqual(['kiosk.rest.arrivingTitle']);
  });

  test('a failed read of config/orders or of the draft never blanks the screen; a failed read of the records fails the refresh', async () => {
    const source = fakeKioskOrdersSource({ suppliers, history });
    source.readConfig.mockRejectedValueOnce(new Error('offline'));
    source.readDraft.mockRejectedValueOnce(new Error('offline'));
    expect(await fetchRestSections(source, '2026-10-07')).toHaveLength(2);
    source.readHistoryFrom.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchRestSections(source, '2026-10-07')).rejects.toThrow('offline');
  });
});
