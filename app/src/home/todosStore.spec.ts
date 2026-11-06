import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeTodosSource, permissionDenied } from '../testing/fakeTodosSource';
import { createTodosStore } from './todosStore';
import type { TodosMessage } from './todosStore';

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
    const source = fakeTodosSource();
    source.refuseWith = new Error('unavailable');
    const store = createTodosStore(source);
    const said: TodosMessage[] = [];
    store.onMessage(message => said.push(message));

    store.setDone('a', true);
    store.add('Something', '2026-11-06');
    await flush();

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
