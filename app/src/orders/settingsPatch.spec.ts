// What Orders → Settings writes into config/orders, and when it refuses (step 3f-8, parity M3–M8).
import { describe, expect, test } from 'vitest';
import { normalizeOrdersConfig } from '@mise/shared/orders-config';
import { historyDaysOf, settingPatch, withPatch } from './settingsPatch';

const config = (doc: Record<string, unknown> = {}) => normalizeOrdersConfig(doc);

describe('settingPatch', () => {
  test('the Stock box is a plain yes or no', () => {
    expect(settingPatch({ kind: 'showStock', on: false }, config())).toStrictEqual({ patch: { showStock: false } });
    expect(settingPatch({ kind: 'showStock', on: true }, config({ showStock: false }))).toStrictEqual({ patch: { showStock: true } });
  });

  test('order lists off is refused while they are the only road staff have', () => {
    const onlyLists = config({ sendRoutes: { manager: true, whatsapp: false, whatsappSupplier: false, email: false } });
    expect(settingPatch({ kind: 'orderLists', on: false }, onlyLists)).toStrictEqual({ refused: 'only-road' });
    // Turning them ON is never refused.
    expect(settingPatch({ kind: 'orderLists', on: true }, onlyLists)).toStrictEqual({ patch: { orderLists: true } });
    // With WhatsApp open (the default) they can go.
    expect(settingPatch({ kind: 'orderLists', on: false }, config())).toStrictEqual({ patch: { orderLists: false } });
  });

  test('a road: the whole map and the preference are written', () => {
    expect(settingPatch({ kind: 'route', route: 'email', on: true }, config())).toStrictEqual({
      patch: { sendRoutes: { manager: true, whatsapp: true, whatsappSupplier: false, email: true }, preferredRoute: 'manager' },
    });
  });

  test('a preference on a road being closed moves to the first open one', () => {
    const doc = config({ sendRoutes: { manager: true, whatsapp: true, whatsappSupplier: false, email: false }, preferredRoute: 'whatsapp' });
    expect(settingPatch({ kind: 'route', route: 'whatsapp', on: false }, doc)).toStrictEqual({
      patch: { sendRoutes: { manager: true, whatsapp: false, whatsappSupplier: false, email: false }, preferredRoute: 'manager' },
    });
  });

  test('the last road cannot be closed', () => {
    const one = config({ sendRoutes: { manager: false, whatsapp: true, whatsappSupplier: false, email: false } });
    expect(settingPatch({ kind: 'route', route: 'whatsapp', on: false }, one)).toStrictEqual({ refused: 'last-road' });
  });

  test('with lists off, the manager road does not count as the one kept open', () => {
    const doc = config({ orderLists: false, sendRoutes: { manager: true, whatsapp: true, whatsappSupplier: false, email: false } });
    expect(settingPatch({ kind: 'route', route: 'whatsapp', on: false }, doc)).toStrictEqual({ refused: 'last-road' });
  });

  test('the week start: a known day is written, anything else refused, the same day writes nothing', () => {
    expect(settingPatch({ kind: 'weekStart', day: 'Monday' }, config())).toStrictEqual({ patch: { weekStartsOn: 'Monday' } });
    expect(settingPatch({ kind: 'weekStart', day: 'Funday' }, config())).toStrictEqual({ refused: 'invalid' });
    expect(settingPatch({ kind: 'weekStart', day: 'Sunday' }, config())).toStrictEqual({ refused: 'unchanged' });
  });

  test('the days of History: 1 to 365, whole, and the stored number writes nothing', () => {
    expect(settingPatch({ kind: 'historyDays', value: '30' }, config())).toStrictEqual({ patch: { historyDays: 30 } });
    expect(settingPatch({ kind: 'historyDays', value: 15 }, config())).toStrictEqual({ refused: 'unchanged' });
    for (const bad of ['', ' ', '0', '366', '-3', 'abc', null, undefined, true, Number.NaN, Infinity]) {
      expect(settingPatch({ kind: 'historyDays', value: bad }, config())).toStrictEqual({ refused: 'invalid' });
    }
  });

  test('the supplier order goes through normalizeSupplierOrder', () => {
    expect(settingPatch({ kind: 'supplierOrder', ids: ['b', 'a', 'b', ''] }, config())).toStrictEqual({ patch: { supplierOrder: ['b', 'a'] } });
  });
});

describe('historyDaysOf', () => {
  test('a whole number of days, rounded down like the current app', () => {
    expect(historyDaysOf('12.7')).toBe(12);
    expect(historyDaysOf(1)).toBe(1);
    expect(historyDaysOf(365)).toBe(365);
    expect(historyDaysOf('0.5')).toBe(null);
  });
});

describe('withPatch', () => {
  test('two road closes judged one after the other cannot shut the last road, before either has landed', () => {
    const start = config({ orderLists: false, sendRoutes: { manager: true, whatsapp: true, whatsappSupplier: false, email: true } });
    const first = settingPatch({ kind: 'route', route: 'email', on: false }, start);
    expect('patch' in first).toBe(true);
    if (!('patch' in first)) return;
    expect(settingPatch({ kind: 'route', route: 'whatsapp', on: false }, withPatch(start, first.patch))).toStrictEqual({ refused: 'last-road' });
  });

  test('order lists off counts for the roads judged next', () => {
    const start = config({ sendRoutes: { manager: true, whatsapp: true, whatsappSupplier: false, email: false } });
    const off = withPatch(start, { orderLists: false });
    expect(off.orderLists).toBe(false);
    expect(off.sendSettings.orderLists).toBe(false);
    expect(settingPatch({ kind: 'route', route: 'whatsapp', on: false }, off)).toStrictEqual({ refused: 'last-road' });
  });

  test('a patch the config already carries changes nothing, and the other fields are kept', () => {
    const start = config({ showStock: false, historyDays: 30, weekStartsOn: 'Monday', supplierOrder: ['b'] });
    expect(withPatch(start, { showStock: false })).toStrictEqual(start);
    expect(withPatch(start, { historyDays: 40 }).historyDays).toBe(40);
    expect(withPatch(start, { historyDays: 40 }).weekStartsOn).toBe('Monday');
  });
});
