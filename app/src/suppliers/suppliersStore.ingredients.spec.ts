import { describe, expect, test, vi } from 'vitest';
import { INGREDIENT_DRAINED_FIELDS } from '@mise/shared/price-model';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { createSuppliersStore, ingredientDocOf } from './suppliersStore';
import type { SuppliersMessage } from './suppliersStore';

// The ingredient card's half of the store (step 3e-2): product data saved local-first, never a price; the order line
// frozen when the card replaced the order unit; a delete that takes the draft line with it; the F5 count.

const tick = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });

function started(source = fakeSuppliersSource()) {
  let held = 0;
  const deps = { markBusy: () => { held += 1; let done = false; return () => { if (!done) { done = true; held -= 1; } }; } };
  const store = createSuppliersStore(source, deps);
  const messages: SuppliersMessage[] = [];
  store.onMessage(m => { messages.push(m); });
  store.start();
  return { store, source, messages, held: () => held };
}

const drained = Object.fromEntries(INGREDIENT_DRAINED_FIELDS.map(k => [k, null]));

describe('ingredientDocOf: the ingredient document of a payload', () => {
  test('⚠️ every price key is cut, and the six old price keys go as null (parity C16)', () => {
    const doc = ingredientDocOf({
      name: 'Flour', pricePerUnit: 2, priceUnit: 'kg', vatRate: 4, casePrice: 20, caseCount: 4, caseItemSize: 1,
      caseItemUnit: 'pack', priceBasis: 'case', priceUpdatedAt: 'x', unitWeightKg: 1, packPrice: 3, packSize: '1 kg',
    });
    expect(doc).toEqual({ name: 'Flour', ...drained });
    for (const key of ['vatRate', 'casePrice', 'caseCount', 'caseItemSize', 'caseItemUnit', 'priceBasis']) {
      expect(key in doc, `${key} would make the rules refuse every ingredient save`).toBe(false);
    }
  });

  test('the six are exactly the ones the rules accept as null on an ingredient', () => {
    expect([...INGREDIENT_DRAINED_FIELDS].sort())
      .toEqual(['packPrice', 'packSize', 'pricePerUnit', 'priceUnit', 'priceUpdatedAt', 'unitWeightKg']);
  });
});

describe('the suppliers store: saving an ingredient', () => {
  test('LOCAL-FIRST: a new ingredient gets a phone-made id at once, the write carries no price, busy until answered', async () => {
    const { store, source, held } = started();
    await tick();
    const release = source.holdWrites();
    const id = store.saveIngredient(null, { name: 'Flour', shortName: '', pricePerUnit: 3 });
    expect(id).toMatch(/^new-ingredient-/);
    expect(held()).toBe(1);
    await tick();
    expect(source.writes).toEqual([{ op: 'ingredient-save', id, data: { name: 'Flour', shortName: '', ...drained } }]);
    expect(store.getSnapshot().ingredients.map(i => i.id)).toEqual([id]);
    release();
    await tick();
    expect(held()).toBe(0);
  });

  test('an existing ingredient is saved at its own id', async () => {
    const { store, source } = started(fakeSuppliersSource({ ingredients: [{ id: 'i1', name: 'Flour' }] }));
    await tick();
    expect(store.saveIngredient('i1', { name: 'Flour 00' })).toBe('i1');
    await tick();
    expect(source.ingredients.get('i1')?.name).toBe('Flour 00');
  });

  test('a refused save says so with the name to show, and Firestore takes it back', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { store, source, messages } = started(fakeSuppliersSource({ ingredients: [{ id: 'i1', name: 'Flour' }] }));
    await tick();
    source.refuseWrites.ingredientSave = true;
    store.saveIngredient('i1', { name: 'Farina tipo 00', shortName: 'Farina' });
    await tick();
    await tick();
    expect(messages).toEqual([{ kind: 'ingredient-not-saved', name: 'Farina' }]);
    expect(source.ingredients.get('i1')?.name).toBe('Flour');
    quiet.mockRestore();
  });
});

describe('the suppliers store: the order line when the card replaced the order unit (parity C35)', () => {
  const withLine = (entry: Record<string, unknown>) => {
    const source = fakeSuppliersSource({ ingredients: [{ id: 'i1', name: 'Flour', unit: 'cartone' }] });
    source.draft = { i1: entry };
    return started(source);
  };
  const unitWrites = (source: ReturnType<typeof fakeSuppliersSource>) => source.writes.filter(w => w.op === 'draft-unit');

  test('a line with a quantity and no unit of its own is frozen in the replaced unit', async () => {
    const { store, source } = withLine({ qty: 8 });
    await tick();
    store.saveIngredient('i1', { name: 'Flour', unit: 'busta', packCount: null }, { unitChangedFrom: 'cartone' });
    await tick();
    await tick();
    expect(unitWrites(source)).toEqual([{ op: 'draft-unit', id: 'i1', unit: 'cartone' }]);
    expect(source.draft?.i1).toEqual({ qty: 8, unit: 'cartone' });
  });

  test('a line with its own unit, a line with no quantity, no line, or no replaced unit: nothing is written', async () => {
    for (const entry of [{ qty: 8, unit: 'kg' }, { qty: 0 }, {}]) {
      const { store, source } = withLine(entry);
      await tick();
      store.saveIngredient('i1', { name: 'Flour', unit: 'busta' }, { unitChangedFrom: 'cartone' });
      await tick();
      await tick();
      expect(unitWrites(source), JSON.stringify(entry)).toEqual([]);
    }
    const { store, source } = withLine({ qty: 8 });
    await tick();
    store.saveIngredient('i1', { name: 'Flour', unit: 'busta' });
    store.saveIngredient('i1', { name: 'Flour', unit: 'busta' }, { unitChangedFrom: 'busta' });
    await tick();
    await tick();
    expect(unitWrites(source)).toEqual([]);
  });
});

describe('the suppliers store: deleting an ingredient', () => {
  test('the ingredient goes, with its price only when asked, and its order line goes too', async () => {
    const source = fakeSuppliersSource({ ingredients: [{ id: 'i1', name: 'Flour' }], prices: { i1: { pricePerUnit: 2 } } });
    source.draft = { i1: { qty: 2 }, i2: { qty: 1 } };
    const { store } = started(source);
    await tick();
    store.deleteIngredient('i1', true);
    await tick();
    expect(source.writes.map(w => w.op)).toEqual(['ingredient-delete', 'draft-clear']);
    expect(source.ingredients.has('i1')).toBe(false);
    expect(source.prices.has('i1')).toBe(false);
    expect(source.draft).toEqual({ i2: { qty: 1 } });
  });

  test('⚠️ without price rights the price document is left alone (a refused price delete fails the whole batch)', async () => {
    const source = fakeSuppliersSource({ ingredients: [{ id: 'i1', name: 'Flour' }], prices: { i1: { pricePerUnit: 2 } } });
    const { store } = started(source);
    await tick();
    store.deleteIngredient('i1', false);
    await tick();
    expect(source.writes[0]).toEqual({ op: 'ingredient-delete', id: 'i1', withPrice: false });
    expect(source.prices.has('i1')).toBe(true);
  });

  test('no draft to clean is only logged; a refused delete says so with the name read BEFORE the write', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const source = fakeSuppliersSource({ ingredients: [{ id: 'i1', name: 'Farina tipo 00', shortName: 'Farina' }] });
    const { store, messages } = started(source);
    await tick();
    store.deleteIngredient('i1', false);
    await tick();
    await tick();
    expect(messages).toEqual([]);
    expect(errors).toHaveBeenCalledWith('The draft still holds a deleted ingredient:', expect.anything());
    source.ingredients.set('i1', { id: 'i1', name: 'Farina tipo 00', shortName: 'Farina' });
    source.push();
    source.refuseWrites.ingredientDelete = true;
    store.deleteIngredient('i1', false);
    await tick();
    await tick();
    expect(messages).toEqual([{ kind: 'ingredient-not-deleted', name: 'Farina' }]);
    expect(source.ingredients.has('i1')).toBe(true);
    errors.mockRestore();
  });
});

describe('the suppliers store: what uses an ingredient (F5)', () => {
  test('the source’s count is handed on; a failure is «could not count», never 0', async () => {
    const source = fakeSuppliersSource();
    source.usage = { recipes: 3, products: null };
    const { store } = started(source);
    expect(await store.ingredientUsage('i1')).toEqual({ recipes: 3, products: null });
    expect(source.usageCalls).toEqual(['i1']);
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    source.readUsage = () => Promise.reject(new Error('offline'));
    expect(await store.ingredientUsage('i1')).toEqual({ recipes: null, products: null });
    quiet.mockRestore();
  });
});
