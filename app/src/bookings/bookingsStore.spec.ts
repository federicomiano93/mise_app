import { afterEach, describe, expect, it, vi } from 'vitest';
import { bookingFixture, fakeBookingsSource, permissionDenied } from '../testing/fakeBookingsSource';
import { emptyDraft, toBookingData } from './bookingModel';
import type { Draft } from './bookingModel';
import { RETRY_FIRST_MS, createBookingsStore } from './bookingsStore';
import type { Timers } from './bookingsStore';

const flush = () => new Promise(resolve => { setTimeout(resolve, 0); });

function manualTimers() {
  const pending: Array<{ run: () => void; ms: number }> = [];
  const timers: Timers = {
    setTimeout: (run, ms) => { const job = { run, ms }; pending.push(job); return job; },
    clearTimeout: handle => { const i = pending.indexOf(handle as never); if (i >= 0) pending.splice(i, 1); },
  };
  return { timers, pending };
}

let key = 0;
const draft: Draft = {
  ...emptyDraft(() => { key += 1; return key; }),
  customerName: 'Mario Prova', phone: '+39 333 000 0000', mode: 'pickup', date: '2026-12-24', time: '09:30',
  lines: [{ key: 1, name: 'Panettone', qty: '2', unit: 'pcs', note: '', kept: null }],
};
const data = toBookingData(draft, { status: 'todo', number: 1, items: [] });

afterEach(() => { vi.restoreAllMocks(); });

describe('bookingsStore', () => {
  it('listens from the day it is given, once, and stops', async () => {
    const source = fakeBookingsSource([bookingFixture({ id: 'old', date: '2026-10-01' }), bookingFixture({ id: 'new', date: '2026-11-18' })]);
    const store = createBookingsStore(source);
    expect(store.getSnapshot().status).toBe('loading');
    store.start('2026-10-19');
    store.start('2026-10-19');
    await flush();
    expect(source.watching()).toBe(1);
    expect(store.getSnapshot()).toMatchObject({ status: 'ready' });
    expect(store.getSnapshot().items.map(b => b.id)).toEqual(['new']);
    store.stop();
    expect(source.watching()).toBe(0);
  });

  it('saves a new booking at once and hands back its id; an existing one is updated', async () => {
    const source = fakeBookingsSource();
    const store = createBookingsStore(source);
    store.start('2026-10-19');
    await flush();
    const id = store.save(null, data, draft);
    expect(id).toBe('new1');
    await flush();
    expect(store.getSnapshot().items.map(b => b.id)).toEqual(['new1']);
    store.save('new1', { ...data, customerName: 'Maria Prova' }, draft);
    await flush();
    expect(store.getSnapshot().items[0]?.customerName).toBe('Maria Prova');
    expect(source.update).toHaveBeenCalledTimes(1);
  });

  it('⚠️ a refused save keeps what was typed, says so, and hands it back once', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = fakeBookingsSource();
    const store = createBookingsStore(source);
    const messages: string[] = [];
    store.onMessage(message => { messages.push(message.kind); });
    store.start('2026-10-19');
    source.refuseWith = permissionDenied();
    store.save(null, data, draft);
    await flush();
    expect(messages).toEqual(['no-access']);
    expect(store.getSnapshot().refused).toEqual({ id: null, draft, status: 'todo', number: 1 });
    expect(store.takeRefused()?.draft).toBe(draft);
    expect(store.getSnapshot().refused).toBeNull();
    expect(store.takeRefused()).toBeNull();
  });

  it('⚠️ never logs a booking, only the error', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = fakeBookingsSource();
    const store = createBookingsStore(source);
    source.refuseWith = new Error('unavailable');
    store.save(null, data, draft);
    await flush();
    expect(JSON.stringify(logged.mock.calls)).not.toMatch(/Mario|333/);
  });

  it('a status change and a delete are written; a failure is reported as not saved', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = fakeBookingsSource([bookingFixture({ id: 'A' })]);
    const store = createBookingsStore(source);
    const messages: string[] = [];
    store.onMessage(message => { messages.push(message.kind); });
    store.start('2026-10-19');
    await flush();
    store.setStatus('A', 'ready');
    await flush();
    expect(store.getSnapshot().items[0]?.status).toBe('ready');
    source.refuseWith = new Error('unavailable');
    store.remove('A');
    await flush();
    expect(messages).toEqual(['not-saved']);
    source.refuseWith = null;
    store.remove('A');
    await flush();
    expect(store.getSnapshot().items).toEqual([]);
  });

  it('keeps the bookings and says the stream broke, then asks again after 30 s', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = fakeBookingsSource([bookingFixture({ id: 'A' })]);
    const { timers, pending } = manualTimers();
    const store = createBookingsStore(source, timers);
    store.start('2026-10-19');
    await flush();
    source.breakStreams();
    expect(store.getSnapshot().status).toBe('error');
    expect(store.getSnapshot().items).toHaveLength(1);
    expect(pending[0]?.ms).toBe(RETRY_FIRST_MS);
    pending.shift()?.run();
    await flush();
    expect(store.getSnapshot().status).toBe('ready');
    store.stop();
  });
});
