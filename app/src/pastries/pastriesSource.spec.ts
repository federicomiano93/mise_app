import { describe, expect, test, vi } from 'vitest';
import type { FirestoreKit } from '../session/firebaseBackend';
import { LOG_READ_LIMIT, createFirestorePastriesSource } from './pastriesSource';

// The ONLY code in Mise 2 that writes Pastries to the real database, against a recording fake of
// the Firestore SDK. firestore.rules (the `pastries` and `pastry-logs` blocks) accept exactly these
// shapes; every other spec runs on an in-memory source, so a slip here — a merge write, a key the
// whitelist refuses, a missing venue stamp, a wider read — would otherwise first show as a refused
// save on a phone.

type Ref = { kind: string; path: string; parts?: unknown[] };

function fakeKit() {
  const calls: { fn: string; args: unknown[] }[] = [];
  const record = (fn: string) => (...args: unknown[]) => { calls.push({ fn, args }); };
  const snapshots: { target: Ref; next: (snap: unknown) => void; error: (err: unknown) => void; stopped: boolean }[] = [];
  let stored: Record<string, unknown> | null = null;
  const fs = {
    collection: (_db: unknown, path: string): Ref => ({ kind: 'collection', path }),
    doc: (_db: unknown, path: string, id: string): Ref => ({ kind: 'doc', path: `${path}/${id}` }),
    orderBy: (field: string, dir: string) => ({ orderBy: [field, dir] }),
    limit: (n: number) => ({ limit: n }),
    where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
    query: (ref: Ref, ...parts: unknown[]): Ref => ({ ...ref, kind: 'query', parts }),
    onSnapshot: vi.fn((target: Ref, next: (snap: unknown) => void, error: (err: unknown) => void) => {
      const entry = { target, next, error, stopped: false };
      snapshots.push(entry);
      return () => { entry.stopped = true; };
    }),
    setDoc: vi.fn(async (...args: unknown[]) => { record('setDoc')(...args); }),
    getDoc: vi.fn(async (ref: Ref) => ({
      id: ref.path.split('/').pop(),
      exists: () => stored !== null,
      data: () => stored,
    })),
    deleteDoc: vi.fn(async (...args: unknown[]) => { record('deleteDoc')(...args); }),
    runTransaction: vi.fn(async (_db: unknown, body: (tx: unknown) => Promise<void>) => {
      const tx = {
        get: async () => ({ exists: () => stored !== null, data: () => stored }),
        set: (...args: unknown[]) => { record('tx.set')(...args); },
      };
      await body(tx);
    }),
  };
  const kit = { fs, db: {} } as unknown as FirestoreKit;
  return {
    kit, fs, calls, snapshots,
    setStored: (value: Record<string, unknown> | null) => { stored = value; },
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('the Pastries source, as firestore.rules expect it', () => {
  test('a day is written WHOLE (no merge), with exactly the keys the rules allow, stamped for the venue', async () => {
    const { kit, fs } = fakeKit();
    const source = createFirestorePastriesSource(() => Promise.resolve(kit), 'panificio-miano');
    await source.saveDay('Tuesday', [{ name: 'Cornetti', qty: 24 }], 'butter is low');
    expect(fs.setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload, options] = fs.setDoc.mock.calls[0] as [Ref, Record<string, unknown>, unknown];
    expect(ref.path).toBe('locations/panificio-miano/pastries/Tuesday');
    // ⚠️ No third argument: `{ merge: true }` would let a removed field survive and stop the rules
    // from requiring every key.
    expect(options).toBeUndefined();
    expect(Object.keys(payload).sort()).toEqual(['bakery', 'day', 'items', 'note', 'updatedAt']);
    expect(payload).toMatchObject({
      bakery: 'panificio-miano', day: 'Tuesday', items: [{ name: 'Cornetti', qty: 24 }], note: 'butter is low',
    });
    expect(typeof payload.updatedAt).toBe('string');
    expect((payload.updatedAt as string).length).toBeLessThanOrEqual(64);
  });

  test('a refused write rejects, so the store can put the day back', async () => {
    const { kit, fs } = fakeKit();
    fs.setDoc.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    const source = createFirestorePastriesSource(() => Promise.resolve(kit), 'bakery');
    await expect(source.saveDay('Monday', [], '')).rejects.toThrow('denied');
  });

  test('a record is written in a transaction, without `id` as a field, stamped for the venue', async () => {
    const { kit, fs, calls, setStored } = fakeKit();
    setStored({ createdAt: '2026-10-14T19:00:00.000Z' });
    const source = createFirestorePastriesSource(() => Promise.resolve(kit), 'bakery');
    const build = vi.fn((existing: Record<string, unknown> | null) => ({
      id: '2026-10-14_Friday', date: '2026-10-14', day: 'Friday' as const, items: [], note: '',
      createdAt: String(existing?.createdAt ?? 'now'), updatedAt: 'now',
    }));
    await source.confirmLog('2026-10-14_Friday', build);
    expect(fs.runTransaction).toHaveBeenCalledTimes(1);
    // The builder is handed the record as it is INSIDE the transaction.
    expect(build).toHaveBeenCalledWith({ createdAt: '2026-10-14T19:00:00.000Z' });
    const set = calls.find(c => c.fn === 'tx.set');
    const [ref, payload] = set!.args as [Ref, Record<string, unknown>];
    expect(ref.path).toBe('locations/bakery/pastry-logs/2026-10-14_Friday');
    expect(payload).not.toHaveProperty('id');
    expect(Object.keys(payload).sort()).toEqual(['bakery', 'createdAt', 'date', 'day', 'items', 'note', 'updatedAt']);
    expect(payload).toMatchObject({ bakery: 'bakery', createdAt: '2026-10-14T19:00:00.000Z' });
  });

  test('the records are read newest first by the date FIELD, at most 120', async () => {
    const { kit, snapshots } = fakeKit();
    const source = createFirestorePastriesSource(() => Promise.resolve(kit), 'bakery');
    source.watchLogs(() => {}, () => {});
    await flush();
    expect(LOG_READ_LIMIT).toBe(120);
    expect(snapshots[0]!.target).toEqual({
      kind: 'query', path: 'locations/bakery/pastry-logs', parts: [{ orderBy: ['date', 'desc'] }, { limit: 120 }],
    });
  });

  test('tonight\'s confirmations are one equality filter on the date', async () => {
    const { kit, snapshots } = fakeKit();
    const source = createFirestorePastriesSource(() => Promise.resolve(kit), 'bakery');
    source.watchLogsForDate('2026-10-14', () => {}, () => {});
    await flush();
    expect(snapshots[0]!.target).toEqual({
      kind: 'query', path: 'locations/bakery/pastry-logs', parts: [{ where: ['date', '==', '2026-10-14'] }],
    });
  });

  test('the seven days are the whole collection, each document with its id', async () => {
    const { kit, snapshots } = fakeKit();
    const source = createFirestorePastriesSource(() => Promise.resolve(kit), 'bakery');
    const seen = vi.fn();
    source.watchDays(seen, () => {});
    await flush();
    expect(snapshots[0]!.target).toEqual({ kind: 'collection', path: 'locations/bakery/pastries' });
    snapshots[0]!.next({ docs: [{ id: 'Monday', data: () => ({ items: [], note: '', id: 'forged' }) }] });
    // The document's name wins over any `id` field stored inside it.
    expect(seen).toHaveBeenCalledWith([{ items: [], note: '', id: 'Monday' }]);
  });

  test('a stop before Firestore has loaded never subscribes; a stop after unsubscribes', async () => {
    const { kit, fs, snapshots } = fakeKit();
    let release: (k: FirestoreKit) => void = () => {};
    const source = createFirestorePastriesSource(() => new Promise(resolve => { release = resolve; }), 'bakery');
    const stop = source.watchDays(() => {}, () => {});
    stop();
    release(kit);
    await flush();
    expect(fs.onSnapshot).not.toHaveBeenCalled();

    const live = createFirestorePastriesSource(() => Promise.resolve(kit), 'bakery');
    const stopLive = live.watchDays(() => {}, () => {});
    await flush();
    stopLive();
    expect(snapshots[0]!.stopped).toBe(true);
  });

  test('a Firestore that cannot load is reported to the watcher', async () => {
    const source = createFirestorePastriesSource(() => Promise.reject(new Error('offline')), 'bakery');
    const onError = vi.fn();
    source.watchDays(() => {}, onError);
    await flush();
    expect(onError).toHaveBeenCalled();
  });

  test('a record is deleted by its id and nothing else; reading a missing one answers null', async () => {
    const { kit, fs, calls } = fakeKit();
    const source = createFirestorePastriesSource(() => Promise.resolve(kit), 'bakery');
    await source.deleteLog('2026-10-13_Wednesday');
    expect(fs.deleteDoc).toHaveBeenCalledTimes(1);
    expect((calls.find(c => c.fn === 'deleteDoc')!.args[0] as Ref).path).toBe('locations/bakery/pastry-logs/2026-10-13_Wednesday');
    expect(await source.getLog('2026-10-14_Friday')).toBeNull();
  });

  test('a venue id that could point a write elsewhere is refused before anything is written', () => {
    for (const bad of ['', 'a/b', '..', 'locations/bakery']) {
      expect(() => createFirestorePastriesSource(() => Promise.reject(new Error('never')), bad)).toThrow();
    }
  });
});
