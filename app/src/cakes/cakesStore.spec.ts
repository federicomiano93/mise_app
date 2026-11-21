import { describe, expect, test, vi } from 'vitest';
import type { ReferenceGrams } from '@mise/shared/cake-model';
import type { StoredDoc } from '../foodcost/foodcostSource';
import type { CakesMeta, CakesSource } from './cakesSource';
import { createCakesStore } from './cakesStore';
import type { CakesMessage } from './cakesStore';

// The store against a fake source: what is listened to and when, what is dropped as junk, what waits for the server, and the
// reference grams' local-first save with its rollback.

const REF: ReferenceGrams = { diameterCm: 22, discs: 3, discHeightCm: 3, baseG: 300, soakG: 90, fillingG: 280, coatingG: 450, decorationG: 200 };
const OTHER: ReferenceGrams = { ...REF, baseG: 350 };
// `cake-settings/reference` as stored.
const doc = (grams: ReferenceGrams): Record<string, unknown> => ({ bakery: 'bakery', grams, updatedAt: '2026-11-20T09:00:00.000Z' });

function fakeSource() {
  let cakes: { onChange: (list: StoredDoc[], meta: CakesMeta) => void; onError: (err: unknown) => void } | null = null;
  let reference: ((data: Record<string, unknown> | null, meta: CakesMeta) => void) | null = null;
  const stopped: string[] = [];
  const writes: { grams: ReferenceGrams; updatedAt: string; resolve: () => void; reject: (err: unknown) => void }[] = [];
  const source: CakesSource = {
    watchCakes: vi.fn((onChange, onError) => { cakes = { onChange, onError }; return () => stopped.push('cakes'); }),
    watchReference: vi.fn(onChange => { reference = onChange; return () => stopped.push('reference'); }),
    saveReference: (grams, updatedAt) => new Promise<void>((resolve, reject) => { writes.push({ grams, updatedAt, resolve, reject }); }),
  };
  return {
    source, writes, stopped,
    cakes: (list: StoredDoc[], fromServer = true) => cakes!.onChange(list, { fromServer }),
    cakesFail: () => cakes!.onError(new Error('permission-denied')),
    reference: (data: Record<string, unknown> | null, fromServer = true) => reference!(data, { fromServer }),
  };
}

function setup() {
  const fake = fakeSource();
  const store = createCakesStore(fake.source, { now: () => Date.UTC(2026, 10, 21, 9, 0), warn: vi.fn() });
  const messages: CakesMessage[] = [];
  store.onMessage(m => messages.push(m));
  return { fake, store, messages };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('the Cakes store', () => {
  test('nothing is listened to until start(); stop() ends both listeners; start → stop → start listens again, once', () => {
    const { fake, store } = setup();
    expect(fake.source.watchCakes).not.toHaveBeenCalled();
    store.start();
    store.start();
    expect(fake.source.watchCakes).toHaveBeenCalledTimes(1);
    expect(fake.source.watchReference).toHaveBeenCalledTimes(1);
    store.stop();
    expect(fake.stopped.sort()).toEqual(['cakes', 'reference']);
    store.start();
    expect(fake.source.watchCakes).toHaveBeenCalledTimes(2);
  });

  test('before any answer: nothing loaded, no cakes, no reference', () => {
    const { store } = setup();
    store.start();
    expect(store.getSnapshot()).toEqual({
      cakes: [], cakesLoaded: false, cakesFromServer: false, reference: null, referenceLoaded: false, unsent: false,
    });
  });

  test('⚠️ every cake goes through normalizeCake; a document with no id or that is not an object is dropped', () => {
    const { fake, store } = setup();
    store.start();
    fake.cakes([
      { id: 'c1', name: '  Sacher  ', diameterCm: 999, tiers: 'x', lines: 'junk' } as StoredDoc,
      { name: 'no id' } as unknown as StoredDoc,
      null as unknown as StoredDoc,
      { id: 'c2', name: 'Torta', diameterCm: 24, tiers: 2, discs: 3 },
    ]);
    const { cakes } = store.getSnapshot();
    expect(cakes.map(c => c.id)).toEqual(['c1', 'c2']);
    expect(cakes[0]).toMatchObject({ name: 'Sacher', diameterCm: 60, lines: [] });
    expect(cakes[1]).toMatchObject({ diameterCm: 24, tiers: 2, discs: 3 });
  });

  test('the cakes: loaded on any answer, but «from the server» only when the server spoke', () => {
    const { fake, store } = setup();
    store.start();
    fake.cakes([], false);
    expect(store.getSnapshot()).toMatchObject({ cakesLoaded: true, cakesFromServer: false });
    fake.cakes([{ id: 'c1', name: 'A' }], true);
    expect(store.getSnapshot()).toMatchObject({ cakesLoaded: true, cakesFromServer: true });
    // Once the server has spoken, a later answer from the cache does not take it back.
    fake.cakes([{ id: 'c1', name: 'A' }], false);
    expect(store.getSnapshot().cakesFromServer).toBe(true);
  });

  test('a dead cakes stream ends the wait, keeps the list and says so once', () => {
    const { fake, store, messages } = setup();
    store.start();
    fake.cakes([{ id: 'c1', name: 'A' }], false);
    fake.cakesFail();
    expect(store.getSnapshot()).toMatchObject({ cakesLoaded: true });
    expect(store.getSnapshot().cakes).toHaveLength(1);
    expect(messages).toEqual([{ kind: 'cakes-stream-broken' }]);
  });

  test('a stream that fails before any answer still ends the wait', () => {
    const { fake, store } = setup();
    store.start();
    fake.cakesFail();
    expect(store.getSnapshot()).toMatchObject({ cakes: [], cakesLoaded: true, cakesFromServer: false });
  });

  test('the reference is normalised: all eight valid, or null', () => {
    const { fake, store } = setup();
    store.start();
    fake.reference(doc(REF));
    expect(store.getSnapshot()).toMatchObject({ reference: REF, referenceLoaded: true });
    fake.reference(doc({ ...REF, baseG: -1 }));
    expect(store.getSnapshot()).toMatchObject({ reference: null, referenceLoaded: true });
    fake.reference({ bakery: 'bakery' });
    expect(store.getSnapshot()).toMatchObject({ reference: null, referenceLoaded: true });
  });

  test('⚠️ a «missing» reference from this phone’s own database is not an answer; the server’s is', () => {
    const { fake, store } = setup();
    store.start();
    fake.reference(null, false);
    expect(store.getSnapshot().referenceLoaded).toBe(false);
    fake.reference(null, true);
    expect(store.getSnapshot()).toMatchObject({ reference: null, referenceLoaded: true });
  });

  test('saving the reference is local-first: it is on screen and unsent at once, and the source gets the stamp', async () => {
    const { fake, store, messages } = setup();
    store.start();
    fake.reference(doc(REF));
    const listener = vi.fn();
    store.subscribe(listener);
    store.saveReference(OTHER);
    expect(store.getSnapshot()).toMatchObject({ reference: OTHER, unsent: true });
    expect(listener).toHaveBeenCalled();
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0]!.grams).toEqual(OTHER);
    expect(fake.writes[0]!.updatedAt).toBe('2026-11-21T09:00:00.000Z');
    fake.writes[0]!.resolve();
    await settle();
    expect(store.getSnapshot()).toMatchObject({ reference: OTHER, unsent: false });
    expect(messages).toEqual([]);
  });

  test('⚠️ a refused reference goes back as it was, is said once, and is no longer unsent', async () => {
    const { fake, store, messages } = setup();
    store.start();
    fake.reference(doc(REF));
    store.saveReference(OTHER);
    fake.writes[0]!.reject(new Error('permission-denied'));
    await settle();
    expect(store.getSnapshot()).toMatchObject({ reference: REF, unsent: false });
    expect(messages).toEqual([{ kind: 'reference-not-saved' }]);
  });

  test('a refusal never rolls back over something newer that arrived meanwhile', async () => {
    const { fake, store, messages } = setup();
    store.start();
    fake.reference(doc(REF));
    store.saveReference(OTHER);
    const newer = { ...REF, soakG: 120 };
    fake.reference(doc(newer));
    fake.writes[0]!.reject(new Error('refused'));
    await settle();
    expect(store.getSnapshot().reference).toEqual(newer);
    expect(messages).toEqual([{ kind: 'reference-not-saved' }]);
  });

  test('grams that are not a whole valid reference are never sent', () => {
    const { fake, store } = setup();
    store.start();
    store.saveReference({ ...REF, discs: 0 });
    expect(fake.writes).toHaveLength(0);
    expect(store.getSnapshot().unsent).toBe(false);
  });

  test('the snapshot is the SAME object until something changes', () => {
    const { fake, store } = setup();
    store.start();
    const before = store.getSnapshot();
    expect(store.getSnapshot()).toBe(before);
    fake.cakes([]);
    expect(store.getSnapshot()).not.toBe(before);
  });
});
