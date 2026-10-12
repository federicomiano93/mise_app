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
    deleteDoc: vi.fn(async (_ref: Ref) => {}),
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

// ── Step 3c-2: writing the configuration, the link picker's one read, the row-id stamp ──

function writeKit(server: Record<string, unknown> | null) {
  const base = fakeKit();
  const tx = {
    get: vi.fn(async (ref: Ref) => docSnap(ref.path.split('/').pop()!, server)),
    set: vi.fn((_ref: Ref, _data: Record<string, unknown>, _options?: unknown) => {}),
  };
  const fs = Object.assign(base.fs, {
    runTransaction: vi.fn(async (_db: unknown, body: (t: typeof tx) => Promise<unknown>) => body(tx)),
    getDocsFromServer: vi.fn(async (ref: Ref) => ({
      docs: [
        { id: 'r1', data: () => ({ name: 'Sourdough', ingredients: [] }), path: ref.path },
        { id: 'r2', data: () => ({ name: 'Focaccia', id: 'spoofed' }), path: ref.path },
      ],
    })),
  });
  return { ...base, fs, tx };
}

describe('saving the configuration and linking a recipe, as firestore.rules expect it', () => {
  const config = { clients: [], recipes: [{ id: 'own' }], configRev: 3, configModel: 1, bakery: 'elsewhere' } as never;

  test('⚠️ the configuration is written WHOLE in a transaction, with this build\'s configModel and the open venue stamped over what it carried', async () => {
    const { kit, fs, tx } = writeKit({ configRev: 3, recipes: [{ id: 'own' }] });
    const source = createFirestoreCalculatorSource(() => Promise.resolve(kit), 'bakery');
    await expect(source.saveConfig(config)).resolves.toBe(4);
    expect(fs.runTransaction).toHaveBeenCalledTimes(1);
    expect(tx.get.mock.calls[0]![0].path).toBe('locations/bakery/config/calculator');
    const [ref, data] = tx.set.mock.calls[0]!;
    expect(ref.path).toBe('locations/bakery/config/calculator');
    expect(data).toEqual({ clients: [], recipes: [{ id: 'own' }], configRev: 4, configModel: 4, bakery: 'bakery' });
    expect(fs.setDoc).not.toHaveBeenCalled();
  });

  test('⚠️ a Catalogue import that landed meanwhile (another revision) is kept, never overwritten', async () => {
    const { kit, tx } = writeKit({ configRev: 5, recipes: [{ id: 'own' }, { id: 'cat-new' }] });
    const source = createFirestoreCalculatorSource(() => Promise.resolve(kit), 'bakery');
    await source.saveConfig(config);
    const data = tx.set.mock.calls[0]![1] as { recipes: { id: string }[]; configRev: number };
    expect(data.recipes.map(r => r.id)).toStrictEqual(['own', 'cat-new']);
    expect(data.configRev).toBe(6);
  });

  test('a brand-new venue (no document) writes its first configuration at revision 1', async () => {
    const { kit, tx } = writeKit(null);
    const source = createFirestoreCalculatorSource(() => Promise.resolve(kit), 'bakery');
    await source.saveConfig({ ...(config as object), configRev: 0 } as never);
    expect((tx.set.mock.calls[0]![1] as { configRev: number }).configRev).toBe(1);
  });

  test('a refused transaction rejects, so the store can take the change back', async () => {
    const { kit, fs } = writeKit(null);
    fs.runTransaction.mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'permission-denied' }));
    const source = createFirestoreCalculatorSource(() => Promise.resolve(kit), 'bakery');
    await expect(source.saveConfig(config)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  test('⚠️ the picker reads the venue\'s catalogue recipes ONCE, FROM THE SERVER (never a cached partial list), with each document\'s own id winning over a field', async () => {
    const { kit, fs } = writeKit(null);
    const source = createFirestoreCalculatorSource(() => Promise.resolve(kit), 'bakery');
    const list = await source.listCatalogueRecipes();
    expect(fs.getDocsFromServer).toHaveBeenCalledTimes(1);
    expect(fs.getDocsFromServer.mock.calls[0]![0].path).toBe('locations/bakery/recipes');
    expect(fs.onSnapshot).not.toHaveBeenCalled();
    expect(list.map(r => r.id)).toStrictEqual(['r1', 'r2']);
  });

  test('⚠️ the row-id stamp reads the recipe AS IT IS NOW, in a transaction, and MERGES only `ingredients` onto it', async () => {
    // The server's recipe changed since any picker read it: the stamp must be built on THIS list.
    const now = [{ rid: 'ra', label: 'Flour', grams: 1000 }, { label: 'Water', grams: 700 }];
    const { kit, fs, tx } = writeKit({ name: 'Focaccia', ingredients: now });
    const source = createFirestoreCalculatorSource(() => Promise.resolve(kit), 'bakery');
    const rows = await source.stampRowIds('r1') as { rid: string; label: string }[];
    expect(tx.get.mock.calls[0]![0].path).toBe('locations/bakery/recipes/r1');
    expect(rows.map(r => r.label)).toStrictEqual(['Flour', 'Water']);
    expect(rows[0]).toBe(now[0]);
    expect(rows[1]!.rid).toMatch(/^r[a-z0-9]{8}$/);
    const [ref, data, options] = tx.set.mock.calls[0]!;
    expect(ref.path).toBe('locations/bakery/recipes/r1');
    expect(data).toEqual({ ingredients: rows });
    expect(options).toEqual({ merge: true });
    expect(fs.setDoc).not.toHaveBeenCalled();
  });

  test('a recipe whose rows all have ids already is NOT written again', async () => {
    const { kit, tx } = writeKit({ ingredients: [{ rid: 'ra', label: 'Flour' }, { rid: 'rb', label: 'Water' }] });
    const source = createFirestoreCalculatorSource(() => Promise.resolve(kit), 'bakery');
    await expect(source.stampRowIds('r1')).resolves.toHaveLength(2);
    expect(tx.set).not.toHaveBeenCalled();
  });

  test('a recipe deleted meanwhile, a refusal or a bad id rejects — and writes nothing', async () => {
    const gone = writeKit(null);
    await expect(createFirestoreCalculatorSource(() => Promise.resolve(gone.kit), 'bakery').stampRowIds('r1'))
      .rejects.toMatchObject({ code: 'not-found' });
    expect(gone.tx.set).not.toHaveBeenCalled();
    const bad = writeKit({ ingredients: [] });
    await expect(createFirestoreCalculatorSource(() => Promise.resolve(bad.kit), 'bakery').stampRowIds('a/b')).rejects.toThrow();
    expect(bad.fs.runTransaction).not.toHaveBeenCalled();
  });
});

describe('deleting a log (step 3c-3)', () => {
  test('deletes exactly that document under the open venue', async () => {
    const { kit, fs } = fakeKit();
    const source = createFirestoreCalculatorSource(() => Promise.resolve(kit), 'panificio-miano');
    await source.deleteLog('log-1');
    expect(fs.deleteDoc).toHaveBeenCalledTimes(1);
    expect(fs.deleteDoc.mock.calls[0]![0].path).toBe('locations/panificio-miano/logs/log-1');
  });

  test('⚠️ an id that could name another path is refused before Firestore is even asked', async () => {
    const { kit, fs } = fakeKit();
    let loaded = 0;
    const source = createFirestoreCalculatorSource(() => { loaded += 1; return Promise.resolve(kit); }, 'bakery');
    await expect(source.deleteLog('a/b')).rejects.toThrow();
    await expect(source.deleteLog('..')).rejects.toThrow();
    await expect(source.deleteLog('')).rejects.toThrow();
    expect(fs.deleteDoc).not.toHaveBeenCalled();
    expect(loaded).toBe(0);
  });
});
