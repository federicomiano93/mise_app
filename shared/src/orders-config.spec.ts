// Unit tests for the Orders screen's settings (P15), run against BOTH implementations: the TypeScript port in
// shared/ and js/orders/orders-config.js, which the live app uses today. Ported from tests/orders-config.test.mjs
// (and the 'normalizeOrdersConfig carries supplierOrder' test of tests/supplier-order.test.mjs); the module is a
// FULL port, so parity.spec.ts also compares its exports.
//
// PORTED: 14 of 14 tests of tests/orders-config.test.mjs, plus 1 of tests/supplier-order.test.mjs.
//
// The failure that matters here is the direction of the default. This setting decides
// whether a column people type into is on the screen at all, so a missing document, a
// half-written one or a corrupt value must leave the screen as it has always been —
// never silently remove the Stock box.

import { describe, expect, test } from 'vitest';
import * as ported from './orders-config';
import * as legacyJs from '../../js/orders/orders-config.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const { normalizeOrdersConfig, DEFAULT_HISTORY_DAYS } = m;

  test('no document yet: Stock is shown', () => {
    // config/orders does not exist until someone changes the setting for the first time.
    expect(normalizeOrdersConfig(null).showStock).toBe(true);
    expect(normalizeOrdersConfig(undefined).showStock).toBe(true);
  });

  test('a document without the field: Stock is shown', () => {
    expect(normalizeOrdersConfig({}).showStock).toBe(true);
    expect(normalizeOrdersConfig({ bakery: 'main' }).showStock).toBe(true);
  });

  test('only an explicit false hides it', () => {
    expect(normalizeOrdersConfig({ showStock: false }).showStock).toBe(false);
    expect(normalizeOrdersConfig({ showStock: true }).showStock).toBe(true);
  });

  test('a corrupt value leaves the screen alone rather than emptying it', () => {
    // Anything that is not exactly `false` keeps the box: losing a column you are typing
    // into is a much worse outcome than an ignored setting.
    ['false', 0, '', null, undefined, 'no', [], {}].forEach(bad => {
      expect(normalizeOrdersConfig({ showStock: bad }).showStock, `showStock: ${JSON.stringify(bad)} must not hide the box`).toBe(true);
    });
  });

  // ⚠️ THE LIST IS PINNED ON PURPOSE, and it caught the send-routes work the moment
  // it landed. Every key here is something a screen reads, so adding one is a decision
  // and not a side effect - `sendSettings` was added deliberately, and anything that
  // appears without a line in this test has arrived by accident.
  test('it returns only the keys the screen uses, whatever else the document carries', () => {
    const out = normalizeOrdersConfig({ bakery: 'main', showStock: false, somethingElse: 42 });
    expect(Object.keys(out)).toStrictEqual(['showStock', 'historyDays', 'sendSettings', 'orderLists', 'weekStartsOn', 'supplierOrder', 'favouriteSuppliers']);
  });

  // ⚠️ AND IT IS ALWAYS USABLE, whatever the document says. An order that cannot leave
  // the app at all is the one failure this whole feature must not be able to produce,
  // so a missing, empty or corrupt config still comes back with a road open.
  // ⚠️ AND THE WEEK IS ALWAYS USABLE TOO. An unreadable setting must not empty Incoming:
  // a screen showing nothing looks exactly like the feature working.
  test('a config with no week setting still has a week', () => {
    [undefined, null, {}, { weekStartsOn: '' }, { weekStartsOn: ['Monday'] }].forEach(doc => {
      expect(normalizeOrdersConfig(doc).weekStartsOn, JSON.stringify(doc)).toBe('Sunday');
    });
    expect(normalizeOrdersConfig({ weekStartsOn: 'Monday' }).weekStartsOn).toBe('Monday');
  });

  test('a config with no send settings still leaves a road open', () => {
    [undefined, null, {}, { sendRoutes: null }, { sendRoutes: 'x' }].forEach(doc => {
      const s = normalizeOrdersConfig(doc);
      const open = Object.values(s.sendSettings.routes).filter(Boolean);
      expect(open.length, `${JSON.stringify(doc)} left no way to send`).toBeGreaterThan(0);
      expect(s.sendSettings.preferred, 'and one of them is offered first').toBeTruthy();
    });
  });

  // ── How many days of past orders History shows ─────────────────────────────
  //
  // The failure that matters here is the opposite of the Stock one: this setting can
  // only ever HIDE orders behind a button, so the danger is a value that hides them
  // ALL. An empty History reads as "our orders have been deleted" — and the promise of
  // this feature is precisely that nothing is deleted.

  test('no document yet, or no field: the default window', () => {
    expect(normalizeOrdersConfig(null).historyDays).toBe(DEFAULT_HISTORY_DAYS);
    expect(normalizeOrdersConfig({}).historyDays).toBe(DEFAULT_HISTORY_DAYS);
    expect(normalizeOrdersConfig({ showStock: false }).historyDays).toBe(DEFAULT_HISTORY_DAYS);
  });

  test('the default is 15 days', () => {
    // Pinned: this is the number Federico asked for, and the note under the field in
    // Settings quotes it. Changing it is a product decision, not a refactor.
    expect(DEFAULT_HISTORY_DAYS).toBe(15);
  });

  test('a stored number is used as given', () => {
    expect(normalizeOrdersConfig({ historyDays: 7 }).historyDays).toBe(7);
    expect(normalizeOrdersConfig({ historyDays: 1 }).historyDays).toBe(1);
    expect(normalizeOrdersConfig({ historyDays: 90 }).historyDays).toBe(90);
  });

  test('a number typed into an input arrives as a string, and still works', () => {
    expect(normalizeOrdersConfig({ historyDays: '30' }).historyDays).toBe(30);
    expect(normalizeOrdersConfig({ historyDays: 15.8 }).historyDays).toBe(15);
  });

  test('nothing usable can produce an empty History', () => {
    // Every one of these must fall back to the default rather than to 0 days.
    [0, -1, -99, NaN, Infinity, '', ' ', 'abc', null, undefined, {}, [], true, false].forEach(bad => {
      expect(normalizeOrdersConfig({ historyDays: bad }).historyDays,
        `historyDays: ${JSON.stringify(bad)} must fall back to the default`).toBe(DEFAULT_HISTORY_DAYS);
    });
  });

  test('an absurd window is capped rather than trusted', () => {
    expect(normalizeOrdersConfig({ historyDays: 100000 }).historyDays).toBe(365);
  });

  // ── Order lists (28 Sep 2026): only an explicit false turns them off ──
  test('order lists default ON, and ride along with the send settings', () => {
    expect(normalizeOrdersConfig(null).orderLists).toBe(true);
    expect(normalizeOrdersConfig({ orderLists: 'no' }).orderLists).toBe(true);
    expect(normalizeOrdersConfig({ orderLists: false }).orderLists).toBe(false);
    expect(normalizeOrdersConfig({ orderLists: false }).sendSettings.orderLists).toBe(false);
  });

  // From tests/supplier-order.test.mjs.
  test('normalizeOrdersConfig carries supplierOrder, empty by default', () => {
    expect(normalizeOrdersConfig(null).supplierOrder).toStrictEqual([]);
    expect(normalizeOrdersConfig({ supplierOrder: ['a', 'a', 'b'] }).supplierOrder).toStrictEqual(['a', 'b']);
    expect(normalizeOrdersConfig({ supplierOrder: 'oops' }).supplierOrder).toStrictEqual([]);
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('the starred suppliers ride along, cleaned the way the Suppliers page cleans them', () => {
    expect(normalizeOrdersConfig({ favouriteSuppliers: ['b', 'a', 'b', '', 3] }).favouriteSuppliers).toStrictEqual(['b', 'a']);
    expect(normalizeOrdersConfig(null).favouriteSuppliers).toStrictEqual([]);
  });
});
