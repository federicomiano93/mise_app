// The scheduler behind the «To do today» half (restTodosFeed.ts): the timing of the Orders lines' feed, mirrored from restOrders.spec.ts.

import { afterEach, describe, expect, test, vi } from 'vitest';
import type { KioskTodo, KioskTodosSource } from './kioskTodosSource';
import { REFRESH_MS } from './restOrders';
import { createRestTodosFeed } from './restTodosFeed';

const ONE: KioskTodo = { text: 'Mop', day: '2026-10-07', createdAtMs: 1 };

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

function feed(opts: { read?: (n: number) => Promise<KioskTodo[]>; visible?: () => boolean } = {}) {
  const timers = fakeTimers();
  const at = { now: new Date(2026, 9, 7, 14, 0).getTime() };
  const calls = { read: 0, changed: 0 };
  const source: KioskTodosSource = { readOpen: async () => { calls.read++; return opts.read ? opts.read(calls.read) : [ONE]; } };
  const f = createRestTodosFeed({ source, onChange: () => { calls.changed++; }, now: () => at.now, visible: opts.visible, timers });
  return { f, timers, calls, at };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('the to-do scheduler', () => {
  test('reads at once on rest entry, then every 15 minutes, and stops for good', async () => {
    const { f, timers, calls } = feed();
    f.start();
    await settle();
    expect(calls.read).toBe(1);
    expect([...timers.jobs.values()].map(j => j.ms)).toStrictEqual([REFRESH_MS]);
    expect(f.current()).toStrictEqual([ONE]);
    timers.fire();
    await settle();
    expect(calls.read).toBe(2);
    f.start();   // idempotent
    await settle();
    expect(calls.read).toBe(2);
    expect(timers.jobs.size).toBe(1);
    f.stop();
    expect(timers.jobs.size).toBe(0);
    expect(f.isRunning()).toBe(false);
  });

  test('a fresh answer is reused on the next rest, a stale one is read again', async () => {
    const { f, calls, at } = feed();
    f.start(); await settle();
    f.stop();
    at.now += 60_000;
    f.start(); await settle();
    expect(calls.read).toBe(1);
    f.stop();
    at.now += REFRESH_MS;
    f.start(); await settle();
    expect(calls.read).toBe(2);
  });

  test('nothing is read while the page is hidden', async () => {
    let visible = false;
    const { f, calls } = feed({ visible: () => visible });
    f.start(); await settle();
    expect(calls.read).toBe(0);
    visible = true;
    f.refreshIfStale(); await settle();
    expect(calls.read).toBe(1);
  });

  test('a failed read keeps the last good lines and logs only the code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { f, timers } = feed({ read: async n => { if (n === 2) throw Object.assign(new Error('secret to-do words'), { code: 'unavailable' }); return [ONE]; } });
    f.start(); await settle();
    timers.fire(); await settle();
    expect(f.current()).toStrictEqual([ONE]);
    expect(warn).toHaveBeenCalledWith('The kiosk to-dos could not be refreshed:', 'unavailable');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
  });

  test('yesterday’s answer is never drawn on a new work day', async () => {
    const { f, at } = feed();
    f.start(); await settle();
    at.now += 24 * 3_600_000;
    expect(f.current()).toStrictEqual([]);
  });

  test('a read that returns after stop is ignored', async () => {
    const { f, calls } = feed({ read: () => new Promise<KioskTodo[]>(resolve => { setTimeout(() => { resolve([ONE]); }, 0); }) });
    f.start();
    f.stop();
    await settle();
    expect(f.current()).toStrictEqual([]);
    expect(calls.changed).toBe(0);
  });
});
