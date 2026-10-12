import { describe, expect, test, vi } from 'vitest';
import type { FirestoreKit } from '../session/firebaseBackend';
import { checkId, createFirestoreCalculatorSource } from './calculatorSource';

// The ONLY code in Mise 2 that reads the Calculator from, and writes dough logs to, the real database,
// against a recording fake of the Firestore SDK. firestore.rules (the `logs` block) accept exactly the
// shape js/firebase.js `saveLogDoc` writes; a slip here — a log without the venue stamp, a merged write
// that keeps a stale version chain, an unbounded read of every log ever made — would first show as a
// dough missing from the office's history.

type Ref = { kind: string; path: string; parts?: unknown[] };

function fakeKit() {
  const listeners: { target: Ref; options: unknown; next: (snap: unknown) => void; error: (err: unknown) => void; stopped: boolean }[] = [];
  const fs = {
    collection: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'collection', path: segments.join('/') }),
    doc: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'doc', path: segments.join('/') }),
    query: (ref: Ref, ...parts: unknown[]): Ref => ({ ...ref, kind: 'query', parts }),
    where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
    onSnapshot: vi.fn((target: Ref, ...rest: unknown[]) => {
      const options = typeof rest[0] === 'function' ? undefined : rest.shift();
      const [next, error] = rest as [(snap: unknown) => void, (err: unknown) => void];
      const entry = { target, options, next, error, stopped: false };
      listeners.push(entry);
      return () => { entry.stopped = true; };
    }),
    setDoc: vi.fn(async (_ref: Ref, _data: Record<string, unknown>, _options?: unknown) => {}),
  };
  const kit = { fs, db: {} } as unknown as FirestoreKit;
  const live = (path: string) => listeners.filter(l => l.target.path === path && !l.stopped);
  return { kit, fs, listeners, live };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function docSnap(id: string, data: Record<string, unknown> | null, fromCache = false) {
  return { id, exists: () => data !== null, data: () => data, metadata: { fromCache } };
}

describe('the Calculator source, as firestore.rules expect it', () => {
  test('⚠️ a log is written WHOLE (no merge) under the open venue, stamped for it over whatever it carried', async () => {
    const { kit, fs } = fakeKit();
    const source = createFirestoreCalculatorSource(() => Promise.resolve(kit), 'panificio-miano');
    await source.saveLog({ id: 'log-1', dough: 'Sourdough', bakery: 'main', versions: [] });
    expect(fs.setDoc).toHaveBeenCalledTimes(1);
    const [ref, data, options] = fs.setDoc.mock.calls[0]!;
    expect(ref.path).toBe('locations/panificio-miano/logs/log-1');
    expect(data).toEqual({ id: 'log-1', dough: 'Sourdough', bakery: 'panificio-miano', versions: [] });
    expect(options).toBeUndefined();
  });

  test('⚠️ a log id that could name another path never reaches Firestore', async () => {
    const { kit, fs } = fakeKit();
    const source = createFirestoreCalculatorSource(() => Promise.resolve(kit), 'bakery');
    await expect(source.saveLog({ id: 'a/b' })).rejects.toThrow();
    await expect(source.saveLog({ id: '..' })).rejects.toThrow();
    await expect(source.saveLog({ id: '' })).rejects.toThrow();
    expect(fs.setDoc).not.toHaveBeenCalled();
    expect(() => checkId(undefined)).toThrow();
    expect(checkId('log-x')).toBe('log-x');
  });

  test('a venue id that could point anywhere else is refused before anything is built', () => {
    const { kit } = fakeKit();
    expect(() => createFirestoreCalculatorSource(() => Promise.resolve(kit), 'a/b')).toThrow();
  });

  test('⚠️ the logs are read for a WINDOW only (P14), from createdAtMs, with metadata changes', async () => {
    const { kit, listeners } = fakeKit();
    const source = createFirestoreCalculatorSource(() => Promise.resolve(kit), 'bakery');
    const seen: unknown[] = [];
    source.watchLogs(1000, (list, meta) => seen.push([list, meta]), () => {});
    await settle();
    const [listener] = listeners;
    expect(listener!.target.path).toBe('locations/bakery/logs');
    expect(listener!.target.parts).toEqual([{ where: ['createdAtMs', '>=', 1000] }]);
    expect(listener!.options).toEqual({ includeMetadataChanges: true });
    listener!.next({ docs: [{ id: 'l1', data: () => ({ dough: 'Pizza' }) }], metadata: { fromCache: true } });
    expect(seen).toEqual([[[{ dough: 'Pizza', id: 'l1' }], { fromServer: false }]]);
  });

  test('the configuration: its fields, or null for no document — and where the answer came from', async () => {
    const { kit, listeners } = fakeKit();
    const source = createFirestoreCalculatorSource(() => Promise.resolve(kit), 'bakery');
    const seen: unknown[] = [];
    source.watchConfig((data, meta) => seen.push([data, meta]), () => {});
    await settle();
    expect(listeners[0]!.target.path).toBe('locations/bakery/config/calculator');
    expect(listeners[0]!.options).toEqual({ includeMetadataChanges: true });
    listeners[0]!.next(docSnap('calculator', null, true));
    listeners[0]!.next(docSnap('calculator', { recipes: [] }));
    expect(seen).toEqual([[null, { fromServer: false }], [{ recipes: [] }, { fromServer: true }]]);
  });

  test('⚠️ a refused configuration stream calls onError, NEVER onChange (it would count as an answer)', async () => {
    const { kit, listeners } = fakeKit();
    const source = createFirestoreCalculatorSource(() => Promise.resolve(kit), 'bakery');
    const onChange = vi.fn();
    const onError = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    source.watchConfig(onChange, onError);
    await settle();
    listeners[0]!.error(new Error('permission-denied'));
    expect(onChange).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test('a configuration stream that never starts (Firestore did not load) calls onError only', async () => {
    const source = createFirestoreCalculatorSource(() => Promise.reject(new Error('offline')), 'bakery');
    const onChange = vi.fn();
    const onError = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    source.watchConfig(onChange, onError);
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  test('⚠️ a linked recipe is read ONE BY ONE by its own path; a refusal is the answer «gone», from the server', async () => {
    const { kit, fs, listeners } = fakeKit();
    const source = createFirestoreCalculatorSource(() => Promise.resolve(kit), 'bakery');
    const seen: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    source.watchLinkedRecipe('r1', (recipe, meta) => seen.push([recipe, meta]));
    await settle();
    expect(listeners[0]!.target.kind).toBe('doc');
    expect(listeners[0]!.target.path).toBe('locations/bakery/recipes/r1');
    listeners[0]!.next(docSnap('r1', { name: 'Focaccia' }, true));
    listeners[0]!.error(new Error('permission-denied'));
    expect(seen).toEqual([
      [{ name: 'Focaccia', id: 'r1' }, { fromServer: false }],
      [null, { fromServer: true }],
    ]);
    expect(fs.onSnapshot).toHaveBeenCalledTimes(1);
  });

  test('a linked id that could name another path is «gone» at once and never reaches Firestore', async () => {
    const { kit, fs } = fakeKit();
    const source = createFirestoreCalculatorSource(() => Promise.resolve(kit), 'bakery');
    const seen: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    source.watchLinkedRecipe('x/y', (recipe, meta) => seen.push([recipe, meta]));
    await settle();
    expect(seen).toEqual([[null, { fromServer: true }]]);
    expect(fs.onSnapshot).not.toHaveBeenCalled();
  });

  test('stopping before Firestore has loaded starts nothing; stopping after ends the listener', async () => {
    const { kit, listeners, live } = fakeKit();
    const source = createFirestoreCalculatorSource(() => Promise.resolve(kit), 'bakery');
    const early = source.watchConfig(() => {}, () => {});
    early();
    await settle();
    expect(listeners).toHaveLength(0);
    const late = source.watchLogs(0, () => {}, () => {});
    await settle();
    expect(live('locations/bakery/logs')).toHaveLength(1);
    late();
    expect(live('locations/bakery/logs')).toHaveLength(0);
  });
});
