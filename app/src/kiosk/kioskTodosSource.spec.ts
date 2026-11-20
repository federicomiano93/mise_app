import { describe, expect, test, vi } from 'vitest';
import { createFirestoreKioskTodosSource, readKioskTodo } from './kioskTodosSource';

const stamp = (ms: number) => ({ toMillis: () => ms });

describe('readKioskTodo', () => {
  test('keeps a well-formed document, with or without a creation time', () => {
    expect(readKioskTodo({ text: 'Mop', day: '2026-10-05', createdAt: stamp(7) })).toStrictEqual({ text: 'Mop', day: '2026-10-05', createdAtMs: 7 });
    expect(readKioskTodo({ text: 'Mop', day: '2026-10-05' })).toStrictEqual({ text: 'Mop', day: '2026-10-05', createdAtMs: null });
    expect(readKioskTodo({ text: 'Mop', day: '2026-10-05', createdAt: 'soon' })?.createdAtMs).toBeNull();
  });

  test('drops what the rules could not have accepted', () => {
    expect(readKioskTodo({ text: '', day: '2026-10-05' })).toBeNull();
    expect(readKioskTodo({ text: 5, day: '2026-10-05' })).toBeNull();
    expect(readKioskTodo({ text: 'x', day: '5 Oct' })).toBeNull();
    expect(readKioskTodo({ text: 'x' })).toBeNull();
  });
});

describe('the Firestore source', () => {
  test('asks ONE single-field query on the venue’s todos and keeps the good documents', async () => {
    const where = vi.fn((...args: unknown[]) => ({ where: args }));
    const query = vi.fn((...args: unknown[]) => ({ query: args }));
    const collection = vi.fn((...args: unknown[]) => ({ collection: args }));
    const getDocs = vi.fn(async () => ({
      docs: [
        { id: 'a', data: () => ({ text: 'Mop', day: '2026-10-05', createdAt: stamp(3) }) },
        { id: 'b', data: () => ({ text: '', day: '2026-10-05' }) },
      ],
    }));
    const firestore = async () => ({ db: 'db', fs: { where, query, collection, getDocs } }) as never;
    const source = createFirestoreKioskTodosSource(firestore, 'bakery');
    expect(await source.readOpen()).toStrictEqual([{ text: 'Mop', day: '2026-10-05', createdAtMs: 3 }]);
    expect(where).toHaveBeenCalledWith('done', '==', false);
    expect(collection).toHaveBeenCalledWith('db', 'locations/bakery/todos');
    expect(getDocs).toHaveBeenCalledTimes(1);
  });
});
