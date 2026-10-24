// The twenty-six TypeScript models and the js/ files the live app runs today must stay the SAME
// thing, until the switch to Mise 2 retires the js/ ones. The behaviour specs next to each model
// run every test against both; this file checks what a behaviour test cannot see — that the two
// export the same names, the same constants, the same frozen-ness and the same function shapes.
//
// membership.ts, location-id.ts, pastries-model.ts, market.ts, price-model.ts, currency.ts,
// inventory-value.ts, catalogue-model.ts, recipe-cost-model.ts and foodcost-model.ts are NOT paired here:
// they are partial or adapted ports (the pure half of
// js/roles.js and js/location.js; everything in js/pastries/pastries-model.js except weekdayLabel and
// weekdayShortLabel, which look a word up in the interface dictionary that in Mise 2 belongs to the
// app; the country and money half of js/market.js, without the label vocabulary; the reading half of
// js/price-model.js, without the writing half and the dictionary lookups; js/currency.js without
// the module variable that holds the venue's money, which Mise 2 hands to the functions instead; and
// everything in js/inventory/inventory-value.js except formatTotal, which writes the total with that
// same module variable; the part of js/catalogue/catalogue-model.js that Food cost reads; everything in
// js/catalogue/recipe-cost-model.js except the two functions that look a word up in the dictionary; and
// everything in js/foodcost/foodcost-model.js except blockerText, likewise), so the js/ files export more
// or differently by design; their specs run every test against both files instead (pastries-model.spec.ts,
// market.spec.ts, price-model.spec.ts, currency.spec.ts, inventory-value.spec.ts, catalogue-model.spec.ts,
// recipe-cost-model.spec.ts and foodcost-model.spec.ts also compare the names, constants, frozen-ness and
// function shapes of everything they do port).
//
// ⚠️ IT IS WHAT CATCHES A FIX MADE TO js/ AND FORGOTTEN HERE. A constant changed in one file
// (a new allergen, a new push kind, a new card) is invisible to every behavioural test that does
// not happen to read it; here it is a red line naming the export.

import { describe, expect, test } from 'vitest';
import * as joinCode from './join-code';
import * as pushModel from './push-model';
import * as homeCards from './home-cards';
import * as awayModel from './away-model';
import * as allergenModel from './allergen-model';
import * as sections from './sections';
import * as firebaseTarget from './firebase-target';
import * as localData from './local-data';
import * as sameData from './same-data';
import * as errorModel from './error-model';
import * as deviceModel from './device-model';
import * as usageModel from './usage-model';
import * as pastriesLogModel from './pastries-log-model';
import * as pastriesLock from './pastries-lock';
import * as packSize from './pack-size';
import * as orderUnit from './order-unit';
import * as ingredientName from './ingredient-name';
import * as orderCost from './order-cost';
import * as inventoryModel from './inventory-model';
import * as inventoryOutbox from './inventory-outbox';
import * as inventoryPurchases from './inventory-purchases';
import * as vatRates from './vat-rates';
import * as ingredientKind from './ingredient-kind';
import * as productLimits from './product-limits';
import * as vatGuide from './vat-guide';
import * as foodcostWeighing from './foodcost-weighing';
import * as legacyJoinCode from '../../js/join-code.js';
import * as legacyPushModel from '../../js/push-model.js';
import * as legacyHomeCards from '../../js/home-cards.js';
import * as legacyAwayModel from '../../js/away-model.js';
import * as legacyAllergenModel from '../../js/allergen-model.js';
import * as legacySections from '../../js/sections.js';
import * as legacyFirebaseTarget from '../../js/firebase-target.js';
import * as legacyLocalData from '../../js/local-data.js';
import * as legacySameData from '../../js/same-data.js';
import * as legacyErrorModel from '../../js/error-model.js';
import * as legacyDeviceModel from '../../js/device-model.js';
import * as legacyUsageModel from '../../js/usage-model.js';
import * as legacyPastriesLogModel from '../../js/pastries/pastries-log-model.js';
import * as legacyPastriesLock from '../../js/pastries/pastries-lock.js';
import * as legacyPackSize from '../../js/pack-size.js';
import * as legacyOrderUnit from '../../js/order-unit.js';
import * as legacyIngredientName from '../../js/ingredient-name.js';
import * as legacyOrderCost from '../../js/order-cost.js';
import * as legacyInventoryModel from '../../js/inventory/inventory-model.js';
import * as legacyInventoryOutbox from '../../js/inventory/inventory-outbox.js';
import * as legacyInventoryPurchases from '../../js/inventory/inventory-purchases.js';
import * as legacyVatRates from '../../js/vat-rates.js';
import * as legacyIngredientKind from '../../js/ingredient-kind.js';
import * as legacyProductLimits from '../../js/foodcost/product-limits.js';
import * as legacyVatGuide from '../../js/foodcost/vat-guide.js';
import * as legacyFoodcostWeighing from '../../js/foodcost/foodcost-weighing.js';

const PAIRS: readonly (readonly [string, object, object])[] = [
  ['join-code', joinCode, legacyJoinCode],
  ['push-model', pushModel, legacyPushModel],
  ['home-cards', homeCards, legacyHomeCards],
  ['away-model', awayModel, legacyAwayModel],
  ['allergen-model', allergenModel, legacyAllergenModel],
  ['sections', sections, legacySections],
  ['firebase-target', firebaseTarget, legacyFirebaseTarget],
  ['local-data', localData, legacyLocalData],
  ['same-data', sameData, legacySameData],
  ['error-model', errorModel, legacyErrorModel],
  ['device-model', deviceModel, legacyDeviceModel],
  ['usage-model', usageModel, legacyUsageModel],
  ['pastries-log-model', pastriesLogModel, legacyPastriesLogModel],
  ['pastries-lock', pastriesLock, legacyPastriesLock],
  ['pack-size', packSize, legacyPackSize],
  ['order-unit', orderUnit, legacyOrderUnit],
  ['ingredient-name', ingredientName, legacyIngredientName],
  ['order-cost', orderCost, legacyOrderCost],
  ['inventory-model', inventoryModel, legacyInventoryModel],
  ['inventory-outbox', inventoryOutbox, legacyInventoryOutbox],
  ['inventory-purchases', inventoryPurchases, legacyInventoryPurchases],
  ['vat-rates', vatRates, legacyVatRates],
  ['ingredient-kind', ingredientKind, legacyIngredientKind],
  ['product-limits', productLimits, legacyProductLimits],
  ['vat-guide', vatGuide, legacyVatGuide],
  ['foodcost-weighing', foodcostWeighing, legacyFoodcostWeighing],
];

const exportsOf = (module: object): Record<string, unknown> => module as Record<string, unknown>;

// ⚠️ The outbox of the current app got the fix of 11 Oct 2026 (several writes in the air, counts held for
// the server's word) in PR #343, and this branch can be older than that. Until js/inventory/inventory-outbox.js
// in THIS checkout has it (it exports `answered`), the port has more exports and a different empty outbox BY
// DESIGN, so that one pair is compared only on what the old file has; the day it has the fix the pair is
// compared in full, with no edit.
const legacyOutboxHasTheFix = typeof (legacyInventoryOutbox as unknown as { answered?: unknown }).answered === 'function';
const COMPARED_IN_FULL = PAIRS.filter(([name]) => name !== 'inventory-outbox' || legacyOutboxHasTheFix);

// Whether a value, and everything inside it, is frozen — as a tree, so that a card frozen in one
// file and loose in the other is a difference even when the list around it is frozen in both.
type FrozenTree = null | { frozen: boolean; children: Record<string, FrozenTree> };

function frozenTree(value: unknown, seen: WeakSet<object> = new WeakSet()): FrozenTree {
  if (typeof value !== 'object' || value === null) return null;
  if (seen.has(value)) return { frozen: Object.isFrozen(value), children: {} };
  seen.add(value);
  const children: Record<string, FrozenTree> = {};
  for (const [key, inner] of Object.entries(value)) children[key] = frozenTree(inner, seen);
  return { frozen: Object.isFrozen(value), children };
}

describe.each(COMPARED_IN_FULL)('parity: %s', (_name, tsModule, jsModule) => {
  const ts = exportsOf(tsModule);
  const js = exportsOf(jsModule);
  const names = Object.keys(js).sort();

  test('exports exactly the same names', () => {
    expect(Object.keys(ts).sort()).toStrictEqual(names);
  });

  test('every export is a function in both or a value in both', () => {
    for (const name of names) {
      expect(typeof ts[name], name).toBe(typeof js[name]);
    }
  });

  test('every non-function export is strictly equal', () => {
    for (const name of names) {
      if (typeof js[name] === 'function') continue;
      expect(ts[name], name).toStrictEqual(js[name]);
    }
  });

  test('frozen-ness matches for every object and array export, all the way down', () => {
    for (const name of names) {
      if (typeof js[name] !== 'object' || js[name] === null) continue;
      expect(Object.isFrozen(ts[name]), name).toBe(Object.isFrozen(js[name]));
      expect(frozenTree(ts[name]), name).toStrictEqual(frozenTree(js[name]));
    }
  });

  test('every function has the same name and the same number of required parameters', () => {
    for (const name of names) {
      const mine = ts[name];
      const theirs = js[name];
      if (typeof mine !== 'function' || typeof theirs !== 'function') continue;
      expect(mine.name, name).toBe(theirs.name);
      expect(mine.length, `${name}: arity`).toBe(theirs.length);
    }
  });
});

if (!legacyOutboxHasTheFix) {
  describe('parity: inventory-outbox (the fix of 11 Oct 2026, PR #343, is not in js/ in this checkout yet)', () => {
    // TO DELETE, with `legacyOutboxHasTheFix`, once PR #343 is on main and merged into this branch.
    test('the port still exports everything the current app’s file does, with the same name and arity, and its exports that are not functions are the same kind of thing', () => {
      const ts = exportsOf(inventoryOutbox);
      const js = exportsOf(legacyInventoryOutbox);
      for (const name of Object.keys(js)) {
        expect(name in ts, `${name} is exported by js/ and not by the port`).toBe(true);
        expect(typeof ts[name], name).toBe(typeof js[name]);
        if (typeof js[name] === 'function') {
          const mine = ts[name] as { name: string; length: number };
          const theirs = js[name] as { name: string; length: number };
          expect(mine.name, name).toBe(theirs.name);
          expect(mine.length, `${name}: arity`).toBe(theirs.length);
        }
      }
    });
  });
}

test('all twenty-six models are compared', () => {
  expect(PAIRS.map(([name]) => name)).toStrictEqual(
    ['join-code', 'push-model', 'home-cards', 'away-model', 'allergen-model', 'sections', 'firebase-target', 'local-data', 'same-data',
      'error-model', 'device-model', 'usage-model', 'pastries-log-model', 'pastries-lock', 'pack-size', 'order-unit', 'ingredient-name',
      'order-cost', 'inventory-model', 'inventory-outbox', 'inventory-purchases', 'vat-rates', 'ingredient-kind', 'product-limits',
      'vat-guide', 'foodcost-weighing']);
});
