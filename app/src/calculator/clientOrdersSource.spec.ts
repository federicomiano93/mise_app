import { describe, expect, test, vi } from 'vitest';
import { linkEmailFor } from '@mise/shared/client-order-model';
import type { FirestoreKit } from '../session/firebaseBackend';
import { createFirestoreClientOrdersSource } from './clientOrdersSource';
import type { ClientOrdersDeps } from './clientOrdersSource';

// The ONLY code in Mise 2 that writes the clients' ordering data to the real database, against a recording fake of
// the Firestore SDK. firestore.rules (the `client-accounts`, `client-settings`, `client-menus` and `client-orders`
// blocks) accept exactly the shapes js/client-orders-data.js writes, with CLOSED key lists: a key too many, a missing
// `bakery` stamp or a whole write where a patch belongs is refused — or, for «applied», would wipe the client's own
// order. Each test below is one of those shapes.

type Ref = { kind: string; path: string; parts?: unknown[] };

function fakeKit(docs: Record<string, Array<{ id: string; data: Record<string, unknown> }>> = {}) {
  const calls: string[] = [];
  const listeners: { target: Ref; options: unknown; next: (snap: unknown) => void; error: (err: unknown) => void }[] = [];
  const snapOf = (path: string) => {
    const list = docs[path] ?? [];
    return { empty: list.length === 0, docs: list.map(d => ({ id: d.id, data: () => d.data })) };
  };
  const fs = {
    collection: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'collection', path: segments.join('/') }),
    doc: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'doc', path: segments.join('/') }),
    query: (ref: Ref, ...parts: unknown[]): Ref => ({ ...ref, kind: 'query', parts }),
    where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
    orderBy: (field: string, dir: string) => ({ orderBy: [field, dir] }),
    limit: (n: number) => ({ limit: n }),
    onSnapshot: vi.fn((target: Ref, options: unknown, next: (snap: unknown) => void, error: (err: unknown) => void) => {
      listeners.push({ target, options, next, error });
      return () => {};
    }),
    getDocs: vi.fn(async (ref: Ref) => snapOf(ref.path)),
    setDoc: vi.fn(async (ref: Ref, _data: Record<string, unknown>, _options?: unknown) => { calls.push(`set ${ref.path}`); }),
    updateDoc: vi.fn(async (ref: Ref, _data: Record<string, unknown>) => { calls.push(`update ${ref.path}`); }),
    deleteDoc: vi.fn(async (ref: Ref) => { calls.push(`delete ${ref.path}`); }),
  };
  const kit = { fs, db: {} } as unknown as FirestoreKit;
  return { kit, fs, calls, listeners };
}

function deps(over: Partial<ClientOrdersDeps> = {}): ClientOrdersDeps & { created: string[][] } {
  const created: string[][] = [];
  return {
    created,
    createLinkAccount: async (email, password) => { created.push([email, password]); return 'uid-new'; },
    nowIso: () => '2026-10-13T08:00:00.000Z',
    randomBytes: () => new Uint8Array(32).fill(1),
    ...over,
  };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const ROMA = { id: 'c-roma', name: 'Cafe Roma', products: [{ id: 'p1', name: 'Pizza', kind: 'number' }, { id: 'p2', name: 'Old', active: false }] };
const VENUE = { name: 'Test Bakery', country: 'IT' as const };

describe('the client-orders source, as firestore.rules expect it', () => {
  test('⚠️ the deadline is written WHOLE with exactly bakery, cutoff and updatedAt', async () => {
    const { kit, fs } = fakeKit();
    await createFirestoreClientOrdersSource(() => Promise.resolve(kit), 'bakery', deps()).saveCutoff('');
    const [ref, data, options] = fs.setDoc.mock.calls[0]!;
    expect(ref.path).toBe('locations/bakery/client-settings/orders');
    expect(data).toEqual({ bakery: 'bakery', cutoff: '', updatedAt: '2026-10-13T08:00:00.000Z' });
    expect(options).toBeUndefined();
  });

  test('⚠️ «applied» is a PATCH of exactly bakery, appliedAt and appliedFor — never a whole write over the client\'s order', async () => {
    const { kit, fs } = fakeKit();
    await createFirestoreClientOrdersSource(() => Promise.resolve(kit), 'bakery', deps())
      .markApplied({ id: '2026-10-14_c-roma', updatedAt: '2026-10-13T07:00:00.000Z' });
    expect(fs.setDoc).not.toHaveBeenCalled();
    const [ref, data] = fs.updateDoc.mock.calls[0]!;
    expect(ref.path).toBe('locations/bakery/client-orders/2026-10-14_c-roma');
    expect(data).toEqual({ bakery: 'bakery', appliedAt: '2026-10-13T08:00:00.000Z', appliedFor: '2026-10-13T07:00:00.000Z' });
  });

  test('⚠️ an id that could name another path never reaches Firestore; a venue id neither', async () => {
    const { kit, fs } = fakeKit();
    const source = createFirestoreClientOrdersSource(() => Promise.resolve(kit), 'bakery', deps());
    await expect(source.markApplied({ id: 'a/b' })).rejects.toThrow();
    await expect(source.revokeLink('../x')).rejects.toThrow();
    expect(fs.updateDoc).not.toHaveBeenCalled();
    expect(fs.deleteDoc).not.toHaveBeenCalled();
    expect(() => createFirestoreClientOrdersSource(() => Promise.resolve(kit), 'a/b', deps())).toThrow();
  });

  test('the orders still to come: one range on `date` (no composite index), with metadata changes', async () => {
    const { kit, listeners } = fakeKit();
    const seen: unknown[] = [];
    createFirestoreClientOrdersSource(() => Promise.resolve(kit), 'bakery', deps())
      .watchUpcoming('2026-10-13', (list, meta) => seen.push([list, meta]), () => {});
    await settle();
    expect(listeners[0]!.target.path).toBe('locations/bakery/client-orders');
    expect(listeners[0]!.target.parts).toEqual([{ where: ['date', '>=', '2026-10-13'] }]);
    expect(listeners[0]!.options).toEqual({ includeMetadataChanges: true });
    listeners[0]!.next({ docs: [{ id: 'x', data: () => ({ date: '2026-10-14' }) }], metadata: { fromCache: true } });
    expect(seen).toEqual([[[{ date: '2026-10-14', id: 'x' }], { fromServer: false }]]);
  });

  test('⚠️ the history: two bounds on `date`, ordered by the FIELD descending (never the id), capped', async () => {
    const { kit, fs } = fakeKit();
    await createFirestoreClientOrdersSource(() => Promise.resolve(kit), 'bakery', deps())
      .readPast({ before: '2026-10-13', since: '2026-09-28' });
    const [ref] = fs.getDocs.mock.calls[0]!;
    expect(ref.path).toBe('locations/bakery/client-orders');
    expect(ref.parts).toEqual([
      { where: ['date', '<', '2026-10-13'] },
      { where: ['date', '>=', '2026-09-28'] },
      { orderBy: ['date', 'desc'] },
      { limit: 200 },
    ]);
  });

  test('menus: only the ones that moved, the six keys the rules allow, a paused product left out, a bad id skipped', async () => {
    const published = {
      'locations/bakery/client-menus': [{ id: 'c-same', data: { clientName: 'Same', bakeryName: 'Test Bakery', country: 'IT', products: [] } }],
    };
    const { kit, fs } = fakeKit(published);
    const written = await createFirestoreClientOrdersSource(() => Promise.resolve(kit), 'bakery', deps())
      .publishMenus([ROMA, { id: 'c-same', name: 'Same', products: [] }, { id: 'bad_id', name: 'X', products: [] }], VENUE);
    expect(written).toBe(1);
    expect(fs.setDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = fs.setDoc.mock.calls[0]!;
    expect(ref.path).toBe('locations/bakery/client-menus/c-roma');
    expect(data).toEqual({
      bakery: 'bakery', bakeryName: 'Test Bakery', clientName: 'Cafe Roma', country: 'IT',
      products: [{ id: 'p1', name: 'Pizza', kind: 'number' }], updatedAt: '2026-10-13T08:00:00.000Z',
    });
  });

  test('⚠️ a link: the account first, then its grant (five keys), THEN the old grant revoked, then the menu', async () => {
    const { kit, fs, calls } = fakeKit();
    const d = deps();
    const created = await createFirestoreClientOrdersSource(() => Promise.resolve(kit), 'bakery', d)
      .createLink(ROMA, VENUE, 'uid-old');
    expect(created.uid).toBe('uid-new');
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // One secret for both halves of the account, the address built by the shared model.
    expect(d.created).toEqual([[linkEmailFor(created.token), created.token]]);
    expect(calls).toEqual([
      'set locations/bakery/client-accounts/uid-new',
      'delete locations/bakery/client-accounts/uid-old',
      'set locations/bakery/client-menus/c-roma',
    ]);
    expect(fs.setDoc.mock.calls[0]![1]).toEqual({
      bakery: 'bakery', clientId: 'c-roma', clientName: 'Cafe Roma',
      createdAt: '2026-10-13T08:00:00.000Z', linkToken: created.token,
    });
  });

  test('⚠️ a client id that cannot name an order (an underscore) gets no account at all', async () => {
    const { kit, fs } = fakeKit();
    const d = deps();
    await expect(createFirestoreClientOrdersSource(() => Promise.resolve(kit), 'bakery', d)
      .createLink({ id: 'c_roma', name: 'X' }, VENUE, null)).rejects.toThrow();
    expect(d.created).toEqual([]);
    expect(fs.setDoc).not.toHaveBeenCalled();
  });

  test('a refused account creation writes nothing', async () => {
    const { kit, fs } = fakeKit();
    const d = deps({ createLinkAccount: async () => { throw new Error('auth/network-request-failed'); } });
    await expect(createFirestoreClientOrdersSource(() => Promise.resolve(kit), 'bakery', d)
      .createLink(ROMA, VENUE, 'uid-old')).rejects.toThrow();
    expect(fs.setDoc).not.toHaveBeenCalled();
    expect(fs.deleteDoc).not.toHaveBeenCalled();
  });

  test('the grants are read whole; one that names no client is dropped', async () => {
    const { kit } = fakeKit({
      'locations/bakery/client-accounts': [
        { id: 'u1', data: { clientId: 'c-roma', clientName: 'Cafe Roma', createdAt: 'x', linkToken: 't' } },
        { id: 'u2', data: { clientName: 'nobody' } },
      ],
    });
    const list = await createFirestoreClientOrdersSource(() => Promise.resolve(kit), 'bakery', deps()).listAccounts();
    expect(list).toEqual([{ uid: 'u1', clientId: 'c-roma', clientName: 'Cafe Roma', createdAt: 'x', linkToken: 't' }]);
  });
});

// ⚠️ THE SECOND FIREBASE APP behind an ordering link (session/firebaseBackend.ts `createLinkAccount`) is checked in its
// source: two lines nothing else would notice losing. Without the emulator line a link made on localhost creates a REAL
// account in production (the key's referrer list allows localhost); without inMemoryPersistence the client's credential
// is written into the IndexedDB both apps share for who is signed in.
const backendSource = import.meta.glob<string>('../session/firebaseBackend.ts', { query: '?raw', import: 'default', eager: true });

describe('the account behind an ordering link', () => {
  const code = (Object.values(backendSource)[0] ?? '').replace(/^\s*\/\/.*$/gm, '');
  const body = code.slice(code.indexOf('async function createLinkAccount'), code.indexOf('return {', code.indexOf('async function createLinkAccount')));

  test('is made on its own app, in memory only, on the emulator locally, signed out and thrown away', () => {
    expect(body.length).toBeGreaterThan(100);
    expect(body).toMatch(/initializeApp\(configForHost\(hostname\), `client-link-/);
    expect(body).toMatch(/initializeAuth\(secondary, \{ persistence: inMemoryPersistence \}\)/);
    expect(body).toMatch(/if \(isEmulator\) connectAuthEmulator\(linkAuth, 'http:\/\/localhost:9099'/);
    expect(body.indexOf('connectAuthEmulator')).toBeLessThan(body.indexOf('createUserWithEmailAndPassword'));
    expect(body).toMatch(/await signOut\(linkAuth\)/);
    expect(body).toMatch(/finally \{[\s\S]*deleteApp\(secondary\)/);
    // Never on the person's own Auth.
    expect(body).not.toMatch(/createUserWithEmailAndPassword\(auth\b/);
  });
});
