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
  lines: [{ key: 1, name: 'Panettone', qty: '2', unit: 'pcs', weightKg: null, note: '', kept: null }],
};
const data = toBookingData(draft, { status: 'todo', number: 1, items: [] });

afterEach(() => { vi.restoreAllMocks(); });

describe('bookingsStore', () => {
  it('listens to the month it is given, once, and stops', async () => {
    const source = fakeBookingsSource([
      bookingFixture({ id: 'old', date: '2026-10-31' }), bookingFixture({ id: 'new', date: '2026-11-18' }), bookingFixture({ id: 'next', date: '2026-12-01' }),
    ]);
    const store = createBookingsStore(source);
    expect(store.getSnapshot().status).toBe('loading');
    store.start('2026-11');
    store.start('2026-11');
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
    store.start('2026-12');
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
    store.start('2026-11');
    source.refuseWith = permissionDenied();
    store.save(null, data, draft);
    await flush();
    expect(messages).toEqual(['no-access']);
    expect(store.getSnapshot().refused).toEqual({ id: null, draft, status: 'todo', number: 1, storedDate: null });
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
    store.start('2026-11');
    await flush();
    store.setStatus('A', 'collected');
    await flush();
    expect(store.getSnapshot().items[0]?.status).toBe('collected');
    source.refuseWith = new Error('unavailable');
    store.remove('A');
    await flush();
    expect(messages).toEqual(['not-saved']);
    source.refuseWith = null;
    store.remove('A');
    await flush();
    expect(store.getSnapshot().items).toEqual([]);
  });

  it('⚠️ a month asked while listening drops the old listener and opens ONE on the new month; the same month changes nothing', async () => {
    const source = fakeBookingsSource([bookingFixture({ id: 'nov', date: '2026-11-18' }), bookingFixture({ id: 'dec', date: '2026-12-24' })]);
    const store = createBookingsStore(source);
    store.watchMonth('2026-12');
    store.start('2026-11');
    await flush();
    // Asked before the start: the start takes it, not its fallback.
    expect(source.watch).toHaveBeenCalledTimes(1);
    expect(source.watch).toHaveBeenLastCalledWith({ from: '2026-12-01', until: '2027-01-01' }, expect.any(Function), expect.any(Function));
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', month: '2026-12' });
    expect(store.getSnapshot().items.map(b => b.id)).toEqual(['dec']);
    store.watchMonth('2026-12');
    expect(source.watch).toHaveBeenCalledTimes(1);
    store.watchMonth('2026-11');
    // At once: nothing of December stands for November while it loads.
    expect(store.getSnapshot()).toMatchObject({ status: 'loading', month: '2026-11', items: [] });
    await flush();
    expect(source.watching()).toBe(1);
    expect(source.watch).toHaveBeenLastCalledWith({ from: '2026-11-01', until: '2026-12-01' }, expect.any(Function), expect.any(Function));
    expect(store.getSnapshot().items.map(b => b.id)).toEqual(['nov']);
    store.stop();
    expect(source.watching()).toBe(0);
  });

  it('⚠️ a one-tap status shows AT ONCE, before the server answers; a refusal puts it back and says so as a status refusal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = fakeBookingsSource([bookingFixture({ id: 'A', status: 'todo' })]);
    const store = createBookingsStore(source);
    const messages: unknown[] = [];
    store.onMessage(message => { messages.push(message); });
    store.start('2026-11');
    await flush();
    // The server never answers this one: still shown as collected.
    vi.mocked(source.setStatus).mockImplementationOnce(() => new Promise(() => undefined));
    store.setStatus('A', 'collected');
    expect(store.getSnapshot().items[0]?.status).toBe('collected');
    // Refused: back as the listener has it, and said.
    let refuse: (err: unknown) => void = () => undefined;
    vi.mocked(source.setStatus).mockImplementationOnce(() => new Promise((_, reject) => { refuse = reject; }));
    store.setStatus('A', 'todo');
    expect(store.getSnapshot().items[0]?.status).toBe('todo');
    refuse(permissionDenied());
    await flush();
    expect(store.getSnapshot().items[0]?.status).toBe('todo');
    expect(messages).toEqual([{ kind: 'no-access', status: true }]);
  });

  it('⚠️ a refused tap puts the row back to what the listener holds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = fakeBookingsSource([bookingFixture({ id: 'A', status: 'ready' })]);
    const store = createBookingsStore(source);
    const messages: unknown[] = [];
    store.onMessage(message => { messages.push(message); });
    store.start('2026-11');
    await flush();
    let refuse: (err: unknown) => void = () => undefined;
    vi.mocked(source.setStatus).mockImplementationOnce(() => new Promise((_, reject) => { refuse = reject; }));
    store.setStatus('A', 'collected');
    expect(store.getSnapshot().items[0]?.status).toBe('collected');
    refuse(new Error('unavailable'));
    await flush();
    expect(store.getSnapshot().items[0]?.status).toBe('ready');
    expect(messages).toEqual([{ kind: 'not-saved', status: true }]);
  });

  it('⚠️ an earlier tap refused after a later one says the plain «not saved», never «put back»', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = fakeBookingsSource([bookingFixture({ id: 'A', status: 'todo' })]);
    const store = createBookingsStore(source);
    const messages: unknown[] = [];
    store.onMessage(message => { messages.push(message); });
    store.start('2026-11');
    await flush();
    let refuse: (err: unknown) => void = () => undefined;
    vi.mocked(source.setStatus).mockImplementationOnce(() => new Promise((_, reject) => { refuse = reject; }));
    vi.mocked(source.setStatus).mockImplementationOnce(() => new Promise(() => undefined));
    store.setStatus('A', 'collected');
    store.setStatus('A', 'todo');
    refuse(new Error('unavailable'));
    await flush();
    expect(messages).toEqual([{ kind: 'not-saved' }]);
    expect(store.getSnapshot().items[0]?.status).toBe('todo');
  });

  it('several months in ONE query while a form spans them; `confirmed` only once the server answered', async () => {
    const source = fakeBookingsSource([bookingFixture({ id: 'dec', date: '2026-12-31' }), bookingFixture({ id: 'jan', date: '2027-01-02' })]);
    const store = createBookingsStore(source);
    store.watchMonth('2026-12', '2027-01');
    store.start('2026-12');
    expect(store.getSnapshot().confirmed).toBe(false);
    await flush();
    expect(source.watch).toHaveBeenLastCalledWith({ from: '2026-12-01', until: '2027-02-01' }, expect.any(Function), expect.any(Function));
    expect(store.getSnapshot()).toMatchObject({ month: '2026-12', through: '2027-01', confirmed: true });
    expect(store.getSnapshot().items.map(b => b.id).sort()).toEqual(['dec', 'jan']);
  });

  it('keeps the bookings and says the stream broke, then asks again after 30 s', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = fakeBookingsSource([bookingFixture({ id: 'A' })]);
    const { timers, pending } = manualTimers();
    const store = createBookingsStore(source, timers);
    store.start('2026-11');
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
