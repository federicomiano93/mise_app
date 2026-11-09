import { describe, expect, test, vi } from 'vitest';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { createSuppliersStore } from './suppliersStore';
import type { SuppliersMessage } from './suppliersStore';

const tick = () => new Promise<void>(resolve => { setTimeout(resolve, 0); });

function counted() {
  let held = 0;
  return {
    deps: { markBusy: () => { held += 1; let done = false; return () => { if (!done) { done = true; held -= 1; } }; } },
    held: () => held,
  };
}

function started(source = fakeSuppliersSource(), deps = counted().deps) {
  const store = createSuppliersStore(source, deps);
  const messages: SuppliersMessage[] = [];
  store.onMessage(m => { messages.push(m); });
  store.start();
  return { store, source, messages };
}

describe('the suppliers store: what is believed', () => {
  test('nothing is shown as loaded before the first answer', () => {
    const { store } = started();
    expect(store.getSnapshot().suppliersLoaded).toBe(false);
    expect(store.getSnapshot().ingredientsLoaded).toBe(false);
    expect(store.getSnapshot().configLoaded).toBe(false);
  });

  test('the server’s answer is believed, an empty one too', async () => {
    const { store } = started();
    await tick();
    const snap = store.getSnapshot();
    expect(snap.suppliersLoaded).toBe(true);
    expect(snap.ingredientsLoaded).toBe(true);
    expect(snap.suppliers).toEqual([]);
  });

  test('⚠️ an EMPTY answer from the browser’s own database is not believed (no «No suppliers yet» flash)', async () => {
    const source = fakeSuppliersSource();
    source.fromCache = true;
    const { store } = started(source);
    await tick();
    expect(store.getSnapshot().suppliersLoaded).toBe(false);
    expect(store.getSnapshot().ingredientsLoaded).toBe(false);
    source.fromCache = false;
    source.push();
    expect(store.getSnapshot().suppliersLoaded).toBe(true);
  });

  test('a cached answer that holds documents is believed', async () => {
    const source = fakeSuppliersSource({ suppliers: [{ id: 's1', name: 'Alba' }], ingredients: [{ id: 'i1', name: 'Flour' }] });
    source.fromCache = true;
    const { store } = started(source);
    await tick();
    expect(store.getSnapshot().suppliersLoaded).toBe(true);
    expect(store.getSnapshot().ingredientsLoaded).toBe(true);
    // Shown, but not the server's word: a supplier missing from it is not yet «deleted».
    expect(store.getSnapshot().suppliersFromServer).toBe(false);
    source.fromCache = false;
    source.push();
    expect(store.getSnapshot().suppliersFromServer).toBe(true);
  });

  test('a stream that fails ends the wait and says it broke', async () => {
    const source = fakeSuppliersSource();
    source.refuse.suppliers = true;
    const { store } = started(source);
    await tick();
    expect(store.getSnapshot().suppliersLoaded).toBe(true);
    expect(store.getSnapshot().suppliersBroken).toBe(true);
    expect(store.getSnapshot().ingredientsBroken).toBe(false);
  });

  test('a stream that dies later says so too', async () => {
    const { store, source } = started(fakeSuppliersSource({ suppliers: [{ id: 's1', name: 'Alba' }] }));
    await tick();
    source.breakStreams();
    expect(store.getSnapshot().suppliersBroken).toBe(true);
    expect(store.getSnapshot().ingredientsBroken).toBe(true);
    // What was on screen stays: the page says it may be old.
    expect(store.getSnapshot().suppliers).toHaveLength(1);
  });
});

describe('the suppliers store: prices', () => {
  const flour = { id: 'i1', name: 'Flour', priceUnit: 9, pricePerUnit: 9 };

  test('the prices are laid on the ingredients, and the old keys on the ingredient never show', async () => {
    const { store } = started(fakeSuppliersSource({
      ingredients: [flour],
      prices: { i1: { priceUnit: 'kg', pricePerUnit: 1.2 } },
    }));
    await tick();
    const snap = store.getSnapshot();
    expect(snap.pricesReadable).toBe(true);
    expect(snap.ingredients[0]).toMatchObject({ id: 'i1', priceUnit: 'kg', pricePerUnit: 1.2 });
  });

  test('a person refused the prices sees the ingredients unpriced, and readable is false', async () => {
    const { store } = started(fakeSuppliersSource({
      ingredients: [flour], prices: { i1: { priceUnit: 'kg', pricePerUnit: 1.2 } }, refusePrices: true,
    }));
    await tick();
    const snap = store.getSnapshot();
    expect(snap.pricesReadable).toBe(false);
    expect(snap.ingredients[0]).toMatchObject({ id: 'i1', priceUnit: null, pricePerUnit: null });
  });
});

describe('the suppliers store: config/orders', () => {
  test('⚠️ «missing» from the browser’s own database is not loaded; from the server it is', async () => {
    const source = fakeSuppliersSource();
    source.fromCache = true;
    const { store } = started(source);
    await tick();
    expect(store.getSnapshot().configLoaded).toBe(false);
    expect(store.getSnapshot().storedCategories).toBeNull();
    source.fromCache = false;
    source.push();
    expect(store.getSnapshot().configLoaded).toBe(true);
  });

  test('a cached document is loaded; an empty list is an answer; favourites are normalised', async () => {
    const source = fakeSuppliersSource({ ordersConfig: { ingredientCategories: [], favouriteSuppliers: ['a', 'a', '', 3, 'b'] } });
    source.fromCache = true;
    const { store } = started(source);
    await tick();
    const snap = store.getSnapshot();
    expect(snap.configLoaded).toBe(true);
    expect(snap.storedCategories).toEqual([]);
    expect(snap.favourites).toEqual(['a', 'b']);
  });

  test('the week starts on the venue’s day, read as weekStartOf does; Sunday until it arrives or when unreadable (parity I107)', async () => {
    const source = fakeSuppliersSource({ ordersConfig: { weekStartsOn: ' monday ' } });
    const { store } = started(source);
    expect(store.getSnapshot().weekStartsOn).toBe('Sunday');
    await tick();
    expect(store.getSnapshot().weekStartsOn).toBe('Monday');
    const odd = fakeSuppliersSource({ ordersConfig: { weekStartsOn: ['Monday'] } });
    const second = started(odd);
    await tick();
    expect(second.store.getSnapshot().weekStartsOn, 'a list is not a day').toBe('Sunday');
  });

  test('a refused config read leaves the defaults and no delete', async () => {
    const source = fakeSuppliersSource({ ingredients: [{ id: 'i1', name: 'x', category: 'Bakery' }] });
    source.refuse.config = true;
    const { store } = started(source);
    await tick();
    expect(store.getSnapshot().configLoaded).toBe(false);
    expect(store.categories('en')).toEqual(['Bakery', 'Pastry', 'Retail']);
    expect(store.deleteCategory('Bakery', 'en')).toBe(false);
    expect(source.writes).toEqual([]);
  });
});

describe('the suppliers store: writes', () => {
  test('a new supplier gets its id at once, is on screen at once, and holds the busy marker until answered', async () => {
    const busy = counted();
    const { store, source, messages } = started(fakeSuppliersSource(), busy.deps);
    await tick();
    const release = source.holdWrites();
    const id = store.saveSupplier(null, { name: 'Alba', shortName: '' });
    expect(id).toMatch(/^new-supplier-/);
    await tick();
    expect(store.getSnapshot().suppliers.map(s => s.id)).toContain(id);
    expect(busy.held()).toBe(1);
    release();
    await tick();
    expect(busy.held()).toBe(0);
    expect(messages).toEqual([]);
    expect(source.writes).toEqual([{ op: 'save', id, data: { name: 'Alba', shortName: '' } }]);
  });

  test('an existing supplier is saved at its own id', async () => {
    const { store, source } = started(fakeSuppliersSource({ suppliers: [{ id: 's1', name: 'Alba' }] }));
    await tick();
    expect(store.saveSupplier('s1', { name: 'Alba Srl' })).toBe('s1');
  });

  test('a refused save is said, taken back, and lets go of the busy marker', async () => {
    const busy = counted();
    const { store, source, messages } = started(fakeSuppliersSource({ suppliers: [{ id: 's1', name: 'Alba' }] }), busy.deps);
    await tick();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    source.refuseWrites.save = true;
    store.saveSupplier('s1', { name: 'Typed' });
    await tick();
    await tick();
    expect(messages).toEqual([{ kind: 'supplier-not-saved', name: 'Typed' }]);
    expect(store.getSnapshot().suppliers[0]).toMatchObject({ name: 'Alba' });
    expect(busy.held()).toBe(0);
  });

  test('switching off, deleting and starring say their own refusal, naming the supplier', async () => {
    const { store, source, messages } = started(fakeSuppliersSource({ suppliers: [{ id: 's1', name: 'Alba' }] }));
    await tick();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    source.refuseWrites.active = true;
    source.refuseWrites.delete = true;
    source.refuseWrites.favourite = true;
    store.setSupplierActive('s1', false);
    store.deleteSupplier('s1');
    store.setFavourite('s1', true);
    await tick();
    await tick();
    expect(messages).toEqual([
      { kind: 'supplier-active-not-saved', name: 'Alba' },
      { kind: 'supplier-not-deleted', name: 'Alba' },
      { kind: 'favourite-not-saved' },
    ]);
  });

  test('⚠️ the refusals name the supplier as the screens do: the short name when there is one (supplierLabel)', async () => {
    const { store, source, messages } = started(fakeSuppliersSource({ suppliers: [{ id: 's1', name: 'Alba Fine Foods Ltd', shortName: 'Alba' }] }));
    await tick();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    source.refuseWrites.active = true;
    source.refuseWrites.delete = true;
    source.refuseWrites.save = true;
    store.setSupplierActive('s1', false);
    store.deleteSupplier('s1');
    store.saveSupplier('s1', { name: 'Alba Fine Foods Ltd', shortName: 'Alba' });
    store.saveSupplier('s1', { name: 'Alba Fine Foods Ltd', shortName: '  ' });
    await tick();
    await tick();
    expect(messages).toEqual([
      { kind: 'supplier-active-not-saved', name: 'Alba' },
      { kind: 'supplier-not-deleted', name: 'Alba' },
      { kind: 'supplier-not-saved', name: 'Alba' },
      { kind: 'supplier-not-saved', name: 'Alba Fine Foods Ltd' },
    ]);
  });

  test('ingredientsFromServer turns true only on the server’s answer, as suppliersFromServer does', async () => {
    const source = fakeSuppliersSource({ ingredients: [{ id: 'i1', name: 'Flour' }] });
    source.fromCache = true;
    const { store } = started(source);
    await tick();
    expect(store.getSnapshot().ingredientsLoaded).toBe(true);
    expect(store.getSnapshot().ingredientsFromServer).toBe(false);
    source.fromCache = false;
    source.push();
    expect(store.getSnapshot().ingredientsFromServer).toBe(true);
  });

  test('a star moves at once', async () => {
    const { store } = started(fakeSuppliersSource({ suppliers: [{ id: 's1', name: 'Alba' }] }));
    await tick();
    store.setFavourite('s1', true);
    expect(store.getSnapshot().favourites).toEqual(['s1']);
    store.setFavourite('s1', false);
    expect(store.getSnapshot().favourites).toEqual([]);
  });

  test('the count his decision F2 names: ingredients AND packaging filed under the supplier', async () => {
    const { store } = started(fakeSuppliersSource({
      suppliers: [{ id: 's1', name: 'Alba' }],
      ingredients: [
        { id: 'i1', name: 'Flour', supplierId: 's1' },
        { id: 'i2', name: 'Box', supplierId: 's1', kind: 'packaging' },
        { id: 'i3', name: 'Salt', supplierId: 's2' },
      ],
    }));
    await tick();
    expect(store.itemsOfSupplier('s1')).toBe(2);
    expect(store.itemsOfSupplier('nobody')).toBe(0);
  });

  test('deleting a category writes the shortened list and «no category» on every ingredient that used it', async () => {
    const { store, source, messages } = started(fakeSuppliersSource({
      ordersConfig: { ingredientCategories: ['Bakery', 'Pastry'] },
      ingredients: [
        { id: 'i1', name: 'Flour', category: 'bakery ' },
        { id: 'i2', name: 'Cream', category: 'Pastry' },
        { id: 'i3', name: 'Jar', category: 'Retail' },
      ],
    }));
    await tick();
    expect(store.categories('en')).toEqual(['bakery', 'Pastry', 'Retail']);
    expect(store.countInCategory('Bakery')).toBe(1);
    expect(store.deleteCategory('bakery ', 'en')).toBe(true);
    expect(source.writes).toEqual([{ op: 'category', list: ['Pastry', 'Retail'], ids: ['i1'] }]);
    await tick();
    expect(messages).toEqual([]);
    expect(store.getSnapshot().storedCategories).toEqual(['Pastry', 'Retail']);
  });

  test('a refused category delete is said with the category’s name', async () => {
    const { store, source, messages } = started(fakeSuppliersSource({ ordersConfig: { ingredientCategories: ['Bakery'] } }));
    await tick();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    source.refuseWrites.category = true;
    store.deleteCategory('Bakery', 'en');
    await tick();
    await tick();
    expect(messages).toEqual([{ kind: 'category-not-deleted', name: 'Bakery' }]);
  });

  test('a panel switch holds the busy marker until the server answers, and rejects when refused', async () => {
    const busy = counted();
    const { store, source } = started(fakeSuppliersSource(), busy.deps);
    const release = source.holdPanel();
    const done = store.setIngredientPanel('showAllergens', false);
    expect(busy.held()).toBe(1);
    release();
    await done;
    expect(busy.held()).toBe(0);
    expect(source.panelCalls).toEqual([{ key: 'showAllergens', on: false }]);
    source.refusePanel = new Error('permission-denied');
    await expect(store.setIngredientPanel('showNutrition', true)).rejects.toThrow('permission-denied');
    expect(busy.held()).toBe(0);
  });

  test('stop ends the listeners, start begins them again', async () => {
    const { store, source } = started(fakeSuppliersSource());
    await tick();
    store.stop();
    source.suppliers.set('s1', { id: 's1', name: 'Alba' });
    source.push();
    expect(store.getSnapshot().suppliers).toEqual([]);
    store.start();
    await tick();
    expect(store.getSnapshot().suppliers).toHaveLength(1);
  });
});

describe('the suppliers store: «To order today» data', () => {
  test('keeps only the date and the supplier of each record, and the closes that are days', async () => {
    const source = fakeSuppliersSource();
    source.placedRecords = [{ id: 'a', date: '2026-11-10', supplierId: 's1', quantities: { x: 1 } }];
    source.draftDoc = { entries: { x: { qty: 1 } }, skipped: { s1: '2026-11-10', s2: 5 } };
    const { store } = started(source);
    await tick();
    const snap = store.getSnapshot();
    expect(snap.placed).toEqual([{ date: '2026-11-10', supplierId: 's1' }]);
    expect(snap.closed).toEqual({ s1: '2026-11-10' });
    expect([snap.placedLoaded, snap.draftLoaded, snap.placedBroken, snap.draftBroken]).toEqual([true, true, false, false]);
  });

  test('⚠️ the snapshot does not move when the draft changes but the closes do not (a keystroke on another phone)', async () => {
    const source = fakeSuppliersSource();
    source.draftDoc = { skipped: { s1: '2026-11-10' } };
    const { store } = started(source);
    await tick();
    const before = store.getSnapshot();
    const seen = vi.fn();
    store.subscribe(seen);
    source.setDraftDoc({ skipped: { s1: '2026-11-10' }, entries: { x: { qty: 2 } }, updatedAt: 'later' });
    source.setPlaced([]);
    expect(seen).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);
    source.setDraftDoc({ skipped: {} });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().closed).toEqual({});
  });

  test('a browser copy that has no draft is not an answer; the server’s word that there is none is', async () => {
    const source = fakeSuppliersSource();
    source.fromCache = true;
    const { store } = started(source);
    await tick();
    expect([store.getSnapshot().placedLoaded, store.getSnapshot().draftLoaded]).toEqual([false, false]);
    source.fromCache = false;
    source.push();
    expect([store.getSnapshot().placedLoaded, store.getSnapshot().draftLoaded]).toEqual([true, true]);
  });

  test('a dead stream ends the wait: records say broken, a dead draft counts as arrived with no closes', async () => {
    const source = fakeSuppliersSource();
    source.refuse.placed = true;
    source.refuse.draftDoc = true;
    const { store } = started(source);
    await tick();
    const snap = store.getSnapshot();
    expect([snap.placedLoaded, snap.placedBroken, snap.draftLoaded, snap.draftBroken]).toEqual([true, true, true, true]);
    expect(snap.closed).toEqual({});
  });

  test('watches the records from the day it starts, the clock a spec hands it', async () => {
    const source = fakeSuppliersSource();
    const store = createSuppliersStore(source, { ...counted().deps, today: () => '2026-01-02' });
    store.start();
    await tick();
    expect(source.placedFrom).toEqual(['2026-01-02']);
  });
});
