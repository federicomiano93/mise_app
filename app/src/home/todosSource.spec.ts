import { describe, expect, test, vi } from 'vitest';
import type { FirestoreKit } from '../session/firebaseBackend';
import { TODO_TEXT_MAX, cleanTodoText, createFirestoreTodosSource } from './todosSource';

// The ONLY code in Mise 2 that writes the «Da fare» list to the real database, against a recording fake of
// the Firestore SDK. firestore.rules (`match /todos/{id}`) accept exactly these shapes, so a slip here — a
// missing venue stamp, a stray key, an expireAt on an untick — would first show as a refused tick on a phone.

type Ref = { kind: string; path: string };
const SERVER_TIME = { sentinel: 'serverTimestamp' };

function fakeKit() {
  const snapshots: { target: Ref; options: unknown; next: (snap: unknown) => void; error: (err: unknown) => void; stopped: boolean }[] = [];
  const fs = {
    collection: (_db: unknown, path: string): Ref => ({ kind: 'collection', path }),
    doc: (_db: unknown, path: string, id: string): Ref => ({ kind: 'doc', path: `${path}/${id}` }),
    serverTimestamp: () => SERVER_TIME,
    Timestamp: { fromMillis: (ms: number) => ({ timestampMs: ms }) },
    onSnapshot: vi.fn((target: Ref, options: unknown, next: (snap: unknown) => void, error: (err: unknown) => void) => {
      const entry = { target, options, next, error, stopped: false };
      snapshots.push(entry);
      return () => { entry.stopped = true; };
    }),
    setDoc: vi.fn(async (..._args: unknown[]) => undefined),
    updateDoc: vi.fn(async (..._args: unknown[]) => undefined),
    deleteDoc: vi.fn(async (..._args: unknown[]) => undefined),
  };
  const kit = { fs, db: {} } as unknown as FirestoreKit;
  return { kit, fs, snapshots };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const stamp = (ms: number) => ({ toMillis: () => ms });
const doc = (id: string, data: Record<string, unknown>) => ({ id, data: vi.fn(() => data) });

function make(now = () => 1_000_000) {
  const k = fakeKit();
  const source = createFirestoreTodosSource(() => Promise.resolve(k.kit), 'panificio-miano', now);
  return { ...k, source };
}

describe('the to-do source, as firestore.rules expect it', () => {
  test('add writes a whole new document on a made 20-character id, with exactly the keys the rules require', async () => {
    const { source, fs } = make();
    const { id, written } = source.add('  Call the mill  ', '2026-11-07');
    expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
    await written;

    expect(fs.setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload, options] = fs.setDoc.mock.calls[0] as [Ref, Record<string, unknown>, unknown];
    expect(ref.path).toBe(`locations/panificio-miano/todos/${id}`);
    expect(options).toBeUndefined();
    expect(payload).toEqual({
      bakery: 'panificio-miano',
      text: 'Call the mill',
      day: '2026-11-07',
      done: false,
      doneAt: null,
      expireAt: null,
      createdAt: SERVER_TIME,
    });
  });

  test('edit changes the bakery stamp, the words and the day only', async () => {
    const { source, fs } = make();
    await source.edit('abc', ' New words ', '2026-11-09');
    const [ref, payload] = fs.updateDoc.mock.calls[0] as [Ref, Record<string, unknown>];
    expect(ref.path).toBe('locations/panificio-miano/todos/abc');
    expect(payload).toEqual({ bakery: 'panificio-miano', text: 'New words', day: '2026-11-09' });
  });

  test('a tick stamps doneAt with the server time and expireAt thirty days from the phone clock', async () => {
    const { source, fs } = make(() => 5_000);
    await source.setDone('abc', true);
    const [ref, payload] = fs.updateDoc.mock.calls[0] as [Ref, Record<string, unknown>];
    expect(ref.path).toBe('locations/panificio-miano/todos/abc');
    expect(payload).toEqual({
      bakery: 'panificio-miano',
      done: true,
      doneAt: SERVER_TIME,
      expireAt: { timestampMs: 5_000 + 30 * 86_400_000 },
    });
  });

  test('an untick clears doneAt and expireAt', async () => {
    const { source, fs } = make();
    await source.setDone('abc', false);
    const [, payload] = fs.updateDoc.mock.calls[0] as [Ref, Record<string, unknown>];
    expect(payload).toEqual({ bakery: 'panificio-miano', done: false, doneAt: null, expireAt: null });
  });

  test('remove deletes the document', async () => {
    const { source, fs } = make();
    await source.remove('abc');
    const [ref] = fs.deleteDoc.mock.calls[0] as [Ref];
    expect(ref.path).toBe('locations/panificio-miano/todos/abc');
  });

  test('a refused write rejects, so the store can say so', async () => {
    const { source, fs } = make();
    fs.updateDoc.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await expect(source.setDone('abc', true)).rejects.toThrow('denied');
  });

  test('a bad day or bad words throw before anything is written', async () => {
    const { source, fs } = make();
    expect(() => source.add('Fine', '7 November')).toThrow('Not a day');
    expect(() => source.add('   ', '2026-11-07')).toThrow();
    await expect(source.edit('abc', 'Fine', 'tomorrow')).rejects.toThrow('Not a day');
    await expect(source.edit('abc', '', '2026-11-07')).rejects.toThrow();
    expect(fs.setDoc).not.toHaveBeenCalled();
    expect(fs.updateDoc).not.toHaveBeenCalled();
  });

  test('a venue id that could point elsewhere is refused', () => {
    expect(() => createFirestoreTodosSource(() => Promise.resolve(fakeKit().kit), '../other')).toThrow();
  });
});

describe('the to-do source: watching', () => {
  test('reads the whole collection with metadata changes, server times as estimates, and maps the times', async () => {
    const { source, fs, snapshots } = make();
    const onChange = vi.fn();
    source.watch(onChange, vi.fn());
    await flush();

    const [entry] = snapshots;
    expect(entry?.target.path).toBe('locations/panificio-miano/todos');
    expect(entry?.options).toEqual({ includeMetadataChanges: true });

    const good = doc('a', { text: 'Call the mill', day: '2026-11-07', done: true, doneAt: stamp(900), createdAt: stamp(100) });
    entry?.next({ docs: [good], metadata: { fromCache: true } });

    expect(good.data).toHaveBeenCalledWith({ serverTimestamps: 'estimate' });
    expect(onChange).toHaveBeenCalledWith(
      [{ id: 'a', text: 'Call the mill', day: '2026-11-07', done: true, doneAtMs: 900, createdAtMs: 100 }],
      true,
    );
    expect(fs.onSnapshot).toHaveBeenCalledTimes(1);
  });

  test('skips a malformed document and reports fromCache false from the server', async () => {
    const { source, snapshots } = make();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onChange = vi.fn();
    source.watch(onChange, vi.fn());
    await flush();

    snapshots[0]?.next({
      docs: [
        doc('bad1', { text: '', day: '2026-11-07' }),
        doc('bad2', { text: 'No day' }),
        doc('bad3', { text: 'Bad day', day: 'soon' }),
        doc('ok', { text: 'Fine', day: '2026-11-07', done: false, doneAt: null, createdAt: null }),
      ],
      metadata: { fromCache: false },
    });

    expect(onChange).toHaveBeenCalledWith(
      [{ id: 'ok', text: 'Fine', day: '2026-11-07', done: false, doneAtMs: null, createdAtMs: null }],
      false,
    );
  });

  test('passes a stream error on', async () => {
    const { source, snapshots } = make();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onError = vi.fn();
    source.watch(vi.fn(), onError);
    await flush();
    const err = new Error('unavailable');
    snapshots[0]?.error(err);
    expect(onError).toHaveBeenCalledWith(err);
  });

  test('stopping unsubscribes, and stopping before Firestore has loaded never subscribes', async () => {
    const live = make();
    const stop = live.source.watch(vi.fn(), vi.fn());
    await flush();
    stop();
    expect(live.snapshots[0]?.stopped).toBe(true);

    const early = make();
    const stopEarly = early.source.watch(vi.fn(), vi.fn());
    stopEarly();
    await flush();
    expect(early.fs.onSnapshot).not.toHaveBeenCalled();
  });
});

describe('cleanTodoText', () => {
  test('trims, refuses empty and whitespace, accepts 200 characters and refuses 201', () => {
    expect(cleanTodoText('  hello ')).toBe('hello');
    expect(() => cleanTodoText('')).toThrow();
    expect(() => cleanTodoText('   \n ')).toThrow();
    expect(cleanTodoText('x'.repeat(TODO_TEXT_MAX))).toHaveLength(200);
    expect(() => cleanTodoText('x'.repeat(TODO_TEXT_MAX + 1))).toThrow();
  });
});
