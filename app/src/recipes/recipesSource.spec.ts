import { describe, expect, test, vi } from 'vitest';
import type { FirestoreKit } from '../session/firebaseBackend';
import { createFirestoreRecipesSource } from './recipesSource';

// The ONLY code in Mise 2 that reads the Recipe catalogue from the real database, against a recording
// fake of the Firestore SDK. A slip here — another venue's path, a listener without metadata changes
// (so the server's identical answer is never heard), an id lost behind a field called `id` — would
// first show as an empty or a wrong catalogue on somebody's phone.

type Ref = { kind: string; path: string };

function fakeKit() {
  const listeners: { target: Ref; options: unknown; next: (snap: unknown) => void; error: (err: unknown) => void; stopped: boolean }[] = [];
  const fs = {
    collection: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'collection', path: segments.join('/') }),
    onSnapshot: vi.fn((target: Ref, ...rest: unknown[]) => {
      const options = typeof rest[0] === 'function' ? undefined : rest.shift();
      const [next, error] = rest as [(snap: unknown) => void, (err: unknown) => void];
      const entry = { target, options, next, error, stopped: false };
      listeners.push(entry);
      return () => { entry.stopped = true; };
    }),
  };
  const kit = { fs, db: {} } as unknown as FirestoreKit;
  return { kit, fs, listeners };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function snapOf(docs: Array<Record<string, unknown> & { id: string }>, fromCache = false) {
  return {
    docs: docs.map(({ id, ...data }) => ({ id, data: () => data })),
    metadata: { fromCache },
  };
}

describe('the Recipe catalogue source', () => {
  test('watches the open venue’s recipes, with metadata changes, and says where each answer came from', async () => {
    const { kit, listeners } = fakeKit();
    const source = createFirestoreRecipesSource(() => Promise.resolve(kit), 'panificio-miano');
    const onChange = vi.fn();
    source.watchRecipes(onChange, vi.fn());
    await settle();
    expect(listeners).toHaveLength(1);
    expect(listeners[0]!.target.path).toBe('locations/panificio-miano/recipes');
    expect(listeners[0]!.options).toEqual({ includeMetadataChanges: true });
    listeners[0]!.next(snapOf([{ id: 'r1', name: 'Focaccia' }], true));
    listeners[0]!.next(snapOf([{ id: 'r1', name: 'Focaccia' }], false));
    expect(onChange).toHaveBeenNthCalledWith(1, [{ name: 'Focaccia', id: 'r1' }], { fromServer: false });
    expect(onChange).toHaveBeenNthCalledWith(2, [{ name: 'Focaccia', id: 'r1' }], { fromServer: true });
  });

  test('⚠️ the document id wins over a stored field called `id`', async () => {
    const { kit, listeners } = fakeKit();
    const source = createFirestoreRecipesSource(() => Promise.resolve(kit), 'bakery');
    const onChange = vi.fn();
    source.watchRecipes(onChange, vi.fn());
    await settle();
    listeners[0]!.next({ docs: [{ id: 'real', data: () => ({ id: 'forged', name: 'X' }) }], metadata: { fromCache: false } });
    expect(onChange.mock.calls[0]![0]).toEqual([{ id: 'real', name: 'X' }]);
  });

  test('a stop before Firestore has loaded attaches nothing; a stop after ends the listener', async () => {
    const { kit, listeners } = fakeKit();
    const source = createFirestoreRecipesSource(() => Promise.resolve(kit), 'bakery');
    source.watchRecipes(vi.fn(), vi.fn())();
    await settle();
    expect(listeners).toHaveLength(0);
    const stop = source.watchRecipes(vi.fn(), vi.fn());
    await settle();
    stop();
    expect(listeners[0]!.stopped).toBe(true);
  });

  test('a refused stream and a Firestore that cannot load both reach onError', async () => {
    const { kit, listeners } = fakeKit();
    const onError = vi.fn();
    createFirestoreRecipesSource(() => Promise.resolve(kit), 'bakery').watchRecipes(vi.fn(), onError);
    await settle();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    listeners[0]!.error(new Error('permission-denied'));
    expect(onError).toHaveBeenCalledTimes(1);
    const failed = vi.fn();
    createFirestoreRecipesSource(() => Promise.reject(new Error('chunk')), 'bakery').watchRecipes(vi.fn(), failed);
    await settle();
    expect(failed).toHaveBeenCalledTimes(1);
  });

  test('⚠️ a venue id that could name another path is refused before anything is read', () => {
    const { kit } = fakeKit();
    expect(() => createFirestoreRecipesSource(() => Promise.resolve(kit), '../other')).toThrow();
  });
});
