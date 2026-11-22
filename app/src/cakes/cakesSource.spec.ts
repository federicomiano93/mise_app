import { describe, expect, test, vi } from 'vitest';
import type { ReferenceGrams } from '@mise/shared/cake-model';
import type { FirestoreKit } from '../session/firebaseBackend';
import { createFirestoreCakesSource } from './cakesSource';

// The ONLY code in Mise 2 that listens to the cakes and writes the reference grams, against a recording fake of the Firestore SDK.
// firestore.rules (`cakes/{id}`, `cake-settings/reference`) accept exactly these shapes. A cake itself is never written here.

type Ref = { kind: string; path: string };

function fakeKit() {
  const listeners: { target: Ref; options: unknown; next: (snap: unknown) => void; error: (err: unknown) => void; stopped: boolean }[] = [];
  const fs = {
    collection: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'collection', path: segments.join('/') }),
    doc: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'doc', path: segments.join('/') }),
    onSnapshot: vi.fn((target: Ref, ...rest: unknown[]) => {
      const options = typeof rest[0] === 'function' ? undefined : rest.shift();
      const [next, error] = rest as [(snap: unknown) => void, (err: unknown) => void];
      const entry = { target, options, next, error, stopped: false };
      listeners.push(entry);
      return () => { entry.stopped = true; };
    }),
    setDoc: vi.fn(async (_ref: Ref, _data: Record<string, unknown>, _options?: unknown) => {}),
    writeBatch: vi.fn(),
    deleteDoc: vi.fn(),
    updateDoc: vi.fn(),
  };
  const kit = { fs, db: {} } as unknown as FirestoreKit;
  const live = (path: string) => listeners.filter(l => l.target.path === path && !l.stopped);
  return { kit, fs, listeners, live };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const REF: ReferenceGrams = { diameterCm: 22, discs: 3, discHeightCm: 3, baseG: 300, soakG: 90, fillingG: 280, coatingG: 450, decorationG: 200 };

describe('the Cakes source, as firestore.rules expect it', () => {
  test('the cakes are listened to with metadata changes, id beside the fields, and say where the answer came from', async () => {
    const { kit, live } = fakeKit();
    const source = createFirestoreCakesSource(() => Promise.resolve(kit), 'panificio-miano');
    const onChange = vi.fn();
    source.watchCakes(onChange, vi.fn());
    await settle();
    const [listener] = live('locations/panificio-miano/cakes');
    expect(listener!.options).toEqual({ includeMetadataChanges: true });
    const snap = (fromCache: boolean) => ({ docs: [{ id: 'c1', data: () => ({ name: 'Sacher' }) }], metadata: { fromCache } });
    listener!.next(snap(true));
    listener!.next(snap(false));
    expect(onChange.mock.calls).toEqual([
      [[{ name: 'Sacher', id: 'c1' }], { fromServer: false }],
      [[{ name: 'Sacher', id: 'c1' }], { fromServer: true }],
    ]);
  });

  test('a stream that dies is reported, and stopping before Firestore has loaded listens to nothing', async () => {
    const { kit, live, listeners } = fakeKit();
    const source = createFirestoreCakesSource(() => Promise.resolve(kit), 'bakery');
    const onError = vi.fn();
    source.watchCakes(vi.fn(), onError);
    await settle();
    const failure = new Error('permission-denied');
    live('locations/bakery/cakes')[0]!.error(failure);
    expect(onError).toHaveBeenCalledWith(failure);

    const early = createFirestoreCakesSource(() => Promise.resolve(kit), 'bakery').watchCakes(vi.fn(), vi.fn());
    early();
    await settle();
    expect(listeners.filter(l => !l.stopped)).toHaveLength(1);
  });

  test('the reference is one document, with metadata changes; missing reads as null; a refusal reads as the server saying none', async () => {
    const { kit, live } = fakeKit();
    const source = createFirestoreCakesSource(() => Promise.resolve(kit), 'bakery');
    const onChange = vi.fn();
    source.watchReference(onChange);
    await settle();
    const [listener] = live('locations/bakery/cake-settings/reference');
    expect(listener!.options).toEqual({ includeMetadataChanges: true });
    listener!.next({ exists: () => true, data: () => ({ grams: REF }), metadata: { fromCache: false } });
    listener!.next({ exists: () => false, data: () => undefined, metadata: { fromCache: true } });
    listener!.error(new Error('permission-denied'));
    expect(onChange.mock.calls).toEqual([
      [{ grams: REF }, { fromServer: true }],
      [null, { fromServer: false }],
      [null, { fromServer: true }],
    ]);
  });

  test('⚠️ the standard cake is written WHOLE with setDoc (never merged), exactly what it was handed', async () => {
    const { kit, fs } = fakeKit();
    const source = createFirestoreCakesSource(() => Promise.resolve(kit), 'panificio-miano');
    const row = { diameterCm: 22, baseG: 300, soakG: 90, fillingG: 280, coatingG: 450, decorationG: 200 };
    const doc = { bakery: 'panificio-miano', grams: REF, rows: [row], updatedAt: '2026-11-21T09:00:00.000Z' };
    await source.saveStandard(doc);
    expect(fs.writeBatch).not.toHaveBeenCalled();
    const [ref, data, options] = fs.setDoc.mock.calls[0]!;
    expect(ref.path).toBe('locations/panificio-miano/cake-settings/reference');
    expect(options).toBeUndefined();
    expect(data).toEqual(doc);
  });

  test('⚠️ this source writes no cake, ever: it has no such call', () => {
    const { kit } = fakeKit();
    const source = createFirestoreCakesSource(() => Promise.resolve(kit), 'bakery');
    expect(Object.keys(source).sort()).toEqual(['saveStandard', 'watchCakes', 'watchReference']);
  });

  test('the venue id is checked before anything is built from it', () => {
    const { kit } = fakeKit();
    expect(() => createFirestoreCakesSource(() => Promise.resolve(kit), '../other')).toThrow();
  });
});
