import { describe, expect, it, vi } from 'vitest';
import { fakeSettingsSource } from '../../testing/fakeSettingsSource';
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

  it('puts back what the server is KNOWN to hold, not the previous optimistic value: two refusals in a row', async () => {
    const { store, source } = make({ away: { until: '2026-11-20' } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    store.start();
    await flush();
    const refusals: ((err: Error) => void)[] = [];
    source.saveAway = vi.fn(() => ({ result: 'saved' as const, written: new Promise<void>((_, fail) => { refusals.push(fail); }) }));
    const first = store.set('2026-11-12');
    const second = store.comeBack();
    expect(store.getSnapshot()).toMatchObject({ until: '', away: false });
    refusals[0]?.(new Error('first refused'));
    await flush();
    // The older refusal changes nothing…
    expect(store.getSnapshot().until).toBe('');
    refusals[1]?.(new Error('second refused'));
    expect(first.accepted && await first.saved).toBe(false);
    expect(second.accepted && await second.saved).toBe(false);
    // …and the newest one shows the server’s real state, not the first, also refused, value.
    expect(store.getSnapshot()).toMatchObject({ until: '2026-11-20', away: true });
  });

  it('comes back to what showed before the first write when two writes are refused before the first read answers', async () => {
    const source = fakeSettingsSource({ now: () => NOW });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    source.readMyAway = vi.fn(() => new Promise<{ until: string } | null>(() => undefined));
    const refusals: ((err: Error) => void)[] = [];
    source.saveAway = vi.fn(() => ({ result: 'saved' as const, written: new Promise<void>((_, fail) => { refusals.push(fail); }) }));
    const store = createAwayStore(source, 'u1', () => NOW);
    store.start();
    const first = store.set('2026-11-12');
    const second = store.set('2026-11-14');
    refusals[0]?.(new Error('first refused'));
    refusals[1]?.(new Error('second refused'));
    expect(first.accepted && await first.saved).toBe(false);
    expect(second.accepted && await second.saved).toBe(false);
    // Not the first refused day (12 Nov): nothing the server ever held.
    expect(store.getSnapshot()).toMatchObject({ until: null, away: false });
  });

  it('records a read that answers during a pending write without showing it over the write, and shows it if the write is refused', async () => {
    const source = fakeSettingsSource({ now: () => NOW });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let answer: (mine: { until: string } | null) => void = () => undefined;
    source.readMyAway = vi.fn(() => new Promise<{ until: string } | null>(done => { answer = done; }));
    let refuse: (err: Error) => void = () => undefined;
    source.saveAway = vi.fn(() => ({ result: 'saved' as const, written: new Promise<void>((_, fail) => { refuse = fail; }) }));
    const store = createAwayStore(source, 'u1', () => NOW);
    store.start();
    const change = store.set('2026-11-12');
    answer({ until: '2026-11-25' });
    await flush();
    expect(store.getSnapshot().until).toBe('2026-11-12');
    refuse(new Error('no'));
    expect(change.accepted && await change.saved).toBe(false);
    expect(store.getSnapshot()).toMatchObject({ status: 'ready', until: '2026-11-25', away: true });
  });

  it('does not let a read that began before a confirmed write undo it', async () => {
    const source = fakeSettingsSource({ now: () => NOW });
    let answer: (mine: { until: string } | null) => void = () => undefined;
    source.readMyAway = vi.fn(() => new Promise<{ until: string } | null>(done => { answer = done; }));
    const store = createAwayStore(source, 'u1', () => NOW);
    store.start();
    const change = store.set('2026-11-12');
    if (change.accepted) await change.saved;
    answer({ until: '2026-11-25' });
    await flush();
    expect(store.getSnapshot().until).toBe('2026-11-12');
  });

  describe('reading again', () => {
    it('reads again at most once every ten minutes, and shows what another phone set', async () => {
      const { store, source, clock } = make({ away: null });
      store.start();
      await flush();
      expect(store.getSnapshot().away).toBe(false);
      source.away = { until: '2026-11-16' };
      clock.now += 9 * 60_000;
      store.refresh();
      expect(source.readMyAway).toHaveBeenCalledTimes(1);
      clock.now += 2 * 60_000;
      store.refresh();
      await flush();
      expect(source.readMyAway).toHaveBeenCalledTimes(2);
      expect(store.getSnapshot()).toMatchObject({ until: '2026-11-16', away: true });
    });

    it('never overwrites a local write still in the air', async () => {
      const { store, source, clock } = make({ away: { until: '2026-11-20' } });
      store.start();
      await flush();
      source.saveAway = vi.fn(() => ({ result: 'saved' as const, written: new Promise<void>(() => undefined) }));
      store.set('2026-11-12');
      clock.now += 11 * 60_000;
      store.refresh();
      await flush();
      expect(store.getSnapshot().until).toBe('2026-11-12');
    });

    it('ignores a re-read that finds nothing: a holiday is never deleted, so nothing means the read failed', async () => {
      const { store, source, clock } = make({ away: { until: '2026-11-20' } });
      store.start();
      await flush();
      source.away = null;
      clock.now += 11 * 60_000;
      store.refresh();
      await flush();
      expect(store.getSnapshot().until).toBe('2026-11-20');
    });

    // Review, 7 Nov 2026: Firestore's getDoc answers from the phone's copy WITH its own unconfirmed write on top.
    it('never takes this phone’s own unconfirmed write, read back, as what the server holds', async () => {
      const { store, source, clock } = make({ away: { until: '2026-11-20' } });
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      store.start();
      await flush();
      let refuse: (err: Error) => void = () => undefined;
      source.saveAway = vi.fn(() => ({ result: 'saved' as const, written: new Promise<void>((_, fail) => { refuse = fail; }) }));
      const change = store.comeBack();
      source.away = { until: '', pending: true };
      clock.now += 11 * 60_000;
      store.refresh();
      await flush();
      refuse(new Error('refused'));
      expect(change.accepted && await change.saved).toBe(false);
      // The server still holds the holiday: the screen must say so, not «back».
      expect(store.getSnapshot()).toMatchObject({ until: '2026-11-20', away: true });
    });

    it('shows a write queued before a reload, read back from the phone’s copy, when nothing is in the air', async () => {
      const { store } = make({ away: { until: '2026-11-12', pending: true } });
      store.start();
      await flush();
      expect(store.getSnapshot()).toMatchObject({ status: 'ready', until: '2026-11-12', away: true });
    });

    it('does nothing before the first read has been asked for', () => {
      const { store, source } = make();
      store.refresh();
      expect(source.readMyAway).not.toHaveBeenCalled();
    });
  });

  it('has an inert store for nobody: never away, never writes', () => {
    expect(INERT_AWAY_STORE.getSnapshot()).toEqual({ status: 'ready', until: null, away: false });
    expect(INERT_AWAY_STORE.set('2026-11-16')).toEqual({ accepted: false });
    expect(INERT_AWAY_STORE.comeBack()).toEqual({ accepted: false });
  });
});
