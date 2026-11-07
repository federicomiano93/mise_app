import { describe, expect, it, vi } from 'vitest';
import { fakeSettingsSource } from '../testing/fakeSettingsSource';
import { INERT_AWAY_STORE, createAwayStore } from './awayStore';

// Saturday 7 November 2026, noon.
const NOW = new Date(2026, 10, 7, 12).getTime();
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function make(seed: Parameters<typeof fakeSettingsSource>[0] = {}, clock = { now: NOW }) {
  const source = fakeSettingsSource({ ...seed, now: () => clock.now });
  const store = createAwayStore(source, 'u1', () => clock.now);
  return { source, store, clock };
}

describe('the holiday store', () => {
  it('is loading until the one read answers, then says whether the person is away', async () => {
    const { store } = make({ away: { until: '2026-11-16' } });
    expect(store.getSnapshot()).toEqual({ status: 'loading', until: null, away: false });
    store.start();
    await flush();
    expect(store.getSnapshot()).toEqual({ status: 'ready', until: '2026-11-16', away: true });
  });

  it('reads once, however many times it is started, and never listens', async () => {
    const { store, source } = make();
    store.start();
    store.start();
    await flush();
    expect(source.readMyAway).toHaveBeenCalledTimes(1);
    expect(source.readMyAway).toHaveBeenCalledWith('u1');
  });

  it('reads no document, a finished holiday or «I am back» as not away', async () => {
    for (const away of [null, { until: '' }, { until: '2026-11-06' }]) {
      const { store } = make({ away });
      store.start();
      await flush();
      expect(store.getSnapshot().status).toBe('ready');
      expect(store.getSnapshot().away).toBe(false);
    }
  });

  it('counts the last day as a day away', async () => {
    const { store } = make({ away: { until: '2026-11-07' } });
    store.start();
    await flush();
    expect(store.getSnapshot().away).toBe(true);
  });

  it('shows a holiday at once, before the server has answered', () => {
    const { store, source } = make();
    let resolve: () => void = () => undefined;
    source.saveAway = vi.fn(() => ({ result: 'saved' as const, written: new Promise<void>(done => { resolve = done; }) }));
    const change = store.set('2026-11-16');
    expect(change.accepted).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', until: '2026-11-16', away: true });
    resolve();
  });

  it('answers true when the server agreed', async () => {
    const { store } = make();
    const change = store.set('2026-11-16');
    expect(change.accepted && await change.saved).toBe(true);
    expect(store.getSnapshot().until).toBe('2026-11-16');
  });

  it('refuses a date that cannot be used and changes nothing', () => {
    const { store, source } = make();
    expect(store.set('2026-11-06')).toEqual({ accepted: false });
    expect(store.set('2028-01-01')).toEqual({ accepted: false });
    expect(store.getSnapshot().until).toBeNull();
    expect(source.away).toBeNull();
  });

  it('puts the state back when the write is refused, and says so', async () => {
    const { store, source } = make({ away: { until: '2026-11-20' } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    store.start();
    await flush();
    source.refuseWith = Object.assign(new Error('no'), { code: 'permission-denied' });
    const change = store.comeBack();
    expect(change.accepted).toBe(true);
    // At once the person is back…
    expect(store.getSnapshot().away).toBe(false);
    // …and when the server refuses, the holiday is put back.
    expect(change.accepted && await change.saved).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ until: '2026-11-20', away: true });
  });

  it('writes «I am back» as an empty day, through the same write', async () => {
    const { store, source } = make({ away: { until: '2026-11-20' } });
    store.start();
    await flush();
    store.comeBack();
    expect(source.saveAway).toHaveBeenCalledWith('u1', '');
    expect(store.getSnapshot()).toMatchObject({ until: '', away: false });
  });

  it('does not put an old refusal back over a newer write', async () => {
    const { store, source } = make();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let reject: (err: Error) => void = () => undefined;
    source.saveAway = vi.fn()
      .mockReturnValueOnce({ result: 'saved', written: new Promise<void>((_, fail) => { reject = fail; }) })
      .mockReturnValueOnce({ result: 'saved', written: Promise.resolve() });
    const first = store.set('2026-11-12');
    store.set('2026-11-16');
    reject(new Error('late refusal'));
    expect(first.accepted && await first.saved).toBe(false);
    expect(store.getSnapshot().until).toBe('2026-11-16');
  });

  it('keeps a person’s own write when the read answers after it', async () => {
    const { store, source } = make({ away: { until: '2026-11-30' } });
    store.start();
    store.set('2026-11-16');
    await flush();
    expect(source.readMyAway).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().until).toBe('2026-11-16');
  });

  it('tells its listeners of a change, and stops when they leave', async () => {
    const { store } = make();
    const listener = vi.fn();
    const leave = store.subscribe(listener);
    store.set('2026-11-16');
    expect(listener).toHaveBeenCalledTimes(1);
    leave();
    store.set('2026-11-17');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ends the holiday by itself after its last day, once asked again', async () => {
    const { store, clock } = make({ away: { until: '2026-11-07' } });
    store.start();
    await flush();
    expect(store.getSnapshot().away).toBe(true);
    clock.now = new Date(2026, 10, 8, 0, 5).getTime();
    store.recheck();
    expect(store.getSnapshot()).toMatchObject({ until: '2026-11-07', away: false });
  });

  it('does not wake its listeners when asking again changes nothing', async () => {
    const { store } = make({ away: { until: '2026-11-20' } });
    store.start();
    await flush();
    const listener = vi.fn();
    store.subscribe(listener);
    store.recheck();
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the same snapshot object until something changes', async () => {
    const { store } = make();
    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
    store.start();
    await flush();
    expect(store.getSnapshot()).not.toBe(first);
  });

  it('has an inert store for nobody: never away, never writes', () => {
    expect(INERT_AWAY_STORE.getSnapshot()).toEqual({ status: 'ready', until: null, away: false });
    expect(INERT_AWAY_STORE.set('2026-11-16')).toEqual({ accepted: false });
    expect(INERT_AWAY_STORE.comeBack()).toEqual({ accepted: false });
  });
});
