import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeTodosSource, permissionDenied } from '../testing/fakeTodosSource';
import { createTodosStore, REFUSAL_SETTLE_MS } from './todosStore';
import type { TodosMessage } from './todosStore';

const item = (id: string, done = false) => ({ id, text: 'Call the mill', day: '2026-11-06', done, doneAtMs: done ? 5 : null, createdAtMs: 1 });

const flush = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe('the to-do store: the listener', () => {
  it('is loading until the first answer, then ready with the items', async () => {
    const source = fakeTodosSource([{ id: 'a', text: 'Call the mill', day: '2026-11-06', done: false, doneAtMs: null, createdAtMs: 1 }]);
    const store = createTodosStore(source);
    expect(store.getSnapshot()).toEqual({ status: 'loading', items: [] });

    store.start();
    expect(store.getSnapshot().status).toBe('loading');
    await flush();

    expect(store.getSnapshot().status).toBe('ready');
    expect(store.getSnapshot().items.map(item => item.text)).toEqual(['Call the mill']);
    store.stop();
  });

  it('starts one listener, and a second start while listening starts no other', async () => {
    const source = fakeTodosSource();
    const store = createTodosStore(source);
    store.start();
    store.start();
    await flush();
    expect(source.watch).toHaveBeenCalledTimes(1);
    expect(source.watching()).toBe(1);
    store.stop();
  });

  it('stops the listener, and can start again (start, stop, start)', async () => {
    const source = fakeTodosSource();
    const store = createTodosStore(source);
    store.start();
    await flush();
    store.stop();
    expect(source.watching()).toBe(0);

    store.start();
    await flush();
    expect(source.watching()).toBe(1);
    expect(source.watch).toHaveBeenCalledTimes(2);
    store.stop();
  });

  it('says error when the stream fails, and keeps what it had', async () => {
    const source = fakeTodosSource([{ id: 'a', text: 'Call the mill', day: '2026-11-06', done: false, doneAtMs: null, createdAtMs: 1 }]);
    const store = createTodosStore(source);
    store.start();
    await flush();

    source.breakStreams();

    expect(store.getSnapshot().status).toBe('error');
    expect(store.getSnapshot().items).toHaveLength(1);
    store.stop();
  });

  it('tells its subscribers about each change, and not after they unsubscribe', async () => {
    const source = fakeTodosSource();
    const store = createTodosStore(source);
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.start();
    await flush();
    const calls = listener.mock.calls.length;
    expect(calls).toBeGreaterThan(0);

    off();
    source.push();
    expect(listener).toHaveBeenCalledTimes(calls);
    store.stop();
  });
});

describe('the to-do store: the writes', () => {
  it('writes through the source and the list follows', async () => {
    const source = fakeTodosSource();
    const store = createTodosStore(source);
    store.start();
    await flush();

    store.add('  Order flour  ', '2026-11-07');
    const [added] = store.getSnapshot().items;
    expect(added).toMatchObject({ text: 'Order flour', day: '2026-11-07', done: false });

    store.setDone(added?.id ?? '', true);
    await flush();
    expect(store.getSnapshot().items[0]?.done).toBe(true);

    store.edit(added?.id ?? '', 'Order rye flour', '2026-11-08');
    await flush();
    expect(store.getSnapshot().items[0]).toMatchObject({ text: 'Order rye flour', day: '2026-11-08' });

    store.remove(added?.id ?? '');
    await flush();
    expect(store.getSnapshot().items).toEqual([]);
    store.stop();
  });

  it('does not wait for a write that has not settled', async () => {
    const source = fakeTodosSource();
    source.setDone = vi.fn(() => new Promise<void>(() => undefined));
    const store = createTodosStore(source);
    const said = vi.fn();
    store.onMessage(said);

    expect(() => { store.setDone('a', true); }).not.toThrow();
    await flush();
    expect(said).not.toHaveBeenCalled();
  });

  it('reports a refused write as «not saved»', async () => {
    const source = fakeTodosSource([item('a')]);
    source.refuseWith = new Error('unavailable');
    // A refused tick is judged once the list has settled (REFUSAL_SETTLE_MS); a refused add is said at once.
    const pending: (() => void)[] = [];
    const store = createTodosStore(source, { setTimeout: run => { pending.push(run); return pending.length; }, clearTimeout: () => {} });
    const said: TodosMessage[] = [];
    store.onMessage(message => said.push(message));
    store.start();
    await flush();

    store.setDone('a', true);
    store.add('Something', '2026-11-06');
    await flush();
    expect(said).toEqual([{ kind: 'not-saved' }]);
    for (const run of pending.splice(0)) run();

    expect(said).toEqual([{ kind: 'not-saved' }, { kind: 'not-saved' }]);
  });

  it('reports permission-denied as «no access»', async () => {
    const source = fakeTodosSource();
    source.refuseWith = permissionDenied();
    const store = createTodosStore(source);
    const said: TodosMessage[] = [];
    store.onMessage(message => said.push(message));

    store.remove('a');
    await flush();

    expect(said).toEqual([{ kind: 'no-access' }]);
  });

  it('reports a call the source itself throws on, instead of throwing at the screen', async () => {
    const source = fakeTodosSource();
    const store = createTodosStore(source);
    const said: TodosMessage[] = [];
    store.onMessage(message => said.push(message));

    expect(() => { store.add('   ', '2026-11-06'); }).not.toThrow();
    await flush();

    expect(said).toEqual([{ kind: 'not-saved' }]);
  });

  it('stops telling a message listener that was removed', async () => {
    const source = fakeTodosSource();
    source.refuseWith = new Error('unavailable');
    const store = createTodosStore(source);
    const said = vi.fn();
    store.onMessage(said)();

    store.setDone('a', true);
    await flush();

    expect(said).not.toHaveBeenCalled();
  });
});

describe('the to-do store: a refusal another phone caused', () => {
  // The refusal is judged once the list has settled (REFUSAL_SETTLE_MS): these timers run it when told to.
  async function started(seed: ReturnType<typeof item>[]) {
    const source = fakeTodosSource(seed);
    const pending: { run: () => void; ms: number }[] = [];
    const store = createTodosStore(source, {
      setTimeout: (run, ms) => { pending.push({ run, ms }); return pending.length; },
      clearTimeout: () => {},
    });
    const said: TodosMessage[] = [];
    store.onMessage(message => said.push(message));
    store.start();
    await flush();
    source.refuseWith = permissionDenied();
    const settle = () => { for (const p of pending.splice(0)) { expect(p.ms).toBe(REFUSAL_SETTLE_MS); p.run(); } };
    return { source, store, said, settle };
  }

  it('says nothing when the list, once settled, shows the item ticked (another phone ticked it first)', async () => {
    const { store, said, settle } = await started([item('a', true)]);
    store.setDone('a', true);
    await flush();
    settle();
    expect(said).toEqual([]);
    store.stop();
  });

  it('says nothing when a second untick of an item the list shows unticked is refused', async () => {
    const { store, said, settle } = await started([item('a', false)]);
    store.setDone('a', false);
    await flush();
    settle();
    expect(said).toEqual([]);
    store.stop();
  });

  it('says nothing when the refused item no longer exists in the list', async () => {
    const { store, said, settle } = await started([]);
    store.setDone('gone', true);
    await flush();
    settle();
    expect(said).toEqual([]);
    store.stop();
  });

  it('⚠️ decides only once settled: a tick refused while the list still shows it (its own pending tick) is said when it rolls back', async () => {
    const { source, store, said, settle } = await started([item('a', false)]);
    // The person's own tick shows at once, as Firestore's local copy does…
    source.items.set('a', item('a', true));
    source.push();
    store.setDone('a', true);
    await flush();
    expect(said).toEqual([]);
    // …then the server's refusal rolls it back before the store looks.
    source.items.set('a', item('a', false));
    source.push();
    settle();
    expect(said).toEqual([{ kind: 'no-access' }]);
    store.stop();
  });

  it('still reports a refused tick of an item the list shows unticked, and a refused delete at once', async () => {
    const { store, said, settle } = await started([item('a', false), item('b', true)]);
    store.remove('a');
    await flush();
    expect(said).toEqual([{ kind: 'no-access' }]);
    store.setDone('a', true);
    store.setDone('b', false);
    await flush();
    settle();
    expect(said).toEqual([{ kind: 'no-access' }, { kind: 'no-access' }, { kind: 'no-access' }]);
    store.stop();
  });
});

describe('the to-do store: asking again after a stream error', () => {
  function fakeTimers() {
    const pending: { id: number; run: () => void; ms: number }[] = [];
    let next = 0;
    return {
      pending,
      timers: {
        setTimeout: (run: () => void, ms: number) => { next += 1; pending.push({ id: next, run, ms }); return next; },
        clearTimeout: (handle: unknown) => {
          const at = pending.findIndex(p => p.id === handle);
          if (at >= 0) pending.splice(at, 1);
        },
      },
      fire: () => { pending.shift()?.run(); },
    };
  }

  it('re-subscribes after 30 s, 60 s, 120 s ... never past 5 minutes, keeping the items and the error until an answer', async () => {
    const source = fakeTodosSource([item('a')]);
    const clock = fakeTimers();
    const store = createTodosStore(source, clock.timers);
    store.start();
    await flush();

    const delays: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      source.breakStreams();
      expect(store.getSnapshot()).toMatchObject({ status: 'error' });
      expect(store.getSnapshot().items).toHaveLength(1);
      delays.push(clock.pending[0]?.ms ?? -1);
      expect(source.watching()).toBe(0);
      clock.fire();
      expect(source.watching()).toBe(1);
      // Still the error status and the old items until the answer arrives.
      expect(store.getSnapshot().status).toBe('error');
    }
    expect(delays).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);

    await flush();
    expect(store.getSnapshot().status).toBe('ready');
    store.stop();
  });

  it('goes back to 30 s after an answer arrives', async () => {
    const source = fakeTodosSource();
    const clock = fakeTimers();
    const store = createTodosStore(source, clock.timers);
    store.start();
    await flush();
    source.breakStreams();
    clock.fire();
    await flush();
    source.breakStreams();
    expect(clock.pending[0]?.ms).toBe(30_000);
    store.stop();
  });

  it('stop() cancels the pending retry', async () => {
    const source = fakeTodosSource();
    const clock = fakeTimers();
    const store = createTodosStore(source, clock.timers);
    store.start();
    await flush();
    source.breakStreams();
    expect(clock.pending).toHaveLength(1);
    store.stop();
    expect(clock.pending).toHaveLength(0);
    expect(source.watching()).toBe(0);
  });
});
