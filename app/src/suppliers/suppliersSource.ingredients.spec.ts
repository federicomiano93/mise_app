import { describe, expect, test, vi } from 'vitest';
import type { FirestoreKit } from '../session/firebaseBackend';
import { createFirestoreSuppliersSource } from './suppliersSource';

// The ingredient card's writes (step 3e-2) against a recording fake of the Firestore SDK: the shapes firestore.rules
// accept (`ingredients`, `ingredient-prices`, `drafts/current`) and the two reads behind his decision F5. Every screen spec
// runs on the in-memory source, so a slip here — an ingredient written whole, a price delete in the batch of somebody the
// rules refuse it to, a draft line addressed by a dotted string — would first show as a save that never arrived.

type Ref = { kind: string; path: string };
type BatchOp = { op: 'set' | 'delete'; ref: Ref; data?: Record<string, unknown>; options?: unknown };

class FieldPath {
  readonly segments: string[];
  constructor(...segments: string[]) { this.segments = segments; }
}
const DELETE = { deleteField: true };

function make(answers: { draft?: Record<string, unknown> | null; recipes?: unknown; products?: unknown } = {}) {
  const batches: { ops: BatchOp[]; committed: boolean }[] = [];
  const snapOf = (docs: Array<{ id: string } & Record<string, unknown>>) => ({
    docs: docs.map(({ id, ...data }) => ({ id, data: () => data })),
  });
  const fs = {
    collection: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'collection', path: segments.join('/') }),
    doc: (_db: unknown, ...segments: string[]): Ref => ({ kind: 'doc', path: segments.join('/') }),
    writeBatch: vi.fn(() => {
      const batch = { ops: [] as BatchOp[], committed: false };
      batches.push(batch);
      return {
        delete: (ref: Ref) => { batch.ops.push({ op: 'delete', ref }); },
        set: (ref: Ref, data: Record<string, unknown>, options?: unknown) => { batch.ops.push({ op: 'set', ref, data, options }); },
        commit: async () => { batch.committed = true; },
      };
    }),
    setDoc: vi.fn(async (_ref: Ref, _data: Record<string, unknown>, _options?: unknown) => {}),
    updateDoc: vi.fn(async (_ref: Ref, ..._rest: unknown[]) => {}),
    getDoc: vi.fn(async (_ref: Ref) => ({
      exists: () => answers.draft !== null && answers.draft !== undefined,
      data: () => answers.draft,
    })),
    getDocsFromServer: vi.fn(async (ref: Ref) => {
      const key = ref.path.endsWith('/recipes') ? 'recipes' : 'products';
      const answer = answers[key];
      if (answer instanceof Error) throw answer;
      return snapOf((answer ?? []) as Array<{ id: string } & Record<string, unknown>>);
    }),
    deleteField: () => DELETE,
    FieldPath,
  };
  const kit = { fs, db: {} } as unknown as FirestoreKit;
  const source = createFirestoreSuppliersSource(() => Promise.resolve(kit), vi.fn(), VENUE);
  return { fs, batches, source };
}

const VENUE = 'panificio-miano';

describe('the ingredient card’s writes, as firestore.rules expect them', () => {
  test('an ingredient is MERGED at its own id, stamped for the venue, never carrying its id as a field', async () => {
    const { fs, source } = make();
    await source.saveIngredient('i1', { id: 'i1', name: 'Flour', shortName: '', bakery: 'elsewhere' });
    const [ref, data, options] = fs.setDoc.mock.calls[0]!;
    expect(ref.path).toBe(`locations/${VENUE}/ingredients/i1`);
    expect(data).toEqual({ name: 'Flour', shortName: '', bakery: VENUE });
    expect(options).toEqual({ merge: true });
  });

  test('a new ingredient id is a Firestore-style id, made on the phone', () => {
    const { source } = make();
    expect(source.newIngredientId()).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(source.newIngredientId()).not.toBe(source.newIngredientId());
  });

  test('⚠️ a delete is ONE batch, and the price document is in it only for a person who may write prices', async () => {
    const { batches, source } = make();
    await source.deleteIngredient('i1', true);
    await source.deleteIngredient('i2', false);
    expect(batches).toHaveLength(2);
    expect(batches[0]!.committed).toBe(true);
    expect(batches[0]!.ops.map(o => [o.op, o.ref.path])).toEqual([
      ['delete', `locations/${VENUE}/ingredients/i1`],
      ['delete', `locations/${VENUE}/ingredient-prices/i1`],
    ]);
    expect(batches[1]!.ops.map(o => [o.op, o.ref.path])).toEqual([['delete', `locations/${VENUE}/ingredients/i2`]]);
  });

  test('⚠️ an id that could name another path never reaches Firestore', async () => {
    const { fs, batches, source } = make();
    await expect(source.saveIngredient('a/b', { name: 'x' })).rejects.toThrow();
    await expect(source.deleteIngredient('..', false)).rejects.toThrow();
    await expect(source.clearDraftEntry('a/b')).rejects.toThrow();
    expect(fs.setDoc).not.toHaveBeenCalled();
    expect(fs.updateDoc).not.toHaveBeenCalled();
    expect(batches.every(b => !b.committed)).toBe(true);
  });

  test('⚠️ the draft line is cleared by updateDoc with a FieldPath, never a dotted string, and stamped', async () => {
    const { fs, source } = make();
    await source.clearDraftEntry('i1');
    const [ref, field, value, k1, v1, k2, v2] = fs.updateDoc.mock.calls[0]!;
    expect((ref as Ref).path).toBe(`locations/${VENUE}/drafts/current`);
    expect(field).toBeInstanceOf(FieldPath);
    expect((field as FieldPath).segments).toEqual(['entries', 'i1']);
    expect(value).toBe(DELETE);
    expect(k1).toBe('updatedAt');
    expect(typeof v1).toBe('string');
    expect([k2, v2]).toEqual(['bakery', VENUE]);
  });

  test('a draft line is read as stored; no draft, no line, or a line that is not a map read as null', async () => {
    expect(await make({ draft: { entries: { i1: { qty: 3 } } } }).source.readDraftEntry('i1')).toEqual({ qty: 3 });
    expect(await make({ draft: null }).source.readDraftEntry('i1')).toBeNull();
    expect(await make({ draft: { entries: {} } }).source.readDraftEntry('i1')).toBeNull();
    expect(await make({ draft: { entries: { i1: 3 } } }).source.readDraftEntry('i1')).toBeNull();
  });

  test('freezing a line MERGES its unit only, with the stamp and the keys the drafts rule allows', async () => {
    const { fs, source } = make();
    await source.setDraftEntryUnit('i1', 'busta');
    const [ref, data, options] = fs.setDoc.mock.calls[0]!;
    expect(ref.path).toBe(`locations/${VENUE}/drafts/current`);
    expect(Object.keys(data).sort()).toEqual(['bakery', 'entries', 'updatedAt']);
    expect(data.entries).toEqual({ i1: { unit: 'busta' } });
    expect(options).toEqual({ merge: true });
  });

  test('F5: recipes and products are read FROM THE SERVER and counted by the rule of the merge (findUsage)', async () => {
    const { fs, source } = make({
      recipes: [
        { id: 'r1', name: 'Bread', ingredients: [{ refId: 'i1' }] },
        { id: 'r2', name: 'Cake', ingredients: [{ refId: 'i1', kind: 'recipe' }] },
        { id: 'r3', name: 'Pie', ingredients: [{ refId: 'other' }] },
      ],
      products: [
        { id: 'p1', name: 'Loaf', components: [{ ingredientId: 'i1' }] },
        { id: 'p2', name: 'Box', packaging: [{ ingredientId: 'i1' }] },
      ],
    });
    expect(await source.readUsage('i1')).toEqual({ recipes: 1, products: 2 });
    expect(fs.getDocsFromServer.mock.calls.map(c => (c[0] as Ref).path).sort())
      .toEqual([`locations/${VENUE}/products`, `locations/${VENUE}/recipes`]);
  });

  test('⚠️ F5: a refused or failed read is null, NEVER 0, and the other one is still counted', async () => {
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { source } = make({ recipes: [{ id: 'r1', ingredients: [{ refId: 'i1' }] }], products: new Error('permission-denied') });
    expect(await source.readUsage('i1')).toEqual({ recipes: 1, products: null });
    quiet.mockRestore();
  });
});
