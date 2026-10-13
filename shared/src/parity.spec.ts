// The thirty-five TypeScript models and the js/ files the live app runs today must stay the SAME
// thing, until the switch to Mise 2 retires the js/ ones. The behaviour specs next to each model
// run every test against both; this file checks what a behaviour test cannot see — that the two
// export the same names, the same constants, the same frozen-ness and the same function shapes.
//
// membership.ts, location-id.ts, pastries-model.ts, price-model.ts, currency.ts,
// inventory-value.ts, catalogue-model.ts, recipe-cost-model.ts and foodcost-model.ts are NOT paired here:
// they are partial or adapted ports (the pure half of
// js/roles.js and js/location.js; everything in js/pastries/pastries-model.js except weekdayLabel and
// weekdayShortLabel, which look a word up in the interface dictionary that in Mise 2 belongs to the
// app; the reading half of
// js/price-model.js, without the writing half and the dictionary lookups; js/currency.js without
// the module variable that holds the venue's money, which Mise 2 hands to the functions instead; and
// everything in js/inventory/inventory-value.js except formatTotal, which writes the total with that
// same module variable; the part of js/catalogue/catalogue-model.js that Food cost reads; everything in
// js/catalogue/recipe-cost-model.js except the two functions that look a word up in the dictionary; and
// everything in js/foodcost/foodcost-model.js except blockerText, likewise), so the js/ files export more
// or differently by design; their specs run every test against both files instead (pastries-model.spec.ts,
// price-model.spec.ts, currency.spec.ts, inventory-value.spec.ts, catalogue-model.spec.ts,
// recipe-cost-model.spec.ts and foodcost-model.spec.ts also compare the names, constants, frozen-ness and
// function shapes of everything they do port).
//
// The Calculator's partial ports are not paired either, for the same reason: calculator-config.ts (it leaves
// out the save path and `orderPrefillLabel`), log-model.ts (the legacy migration and `dayLabel`, which has
// the pure `dayLabelParts` instead), guided-model.ts (everything but `ridOf`) and zoom-steps.ts (the storage and DOM halves); their
// specs (calculator-config.spec.ts, log-model.spec.ts, guided-model via calculator-recipe-source.spec.ts,
// zoom-steps.spec.ts) compare what they do port. calculator-tab-keys.ts is new in Mise 2 and has no original.
// calculator-order-prefill.ts is not paired: `prefillNote` takes the translate function as a third argument (the
// original reads the interface dictionary), so its arity differs by design; its spec compares names, constant and
// shapes itself. client-order-model.ts and client-order-history.ts are not paired either: `orderRows` takes the word for a
// deleted product as a third argument, and `linesLabel` / `emptyWords` take the translate function as their last (the
// originals read the interface dictionary), so those arities differ by design; their specs compare names, constants and
// shapes themselves. recipe-allergen-model.ts is not paired: it leaves out `incompleteText` and `blockingIngredients` takes
// the word for an unknown ingredient as a third argument (the original reads the interface dictionary); its spec compares
// names, constants and shapes itself. market.ts (with the label vocabulary), venue-features.ts and recipe-label-model.ts ARE
// paired: they are full ports. calculator-recipe-text.ts is paired although it differs from the original in ONE input (the line called
// `Flour uniqua blue`, one venue's data): the exports are the same, and its spec says where the text differs.
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
import * as calculatorDoughMath from './calculator-dough-math';
import * as calculatorRecipeSource from './calculator-recipe-source';
import * as calculatorRecipeText from './calculator-recipe-text';
import * as calculatorOrderText from './calculator-order-text';
import * as confirmFlow from './confirm-flow';
import * as logTime from './log-time';
import * as venueFeatures from './venue-features';
import * as market from './market';
import * as recipeLabelModel from './recipe-label-model';
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
import * as legacyCalculatorDoughMath from '../../js/calculator-dough-math.js';
import * as legacyCalculatorRecipeSource from '../../js/calculator-recipe-source.js';
import * as legacyCalculatorRecipeText from '../../js/calculator-recipe-text.js';
import * as legacyCalculatorOrderText from '../../js/calculator-order-text.js';
import * as legacyConfirmFlow from '../../js/confirm-flow.js';
import * as legacyLogTime from '../../js/log-time.js';
import * as legacyVenueFeatures from '../../js/venue-features.js';
import * as legacyMarket from '../../js/market.js';
import * as legacyRecipeLabelModel from '../../js/catalogue/recipe-label-model.js';

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
  ['calculator-dough-math', calculatorDoughMath, legacyCalculatorDoughMath],
  ['calculator-recipe-source', calculatorRecipeSource, legacyCalculatorRecipeSource],
  ['calculator-recipe-text', calculatorRecipeText, legacyCalculatorRecipeText],
  ['calculator-order-text', calculatorOrderText, legacyCalculatorOrderText],
  ['confirm-flow', confirmFlow, legacyConfirmFlow],
  ['log-time', logTime, legacyLogTime],
  ['venue-features', venueFeatures, legacyVenueFeatures],
  ['market', market, legacyMarket],
  ['recipe-label-model', recipeLabelModel, legacyRecipeLabelModel],
];

const exportsOf = (module: object): Record<string, unknown> => module as Record<string, unknown>;

// The outbox of the current app got the fix of 11 Oct 2026 (PR #343, now on main), so that pair is compared in
// full like every other: a js/ regression fails here instead of being skipped.

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

describe.each(PAIRS)('parity: %s', (_name, tsModule, jsModule) => {
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

test('all thirty-five models are compared', () => {
  expect(PAIRS.map(([name]) => name)).toStrictEqual(
    ['join-code', 'push-model', 'home-cards', 'away-model', 'allergen-model', 'sections', 'firebase-target', 'local-data', 'same-data',
      'error-model', 'device-model', 'usage-model', 'pastries-log-model', 'pastries-lock', 'pack-size', 'order-unit', 'ingredient-name',
      'order-cost', 'inventory-model', 'inventory-outbox', 'inventory-purchases', 'vat-rates', 'ingredient-kind', 'product-limits',
      'vat-guide', 'foodcost-weighing', 'calculator-dough-math', 'calculator-recipe-source', 'calculator-recipe-text', 'calculator-order-text',
      'confirm-flow', 'log-time', 'venue-features', 'market', 'recipe-label-model']);
});
