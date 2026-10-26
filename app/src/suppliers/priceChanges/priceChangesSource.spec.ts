import { afterEach, describe, expect, test, vi } from 'vitest';
import type { FirestoreKit } from '../../session/firebaseBackend';
import { SERVER_READ_TIMEOUT_MS, createFirestorePriceChangesSource } from './priceChangesSource';

// The read of «Price changes» against a recording fake of the Firestore SDK. What it pins (parity I103, I104): the server is
// asked first; the cache answers only after a failure, offline, or a server that never answers — and the answer says so;
// the queries are one single-field range (or newest-first, one document) under the venue.

type Ref = { kind: string; path: string; constraints?: unknown[] };
type Snap = { id: string; data: () => Record<string, unknown> };

const VENUE = 'panificio-miano';
const PATH = `locations/${VENUE}/price-changes`;

function make({ offline = false }: { offline?: boolean } = {}) {
  const server: Snap[] = [];
  const cache: Snap[] = [];
  const fs = {
    collection: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'collection', path: segments.join('/') }),
    where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
    orderBy: (field: string, direction?: string) => ({ orderBy: [field, direction ?? 'asc'] }),
    limit: (n: number) => ({ limit: n }),
    query: (target: Ref, ...constraints: unknown[]) => ({ ...target, constraints }),
    getDocsFromServer: vi.fn(async (_q: Ref) => ({ docs: server })),
    getDocsFromCache: vi.fn(async (_q: Ref) => ({ docs: cache })),
    getDocs: vi.fn(),
  };
  const kit = { fs, db: {} } as unknown as FirestoreKit;
  const source = createFirestorePriceChangesSource(() => Promise.resolve(kit), VENUE, { isOffline: () => offline });
  return { fs, source, server, cache };
}

const change = (id: string, date: string): Snap => ({ id, data: () => ({ date, ingredientId: 'i1', pct: 10 }) });

afterEach(() => { vi.useRealTimers(); });

describe('the range of a period', () => {
  test('one single-field range under the venue, oldest first, asked of the SERVER; every document keeps its id', async () => {
    const { fs, source, server } = make();
    server.push(change('inv-1-1-i1', '2026-10-02'));
    const answer = await source.listPriceChanges('2026-10-01', '2026-10-31');
    expect(answer).toEqual({ docs: [{ id: 'inv-1-1-i1', date: '2026-10-02', ingredientId: 'i1', pct: 10 }], fromCache: false });
    const [q] = fs.getDocsFromServer.mock.calls[0]!;
    expect(q.path).toBe(PATH);
    expect(q.constraints).toEqual([
      { where: ['date', '>=', '2026-10-01'] }, { where: ['date', '<=', '2026-10-31'] }, { orderBy: ['date', 'asc'] },
    ]);
    expect(fs.getDocsFromCache).not.toHaveBeenCalled();
    expect(fs.getDocs, 'getDocs would answer from the cache without saying so').not.toHaveBeenCalled();
  });

  test('⚠️ never a false «no changes»: a refused server read falls back to the cache, FLAGGED', async () => {
    const { fs, source, cache } = make();
    fs.getDocsFromServer.mockRejectedValueOnce(Object.assign(new Error('unavailable'), { code: 'unavailable' }));
    cache.push(change('inv-2-1-i1', '2026-10-05'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const answer = await source.listPriceChanges('2026-10-01', '2026-10-31');
    expect(answer.fromCache).toBe(true);
    expect(answer.docs.map(d => d.id)).toEqual(['inv-2-1-i1']);
    warn.mockRestore();
  });

  test('offline, the server is not even asked: the cache answers, flagged', async () => {
    const { fs, source } = make({ offline: true });
    const answer = await source.listPriceChanges('2026-10-01', '2026-10-31');
    expect(answer).toEqual({ docs: [], fromCache: true });
    expect(fs.getDocsFromServer).not.toHaveBeenCalled();
  });

  test('⚠️ a server that never answers is given up after the bound, and the cache answers, flagged (not in the original)', async () => {
    vi.useFakeTimers();
    const { fs, source } = make();
    fs.getDocsFromServer.mockImplementationOnce(() => new Promise(() => undefined));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pending = source.listPriceChanges('2026-10-01', '2026-10-31');
    await vi.advanceTimersByTimeAsync(SERVER_READ_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ docs: [], fromCache: true });
    warn.mockRestore();
  });

  test('when neither the server nor the cache can answer, it REJECTS (the screen shows the error, never an empty list)', async () => {
    const { fs, source } = make();
    fs.getDocsFromServer.mockRejectedValueOnce(new Error('unavailable'));
    fs.getDocsFromCache.mockRejectedValueOnce(new Error('no cache'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(source.listPriceChanges('2026-10-01', '2026-10-31')).rejects.toThrow('no cache');
    warn.mockRestore();
  });
});

describe('the newest change', () => {
  test('newest first, one document; its date, or the empty text when there is none', async () => {
    const { fs, source, server } = make();
    expect(await source.latestPriceChangeDate()).toEqual({ date: '', fromCache: false });
    server.push(change('inv-3-1-i1', '2026-09-30'));
    expect(await source.latestPriceChangeDate()).toEqual({ date: '2026-09-30', fromCache: false });
    const [q] = fs.getDocsFromServer.mock.calls[0]!;
    expect(q.path).toBe(PATH);
    expect(q.constraints).toEqual([{ orderBy: ['date', 'desc'] }, { limit: 1 }]);
  });
});
