import { describe, expect, test, vi } from 'vitest';
import { pricePatch, storedPriceInput } from '@mise/shared/price-model';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { createSuppliersStore, PRICE_HISTORY_MAX } from './suppliersStore';
import type { SuppliersMessage } from './suppliersStore';

// The money half of the store (step 3e-3): one batch with the ingredient, its price and the history entry; untouched
// means unchanged; a refusal takes all of it back; the price read before a card opens; the history on demand.

const tick = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });
const THEN = '2026-09-01T08:00:00.000Z';

function started(source = fakeSuppliersSource()) {
  const store = createSuppliersStore(source, { markBusy: () => () => undefined });
  const messages: SuppliersMessage[] = [];
  store.onMessage(m => { messages.push(m); });
  store.start();
  return { store, source, messages };
}

const storedPrice = pricePatch({ priceUnit: 'kg', pricePerUnit: 2, vatRate: 4 }, THEN);
const seeded = () => fakeSuppliersSource({
  ingredients: [{ id: 'i1', name: 'Flour', supplierId: 's1' }],
  prices: { i1: { ...storedPrice } },
});

describe('the suppliers store: saving the price', () => {
  test('a changed price goes in the SAME write as the ingredient, with one history entry', async () => {
    const { store, source } = started(seeded());
    await tick();
    const before = store.getSnapshot().ingredients[0]!;
    const saved = store.saveIngredient('i1', { name: 'Flour', supplierId: 's1' }, {
      price: { before, patch: pricePatch({ priceUnit: 'kg', pricePerUnit: 2.5, vatRate: 4 }, 'any') },
    });
    expect(saved).toEqual({ id: 'i1', priceRecorded: true });
    await tick();
    const write = source.writes.at(-1)!;
    expect(write.op).toBe('ingredient-save');
    if (write.op !== 'ingredient-save') return;
    expect(write.price?.doc.pricePerUnit).toBe(2.5);
    expect(write.price?.history).toMatchObject({ pricePerUnit: 2.5, supplierId: 's1', source: 'manual' });
    // One clock: the store's, for the price's date and the history entry alike (never the card's own stamp).
    expect(write.price?.doc.priceUpdatedAt).not.toBe('any');
    expect(write.price?.doc.priceUpdatedAt).toBe(write.price?.history?.recordedAt);
    expect(source.history.get('i1')).toHaveLength(1);
    expect(store.getSnapshot().ingredients[0]!.pricePerUnit).toBe(2.5);
  });

  test('⚠️ a rename with the price untouched sends NO money at all', async () => {
    const { store, source } = started(seeded());
    await tick();
    const before = store.getSnapshot().ingredients[0]!;
    const saved = store.saveIngredient('i1', { name: 'Flour 00', supplierId: 's1' }, {
      price: { before, patch: pricePatch(storedPriceInput(before, 4), 'now') },
    });
    expect(saved.priceRecorded).toBe(false);
    await tick();
    const write = source.writes.at(-1)!;
    expect(write.op === 'ingredient-save' && write.price).toBeNull();
    expect(source.prices.get('i1')?.priceUpdatedAt).toBe(THEN);
    expect(source.history.get('i1') ?? []).toHaveLength(0);
  });

  test('⚠️ the price keys never reach the ingredient document, whoever builds the payload', async () => {
    const { store, source } = started(seeded());
    await tick();
    store.saveIngredient('i1', { name: 'Flour', pricePerUnit: 9, vatRate: 22, casePrice: 3 });
    await tick();
    const write = source.writes.at(-1)!;
    if (write.op !== 'ingredient-save') throw new Error('not a save');
    expect(write.data.pricePerUnit).toBeNull();
    expect('vatRate' in write.data || 'casePrice' in write.data).toBe(false);
    expect(write.price).toBeNull();
  });

  test('a refused save takes back the ingredient, the price AND the history entry, and says so', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { store, source, messages } = started(seeded());
    await tick();
    source.refuseWrites.ingredientSave = true;
    const before = store.getSnapshot().ingredients[0]!;
    store.saveIngredient('i1', { name: 'Flour' }, { price: { before, patch: pricePatch({ priceUnit: 'kg', pricePerUnit: 3 }, 'x') } });
    await tick();
    expect(messages).toEqual([{ kind: 'ingredient-not-saved', name: 'Flour' }]);
    expect(source.prices.get('i1')?.pricePerUnit).toBe(2);
    expect(source.history.get('i1') ?? []).toHaveLength(0);
    quiet.mockRestore();
  });
});

describe('the suppliers store: reading a price before a card opens (C28)', () => {
  test('pricesFromServer turns true only when the SERVER answered the prices', async () => {
    const source = seeded();
    source.pricesFromCache = true;
    const { store } = started(source);
    await tick();
    expect(store.getSnapshot().pricesReadable).toBe(true);
    expect(store.getSnapshot().pricesFromServer).toBe(false);
    source.pricesFromCache = false;
    source.push();
    expect(store.getSnapshot().pricesFromServer).toBe(true);
  });

  test('⚠️ a price stream that dies AFTER the server answered is no longer «from the server» (the card reads again)', async () => {
    const source = seeded();
    const { store } = started(source);
    await tick();
    expect(store.getSnapshot().pricesFromServer).toBe(true);
    source.refusePrices = true;
    source.push();
    expect(store.getSnapshot().pricesReadable).toBe(false);
    expect(store.getSnapshot().pricesFromServer).toBe(false);
  });

  test('a refused price watch is never «from the server»', async () => {
    const { store } = started(fakeSuppliersSource({ refusePrices: true }));
    await tick();
    expect(store.getSnapshot().pricesFromServer).toBe(false);
  });

  test('readPrice answers the stored document, null for none, and REJECTS when it cannot be read', async () => {
    const { store, source } = started(seeded());
    expect(await store.readPrice('i1')).toMatchObject({ pricePerUnit: 2 });
    expect(await store.readPrice('nope')).toBeNull();
    source.refusePriceRead = true;
    await expect(store.readPrice('i1')).rejects.toThrow();
  });
});

describe('the suppliers store: the price history (C25)', () => {
  test('the last twenty, newest first; a failure rejects', async () => {
    const entries = Array.from({ length: 25 }, (_, n) => ({
      id: `h${n}`, recordedAt: `2026-01-${String(n + 1).padStart(2, '0')}T00:00:00.000Z`, priceUnit: 'kg', pricePerUnit: n + 1,
    }));
    const { store, source } = started(fakeSuppliersSource({ history: { i1: entries } }));
    const list = await store.readPriceHistory('i1');
    expect(PRICE_HISTORY_MAX).toBe(20);
    expect(list).toHaveLength(20);
    expect(list[0]!.pricePerUnit).toBe(25);
    source.refuseHistory = true;
    await expect(store.readPriceHistory('i1')).rejects.toThrow();
  });
});
