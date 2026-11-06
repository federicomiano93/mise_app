// The prices of «Orders» (step 3f-8c, parity L20): the store opens the listener on ingredient-prices ONLY for whoever may read
// prices (setPriceReader, the session's word), forgets them when that changes or the section closes, and says they are readable
// only when the read SUCCEEDED — a refused read leaves no money anywhere, never «no price».

import { describe, expect, it } from 'vitest';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import { createOrdersStore } from './ordersStore';
import type { OrdersDeps } from './ordersStore';

const DEPS: OrdersDeps = {
  markBusy: () => () => {},
  today: () => '2026-10-27',
  draft: { nowIso: () => '2026-10-27T09:00:00.000Z', setTimer: () => 1, clearTimer: () => {} },
  online: () => true,
};

const FLOUR_PRICE = { bakery: 'bakery', priceUnit: 'kg', pricePerUnit: 1.2, vatRate: 0 };

function setup() {
  const source = fakeOrdersSource({ prices: { flour: FLOUR_PRICE } });
  const store = createOrdersStore(source, DEPS);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  return { source, store, settle };
}

describe('the prices of Orders', () => {
  it('reads nothing about money for somebody who may not read prices', async () => {
    const { source, store, settle } = setup();
    store.start();
    store.setPriceReader(false);
    await settle();
    expect(source.priceWatches).toBe(0);
    expect(store.getSnapshot().prices).toStrictEqual({});
    expect(store.getSnapshot().pricesReadable).toBe(false);
    store.stop();
  });

  it('opens one listener for a price reader, and the prices arrive readable', async () => {
    const { source, store, settle } = setup();
    store.setPriceReader(true);
    // Before start nothing is opened: the section is not on screen yet.
    expect(source.priceWatches).toBe(0);
    store.start();
    await settle();
    expect(source.priceWatches).toBe(1);
    expect(store.getSnapshot().pricesReadable).toBe(true);
    expect(store.getSnapshot().prices).toStrictEqual({ flour: FLOUR_PRICE });
    // Asked again, it does not open a second one.
    store.setPriceReader(true);
    expect(source.priceWatchersOpen()).toBe(1);
    store.stop();
  });

  it('a refused read is not readable, and holds no price', async () => {
    const { source, store, settle } = setup();
    source.refusePrices = true;
    store.start();
    store.setPriceReader(true);
    await settle();
    expect(store.getSnapshot().pricesReadable).toBe(false);
    expect(store.getSnapshot().prices).toStrictEqual({});
    store.stop();
  });

  it('a price changed elsewhere is told at once', async () => {
    const { source, store, settle } = setup();
    store.start();
    store.setPriceReader(true);
    await settle();
    source.prices.set('flour', { ...FLOUR_PRICE, pricePerUnit: 1.5 });
    source.emitPrices();
    expect(store.getSnapshot().prices.flour?.pricePerUnit).toBe(1.5);
    store.stop();
  });

  it('closes the listener and forgets the prices when the person may no longer read them', async () => {
    const { source, store, settle } = setup();
    store.start();
    store.setPriceReader(true);
    await settle();
    store.setPriceReader(false);
    expect(source.priceWatchersOpen()).toBe(0);
    expect(store.getSnapshot().prices).toStrictEqual({});
    expect(store.getSnapshot().pricesReadable).toBe(false);
    store.stop();
  });

  it('stop closes it; start opens it again for a reader (React mounts twice in development)', async () => {
    const { source, store, settle } = setup();
    store.setPriceReader(true);
    store.start();
    await settle();
    store.stop();
    expect(source.priceWatchersOpen()).toBe(0);
    expect(store.getSnapshot().pricesReadable).toBe(false);
    store.start();
    await settle();
    expect(source.priceWatchersOpen()).toBe(1);
    expect(store.getSnapshot().pricesReadable).toBe(true);
    store.stop();
  });
});
