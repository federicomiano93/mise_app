// The TypeScript models and the js/ files must give the SAME answer to the inputs nobody
// planned for: null, the wrong type, a missing field, a string where a number belongs.
//
// The behaviour specs port the tests the current app already has; those pick the cases a person
// thought of. This file feeds BOTH implementations a wide spread of odd values and demands the
// same result — or the same kind of error — from each. It is what backs the claim "behaviour
// identical, including for odd input", and it is the net under any future tidy-up of the port.
//
// Nothing here says what the right answer is (the behaviour specs do that). It only says the two
// agree, so it never needs updating when the rules of a model change on purpose in both.

import { describe, expect, test, vi } from 'vitest';
import * as joinCode from './join-code';
import * as pushModel from './push-model';
import * as homeCards from './home-cards';
import * as awayModel from './away-model';
import * as allergenModel from './allergen-model';
import * as sections from './sections';
import * as firebaseTarget from './firebase-target';
import * as localData from './local-data';
import * as errorModel from './error-model';
import * as deviceModel from './device-model';
import * as usageModel from './usage-model';
import * as pastriesModel from './pastries-model';
import * as pastriesLogModel from './pastries-log-model';
import * as pastriesLock from './pastries-lock';
import * as packSize from './pack-size';
import * as orderUnit from './order-unit';
import * as ingredientName from './ingredient-name';
import * as market from './market';
import * as currency from './currency';
import * as priceModel from './price-model';
import * as orderCost from './order-cost';
import * as inventoryModel from './inventory-model';
import * as inventoryOutbox from './inventory-outbox';
import * as inventoryPurchases from './inventory-purchases';
import * as inventoryValue from './inventory-value';
import * as vatRates from './vat-rates';
import * as ingredientKind from './ingredient-kind';
import * as productLimits from './product-limits';
import * as vatGuide from './vat-guide';
import * as catalogueModel from './catalogue-model';
import * as recipeCostModel from './recipe-cost-model';
import * as foodcostWeighing from './foodcost-weighing';
import * as foodcostModel from './foodcost-model';
import * as calculatorConfig from './calculator-config';
import * as calculatorDoughMath from './calculator-dough-math';
import * as calculatorRecipeSource from './calculator-recipe-source';
import * as calculatorRecipeText from './calculator-recipe-text';
import * as confirmFlow from './confirm-flow';
import * as guidedModel from './guided-model';
import * as logModel from './log-model';
import * as logTime from './log-time';
import * as zoomSteps from './zoom-steps';
import { BAKERY_CONFIG } from '../../tests/fixtures/bakery-config.mjs';
import * as legacyJoinCodeJs from '../../js/join-code.js';
import * as legacyPushModelJs from '../../js/push-model.js';
import * as legacyHomeCardsJs from '../../js/home-cards.js';
import * as legacyAwayModelJs from '../../js/away-model.js';
import * as legacyAllergenModelJs from '../../js/allergen-model.js';
import * as legacySectionsJs from '../../js/sections.js';
import * as legacyFirebaseTargetJs from '../../js/firebase-target.js';
import * as legacyLocalDataJs from '../../js/local-data.js';
import * as legacyErrorModelJs from '../../js/error-model.js';
import * as legacyDeviceModelJs from '../../js/device-model.js';
import * as legacyUsageModelJs from '../../js/usage-model.js';
import * as legacyPastriesModelJs from '../../js/pastries/pastries-model.js';
import * as legacyPastriesLogModelJs from '../../js/pastries/pastries-log-model.js';
import * as legacyPastriesLockJs from '../../js/pastries/pastries-lock.js';
import * as legacyPackSizeJs from '../../js/pack-size.js';
import * as legacyOrderUnitJs from '../../js/order-unit.js';
import * as legacyIngredientNameJs from '../../js/ingredient-name.js';
import * as legacyMarketJs from '../../js/market.js';
import * as legacyCurrencyJs from '../../js/currency.js';
import * as legacyPriceModelJs from '../../js/price-model.js';
import * as legacyOrderCostJs from '../../js/order-cost.js';
import * as legacyInventoryModelJs from '../../js/inventory/inventory-model.js';
import * as legacyInventoryOutboxJs from '../../js/inventory/inventory-outbox.js';
import * as legacyInventoryPurchasesJs from '../../js/inventory/inventory-purchases.js';
import * as legacyInventoryValueJs from '../../js/inventory/inventory-value.js';
import * as legacyVatRatesJs from '../../js/vat-rates.js';
import * as legacyIngredientKindJs from '../../js/ingredient-kind.js';
import * as legacyProductLimitsJs from '../../js/foodcost/product-limits.js';
import * as legacyVatGuideJs from '../../js/foodcost/vat-guide.js';
import * as legacyCatalogueModelJs from '../../js/catalogue/catalogue-model.js';
import * as legacyRecipeCostModelJs from '../../js/catalogue/recipe-cost-model.js';
import * as legacyFoodcostWeighingJs from '../../js/foodcost/foodcost-weighing.js';
import * as legacyFoodcostModelJs from '../../js/foodcost/foodcost-model.js';
import * as legacyCalculatorConfigJs from '../../js/calculator-config.js';
import * as legacyCalculatorDoughMathJs from '../../js/calculator-dough-math.js';
import * as legacyCalculatorRecipeSourceJs from '../../js/calculator-recipe-source.js';
import * as legacyCalculatorRecipeTextJs from '../../js/calculator-recipe-text.js';
import * as legacyConfirmFlowJs from '../../js/confirm-flow.js';
import * as legacyGuidedModelJs from '../../js/catalogue/guided-model.js';
import * as legacyLogModelJs from '../../js/log-model.js';
import * as legacyLogTimeJs from '../../js/log-time.js';
import * as legacyZoomStepsJs from '../../js/zoom-steps.js';

const legacyJoinCode = legacyJoinCodeJs as unknown as typeof joinCode;
const legacyPushModel = legacyPushModelJs as unknown as typeof pushModel;
const legacyHomeCards = legacyHomeCardsJs as unknown as typeof homeCards;
const legacyAwayModel = legacyAwayModelJs as unknown as typeof awayModel;
const legacyAllergenModel = legacyAllergenModelJs as unknown as typeof allergenModel;
const legacySections = legacySectionsJs as unknown as typeof sections;
const legacyFirebaseTarget = legacyFirebaseTargetJs as unknown as typeof firebaseTarget;
const legacyLocalData = legacyLocalDataJs as unknown as typeof localData;
const legacyErrorModel = legacyErrorModelJs as unknown as typeof errorModel;
const legacyDeviceModel = legacyDeviceModelJs as unknown as typeof deviceModel;
const legacyUsageModel = legacyUsageModelJs as unknown as typeof usageModel;
const legacyPastriesModel = legacyPastriesModelJs as unknown as typeof pastriesModel;
const legacyPastriesLogModel = legacyPastriesLogModelJs as unknown as typeof pastriesLogModel;
const legacyPastriesLock = legacyPastriesLockJs as unknown as typeof pastriesLock;
const legacyPackSize = legacyPackSizeJs as unknown as typeof packSize;
const legacyOrderUnit = legacyOrderUnitJs as unknown as typeof orderUnit;
const legacyIngredientName = legacyIngredientNameJs as unknown as typeof ingredientName;
const legacyMarket = legacyMarketJs as unknown as typeof market;
const legacyPriceModel = legacyPriceModelJs as unknown as typeof priceModel;
const legacyOrderCost = legacyOrderCostJs as unknown as typeof orderCost;
const legacyInventoryModel = legacyInventoryModelJs as unknown as typeof inventoryModel;
const legacyInventoryOutbox = legacyInventoryOutboxJs as unknown as typeof inventoryOutbox;
// ⚠️ The outbox of the current app got the fix of 11 Oct 2026 (several writes in the air, counts held for
// the server's word) in PR #343, and this branch can be older than that. Until js/inventory/inventory-outbox.js
// in THIS checkout has it (it exports `answered`), the two files differ BY DESIGN and only what both do the
// same is compared; the day it has it everything is, with no edit (see inventory-outbox.spec.ts).
const legacyOutboxHasTheFix = typeof (legacyInventoryOutboxJs as unknown as { answered?: unknown }).answered === 'function';
const legacyInventoryPurchases = legacyInventoryPurchasesJs as unknown as typeof inventoryPurchases;
const legacyInventoryValue = legacyInventoryValueJs as unknown as typeof inventoryValue;
const legacyVatRates = legacyVatRatesJs as unknown as typeof vatRates;
const legacyIngredientKind = legacyIngredientKindJs as unknown as typeof ingredientKind;
const legacyProductLimits = legacyProductLimitsJs as unknown as typeof productLimits;
const legacyVatGuide = legacyVatGuideJs as unknown as typeof vatGuide;
const legacyCatalogueModel = legacyCatalogueModelJs as unknown as typeof catalogueModel;
const legacyRecipeCostModel = legacyRecipeCostModelJs as unknown as typeof recipeCostModel;
const legacyFoodcostWeighing = legacyFoodcostWeighingJs as unknown as typeof foodcostWeighing;
const legacyFoodcostModel = legacyFoodcostModelJs as unknown as typeof foodcostModel;
const legacyCalculatorConfig = legacyCalculatorConfigJs as unknown as typeof calculatorConfig;
const legacyCalculatorDoughMath = legacyCalculatorDoughMathJs as unknown as typeof calculatorDoughMath;
const legacyCalculatorRecipeSource = legacyCalculatorRecipeSourceJs as unknown as typeof calculatorRecipeSource;
const legacyCalculatorRecipeText = legacyCalculatorRecipeTextJs as unknown as typeof calculatorRecipeText;
const legacyConfirmFlow = legacyConfirmFlowJs as unknown as typeof confirmFlow;
const legacyGuidedModel = legacyGuidedModelJs as unknown as typeof guidedModel;
const legacyLogModel = legacyLogModelJs as unknown as typeof logModel;
const legacyLogTime = legacyLogTimeJs as unknown as typeof logTime;
const legacyZoomSteps = legacyZoomStepsJs as unknown as typeof zoomSteps;

// ── The machinery ────────────────────────────────────────────────────────────

// Any function: the whole point is to call them with arguments their types refuse.
type AnyFn = (...args: any[]) => unknown;

type Outcome = { returned: unknown } | { threw: string };

// What a call did: the value it returned, or the kind of error it threw (the message is the
// engine's wording and is not part of the contract).
function outcome(run: () => unknown): Outcome {
  try {
    return { returned: run() };
  } catch (error) {
    return { threw: error instanceof Error ? error.name : typeof error };
  }
}

// Every combination of one value from each list.
function product(...lists: readonly (readonly unknown[])[]): unknown[][] {
  return lists.reduce<unknown[][]>((rows, list) => rows.flatMap(row => list.map(item => [...row, item])), [[]]);
}

// A value as a person reading a failure can tell it apart (JSON would print NaN as null).
function show(value: unknown): string {
  if (value === undefined || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'symbol') {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// Calls both functions with every argument list and reports every disagreement at once.
function agree(name: string, mine: AnyFn, theirs: AnyFn, argLists: readonly (readonly unknown[])[]): void {
  test(`${name}: the same answer for ${argLists.length} odd inputs`, () => {
    const disagreements: string[] = [];
    for (const args of argLists) {
      const a = outcome(() => mine(...args));
      const b = outcome(() => theirs(...args));
      // Two answers that are the very same value (or the very same object) need no deep comparison:
      // skipping it only saves the time of the long lists of the pricing models.
      if ('returned' in a && 'returned' in b && Object.is(a.returned, b.returned)) continue;
      try {
        expect(a).toStrictEqual(b);
      } catch {
        disagreements.push(`${name}(${args.map(show).join(', ')}): ported ${show(a)} / current ${show(b)}`);
      }
    }
    expect(disagreements.slice(0, 10)).toStrictEqual([]);
  }, 60_000);
}

// The values every function is tried with, whatever it takes.
const ODD: readonly unknown[] = [
  undefined, null, 0, 1, -1, 0.5, NaN, Infinity, -Infinity, '', ' ', 'abc', '5', true, false,
  [], [1], ['a'], {}, { a: 1 },
];

// Fixed instants, local time, so nothing depends on when the suite runs.
const NOW = new Date(2026, 7, 14, 12, 0, 0).getTime();   // 14 Aug 2026, noon
const MIDNIGHT = new Date(2026, 7, 14, 0, 0, 0).getTime();
const LATE = new Date(2026, 7, 14, 23, 59, 59).getTime();
const NEXT_DAY = new Date(2026, 7, 15, 0, 0, 0).getTime();
const NOWS: readonly unknown[] = [NOW, MIDNIGHT, LATE, NEXT_DAY, 0, NaN];

// ── join-code ────────────────────────────────────────────────────────────────

describe('join-code: odd inputs', () => {
  const m = joinCode;
  const l = legacyJoinCode;

  const TYPED = [...ODD, ' 123 456 ', '123-456', '  aB3-_x  ', 'a'.repeat(32), 'a'.repeat(64), 'a'.repeat(65),
    '12345a', '１２３４５６', '123456\n', '12 34\t56'];
  const KINDS = [undefined, 'digits', 'link', 'other', null];
  agree('normalizeTyped', m.normalizeTyped, l.normalizeTyped, product(TYPED, KINDS));
  agree('isWellFormed', m.isWellFormed, l.isWellFormed, product(TYPED, KINDS));

  const live = { expiresAt: NOW + 60_000 };
  const CODE_DOCS = [...ODD, 'code', 42,
    { expiresAt: NOW + 1 }, { expiresAt: NOW }, { expiresAt: NOW - 1 }, { expiresAt: String(NOW + 60_000) },
    { expiresAt: new Date(NOW + 60_000) }, { expiresAt: null }, { expiresAt: '' }, { expiresAt: 'soon' },
    { expiresAt: NaN }, { expiresAt: Infinity }, { expiresAt: NOW + 40_000 }, { expiresAt: NOW + 59 * 60_000 },
    { expiresAt: NOW + 60 * 60_000 }, { expiresAt: NOW + 47 * 3_600_000 }, { expiresAt: NOW + 48 * 3_600_000 },
    { expiresAt: NOW + 7 * 24 * 3_600_000 },
    { ...live, usedAt: NOW - 1000 }, { ...live, usedAt: '' }, { ...live, usedAt: 0 }, { ...live, usedAt: null },
    { ...live, failedAttempts: 4 }, { ...live, failedAttempts: 5 }, { ...live, failedAttempts: '5' },
    { ...live, failedAttempts: NaN }, { ...live, failedAttempts: null }, { ...live, failedAttempts: [] },
    { ...live, usedAt: 1, failedAttempts: 9 }];
  agree('codeStatus', m.codeStatus, l.codeStatus, product(CODE_DOCS, NOWS));
  agree('isRedeemable', m.isRedeemable, l.isRedeemable, product(CODE_DOCS, NOWS));
  agree('expiresIn', m.expiresIn, l.expiresIn, product(CODE_DOCS, NOWS));

  const hourAgo = NOW - 1000;
  const RECORDS = [...ODD, 'record', 42, { attempts: [] }, { attempts: [hourAgo] },
    { attempts: Array(4).fill(hourAgo) }, { attempts: Array(5).fill(hourAgo) },
    { attempts: Array(5).fill(String(hourAgo)) }, { attempts: Array(6).fill(NOW) },
    { attempts: [NOW - 50 * 60_000, hourAgo, NOW - 900, NOW - 800, NOW - 700] },
    { attempts: ['soon', null, NaN, NOW + 60_000, hourAgo] },
    { attempts: [NOW - 3_600_000, NOW - 3_599_999, NOW] },
    { attempts: Array(5).fill(BigInt(hourAgo)) }, { attempts: Array(5).fill(true) },
    { attempts: 'lots' }, { attempts: null }, { attempts: { length: 5 } }];
  agree('recentAttempts', m.recentAttempts, l.recentAttempts, product(RECORDS, NOWS));
  agree('isRateLimited', m.isRateLimited, l.isRateLimited, product(RECORDS, NOWS));
  agree('retryAfterMs', m.retryAfterMs, l.retryAfterMs, product(RECORDS, NOWS));

  const STATUSES = ['expired', 'used', 'locked', 'missing', 'rate-limited', 'already-member', 'digits-paused',
    '', 'ok', 'x', undefined, null, 5];
  const RETRIES = [undefined, 0, 1, 30_000, 60_000, 60_001, 9 * 60_000, NaN, -5, '5', null, Infinity];
  agree('redeemFailureText', m.redeemFailureText, l.redeemFailureText, product(STATUSES, RETRIES));
});

// ── push-model ───────────────────────────────────────────────────────────────

describe('push-model: odd inputs', () => {
  const m = pushModel;
  const l = legacyPushModel;

  const NUMBERS = [...ODD, 'soon', '1700000000000', NOW, NOW + 29_999, NOW + 30_000, NOW + 43_200_000,
    NOW + 43_200_001, NOW - 1, [5], new Date(NOW)];
  agree('isSchedulable', m.isSchedulable, l.isSchedulable, product(NUMBERS, NUMBERS));

  const TEXTS = [...ODD, '  padded  ', 'x'.repeat(300), 'y'.repeat(5000), 12, NOW, 'tab\there'];
  const BASE = { uid: 'u1', token: 'tok', fireAt: NOW + 60_000, title: 'Croissant', body: 'Add the butter', nowMs: NOW };
  const vary = (base: Record<string, unknown>, values: readonly unknown[]) =>
    Object.keys(base).flatMap(field => values.map(value => ({ ...base, [field]: value })));

  agree('buildTimerDoc', m.buildTimerDoc, l.buildTimerDoc,
    [[undefined], [null], [{}], [BASE], ...vary(BASE, TEXTS).map(input => [input])]);

  const TIMER = { uid: 'u1', token: 'tok', fireAt: NOW + 60_000, title: 'Croissant', body: 'B', active: true, createdAt: NOW };
  const TIMER_DOCS = [...ODD, 'timer', 42, TIMER, ...vary(TIMER, TEXTS)];
  const MOMENTS = [NOW, NOW + 60_000, NOW + 60_000 + m.MAX_LATE_MS, NOW + 60_000 + m.MAX_LATE_MS + 1,
    NOW + 59_999, NaN, undefined, 'x', null];
  agree('isValidTimerDoc', m.isValidTimerDoc, l.isValidTimerDoc, product(TIMER_DOCS, MOMENTS));
  agree('isStillDue', m.isStillDue, l.isStillDue, product(TIMER_DOCS, MOMENTS));
  agree('skipReason', m.skipReason, l.skipReason, product(TIMER_DOCS, MOMENTS));

  const LANGS = [undefined, null, 'en', 'it', 'zz', 'EN', 'constructor', '__proto__', 'toString', 'hasOwnProperty',
    '', 5, ['it'], {}];
  const NOTE = { title: 'Croissant', body: 'Add the butter' };
  agree('timerNotification', m.timerNotification, l.timerNotification,
    product([...ODD, 'note', 42, NOTE, ...vary(NOTE, TEXTS)], LANGS));

  const ORDER = { clientName: 'Bar Centrale', date: '2026-08-12' };
  agree('orderNotification', m.orderNotification, l.orderNotification,
    product([...ODD, 'order', 42, ORDER, ...vary(ORDER, TEXTS)], LANGS));

  const QUANTITIES = [...ODD, 'abc', 5, { a: 1 }, { a: 1, b: 2 }, { a: 0 }, ['x', 'y'], { length: 3 }];
  const REQUEST = { fromName: 'Marco', quantities: { a: 1 } };
  agree('orderRequestNotification', m.orderRequestNotification, l.orderRequestNotification,
    product(
      [...ODD, 'request', 42, REQUEST, ...vary(REQUEST, TEXTS), ...QUANTITIES.map(quantities => ({ fromName: 'M', quantities }))],
      [undefined, 'en', 'it', 'zz'],
      [undefined, null, '', 'Bakery', '  Bakery  ', 5, 'v'.repeat(200)],
    ));

  const KINDS = [...ODD, 'timer', 'order', 'orderRequest', 'nonsense', 'Order', 'toString', '__proto__'];
  agree('targetPage', m.targetPage, l.targetPage, product(KINDS));
  agree('cardForKind', m.cardForKind, l.cardForKind, product(KINDS));
  agree('notificationTag', m.notificationTag, l.notificationTag, product(KINDS, TEXTS));
});

// ── home-cards ───────────────────────────────────────────────────────────────

describe('home-cards: odd inputs', () => {
  const m = homeCards;
  const l = legacyHomeCards;

  const ALL_IDS = [...m.HIDEABLE_IDS];
  const IDS = [...ODD, ...ALL_IDS, 'nothing', 'toString', '__proto__', 'constructor', 'hasOwnProperty', 'Orders'];
  const MAPS = [true, 'pastries', ['pastries'], 7, null, {}, { pastries: true }, { pastries: false },
    { pastries: 'true' }, { pastries: 1 }, { pastries: null }, { pastries: {} }, { orders: true },
    { foodcost: true }, { foodcost: false }, { foodcost: 'true' }, { inventory: true }, { toString: true },
    Object.create({ pastries: true }), Object.fromEntries(ALL_IDS.map(id => [id, true]))];
  const LOCATION_DOCS = [...ODD, 'corrupt', 42, { name: 'Bakery' },
    ...MAPS.map(map => ({ [m.HIDDEN_FIELD]: map })),
    ...MAPS.map(map => ({ [m.SHOWN_FIELD]: map })),
    { [m.HIDDEN_FIELD]: { calculator: true }, [m.SHOWN_FIELD]: { foodcost: true } }];

  agree('isHiddenForStaff', m.isHiddenForStaff, l.isHiddenForStaff, product(LOCATION_DOCS, IDS));
  agree('cardVisibleTo', m.cardVisibleTo, l.cardVisibleTo,
    product(LOCATION_DOCS, [true, false, undefined, null, 'true', 1, 0, {}], IDS));

  const ACCESS = [undefined, null, {}, 'map', new Map(),
    new Map<string, unknown>([['emp', true], ['mgr', 'manager'], ['own', 'owner'], ['typo', 'manager ']]),
    { get: () => 'owner' }, { get: () => undefined }, { get: 5 }];
  const UIDS = [...ODD, 'x', ['emp', 'mgr', 'own', 'typo', 'unread'], ['', null, undefined, 42], [42], ['emp', 'emp']];
  agree('mayBeTold', m.mayBeTold, l.mayBeTold, product(
    [null, {}, { [m.HIDDEN_FIELD]: { calculator: true } }, { [m.HIDDEN_FIELD]: { orders: true } },
      { [m.SHOWN_FIELD]: { foodcost: true } }],
    ['calculator', 'foodcost', 'orders', undefined, 'nope'],
    UIDS,
    ACCESS,
  ));

  const LISTS = [...ODD, 'orders', 42, ['orders', 'orders', 'nope', 7, null, 'calculator'], ALL_IDS,
    [...ALL_IDS, 'calculator'], ['orders'], ['pastries', 'orders'], [1], ['toString'], ['__proto__'],
    [...ALL_IDS].reverse(), ['calculator', undefined, 'orders']];
  agree('cleanOrder', m.cleanOrder, l.cleanOrder, product(LISTS));
  agree('isValidOrder', m.isValidOrder, l.isValidOrder, product(LISTS));

  const MARKUP = ['calculator', 'catalogue', 'orders', 'suppliers', 'pastries'];
  agree('orderedCardIds', m.orderedCardIds, l.orderedCardIds, product(
    [...ODD, 'corrupt', ...LISTS.map(list => ({ [m.ORDER_FIELD]: list }))],
    [undefined, null, [], ['a'], MARKUP, ['calculator', 'orders'], ['orders', 'orders', 'calculator'],
      ['foodcost', 'orders'], [undefined, 'orders'], 'abc', 5, {}],
  ));
});

// ── away-model ───────────────────────────────────────────────────────────────

describe('away-model: odd inputs', () => {
  const m = awayModel;
  const l = legacyAwayModel;

  const ISO = [...ODD, 42, '2026-08-14', '2026-08-15', '2026-08-13', '2026-02-31', '2026-13-01', '2026-00-10',
    '2026-04-31', '2024-02-29', '2025-02-29', '0050-01-01', '2026-8-14', ' 2026-08-14', '2026-08-14 ',
    '20/08/2026', 'friday', '9999-12-31', '0000-01-01', '2027-08-14', '2027-08-15', '2028-01-01'];

  agree('isAway', m.isAway, l.isAway, product([...ISO.map(until => ({ until })), 'until', 42], NOWS));
  agree('toISODate', m.toISODate, l.toISODate,
    product([NOW, MIDNIGHT, LATE, 0, -1, NaN, 8.64e15, 8.64e15 + 1, Infinity, '2026-08-14', new Date(NOW), null, undefined]));
  agree('daysBetween', m.daysBetween, l.daysBetween, product(ISO, ISO));
  agree('maxAwayDate', m.maxAwayDate, l.maxAwayDate, product(NOWS));

  const UIDS = [undefined, null, '', ' ', 'u1', ' u1 ', 0, 5, {}, 'x'.repeat(200)];
  agree('buildAwayDoc', m.buildAwayDoc, l.buildAwayDoc, [
    [undefined], [null], [{}], [{ now: NOW }],
    ...product(UIDS, [...ISO, '', null], [NOW, MIDNIGHT, NaN]).map(
      ([uid, until, now]) => [{ uid, until, now }]),
  ]);

  const AWAY_DOCS = [
    { uid: 'a', until: '2026-08-20' }, { uid: 'b', until: '2026-08-01' }, { uid: 'c', until: 'nonsense' },
    { uid: '', until: '2026-08-20' }, { until: '2026-08-20' }, { uid: 5, until: '2026-08-20' },
    { uid: 'd', until: '2026-08-14' }, null, undefined, 0, 'str',
  ];
  agree('awayUids', m.awayUids, l.awayUids, product(
    [undefined, null, [], AWAY_DOCS, AWAY_DOCS.slice(0, 3), 'abc', {}, 5],
    NOWS,
  ));

  const ROSTER = [
    { uid: 'u-own', role: 'owner', firstName: 'Anna', lastName: 'Rossi' },
    { uid: 'u-mgr', role: 'manager', firstName: 'Marco', lastName: 'Bianchi' },
    { uid: 'u-staff', role: 'staff', firstName: 'Sam', lastName: 'Baker' },
  ];
  const ROSTERS = [undefined, null, [], ROSTER, [{ uid: 'x', role: 'staff' }],
    [null, undefined, 0, {}, { uid: 'x' }, { uid: 'x', role: 'owner' }, { uid: 'y', role: 'manager' },
      { uid: 5, role: 'owner' }, 'str', { role: 'owner' }, { uid: 'z', role: 'Owner' }],
    'abc', {}];
  const AWAY_SETS = [undefined, null, new Set(), new Set(['u-mgr']), new Set(['u-own', 'u-mgr']),
    new Set(['x', 'y']), new Set([5]), { has: () => true }, { has: 5 }, []];
  const SENDERS = [undefined, null, 'u-own', 'u-staff', 'x', 5];
  agree('whoWillBeTold', m.whoWillBeTold, l.whoWillBeTold, product(ROSTERS, AWAY_SETS, SENDERS));
  agree('nobodyWillBeTold', m.nobodyWillBeTold, l.nobodyWillBeTold, product(ROSTERS, AWAY_SETS, SENDERS));
  agree('awayNames', m.awayNames, l.awayNames, product(ROSTERS, AWAY_SETS, SENDERS));

  agree('personName', m.personName, l.personName, product([...ODD, 'str', 5,
    { firstName: 'A' }, { firstName: ' A ', lastName: ' B ' }, { lastName: 'B' }, { email: ' e@x ' }, { uid: 'u' },
    { firstName: 5, lastName: 0 }, { firstName: '', email: 'e' }, { firstName: ['x'] }, { firstName: null, lastName: 'B' }]));
});

// ── allergen-model ───────────────────────────────────────────────────────────

describe('allergen-model: odd inputs', () => {
  const m = allergenModel;
  const l = legacyAllergenModel;

  const ALL_CODES = [...m.ALLERGEN_CODES];
  const CODES = [...ODD, ...ALL_CODES, ' milk', 'MILK', 'gluten', 'nuts', 'unicorn', 'toString', '__proto__', 5];
  agree('allergenLabel', m.allergenLabel, l.allergenLabel, product(CODES));
  agree('isAllergenCode', m.isAllergenCode, l.isAllergenCode, product(CODES));

  const RAW_LISTS = [...ODD, 'milk', 42, ['milk', 'unicorn', 'gluten-wheat'], ['milk', 'milk', ' milk '], ['MILK'],
    [null, undefined, 5, {}, []], ['milk', 5], ALL_CODES, [...ALL_CODES].reverse(), { 0: 'milk', length: 1 },
    new Set(['milk']), ['\tmilk\n'], [['milk']]];
  agree('normalizeAllergens', m.normalizeAllergens, l.normalizeAllergens, product(RAW_LISTS));
  agree('normalizeMayContain', m.normalizeMayContain, l.normalizeMayContain, product(RAW_LISTS));

  const STAMPS = [undefined, null, '', '  ', '2026-08-11', '  2026-08-11T09:00:00.000Z  ', 'x'.repeat(100), 0, 20260811,
    false, true, {}, [], new Date(0)];
  const ALLERGEN_VALUES = [undefined, [], ['milk'], ['unicorn'], 'milk', null, ['milk', 'eggs']];
  const INGREDIENTS = [...ODD, 'nope', 42, { name: 'Flour' },
    ...STAMPS.flatMap(stamp => ALLERGEN_VALUES.map(allergens => ({ allergens, allergensCheckedAt: stamp })))];
  agree('allergenState', m.allergenState, l.allergenState, product(INGREDIENTS));
  agree('checkedAt', m.checkedAt, l.checkedAt, product(INGREDIENTS));
  agree('isDeclared', m.isDeclared, l.isDeclared, product(INGREDIENTS));

  // Nutrient values nobody planned for: blanks, text, signs, exponents, other types.
  const AMOUNTS = [...ODD, '  ', '1e2', '0x10', ' 5 ', '-0', -0, 'Infinity', 1e309, '1000.5', '0.01', 0.01, '1,2',
    500, 99_999, 4000, 4001, 1000, 1001, 100, 100.0001, [5], [5, 6], new Date(5), 5n];
  const FULL = { kj: 1400, kcal: 330, fat: 1.2, saturates: 0.2, carbs: 70, sugars: 1.5, protein: 11, salt: 0.01 };
  const NUTRITIONS = [...ODD, 'str', 42, FULL, { ...FULL, kcal: undefined },
    ...Object.keys(FULL).flatMap(key => AMOUNTS.map(amount => ({ ...FULL, [key]: amount })))];
  agree('normalizeNutrition', m.normalizeNutrition, l.normalizeNutrition, product(NUTRITIONS));
  agree('hasFullNutrition', m.hasFullNutrition, l.hasFullNutrition,
    product([...ODD, 'str', 42, {}, ...NUTRITIONS.map(nutrition => ({ nutrition }))]));
  agree('missingNutrients', m.missingNutrients, l.missingNutrients,
    product([...ODD, 'str', 42, {}, ...NUTRITIONS.map(nutrition => ({ nutrition }))]));

  const BASE = { allergens: ['milk'], mayContain: ['milk', 'sesame'], checkedAt: '2026-08-11', nutrition: FULL, packIngredients: 'Farina' };
  const PACKS = [...ODD, 'Farina di GRANO tenero, acqua.', 'x'.repeat(5000), 'x'.repeat(4000), 'x'.repeat(4001), 0, 5];
  agree('buildAllergenFields', m.buildAllergenFields, l.buildAllergenFields, [
    [undefined], [null], [{}], [BASE],
    ...RAW_LISTS.map(allergens => [{ ...BASE, allergens }]),
    ...RAW_LISTS.map(mayContain => [{ ...BASE, mayContain }]),
    ...STAMPS.map(checkedAt => [{ ...BASE, checkedAt }]),
    ...NUTRITIONS.map(nutrition => [{ ...BASE, nutrition }]),
    ...PACKS.map(packIngredients => [{ ...BASE, packIngredients }]),
  ]);
});

// ── sections ─────────────────────────────────────────────────────────────────

describe('sections: odd inputs', () => {
  const m = sections;
  const l = legacySections;

  // `sections` fields and section names nobody planned for: stray spaces (invisible in the console),
  // the exact name beside a spaced one, names from the prototype chain, a value that is not a boolean.
  const SECTION_MAPS = [...ODD, 'corrupt', 42, { orders: false }, { orders: true }, { orders: 'no' }, { orders: 0 },
    { orders: null }, { 'orders ': false }, { ' orders': false }, { orders: true, 'orders ': false },
    { 'orders ': false, orders: true }, { calculator: false, catalogue: false, pastries: false, foodcost: false },
    { foodcost: false }, { 'foodcost ': false }, { invoices: false }, { toString: false },
    JSON.parse('{"__proto__":{"orders":false}}'), Object.create({ orders: false }),
    Object.fromEntries(m.SECTIONS.map(name => [name, false])), Object.fromEntries(m.SECTIONS.map(name => [name, true]))];
  const LOCATION_DOCS = [...ODD, 'corrupt', 42, { name: 'Bakery' },
    ...SECTION_MAPS.map(map => ({ sections: map })),
    ...SECTION_MAPS.map(map => ({ 'sections ': map })),
    { sections: { calculator: false }, 'sections ': { calculator: true } },
    { 'sections ': { calculator: true }, sections: { calculator: false } },
    Object.create({ sections: { orders: false } })];
  const SMALL_DOCS = [null, undefined, {}, { sections: null }, { sections: { foodcost: false } },
    { 'sections ': { 'foodcost ': false } },
    { sections: { orders: true, calculator: false, catalogue: false, pastries: false, foodcost: false } },
    { sections: 'yes' }, [], 'corrupt'];

  const NAMES = [...ODD, ...m.SECTIONS, 'invoices', 'toString', '__proto__', 'constructor', 'Orders', ' orders', 'orders '];
  const ROLES = [...ODD, 'owner', 'manager', 'staff', 'Owner', 'MANAGER', 'admin', 'head-chef', 'toString', '__proto__',
    ' manager', 'owner '];

  agree('allowedSections', m.allowedSections, l.allowedSections, product(LOCATION_DOCS));
  agree('isSectionAllowed', m.isSectionAllowed, l.isSectionAllowed, product(LOCATION_DOCS, NAMES));
  agree('sectionsFor', m.sectionsFor, l.sectionsFor, product(LOCATION_DOCS, ROLES));
  agree('isSectionAllowedFor', m.isSectionAllowedFor, l.isSectionAllowedFor, product(SMALL_DOCS, ROLES, NAMES));

  // `locations.<id>` values and ids nobody planned for: near-misses of the three accepted values, a
  // stray space or a slash in the id, an id one character past the limit, ids that sort oddly.
  const ACCESS_ODD = [true, false, 'manager', 'owner', 'Owner', 'owner ', ' manager', 'staff', 'admin', 'head-chef', 'true',
    0, 1, null, undefined, {}, [], ['owner'], NaN];
  const LOCATIONS_FIELDS = [...ODD, 'owner', 42, { bakery: 'owner' },
    ...ACCESS_ODD.map(value => ({ bakery: value })),
    { 'bakery ': 'owner' }, { ' bakery': true }, { 'bak ery': true }, { 'bakery/x': 'owner' }, { '': true },
    { '../x': 'manager' }, { 'bakery\n': true }, { ['a'.repeat(64)]: true }, { ['a'.repeat(65)]: true },
    { zeta: true, alfa: 'manager', main: 'owner' }, { '0': true, '-x': true, _x: true, Z: true, a: true },
    { bakery: true, restaurant: 'manager', 'loc-e015733e55e7': 'owner', 'bad id': true },
    JSON.parse('{"__proto__":{"bakery":"owner"}}'), Object.create({ bakery: 'owner' })];
  const USER_DOCS = [...ODD, 'corrupt', 42, { email: 'a@b.c' },
    ...LOCATIONS_FIELDS.map(locations => ({ locations })),
    { 'locations ': { bakery: true } }, Object.create({ locations: { bakery: true } })];
  const IDS = ['bakery', 'bakery ', ' bakery', '', undefined, null, 5, 'toString', '__proto__', 'constructor',
    'restaurant', 'main', 'Bakery', 'alfa', 'zeta'];

  agree('accessValue', m.accessValue, l.accessValue, product(USER_DOCS, IDS));
  agree('locationsOf', m.locationsOf, l.locationsOf, product(USER_DOCS));

  const REMEMBERED = [undefined, null, '', 'bakery', 'main', 'alfa', 'zeta', 'trattoria-x', 'nope', ' bakery', 5, {}, [], true];
  agree('pickLocation', m.pickLocation, l.pickLocation, product(USER_DOCS, REMEMBERED));

  // The three flags in every odd combination, with and without a remembered venue.
  const TWO = { locations: { main: 'owner', 'trattoria-x': 'owner' } };
  const START_DOCS = [null, undefined, {}, { locations: {} }, { locations: { main: true } }, TWO,
    { locations: { bakery: 'manager', restaurant: true } }, { locations: { 'bakery ': true } }, 'corrupt',
    { locations: 'owner' }, { locations: [] }, { locations: { main: 'Owner', 'trattoria-x': true } }];
  const FLAGS = [true, false, undefined, 'true', 1, 0, null, {}];
  const OPTIONS = [undefined, null, {}, 'text', 5,
    ...product(FLAGS, FLAGS, FLAGS).map(([isAppAdmin, hubPassed, pickVenue]) =>
      ({ isAppAdmin, hubPassed, pickVenue, remembered: 'main' })),
    ...REMEMBERED.map(remembered => ({ remembered })),
    ...REMEMBERED.map(remembered => ({ isAppAdmin: true, remembered })),
    ...REMEMBERED.map(remembered => ({ pickVenue: true, remembered })),
    ...REMEMBERED.map(remembered => ({ isAppAdmin: true, hubPassed: true, remembered }))];
  agree('pickStart', m.pickStart, l.pickStart, product(START_DOCS, OPTIONS));

  const OPTION_LISTS = [undefined, null, [], ['a'], ['a', 'b'], 'main', 42, {}, { length: 2 }, new Set(['a', 'b'])];
  agree('hasLevelAbove', m.hasLevelAbove, l.hasLevelAbove, [
    [], [undefined], [null], [{}], ['text'], [5],
    ...product(FLAGS, OPTION_LISTS).map(([isAppAdmin, options]) => [{ isAppAdmin, options }]),
  ]);
});

// ── firebase-target ──────────────────────────────────────────────────────────

describe('firebase-target: odd inputs', () => {
  const m = firebaseTarget;
  const l = legacyFirebaseTarget;

  // Hostnames nobody planned for: case, a trailing dot, ports, schemes, neighbours, an object or
  // an array that PRINTS as a production name. Any difference here would send real orders to the
  // wrong database from one of the two apps on the same origin.
  const HOSTS = [...ODD, 'federicomiano93.github.io', 'federicomiano93.github.io.', 'FEDERICOMIANO93.GITHUB.IO',
    'federicomiano93.github.io..', 'federicomiano93.github.io:443', 'https://federicomiano93.github.io',
    'www.federicomiano93.github.io', 'federicomiano93.github.io.evil.example', 'github.io',
    'localhost', 'localhost.', 'LOCALHOST', 'LOCALHOST.', ' localhost', 'localhost ', 'localhost:3000',
    '127.0.0.1', '127.0.0.1.', '127.0.0.2', '::1', '::1.', '[::1]', '[::1].', '0.0.0.0', '192.168.1.5',
    'mise-app-preview.web.app', 'mise-app-preview--pr-1-abc.web.app', 'MISE-APP-PREVIEW--PR7-ABC.WEB.APP.',
    'mise-app-preview--pr-244-vd70c50d.firebaseapp.com', 'bakery-app-ebf90.web.app', 'abc.ngrok.app', 'example.com',
    'İ.example', 'ｌｏｃａｌｈｏｓｔ', 'local\u0000host',
    { toString: () => 'localhost' }, { toString: () => 'federicomiano93.github.io' }, ['localhost'], ['a', 'b'],
    new String('localhost'), Symbol('x'), 5n, 0n, { toString() { throw new Error('boom'); } }];
  agree('isPreviewHost', m.isPreviewHost, l.isPreviewHost, product(HOSTS));
  agree('configForHost', m.configForHost, l.configForHost, product(HOSTS));
});

// ── local-data ───────────────────────────────────────────────────────────────

describe('local-data: odd inputs', () => {
  const m = localData;
  const l = legacyLocalData;

  const ACCOUNTS = [...ODD, 'u1', 'u2', 'U1', 'u1 ', ' u1', 5, '5', 'x'.repeat(200)];
  agree('offlineCacheVerdict', m.offlineCacheVerdict, l.offlineCacheVerdict, product(ACCOUNTS, ACCOUNTS));

  const PLACES = [...ODD, 'bakery', 'restaurant', 'Bakery', 'bakery ', ' bakery', 'loc-e015733e55e7', 'bakery/x', 5, '5'];
  agree('shouldClearLocalData', m.shouldClearLocalData, l.shouldClearLocalData, product(PLACES, PLACES));

  const KEY_LISTS = [...ODD, 'firebase:authUser',
    ['firebase:authUser:x', 'calculator-config', 'qty-ING1', 'kiosk-mode', 'usage-2026-10-11'],
    [...m.KEEP_PREFIXES], m.KEEP_PREFIXES.map(prefix => `${prefix}x`), m.KEEP_PREFIXES.map(prefix => `x${prefix}`),
    ['unknown'], [5, null, undefined, {}, ['firebase:'], 'a'], ['x-firebase:', 'Firebase:', 'ACTIVE-LOCATION', 'device'],
    [''], [' firebase:'], ['firebase:', 'firebase:'], Object.assign(['a', 'firebase:x'], { extra: 1 }), new Set(['a'])];
  const KEEP_LISTS = [undefined, [], ['a'], ['a-', 'b-'], [...m.KEEP_PREFIXES], [''], null, 'abc', 5, {}, [5], [null], ['A-']];
  agree('keysToClear', m.keysToClear, l.keysToClear, product(KEY_LISTS, KEEP_LISTS));

  // clearLocalData changes the storage it is given, so each implementation gets its own fresh
  // copy of the same stand-in; both the number returned and what is left must match.
  const removable = { removeItem(this: Record<string, unknown>, key: string) { delete this[key]; } };
  const unremovable = { removeItem() { throw new Error('blocked'); } };
  const DATA = () => ({
    'calculator-config': '{}', 'qty-ING1': '3', 'firebase:authUser:X:[DEFAULT]': 'token', 'device-id': 'abc', 'unknown-key': '1',
  });
  const STORES: readonly (readonly [string, () => unknown])[] = [
    ['null', () => null],
    ['zero', () => 0],
    ['an empty string', () => ''],
    ['false', () => false],
    ['an empty object', () => ({})],
    ['plain data with no removeItem', DATA],
    ['a storage like the real one', () => Object.assign(Object.create(removable), DATA())],
    ['a storage whose removeItem throws', () => Object.assign(Object.create(unremovable), DATA())],
    ['a storage that cannot be listed', () => new Proxy({}, { ownKeys() { throw new Error('blocked'); } })],
    ['a string', () => 'abc'],
    ['a number', () => 5],
    ['an array', () => ['calculator-config', 'x']],
    ['a storage with only kept keys', () => Object.assign(Object.create(removable), { 'firebase:authUser:X': 't', 'kiosk-mode': '1' })],
  ];
  const remaining = (store: unknown): unknown => {
    try {
      return typeof store === 'object' && store !== null ? Object.keys(store).sort() : null;
    } catch {
      return 'unreadable';
    }
  };

  test(`clearLocalData: the same count and the same keys left for ${STORES.length} odd storages`, () => {
    const disagreements: string[] = [];
    for (const [label, make] of STORES) {
      const mine = make();
      const theirs = make();
      const a = { result: outcome(() => m.clearLocalData(mine as never)), left: remaining(mine) };
      const b = { result: outcome(() => l.clearLocalData(theirs as never)), left: remaining(theirs) };
      try {
        expect(a).toStrictEqual(b);
      } catch {
        disagreements.push(`${label}: ported ${show(a)} / current ${show(b)}`);
      }
    }
    expect(disagreements).toStrictEqual([]);
  });
});

// ── Shared by the three telemetry models below ───────────────────────────────

// `base` with one field at a time replaced by each of that field's values.
const varying = (base: Record<string, unknown>, fields: Record<string, readonly unknown[]>): Record<string, unknown>[] =>
  Object.entries(fields).flatMap(([field, values]) => values.map(value => ({ ...base, [field]: value })));

// Something that is meant to be a Date, and things that are not. `undefined` is left out on
// purpose: the parameter defaults to the clock, and the clock is tried below with a fixed one.
const DATES: readonly unknown[] = [
  new Date(2026, 0, 5, 23, 59), new Date(2026, 9, 9, 0, 1), new Date(2026, 11, 31, 23, 59, 59), new Date(2024, 1, 29),
  new Date(NOW), new Date(0), new Date(NaN), new Date(8.64e15), new Date(-8.64e15), new Date(9999, 11, 31),
  new Date(12345, 0, 1), new Date(-1, 0, 1),
  ...ODD.filter(value => value !== undefined), 42, NOW, '2026-01-05',
  { getFullYear: () => 2026, getMonth: () => 0, getDate: () => 5 },
  { getFullYear: () => 'x', getMonth: () => NaN, getDate: () => undefined },
  Object.create(Date.prototype), new Proxy(new Date(NOW), {}),
];

const DEVICE_IDS: readonly unknown[] = [...ODD, 'Ab3dEf6hIj9lMn2pQr5t', 'AbCdEfGhIjKlMnOpQrSt', 'Dev1ce2Id3Abc4Def5Gh', '', 'short',
  'Ab3dEf6hIj9lMn2pQr5tX', 'Ab3dEf6hIj9lMn2pQr5', 'Ab3dEf6hIj9lMn2pQr5-', 'Ab3dEf6hIj9lMn2pQr5t\n', ' Ab3dEf6hIj9lMn2pQr5t',
  'Ab3dEf6hIj9lMn2pQr5ü', '０１２３４５６７８９０１２３４５６７８９', 'a'.repeat(20), '0'.repeat(20),
  new String('Ab3dEf6hIj9lMn2pQr5t')];
const KIND_VALUES: readonly unknown[] = [...ODD, 'phone', 'tablet', 'computer', 'fridge', 'Phone', 'phone ', ' tablet', 'watch',
  'toString', '__proto__', ['phone']];
const VERSIONS: readonly unknown[] = [...ODD, '649', '643', '1', 'x'.repeat(12), 'x'.repeat(13), '123456789012', '1234567890123',
  ' ', ' 649 ', 649, new String('649')];
const LONG_STACK = Array.from({ length: 30 }, (_, i) => `    at f${i} (a.js:${i}:1)`).join('\n');
const STACKS: readonly unknown[] = [...ODD, 'Error\n at x', 'a\r\nb\r\n', '   \n  \n', '\n\n\n', '  indented  \n trailing   \n',
  LONG_STACK,
  `Error\n${'x'.repeat(5000)}`, 'x'.repeat(2001), `${'x'.repeat(1999)}\ny`, new Error('with a real stack').stack, 12];
const CODES: readonly unknown[] = [...ODD, 'unavailable', 'permission-denied', ' padded ', 'c'.repeat(60), 'c'.repeat(61),
  `${'c'.repeat(60)} `, ' '.repeat(5), '\tx\n', 404, new Error('x')];

// ── error-model ──────────────────────────────────────────────────────────────

describe('error-model: odd inputs', () => {
  const m = errorModel;
  const l = legacyErrorModel;

  const ERR = Object.assign(new Error('Missing   or\n insufficient permissions.'), { code: 'permission-denied' });
  // Everything a window 'error', an 'unhandledrejection' or a console.error call could hand over.
  const CAUGHT: readonly unknown[] = [...ODD, 'text', 'a'.repeat(400), '  ', '\n', '[2026-10-09T10:00:01Z]  x', 42, ERR,
    new Error(''), new TypeError('x'),
    Object.assign(new Error('e'), { code: 'c'.repeat(61) }), Object.assign(new Error('e'), { code: ' spaced ' }),
    Object.assign(new Error('e'), { code: 404 }), { message: 'm' }, { message: 5 }, { message: '  ' },
    { message: 'a'.repeat(400) }, { stack: 'Error\n at a' }, { stack: 5 },
    { message: 'x', stack: LONG_STACK, code: 'unavailable' }, { message: 'x', code: 5 },
    { client: 'Mrs Rossi', total: 12 }, () => 1, function named() { return 1; }, Symbol('s'), 5n,
    new Date(NOW), /re/, Object.create(null), new Map(),
    { get message(): string { throw new Error('boom'); } }];

  const CONTEXTS = [undefined, {}, { filename: 'https://x.test/js/a.js' }, { filename: '' }, { filename: 5 }, { filename: null },
    { message: 'Script error.' }, { message: 5 }, { message: '' }, { message: null }, { message: '  spaced  ', filename: 'f.js' },
    null, 'text', 5];
  agree('recordFromError', m.recordFromError, l.recordFromError, product(CAUGHT, CONTEXTS));
  agree('recordFromRejection', m.recordFromRejection, l.recordFromRejection, product(CAUGHT));

  const ARG_LISTS: readonly unknown[] = [...ODD, 'text', 42, [ERR], ['saveLogDoc failed:', ERR],
    ['order', { client: 'Mrs Rossi', total: 12 }, 7], ['  ', '\n'], ['a'.repeat(400)],
    ['[2026-10-09T10:00:01.123Z]  @firebase/firestore: Firestore (10.7.1): Could not reach Cloud Firestore backend.'],
    ['saved at [2026-10-09T10:00:01Z]  ok'], [42, '[2026-10-09T10:00:01Z]  x'], ['[2026-10-09T10:00:01Z]'],
    ['[2026-10-09T10:00:01Z]  '], ['[2026-10-09T10:00:01Z]  [2026-10-09T10:00:02Z]  twice'],
    [ERR, 'second'], [null, undefined], [undefined, ERR], [() => 1, Symbol('s'), 5n], [, 'a'],
    ...CAUGHT.map(item => [item]), ...CAUGHT.map(item => ['first', item])];
  agree('recordFromConsole', m.recordFromConsole, l.recordFromConsole, product(ARG_LISTS));

  agree('trimStack', m.trimStack, l.trimStack, product(STACKS));
  agree('cleanCode', m.cleanCode, l.cleanCode, product(CODES));

  const TRACE = 'TypeError: x\n    at render (orders.js:10:2)\n    at other (b.js:1:1)';
  const SIGNED: readonly unknown[] = [...ODD, 'record', 42,
    { source: 'error', message: 'm'.repeat(200), stack: TRACE }, { source: 'console', message: 'x', stack: null },
    { source: 'error', message: 'x', stack: 'fn@https://a.test/x.js:1:1' }, { message: 'x' }, { source: 'error' },
    { source: 5, message: 5, stack: 5 }, { stack: 'no frame\njust text' }, { stack: '  at   spaced  \n' },
    { stack: `at ${'x'.repeat(300)}` }, { source: null }, { source: undefined, message: undefined }, { message: 0 },
    { message: '' }, { message: ['a'] }, { message: { toString: () => 'obj' } },
    { message: { toString() { throw new Error('boom'); } } }, { source: 'rejection', message: 'm', stack: 'x@y\nat z' },
    ...varying({ source: 'error', message: 'm', stack: TRACE }, { stack: STACKS, message: ['', 'x'.repeat(130), 7, null] })];
  agree('signature', m.signature, l.signature, product(SIGNED));

  const NOISY: readonly unknown[] = [...ODD, 'record', 42,
    { message: 'ResizeObserver loop limit exceeded' }, { message: 'ResizeObserver loop completed with undelivered notifications.' },
    { message: 'Script error.', stack: null }, { message: 'Script error.', stack: 'at x' }, { message: 'script error' },
    { message: '  SCRIPT ERROR.  ' }, { message: 'Script error..' }, { message: 'Script error.', stack: '' },
    { message: 'boom' }, { message: 'real problem', stack: 'at x' },
    ...[null, undefined, '', 5, 'chrome-extension://abc/content.js', 'https://app.test', 'https://app.test/',
      'https://app.test/js/a.js', 'https://app.test.evil.com/a.js', 'https://other.test/a.js', 'app.test', '/js/a.js',
      'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js', 'https://www.gstatic.com.evil.test/firebasejs/x.js',
      'https://www.gstatic.com/other/x.js', 'https://www.gstatic.com/firebasejs/', { toString: () => 'https://app.test/a.js' }]
      .map(filename => ({ message: 'boom', filename }))];
  const ORIGINS = [undefined, {}, { origin: 'https://app.test' }, { origin: 'https://app.test/' }, { origin: '' },
    { origin: null }, { origin: 5 }, { origin: 'app.test' }, { origin: ['https://app.test'] }, null, 'text', 5];
  agree('isNoise', m.isNoise, l.isNoise, product(NOISY, ORIGINS));

  const DAY = '2026-10-09';
  const MANY = Array.from({ length: 30 }, (_, i) => `s${i}`);
  const STATES: readonly unknown[] = [...ODD, 'text', 5, { day: DAY }, { day: DAY, count: 1, sigs: ['a'] },
    { day: DAY, count: -3, sigs: [1, 'a'] }, { day: DAY, count: 'many', sigs: 'no' }, { day: DAY, count: 500, sigs: [] },
    { day: DAY, count: 1.5, sigs: [] }, { day: DAY, count: NaN }, { day: DAY, count: Infinity },
    { day: DAY, count: 3, sigs: ['a'] }, { day: DAY, count: 0, sigs: ['a', 'b', 'c'] }, { day: DAY, sigs: MANY },
    { day: DAY, count: 30, sigs: MANY }, { day: DAY, count: 19, sigs: ['a'] }, { day: DAY, count: 20, sigs: ['a'] },
    { day: '2026-10-08', count: 5, sigs: ['a'] }, { day: DAY, sigs: [null, undefined, 5, 'x'] }, { day: DAY, count: 5n },
    { day: DAY, count: '5' }, { day: DAY, count: -0 }, { day: DAY, count: 2 ** 53 }, { day: DAY, sigs: { length: 2 } },
    { day: DAY, sigs: ['a', 'a'] }, { day: DAY, sigs: new Set(['a']) }, { day: DAY, sigs: [, 'a'] }, { day: undefined },
    { day: 5 }, Object.create({ day: DAY, count: 3 }), Object.assign(['a'], { day: DAY })];
  const TODAYS = [DAY, '2026-10-10', '', undefined, null, 5];
  agree('normaliseState', m.normaliseState, l.normaliseState, product(STATES, TODAYS));
  agree('shouldSend', m.shouldSend, l.shouldSend,
    product(STATES, ['sig-a', 'a', 'b', 's29', '', undefined, 5, null, 'x'.repeat(500)], TODAYS));

  const PATHS: readonly unknown[] = [...ODD, '/mise_app/orders.html', '/mise_app/', '/', '/mise_app/orders.HTML', '/mise_app/we ird.html',
    '/mise_app/orders', 'orders.html', 'index.html', '/a/b/c.html', '/a//', '/mise_app/orders.html.html', '/mise_app/ünï.html',
    `/mise_app/${'a'.repeat(100)}.html`, '/mise_app/a-b_c.html', '/mise_app/.html', 'C:\\x\\y.html',
    '/mise_app/orders.html?x=1', '/mise_app/orders.html#a', { toString: () => '/mise_app/orders.html' }, ['x.html'],
    Symbol('p'), 5n, Object.create(null)];
  const HASHES: readonly unknown[] = [...ODD, '', '#suppliers', '#Sam-Rossi', '#a-very-long-hash-that-may-be-a-token',
    '#a=b', '#', '#a', `#${'a'.repeat(20)}`, `#${'a'.repeat(21)}`, '#a b', '#-', 'suppliers', '#suppliers\n', '#ünï', '#a_b',
    new String('#suppliers')];
  agree('screenName', m.screenName, l.screenName, product(PATHS, HASHES));

  const RECORD = { source: 'console', message: 'boom', code: 'unavailable', stack: 'Error\n at x', filename: 'secret.js' };
  const WHO = { screen: 'orders', appVersion: '649', deviceId: 'Dev1ce2Id3Abc4Def5Gh', kind: 'tablet', online: true };
  const RECORDS: readonly unknown[] = [...ODD, 'record', 42, RECORD, { source: 'log', message: 'x' }, { source: 'error', message: '' },
    { source: 'error', message: 5 }, { source: 'error', message: 'm'.repeat(400) }, { source: 'rejection', message: 'x', code: 5, stack: 5 },
    { source: 'toString', message: 'x' }, { source: ['error'], message: 'x' }, { source: 'Error', message: 'x' },
    { source: 'error ', message: 'x' }, { source: 'error', message: new String('x') },
    ...varying(RECORD, { source: ['error', 'rejection', 'console', ...ODD], message: ['x', ' spaced ', ...ODD, 'm'.repeat(300), 'm'.repeat(301)],
      code: CODES, stack: STACKS })];
  agree('errorPayload', m.errorPayload, l.errorPayload, [
    [], [undefined], [null], [RECORD, null], [RECORD, 'text'], [RECORD, 5],
    ...product(RECORDS, [undefined, {}, WHO]),
    ...varying(WHO, {
      screen: [...ODD, 'orders', 's'.repeat(60), 's'.repeat(61), ' '],
      appVersion: VERSIONS,
      deviceId: DEVICE_IDS,
      kind: KIND_VALUES,
      online: [...ODD, true, 'true', 1],
    }).map(who => [RECORD, who]),
  ]);
});

// ── device-model ─────────────────────────────────────────────────────────────

describe('device-model: odd inputs', () => {
  const m = deviceModel;
  const l = legacyDeviceModel;

  // Sides and pointers nobody planned for: the 600 edge, text that reads as a number, signs, other
  // types, a value that cannot be turned into a number at all.
  const SIDES: readonly unknown[] = [...ODD, 360, 599, 599.9, 600, 600.1, 800, 1024, 1920, '600', ' 600 ', '0x258', '1e3', -600,
    [600], [], new Date(600), 600n, Symbol('side')];
  const COARSE = [...ODD, 'coarse', 'false', 1];
  agree('deviceKind', m.deviceKind, l.deviceKind, [[], [undefined], [null], ['text'], [5],
    ...product(SIDES, SIDES, COARSE).map(([width, height, coarse]) => [{ width, height, coarse }]),
    ...product(SIDES, COARSE).map(([width, coarse]) => [{ width, coarse }]),
    ...product(SIDES, COARSE).map(([height, coarse]) => [{ height, coarse }])]);

  const BYTES: readonly unknown[] = [...ODD, 'abc', 'a'.repeat(30), Uint8Array.from({ length: 64 }, (_, i) => (i * 3) % 256),
    new Uint8Array(64).fill(255), new Uint8Array(20), new Uint8Array(19), new Uint8Array(21),
    [255, 250, 248, ...Array(20).fill(0)], [1, 2, 3], Array(20).fill(247), Array(20).fill(248), Array(20).fill(61),
    Array(20).fill(62), Array(25).fill(-1), Array(20).fill(1.5), Array(20).fill('1'), Array(20).fill(NaN),
    Array(40).fill(null), Array(30), { length: 20 }, { length: 30, 0: 5 }, { length: '20' },
    Array.from({ length: 20 }, (_, i) => i), Array.from({ length: 64 }, (_, i) => i * 4),
    Float64Array.from({ length: 30 }, (_, i) => i * 2), new Set([1]), new Map(), Array(30).fill(5n), Array(30).fill(true)];
  agree('newDeviceId', m.newDeviceId, l.newDeviceId, product(BYTES));
  agree('isValidDeviceId', m.isValidDeviceId, l.isValidDeviceId, product(DEVICE_IDS));

  agree('localDayKey', m.localDayKey, l.localDayKey, product(DATES));

  // The default is the clock, so it is tried with a fixed one: the day just before midnight.
  test('localDayKey: the same answer with no date, at a fixed clock', () => {
    vi.useFakeTimers();
    try {
      for (const now of [new Date(2026, 9, 9, 23, 59, 59), new Date(2026, 0, 1, 0, 0, 0), new Date(2024, 1, 29, 12)]) {
        vi.setSystemTime(now);
        expect(outcome(() => m.localDayKey())).toStrictEqual(outcome(() => l.localDayKey()));
      }
    } finally {
      vi.useRealTimers();
    }
  });

  // Sessions nobody planned for: not ready, no venue, no person, a person without a uid, the right
  // shape with the wrong types.
  const READY = { status: 'ready', locationId: 'bakery', user: { uid: 'u1' } };
  const SESSIONS: readonly unknown[] = [...ODD, 'session', 42, READY, { ...READY, user: { uid: 'u1', email: 'a@b.c' } },
    ...varying(READY, {
      status: [...ODD, 'loading', 'ready ', 'Ready', 'signed-out'],
      locationId: [...ODD, 'restaurant', ' bakery', 'bakery ', 'Bakery', 'loc-e015733e55e7', new String('bakery')],
      user: [...ODD, {}, { uid: '' }, { uid: 'u2' }, { uid: 5 }, { uid: 0 }, { uid: ' u1' }, { uid: 'U1' }, { uid: ['u1'] }, 'u1'],
    })];
  agree('sameSession', m.sameSession, l.sameSession, product(SESSIONS, SESSIONS));

  const STAMPS: readonly unknown[] = [...ODD, '2026-10-09', '2026-10-08', '2026-10-09 ', 20261009, new Date(NOW), '20261009'];
  const KEYS: readonly unknown[] = [...ODD, '2026-10-09', '2026-10-08', '2026-1-9', '2026-10-09\n', ' 2026-10-09', '２０２６-10-09',
    '2026-10-09T10:00', '0000-00-00', '9999-99-99', '2026/10/09', new String('2026-10-09')];
  agree('dueToday', m.dueToday, l.dueToday, product(STAMPS, KEYS));

  const FACTS = { locationId: 'bakery', uid: 'u1', kind: 'tablet', appVersion: '643', installed: true };
  agree('devicePayload', m.devicePayload, l.devicePayload, [
    [], [undefined], [null], [{}], ['text'], [5], [FACTS], [{ ...FACTS, email: 'a@b.c', name: 'X' }],
    ...varying(FACTS, {
      locationId: [...ODD, 'restaurant', 'x'.repeat(200), 'a/b', 'loc-e015733e55e7', ' bakery', new String('bakery')],
      uid: [...ODD, 'u2', ' u1 ', 'x'.repeat(200), new String('u1')],
      kind: KIND_VALUES,
      appVersion: VERSIONS,
      installed: [...ODD, true, 'true', 'yes', 1, new Boolean(true)],
    }).map(facts => [facts]),
  ]);
});

// ── usage-model ──────────────────────────────────────────────────────────────

describe('usage-model: odd inputs', () => {
  const m = usageModel;
  const l = legacyUsageModel;

  agree('newAcc', m.newAcc, l.newAcc, [[], [undefined], [{ screens: { orders: 1 } }], ['text']]);

  // Accumulators to start from. The functions that change one are given a FRESH copy per
  // implementation, and both the answer and what is left in it must match: caps (a map one short
  // of full sends a new key to 'other'), damaged numbers, a frozen object, and things that are not
  // an accumulator at all.
  const counts = (size: number, key: (i: number) => string): Record<string, number> =>
    Object.fromEntries(Array.from({ length: size }, (_, i) => [key(i), 1]));
  const emptyAcc = (): Record<string, unknown> => ({
    screens: {}, seconds: {}, taps: {}, routes: {}, actions: {}, loads: {}, loadMs: {},
    firstMinute: null, lastMinute: null, offlineSeconds: 0,
  });
  const nearlyFull = (): Record<string, unknown> => ({
    ...emptyAcc(),
    screens: counts(79, i => `p${i}`), seconds: counts(79, i => `p${i}`), taps: counts(79, i => `p${i}`),
    routes: counts(299, i => `s${i}>t${i}`), actions: counts(39, i => `act-${i}`),
    loads: counts(19, i => `pg${i}`), loadMs: counts(19, i => `pg${i}`),
  });
  const ACC_MAKERS: readonly (readonly [string, () => unknown])[] = [
    ['empty', emptyAcc],
    ['already counting', () => ({
      ...emptyAcc(), screens: { orders: 3, index: 1 }, seconds: { orders: 30 }, taps: { orders: 2 },
      routes: { 'index>orders': 2, other: 1 }, actions: { 'order-sent': 2 }, loads: { orders: 4 }, loadMs: { orders: 4000 },
    })],
    ['every map one short of its cap', nearlyFull],
    ['every map one short of its cap, with other', () => {
      const acc = nearlyFull();
      for (const name of ['screens', 'seconds', 'taps', 'routes', 'actions', 'loads', 'loadMs']) {
        (acc[name] as Record<string, number>).other = 5;
      }
      return acc;
    }],
    ['minutes and offline set', () => ({ ...emptyAcc(), firstMinute: 100, lastMinute: 200, offlineSeconds: 86399 })],
    ['offline at the ceiling', () => ({ ...emptyAcc(), offlineSeconds: 86400 })],
    ['minutes at the edges', () => ({ ...emptyAcc(), firstMinute: 0, lastMinute: 1439 })],
    ['damaged counts', () => ({
      ...emptyAcc(), screens: { orders: 'x', index: undefined, nul: null }, seconds: { orders: 'x' }, taps: { orders: NaN },
      routes: { 'a>b': 'x' }, actions: { 'order-sent': undefined }, loads: { orders: 'x' }, loadMs: { orders: null },
    })],
    ['damaged minutes and offline', () => ({ ...emptyAcc(), firstMinute: 'x', lastMinute: undefined, offlineSeconds: 'lots' })],
    ['offline undefined', () => ({ ...emptyAcc(), offlineSeconds: undefined })],
    ['frozen', () => Object.freeze(emptyAcc())],
    ['maps missing', () => ({})],
    ['maps null', () => ({ ...emptyAcc(), screens: null, routes: null })],
    ['null', () => null],
    ['undefined', () => undefined],
    ['a string', () => 'text'],
    ['a number', () => 5],
    ['an array', () => []],
  ];

  type AnyAccFn = (...args: any[]) => unknown;
  function agreeOnAcc(name: string, mine: AnyAccFn, theirs: AnyAccFn, argLists: readonly (readonly unknown[])[]): void {
    test(`${name}: the same answer and the same accumulator for ${argLists.length} odd inputs on ${ACC_MAKERS.length} accumulators`, () => {
      const disagreements: string[] = [];
      for (const [label, make] of ACC_MAKERS) {
        for (const args of argLists) {
          const accMine = make();
          const accTheirs = make();
          const a = { result: outcome(() => mine(accMine, ...args)), acc: accMine };
          const b = { result: outcome(() => theirs(accTheirs, ...args)), acc: accTheirs };
          try {
            expect(a).toStrictEqual(b);
          } catch {
            disagreements.push(`${name}(${label}, ${args.map(show).join(', ')}): ported ${show(a)} / current ${show(b)}`);
          }
        }
      }
      expect(disagreements.slice(0, 10)).toStrictEqual([]);
    }, 60_000);
  }

  // Names nobody planned for: the regex edges, case, spaces, a trailing newline, a name already in
  // the full map's keys, names that sit on the prototype chain, other types.
  const NAMES: readonly unknown[] = [...ODD, 'orders', 'orders:supplier', 'Orders', 'a'.repeat(40), 'a'.repeat(41), 'has space',
    'orders\n', ' orders', 'a-b:c-9', '-', ':', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'other', 'ünï',
    'new-screen', 'p0', 'p78', 'index', 42, Symbol('name'), new String('orders')];
  const SHORT_NAMES = [undefined, null, 42, '', 'orders', 'Orders', 'bad name', 'a'.repeat(41), 'new-screen', 'other', 'p0'];
  agreeOnAcc('addScreen', m.addScreen, l.addScreen, product(NAMES));
  agreeOnAcc('addTap', m.addTap, l.addTap, product(NAMES));

  const ENDS: readonly unknown[] = [...ODD, 'index', 'orders', 'orders:supplier', 'Bad Name', 'a'.repeat(40), 'a'.repeat(41), '-',
    'a>b', 'a>', '>b', 'x\n', 's0', 't0', 'new-screen', 'other', 5];
  agreeOnAcc('addRoute', m.addRoute, l.addRoute, product(ENDS, ENDS));

  // Amounts nobody planned for: halves (Math.round), signs, exponents, text, other types, and one
  // that cannot be turned into a number at all.
  const AMOUNTS: readonly unknown[] = [...ODD, 14.6, 14.5, 15.5, 0.4, 0.5, -0.5, -5, 1e21, 1e309, '15', ' 15 ', '1e2', '0x10',
    '1,5', 30.4, 999999, 86399, 86400, 86401, 2 ** 53, [5], [5, 6], new Date(5), 5n, new Number(7), Symbol('amount')];
  agreeOnAcc('addSeconds', m.addSeconds, l.addSeconds, product(SHORT_NAMES, AMOUNTS));
  agreeOnAcc('addLoad', m.addLoad, l.addLoad, product(SHORT_NAMES, [...AMOUNTS, 59999, 60000, 60001, 1200.4]));
  agreeOnAcc('addOffline', m.addOffline, l.addOffline, product(AMOUNTS));

  const ACTIONS: readonly unknown[] = [...ODD, 'order-sent', 'Order-Sent', '1st', 'has space', 'a'.repeat(40), 'a'.repeat(41), 'a',
    'a-', '-a', 'act-0', 'act-38', 'new-action', 'other', 'a_b', 'a\n', 5];
  agreeOnAcc('addAction', m.addAction, l.addAction, product(ACTIONS));

  const MOMENTS: readonly unknown[] = [...ODD, new Date(2026, 9, 9, 10, 30), new Date(2026, 9, 9, 7, 5), new Date(2026, 9, 9, 23, 59),
    new Date(2026, 9, 9, 0, 0), new Date(2026, 9, 9, 0, 1), new Date('nope'), new Date(NaN), { getTime: () => 1 }, NOW,
    '2026-10-09', Object.create(Date.prototype), new Proxy(new Date(NOW), {})];
  agreeOnAcc('touchMinute', m.touchMinute, l.touchMinute, product(MOMENTS));

  // What a stored accumulator could have turned into, one field at a time and a few together.
  const MAP_NAMES = ['screens', 'seconds', 'taps', 'routes', 'actions', 'loads', 'loadMs'];
  const MAP_VALUES: readonly unknown[] = [null, undefined, 'text', 5, true, [], ['orders'], [1, 2], {}, { orders: 1 }, { orders: '2' },
    { orders: -1 }, { orders: 0.4 }, { orders: 2.5 }, { orders: NaN }, { orders: Infinity }, { orders: null }, { orders: [3] },
    { 'a>b': 1, other: 2 }, { other: 3 }, { 'BAD KEY': 1 }, { 'new-key': 1, 'a>b': 1, 'order-sent': 1 }, { constructor: 1 },
    JSON.parse('{"__proto__":{"orders":1}}'), Object.create({ orders: 5 }), counts(100, i => `p${i}`),
    counts(400, i => `s${i}>t${i}`), counts(50, i => `act-${i}`), counts(25, i => `pg${i}`)];
  const MINUTES: readonly unknown[] = [...ODD, 0, 1, 7, 480, 1020, 1439, 1440, -1, 100.5, '100', 570, 2 ** 31, new Date(0)];
  const GOOD_EXTRA = {
    screens: { orders: 2, index: 1 }, seconds: { orders: 30 }, taps: { orders: 2 }, routes: { 'index>orders': 2 },
    actions: { 'order-sent': 1 }, loads: { orders: 4 }, loadMs: { orders: 4000 }, firstMinute: 480, lastMinute: 1020, offlineSeconds: 20,
  };
  const DIRTY_EXTRA = {
    screens: { ok: 3, 'BAD KEY': 5, neg: -2, nan: 'x', frac: 2.6 }, routes: { 'a>b': 1, nothing: 4, other: 2 },
    actions: { 'good-one': 1, Bad: 2 }, firstMinute: 1440, lastMinute: -3, offlineSeconds: 'lots', extra: { whatever: 1 },
  };
  const EXTRAS: readonly unknown[] = [...ODD, 'junk', 42, GOOD_EXTRA, DIRTY_EXTRA, emptyAcc(),
    ...MAP_NAMES.flatMap(name => MAP_VALUES.map(value => ({ [name]: value }))),
    ...MINUTES.map(firstMinute => ({ firstMinute })), ...MINUTES.map(lastMinute => ({ lastMinute })),
    ...MINUTES.map(firstMinute => ({ firstMinute, lastMinute: 1000 })), ...MINUTES.map(lastMinute => ({ firstMinute: 100, lastMinute })),
    ...AMOUNTS.map(offlineSeconds => ({ offlineSeconds }))];
  agreeOnAcc('mergeAcc', m.mergeAcc, l.mergeAcc, product(EXTRAS));
  agree('cleanAcc', m.cleanAcc, l.cleanAcc, product(EXTRAS));

  agree('isEmptyAcc', m.isEmptyAcc, l.isEmptyAcc, [
    ...ACC_MAKERS.map(([, make]) => [make()]),
    ...[GOOD_EXTRA, DIRTY_EXTRA, ...MAP_NAMES.map(name => ({ [name]: { orders: 1 } }))].map(extra => [m.cleanAcc(extra)]),
    ...ODD.map(value => [value]), [], ['text'], [5],
  ]);

  agree('dayKeyOf', m.dayKeyOf, l.dayKeyOf, product(DATES));
  test('dayKeyOf: the same answer with no date, at a fixed clock', () => {
    vi.useFakeTimers();
    try {
      for (const now of [new Date(2026, 9, 9, 23, 59, 59), new Date(2026, 0, 1, 0, 0, 0), new Date(2024, 1, 29, 12)]) {
        vi.setSystemTime(now);
        expect(outcome(() => m.dayKeyOf())).toStrictEqual(outcome(() => l.dayKeyOf()));
      }
    } finally {
      vi.useRealTimers();
    }
  });

  const DAY_KEYS: readonly unknown[] = [...ODD, '20261009', '2026-10-09', '19991231', '20000101', '20991231', '2100010', '201234567',
    '20261009\n', '2026100', '202610090', ' 20261009', '２０２６１００９', new String('20261009')];
  const UIDS: readonly unknown[] = [...ODD, 'u1', 'a/b', 'x'.repeat(128), 'x'.repeat(129), 'ABC123', 'u-1', 'u_1', 'u1\n', ' u1',
    new String('u1')];
  agree('docId', m.docId, l.docId, product(DEVICE_IDS, DAY_KEYS, UIDS));

  const WHO = { deviceId: 'AbCdEfGhIjKlMnOpQrSt', dayKey: '20261009', kind: 'phone', appVersion: '649' };
  const ACC_VALUES: readonly unknown[] = [...ODD, 'junk', 42, ...ACC_MAKERS.map(([, make]) => make()), GOOD_EXTRA, DIRTY_EXTRA,
    ...MAP_NAMES.map(name => ({ [name]: { 'a>b': 1, orders: 2, 'order-sent': 3, other: 4, 'BAD KEY': 5 } })),
    { ...GOOD_EXTRA, firstMinute: 1000, lastMinute: 100 }, { ...GOOD_EXTRA, offlineSeconds: 99999 }];
  agree('payloadOf', m.payloadOf, l.payloadOf, [
    ...product(ACC_VALUES, [undefined, {}, null, 'text', 5, WHO]),
    ...varying(WHO, { deviceId: DEVICE_IDS, dayKey: DAY_KEYS, kind: KIND_VALUES, appVersion: VERSIONS })
      .flatMap(who => [[GOOD_EXTRA, who], [emptyAcc(), who]]),
    ...ACC_VALUES.map(acc => [acc, WHO]),
  ]);
});

// ── Shared by the three Pastries models below ────────────────────────────────

const localMs = (y: number, month: number, day: number, hour = 12, minute = 0): number =>
  new Date(y, month, day, hour, minute).getTime();

// Moments nobody planned for: the 4am edge on both sides, both clock-change Sundays (the work day is
// the thing that goes wrong there), the first and last instants a Date can hold and the ones just
// outside them, and values that are not a number but read as one.
const PASTRY_MOMENTS: readonly unknown[] = [...ODD, ...NOWS,
  localMs(2026, 7, 4, 0, 30), localMs(2026, 7, 4, 3, 59), localMs(2026, 7, 4, 4, 0), localMs(2026, 7, 4, 23, 30),
  localMs(2026, 7, 9, 22), localMs(2026, 7, 10, 1), localMs(2026, 9, 25, 3, 30), localMs(2026, 9, 25, 4, 30),
  localMs(2026, 2, 29, 3, 30), localMs(2026, 2, 29, 4, 30), localMs(2026, 11, 31, 23, 59), localMs(2024, 1, 29, 3, 59),
  1, 86_399_999, 8.64e15 - 3_600_000, 8.64e15, 8.64e15 + 1, -8.64e15, -8.64e15 - 1, -1, NOW + 0.5,
  '1700000000000', ' 1700000000000 ', '1e12', '0x10', 'yesterday', new Date(NOW), new Date(NaN), [NOW], [NOW, NOW],
  new Number(NOW), { valueOf: () => NOW }, 5n, Symbol('now')];

const PASTRY_DAY_NAMES: readonly unknown[] = [...ODD, ...pastriesModel.WEEKDAYS, ...pastriesModel.WEEKDAY_SHORT, 'monday',
  'MONDAY', 'Monday ', ' Monday', 'Funday', '2026-08-05', 'toString', '__proto__', 'constructor', 'length', 0, 6, 7,
  new String('Monday'), ['Monday'], { toString: () => 'Monday' }];

const PASTRY_NOTES: readonly unknown[] = [...ODD, 'slow proof', '  spaced  ', 'a\nb', '  a\n  b  \n', '\n\n', 'x'.repeat(499),
  'x'.repeat(500), 'x'.repeat(501), 'x'.repeat(900), ` ${'x'.repeat(500)}`, 42, new String('x'), { toString: () => 'x' }, ['x']];

// Lists of rows nobody planned for: rows that are not rows, blank and padded names, quantities of every
// kind, names at and past the limit, the caps either side, a frozen list, a list with a hole in it.
const PASTRY_NUMBERS = (count: number): { name: string; qty: number }[] =>
  Array.from({ length: count }, (_, i) => ({ name: `P${i}`, qty: 1 }));
const PASTRY_QUANTITIES: readonly unknown[] = [0, '', null, undefined, 'abc', -3, 1e999, -1e999, NaN, 0.4, 0.5, 1.5, 24, '24',
  ' 24 ', '1e2', '0x10', '1,5', 9999, 10000, 50000, '9999', '1e4', [5], [5, 6], {}, true, false, new Date(5), 5n,
  new Number(7), { valueOf: () => 7 }];
const PASTRY_ROW_LISTS: readonly unknown[] = [...ODD, 'Cornetti', 42,
  [{ name: 'Cornetti', qty: 24 }, { name: 'Bomboloni', qty: 10 }],
  [{ name: '  Cornetti  ', qty: '24' }, { name: '', qty: '' }, { name: ' cornetti ', qty: 3 }],
  [{ name: 'Cornetti', qty: 12 }, { name: 'Cornetti integrali', qty: 6 }, { name: 'CORNETTI', qty: 1 }],
  [{ name: 'Cornetti', qty: 24 }, { name: '', qty: '' }, { name: '   ', qty: '' }],
  [1, 'Cornetti', null, undefined, [], { name: 'Bomboloni', qty: 10 }, { qty: 5 }, {}, true, 7n],
  ...PASTRY_QUANTITIES.map(qty => [{ name: 'Cornetti', qty }]),
  ...[5, null, undefined, '', ' ', 'x'.repeat(79), 'x'.repeat(80), 'x'.repeat(81), 'x'.repeat(300), ` ${'x'.repeat(80)} `,
    ['a'], new String('a'), { toString: () => 'a' }, 'ünï', 'Pain au chocolat'].map(name => [{ name, qty: 1 }]),
  [function named() { return 1; }], [new String('a')], [new Date(5)], [[{ name: 'nested', qty: 1 }]],
  [{ name: 'Cornetti', qty: 24, extra: true, id: 'x' }], PASTRY_NUMBERS(99), PASTRY_NUMBERS(100), PASTRY_NUMBERS(101),
  PASTRY_NUMBERS(300), Object.freeze([{ name: 'Cornetti', qty: 24 }]),
  [{ name: 'Cornetti', qty: 24 }, , { name: 'Bomboloni', qty: 10 }],
  { length: 1, 0: { name: 'Cornetti', qty: 24 } }, new Set([{ name: 'Cornetti', qty: 24 }])];

const PASTRY_DAY_DOCS: readonly unknown[] = [...ODD, 'doc', 42,
  ...PASTRY_ROW_LISTS.map(items => ({ items })), ...PASTRY_NOTES.map(note => ({ note })),
  { items: [{ name: 'Cornetti', qty: 24 }], note: 'slow proof' }, { day: 'Friday' }, { day: 'friday' }, { day: 5 },
  { day: 'Friday', items: [{ name: 'Cornetti', qty: 24 }] }, { id: 'Monday', day: 'Friday', items: [{ name: 'a', qty: 1 }] },
  Object.create({ items: [{ name: 'Cornetti', qty: 24 }], note: 'inherited' })];

const PASTRY_ISO_DAYS: readonly unknown[] = [...ODD, 42, '2026-08-05', '2026-08-04', '2026-08-14', '2026-08-20', '2026-02-31',
  '2026-02-29', '2028-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-8-5', '05-08-2026', ' 2026-08-05', '2026-08-05 ',
  '2026-08-05\n', '0050-01-01', '0000-01-01', '0099-12-31', '0100-01-01', '1900-02-29', '2000-02-29', '9999-12-31',
  '１２３４-０１-０１', '2026-08-05T00:00:00Z', new String('2026-08-05'), new Date(NOW)];

const PASTRY_LOG_DOCS: readonly unknown[] = [...PASTRY_DAY_DOCS,
  ...['2026-08-05T20:00:00.000Z', '', 5, null, ['x'], new String('x')].map(createdAt => ({ createdAt })),
  { date: '2026-01-01', day: 'Friday', items: [] }, { date: 'rubbish', day: 'Nonday' }, { date: '2026-02-31', day: 'Funday' },
  ...PASTRY_ISO_DAYS.map(date => ({ date, day: 'Monday' })), ...PASTRY_DAY_NAMES.map(day => ({ date: '2026-08-05', day })),
  { id: '2026-08-05_Wednesday', date: '2026-01-01', day: 'Friday', items: [], note: 'n', createdAt: '2026-08-05T20:00:00.000Z' }];

const PASTRY_LOG_IDS: readonly unknown[] = [undefined, null, '', ' ', '2026-08-05_Wednesday', '2026-08-05_Wednesday_extra',
  '2026-02-31_Monday', '2026-08-05_Funday', '2026-08-05', '_Monday', 'Monday', 'rubbish', 'a_b_c', '2026-8-5_Monday',
  ' 2026-08-05_Monday', '2026-08-05_Monday ', '2026-08-05_monday', 5, {}, ['2026-08-05_Monday'], new String('2026-08-05_Monday')];

// ── pastries-model ───────────────────────────────────────────────────────────

describe('pastries-model: odd inputs', () => {
  // A partial port: only what it exports is compared (weekdayLabel and weekdayShortLabel stay in js/).
  const m = pastriesModel;
  const l = legacyPastriesModel;

  agree('isWeekday', m.isWeekday, l.isWeekday, product(PASTRY_DAY_NAMES));
  agree('nextWeekday', m.nextWeekday, l.nextWeekday, product(PASTRY_DAY_NAMES));
  agree('previousWeekday', m.previousWeekday, l.previousWeekday, product(PASTRY_DAY_NAMES));
  agree('workWeekday', m.workWeekday, l.workWeekday, product(PASTRY_MOMENTS));
  agree('provingDayFor', m.provingDayFor, l.provingDayFor, product(PASTRY_MOMENTS));
  agree('wholeNumber', m.wholeNumber, l.wholeNumber, product([...ODD, ...PASTRY_QUANTITIES, Symbol('amount')]));
  agree('cleanNote', m.cleanNote, l.cleanNote, product(PASTRY_NOTES));
  agree('cleanItems', m.cleanItems, l.cleanItems, product(PASTRY_ROW_LISTS));
  agree('findInvalidItems', m.findInvalidItems, l.findInvalidItems, product(PASTRY_ROW_LISTS));
  agree('normalizeDay', m.normalizeDay, l.normalizeDay, product(PASTRY_DAY_DOCS, [undefined, ...PASTRY_DAY_NAMES]));

  const DOC_LISTS: readonly unknown[] = [...ODD, 'docs', 42, [],
    ...PASTRY_DAY_NAMES.map(id => [{ id, items: [{ name: 'Cornetti', qty: 24 }], note: 'n' }]),
    m.WEEKDAYS.map(id => ({ id, items: [{ name: id, qty: 1 }], note: id })),
    [{ id: 'Monday', items: [{ name: 'a', qty: 1 }] }, { id: 'Monday', items: [{ name: 'b', qty: 2 }] }],
    [{ id: 'Monday', day: 'Friday', items: [{ name: 'a', qty: 1 }] }, { day: 'Friday', items: [{ name: 'b', qty: 1 }] }],
    [0, '', null, undefined, 'str', 42, [], {}, true],
    [Object.create({ id: 'Monday', items: [{ name: 'a', qty: 1 }] })],
    [{ id: 'Monday', items: PASTRY_NUMBERS(300) }],
    ...PASTRY_DAY_DOCS.map(doc => [{ id: 'Tuesday', ...(typeof doc === 'object' && doc !== null ? doc : {}) }])];
  agree('normalizeDays', m.normalizeDays, l.normalizeDays, product(DOC_LISTS));

  const CACHES: readonly unknown[] = [...ODD, 'cache', 42, {},
    ...PASTRY_ROW_LISTS.map(rows => ({ Monday: rows })), ...PASTRY_ROW_LISTS.map(items => ({ Monday: { items } })),
    ...PASTRY_NOTES.map(note => ({ Monday: { items: [], note } })),
    { Monday: 'x' }, { Monday: 7 }, { Monday: null }, { Monday: true }, { monday: [{ name: 'a', qty: 1 }] },
    { Monday: [{ name: 'a', qty: 1 }], Tuesday: { items: [{ name: 'b', qty: 2 }], note: 'n' }, Sunday: 'x' },
    Object.fromEntries(m.WEEKDAYS.map(day => [day, [{ name: day, qty: 1 }]])),
    Object.fromEntries(m.WEEKDAYS.map(day => [day, { items: [{ name: day, qty: 1 }], note: day }])),
    Object.create({ Monday: [{ name: 'inherited', qty: 1 }] })];
  agree('daysFromCache', m.daysFromCache, l.daysFromCache, product(CACHES));

  // One position at a time varies around a list that works, so every parameter meets every odd value
  // without the product of all four growing past reason.
  const GOOD_ROWS = [{ name: 'Cornetti', qty: 24 }, { name: 'Bomboloni', qty: 10 }, { name: '  Pain AU chocolat ', qty: 5 }];
  const ROW_LISTS_FOR_QTY: readonly unknown[] = [...PASTRY_ROW_LISTS, [null, { name: 5 }, 'x', { name: 'Cornetti' }, 7, []]];
  const INDEXES: readonly unknown[] = [...ODD, 2, 3, 5, '0', '1', ' 1 ', '1.0', '0x1', 1.5, 1e999, -1e999, [1], [0], 1n,
    new Number(1), { valueOf: () => 1 }];
  const NAMES: readonly unknown[] = [...ODD, 'Cornetti', ' cornetti ', 'CORNETTI', 'Bomboloni', 'Bomboloni ', 'pain au chocolat',
    new String('Cornetti'), { toString: () => 'Cornetti' }, ['Cornetti'], 'ünï'];
  agree('setQuantityAt', m.setQuantityAt as (...args: unknown[]) => unknown, l.setQuantityAt as (...args: unknown[]) => unknown, [
    [], [undefined], [GOOD_ROWS],
    ...ROW_LISTS_FOR_QTY.flatMap(rows => [[rows, 0, 18, 'Cornetti'], [rows, 1, 18, 'Bomboloni'], [rows, 0, 18, 'a']]),
    ...INDEXES.flatMap(index => GOOD_ROWS.map(row => [GOOD_ROWS, index, 18, row.name])),
    ...PASTRY_QUANTITIES.flatMap(qty => [[GOOD_ROWS, 0, qty, 'Cornetti'], [GOOD_ROWS, 2, qty, 'pain au chocolat']]),
    ...NAMES.flatMap(name => [[GOOD_ROWS, 0, 18, name], [GOOD_ROWS, 1, 18, name], [GOOD_ROWS, 2, 18, name]]),
    ...product(ROW_LISTS_FOR_QTY.slice(0, 12), [0, 1, 99, -1, NaN], [18, 'x'], ['Cornetti', undefined]),
  ]);
});

// ── pastries-log-model ───────────────────────────────────────────────────────

describe('pastries-log-model: odd inputs', () => {
  const m = pastriesLogModel;
  const l = legacyPastriesLogModel;

  agree('workDate', m.workDate, l.workDate, product(PASTRY_MOMENTS));
  agree('logIdFor', m.logIdFor as (...args: unknown[]) => unknown, l.logIdFor as (...args: unknown[]) => unknown,
    product([...ODD, '2026-08-05', 'Wednesday', new String('x')], [...ODD, 'Wednesday', '2026-08-05', new String('x')]));
  agree('isRealISODate', m.isRealISODate, l.isRealISODate, product(PASTRY_ISO_DAYS));
  agree('daysBetween', m.daysBetween, l.daysBetween, product(PASTRY_ISO_DAYS, PASTRY_ISO_DAYS));

  // Records around the fifteen-day edge of NOW (14 Aug 2026), a clock on either side of 4am, and
  // windows that are not fifteen.
  const LOGS: readonly unknown[] = [...ODD, 'log', 42, { id: 'x' }, { date: 5 }, { date: new String('2026-08-14') },
    ...['2026-08-14', '2026-08-13', '2026-08-15', '2026-07-30', '2026-07-29', '2026-07-31', '2026-01-01', '2026-09-01',
      '2026-02-31', 'nonsense', '', null, undefined].map(date => ({ date })),
    ...['2026-08-14', '2026-07-30', '2026-07-29'].map(date => ({ id: `${date}_Monday`, date, day: 'Monday', items: [] }))];
  const CLOCKS: readonly unknown[] = [NOW, MIDNIGHT, LATE, NEXT_DAY, localMs(2026, 7, 14, 3), localMs(2026, 7, 14, 4),
    localMs(2026, 7, 29, 12), localMs(2026, 7, 30, 3, 59), localMs(2026, 7, 30, 4), 0, NaN, -1, 1, Infinity, -Infinity, 'now',
    '1700000000000', {}, null, undefined, 8.64e15, 8.64e15 + 1, new Date(NOW), [NOW]];
  const WINDOWS = [undefined, 15, 0, 1, -1, 14, 16, 1000, 0.5, NaN, null, '15', ' 15 ', Infinity, -Infinity, [15], {}];
  agree('isLogVisible', m.isLogVisible, l.isLogVisible, product(LOGS, CLOCKS, WINDOWS));

  agree('normalizeLog', m.normalizeLog, l.normalizeLog, product(PASTRY_LOG_DOCS, PASTRY_LOG_IDS));
  agree('normalizeLog (one argument)', m.normalizeLog, l.normalizeLog, product(PASTRY_LOG_DOCS));

  const LOG_LISTS: readonly unknown[] = [...ODD, 'logs', 42, [],
    ...PASTRY_LOG_DOCS.map(doc => [doc]),
    ...PASTRY_LOG_IDS.map(id => [{ id, items: [{ name: 'a', qty: 1 }] }]),
    [{ id: '2026-08-05_Wednesday', date: '2026-08-05', day: 'Wednesday', items: [] }, { id: 'rubbish', date: 'rubbish', day: 'Nonday' },
      { id: '2026-02-31_Monday', items: [] }, null, undefined, 0, '', 'str', 42, []],
    [Object.create({ id: '2026-08-05_Monday' })]];
  agree('normalizeLogs', m.normalizeLogs, l.normalizeLogs, product(LOG_LISTS));

  const SORTABLE: readonly unknown[] = [...ODD, 'logs', 42, [],
    [{ date: '2026-08-04', day: 'Wednesday' }, { date: '2026-08-05', day: 'Friday' }, { date: '2026-08-05', day: 'Tuesday' }],
    [{ date: '2026-08-05', day: 'Sunday' }, { date: '2026-08-05', day: 'Monday' }, { date: '2026-08-05', day: 'Funday' }],
    [{ date: '2026-08-05', day: 'Funday' }, { date: '2026-08-05', day: 'Nonday' }, { date: '2026-08-05', day: 'Monday' }],
    [{ date: '2026-08-05', day: 'Monday', id: 'a' }, { date: '2026-08-05', day: 'Monday', id: 'b' }],
    [{ day: 'Monday' }, { day: 'Tuesday' }], [{ date: 5, day: 'Monday' }, { date: 4, day: 'Monday' }],
    [{ date: '2026-08-05', day: 'Monday' }], [null, null], [{ date: '2026-08-05', day: 'Monday' }, null],
    Object.freeze([{ date: '2026-08-04', day: 'Monday' }, { date: '2026-08-05', day: 'Monday' }]),
    { length: 2, 0: { date: 'a', day: 'Monday' }, 1: { date: 'b', day: 'Monday' } }];
  agree('sortLogs', m.sortLogs as (...args: unknown[]) => unknown, l.sortLogs as (...args: unknown[]) => unknown, product(SORTABLE));

  const BASE = { day: 'Wednesday', items: [{ name: 'Cornetti', qty: 24 }], note: 'slow proof', nowMs: NOW, existing: undefined };
  const EXISTING: readonly unknown[] = [...ODD, 'record', 42, { createdAt: '2026-08-04T20:00:00.000Z' }, { createdAt: '' },
    { createdAt: 5 }, { createdAt: null }, { createdAt: new String('x') }, { updatedAt: 'x' },
    ...PASTRY_LOG_DOCS.slice(0, 12)];
  agree('buildLog', m.buildLog as (...args: unknown[]) => unknown, l.buildLog as (...args: unknown[]) => unknown, [
    [], [undefined], [null], [{}], [BASE], [{ ...BASE, existing: { createdAt: '2026-08-04T20:00:00.000Z' } }],
    ...varying(BASE, {
      day: [...PASTRY_DAY_NAMES, 'Wednesday'],
      items: PASTRY_ROW_LISTS,
      note: PASTRY_NOTES,
      nowMs: PASTRY_MOMENTS,
      existing: EXISTING,
    }).map(input => [input]),
  ]);
});

// ── pastries-lock ────────────────────────────────────────────────────────────

describe('pastries-lock: odd inputs', () => {
  const m = pastriesLock;
  const l = legacyPastriesLock;

  agree('grantKeyFor', m.grantKeyFor, l.grantKeyFor, product(PASTRY_DAY_NAMES));

  const ACTIONS: readonly unknown[] = [...ODD, 'edit', 'confirm', 'Edit', 'CONFIRM', 'edit ', ' confirm', 'toString', '__proto__',
    'save', new String('edit'), ['edit'], { toString: () => 'edit' }];
  agree('grantAfter', m.grantAfter, l.grantAfter, [...product(ACTIONS), ...product(ACTIONS, PASTRY_ISO_DAYS)]);

  const CONFIRMED = [true, false, undefined, null, 0, 1, '', 'yes', 'false', {}, [], NaN, new Boolean(false)];
  const GRANTS = [null, undefined, '2026-08-05', '2026-08-04', '2026-08-06', '', 5, {}, [], true, new String('2026-08-05')];
  agree('isDayLocked', m.isDayLocked, l.isDayLocked, [
    [], [undefined], [null], [{}], ['text'], [5], [true], [[]],
    ...product(CONFIRMED, GRANTS, PASTRY_ISO_DAYS).map(([confirmed, grant, workDate]) => [{ confirmed, grant, workDate }]),
  ]);

  agree('msUntilWorkDayEnd', m.msUntilWorkDayEnd, l.msUntilWorkDayEnd, product(PASTRY_MOMENTS));

  const RECORDS: readonly unknown[] = [...ODD, 'record', 42,
    ...PASTRY_LOG_IDS.map(id => ({ id, day: 'Friday' })), ...PASTRY_DAY_NAMES.map(day => ({ id: '2026-08-05_Funday', day })),
    ...PASTRY_DAY_NAMES.map(id => ({ id })), { id: '2026-08-05_Monday' }, { id: '2026-08-05_Monday_Tuesday', day: 'Friday' },
    { id: 5, day: 'Friday' }, { day: 'Friday' }, { day: ['Friday'] }, Object.create({ id: '2026-08-05_Monday' })];
  const RECORD_LISTS: readonly unknown[] = [...ODD, 'records', 42, [],
    ...RECORDS.map(record => [record]), RECORDS, RECORDS.slice(0, 5),
    ['x', 5, null, undefined, [], {}], Object.fromEntries(RECORDS.slice(0, 3).map((record, i) => [i, record])),
    new Set(RECORDS.slice(0, 3))];
  agree('confirmedDaysFrom', m.confirmedDaysFrom, l.confirmedDaysFrom, product(RECORD_LISTS));
});

// ── pack-size ────────────────────────────────────────────────────────────────

// Free-text pack weights nobody planned for: every unit and every way of writing the multiplier, a
// comma or a dot, a unit written first, stray, doubled and non-ASCII spaces and digits, capitals
// (even the Kelvin sign, which lower-cases to a «k»), numbers too small to keep and too big to hold.
const WEIGHT_TEXTS: readonly unknown[] = [...ODD, 'weight', 42, '25kg', '25 KG', ' 25kg ', '25  kg', '25\tkg', '25\nkg', '25kg\n',
  '2,27 kg', '2.27kg', '500 g', '0.5kg', '.5kg', '5.kg', '1,5,5kg', '1.5.5kg', '1e3g', 'kg 5', 'KG 5', 'kg5', 'kg  2,5', 'lt 2',
  'l 1', 'cl 50', '50 cl', '50cl', '1 lt', '1 l', '1lt', '750ml', '75 CL', '6x1kg', '6 x 1kg', '6×1kg', '6*1kg', '6X1KG', '12x500g',
  '12 x 500 g', '6x1,5kg', '1x1x1kg', 'x1kg', '6x kg', '6x', '0 kg', '0x5kg', '5x0kg', '0,0 g', '00.5kg', '25 kgs', '25 kilo',
  '25kg sacco', 'sacco 25kg', 'sacco', '', ' ', '   ', '25', 'kg', '25 oz', '٢٥kg', '２５kg', '25㎏', '25 Kg', '25 kg',
  '1'.repeat(400) + 'kg', '0.0000001kg', '0.0004kg', '0.0005kg', '999999999999999999999kg', '9'.repeat(400) + 'g',
  new String('25kg'), ['25kg'], { toString: () => '25kg' }, Symbol('weight'), 5n];

describe('pack-size: odd inputs', () => {
  const m = packSize;
  const l = legacyPackSize;

  agree('parsePackSize', m.parsePackSize, l.parsePackSize, product(WEIGHT_TEXTS));
  agree('splitWeight', m.splitWeight, l.splitWeight, product(WEIGHT_TEXTS));

  const AMOUNTS: readonly unknown[] = [...WEIGHT_TEXTS, '2.5', '2,5', '0', '-3', '-0', '1e2', '1e999', ' 2.5 ', '2.5 ', '+5', '.5', '5.',
    'Infinity', '٢', 2.5, 0, -1, 1e21, 1e-7, 0.1 + 0.2, { toString() { throw new Error('boom'); } }];
  const UNITS: readonly unknown[] = [...ODD, ...m.WEIGHT_UNIT_CHOICES, 'lt', 'cl', 'KG', ' kg', 'kg ', 'stone', 'kilo', 'toString',
    '__proto__', ['kg'], new String('kg')];
  agree('joinWeight', m.joinWeight, l.joinWeight, product(AMOUNTS, UNITS));
  agree('isUnusableWeight', m.isUnusableWeight, l.isUnusableWeight, product(AMOUNTS, UNITS));
});

// ── order-unit ───────────────────────────────────────────────────────────────

// Units as people type them: capitals, stray, doubled and tab spaces, the 100-character cap on either
// side of the edge, letters whose lower case is longer, and values that are not text at all.
const UNIT_WORDS: readonly unknown[] = [...ODD, 'busta', ' Busta ', 'BUSTA', 'mezza  busta', 'mezza busta', 'cartone', 'Cartone',
  'sacco', 'x'.repeat(99), 'x'.repeat(100), 'x'.repeat(101), 'x'.repeat(150), `${'x'.repeat(99)} y`, '\tbusta\n', 'bus\tta', 'İ', 'ß',
  4, 4n, new String('busta'), ['busta'], { toString: () => 'busta' }, Symbol('unit')];
const PACK_COUNTS: readonly unknown[] = [undefined, null, 0, 1, 2, 4, 12, 2.5, -1, '4', NaN, Infinity, 1e21, 4n, [4], true];

describe('order-unit: odd inputs', () => {
  const m = orderUnit;
  const l = legacyOrderUnit;

  const KEY_CARDS = [{ unit: 'cartone', packUnit: 'busta' }, { unit: 'cartone' }, { packUnit: 'busta' }, { unit: 'busta', packUnit: ' Busta ' },
    { unit: 'cartone', packUnit: 'busta', packCount: 4 }, { unit: 'Cartone', packUnit: 'busta', packCount: 4 },
    { unit: 'busta', packUnit: 'busta', packCount: 4 }, { unit: 'pz', packUnit: 'busta', packCount: 4 },
    Object.create({ unit: 'cartone', packUnit: 'busta', packCount: 4 }), { get unit(): string { throw new Error('boom'); } }];
  const CARDS: readonly unknown[] = [...ODD, 'card', 42, ...KEY_CARDS,
    ...UNIT_WORDS.map(unit => ({ unit })),
    ...UNIT_WORDS.map(packUnit => ({ unit: 'cartone', packUnit })),
    ...UNIT_WORDS.map(packUnit => ({ unit: 'Cartone', packUnit, packCount: 4 })),
    ...PACK_COUNTS.map(packCount => ({ unit: 'cartone', packUnit: 'busta', packCount }))];
  const FEW_CARDS: readonly unknown[] = [...ODD, 'card', 42, ...KEY_CARDS,
    ...PACK_COUNTS.map(packCount => ({ unit: 'cartone', packUnit: 'busta', packCount })),
    ...[undefined, '', 'sacco', 5].map(packUnit => ({ unit: 'cartone', packUnit, packCount: 4 }))];
  const FEW_UNITS: readonly unknown[] = [...ODD, 'busta', ' Busta ', 'cartone', 'Cartone', ' CARTONE.', 'sacco', 'mezza  busta',
    'x'.repeat(150), 4, new String('busta')];
  const ENTRIES: readonly unknown[] = [...ODD, 'entry', 42, { qty: 1 }, { unit: 'busta' }, { unit: '' }, { unit: ' CARTONE ' },
    ...UNIT_WORDS.map(unit => ({ unit }))];

  agree('cleanUnit', m.cleanUnit, l.cleanUnit, product(UNIT_WORDS));
  agree('sameUnit', m.sameUnit, l.sameUnit, product(UNIT_WORDS, UNIT_WORDS));
  agree('hasUnitChoice', m.hasUnitChoice, l.hasUnitChoice, product(CARDS));
  agree('unitChoices', m.unitChoices, l.unitChoices, [...product(CARDS), ...product(CARDS, [undefined, '', '   ', 'busta', 'Busta', 'sacco', 'cartone', 5, null, 'x'.repeat(150)])]);
  agree('entryUnit', m.entryUnit, l.entryUnit, product(ENTRIES, FEW_CARDS));
  agree('isDefaultUnit', m.isDefaultUnit, l.isDefaultUnit, product(ENTRIES, FEW_CARDS));
  agree('lineUnit', m.lineUnit, l.lineUnit, product(FEW_CARDS, ENTRIES));

  const RECORDS: readonly unknown[] = [...ODD, 'record', { units: { a: 'busta' } }, { units: null }, { units: 'abc' }, { units: ['x'] },
    { units: { a: 5 } }, { units: { a: ' Busta ' } }, {}, { units: {} }, { units: Object.create({ a: 'inherited' }) },
    { units: { a: 'x'.repeat(150) } }, { units: { 0: 'zero' } }, { units: { constructor: 'ctor' } }];
  const IDS: readonly unknown[] = ['a', 'b', 0, 1, undefined, null, '', '__proto__', 'constructor', 'toString', 'length', ['a'],
    { toString: () => 'a' }, Symbol('a')];
  agree('recordUnit', m.recordUnit, l.recordUnit, product(RECORDS, IDS, [undefined, null, {}, KEY_CARDS[0], KEY_CARDS[1], KEY_CARDS[4]]));

  const QTYS: readonly unknown[] = [...ODD, 2, 2.5, '3', 1e21, 4n, new Number(2), Symbol('qty'), { toString: () => '7' }];
  agree('qtyWithUnit', m.qtyWithUnit, l.qtyWithUnit, product(QTYS, UNIT_WORDS));

  const NUMBERS = [1, 2, 0, -1, 2.5, NaN, '3', undefined];
  agree('inPackages', m.inPackages, l.inPackages, product(NUMBERS, FEW_UNITS, FEW_CARDS));
  agree('addableInPackages', m.addableInPackages, l.addableInPackages, product(FEW_UNITS.slice(18), FEW_UNITS.slice(18), FEW_CARDS));
  agree('storedUnitFor', m.storedUnitFor, l.storedUnitFor, product(UNIT_WORDS, CARDS));
});

// ── ingredient-name ──────────────────────────────────────────────────────────

describe('ingredient-name: odd inputs', () => {
  const m = ingredientName;
  const l = legacyIngredientName;

  const NAMES: readonly unknown[] = [...ODD, 'Flour', ' Farina ', 'x'.repeat(300), 'ünï', 42, 0, 1n, new String('S'), ['a', 'b'],
    { toString: () => 'T' }, Symbol('name')];
  const INGREDIENTS: readonly unknown[] = [...ODD, 'ing', 42, 7n, { name: 'Flour' }, { name: 'Flour', shortName: ' Farina ' },
    { shortName: '  ' }, { name: 'Caputo', shortName: 'Farina', invoiceName: 'CAPUTO ROSSO' },
    ...NAMES.map(name => ({ name, shortName: 'Short' })),
    ...NAMES.map(shortName => ({ name: 'Flour', shortName })),
    ...NAMES.map(invoiceName => ({ name: 'Flour', shortName: '', invoiceName })),
    function named() { return 1; }, Object.create({ name: 'inherited', shortName: 'inherited short' }),
    { get name(): string { throw new Error('boom'); } }];
  agree('ingredientDisplayName', m.ingredientDisplayName, l.ingredientDisplayName, product(INGREDIENTS));

  // The caller's folding is theirs to choose, so odd ones are tried too: one that returns a list (a
  // list has its own includes), one that returns a number, one that is not a function at all.
  const fold = (value: unknown): string => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const NORMALIZERS: readonly unknown[] = [fold, (value: unknown) => String(value ?? ''), (value: unknown) => value, () => 'caputo rosso',
    () => ['farina'], () => 5, () => undefined, undefined, null, 'fold'];
  const QUERIES: readonly unknown[] = ['', 'farina', 'FARINA', 'caputo', 'f', ' ', 'ünï', 'x'.repeat(300), undefined, null, 0, 5, true, {}, ['farina']];
  agree('ingredientNameMatches', m.ingredientNameMatches as (...args: unknown[]) => unknown,
    l.ingredientNameMatches as (...args: unknown[]) => unknown,
    product(INGREDIENTS.slice(0, 40), QUERIES, NORMALIZERS));
});

// ── market ───────────────────────────────────────────────────────────────────

describe('market: odd inputs', () => {
  // A partial port: only what it exports is compared (the label vocabulary stays in js/ until step 3d).
  const m = market;
  const l = legacyMarket;

  // Venues as a document may hold them: the two real countries and everything near them.
  const LOCATIONS: readonly unknown[] = [...ODD, 'GB', 'IT', 'country', 42, { country: 'GB' }, { country: 'IT' }, { country: 'gb' },
    { country: 'it' }, { country: 'GB ' }, { country: ' IT' }, { country: 'GBR' }, { country: 'UK' }, { country: 'FR' }, { country: '' },
    { country: null }, { country: undefined }, { country: 42 }, { country: true }, { country: ['GB'] }, { country: { toString: () => 'GB' } },
    { country: new String('GB') }, { country: 'GB', language: 'it' }, { country: 'IT', language: 'en' }, { country: 'IT', language: 'zz' },
    { country: 'constructor' }, { country: '__proto__' }, { country: 'toString' }, { country: 'hasOwnProperty' }, { country: 'length' },
    Object.create({ country: 'GB' }), { get country(): string { return 'IT'; } },
    { get country(): string { throw new Error('boom'); } }, Object.assign(() => 1, { country: 'GB' }),
    new Proxy({}, { get: () => 'IT' }), JSON.parse('{"country":"IT"}'), JSON.parse('{"__proto__":{"country":"GB"}}')];
  agree('countryOf', m.countryOf, l.countryOf, product(LOCATIONS));
  agree('outputLanguage', m.outputLanguage, l.outputLanguage, product(LOCATIONS));
  agree('canPrintLabel', m.canPrintLabel, l.canPrintLabel, product(LOCATIONS));
  agree('currencyOf', m.currencyOf, l.currencyOf, product(LOCATIONS));
  agree('moneyLayoutOf', m.moneyLayoutOf, l.moneyLayoutOf, product(LOCATIONS));
});

// ── currency ─────────────────────────────────────────────────────────────────

// A venue's money, as the session would hand it to setCurrency (the js/ module, which keeps it in a
// module variable) and as it would hand it to moneyOf (the TypeScript one, which returns it). The same
// symbol and layout, so the same text is demanded of both. The js/ module is put back to its
// fallback after every call, so nothing leaks from one case to the next.
const GB_LAYOUT = { decimal: '.', group: '', symbolAfter: false };
const IT_LAYOUT = { decimal: ',', group: '.', symbolAfter: true };
const VENUES: readonly (readonly [unknown, unknown])[] = [
  [undefined, undefined], ['£', undefined], ['£', GB_LAYOUT], ['€', IT_LAYOUT], ['€', { ...IT_LAYOUT }], ['$', { decimal: '.', group: ',', symbolAfter: false }],
  ['€', { decimal: ',', group: '', symbolAfter: true }], ['€', { decimal: ',', group: '.', symbolAfter: false }],
  ['', IT_LAYOUT], [null, IT_LAYOUT], [5, IT_LAYOUT], [{}, IT_LAYOUT], [['€'], IT_LAYOUT], [new String('€'), IT_LAYOUT], [' ', IT_LAYOUT],
  ['EUR', IT_LAYOUT], ['€€', GB_LAYOUT],
  // layouts that are not of the expected shape fall back, never half-apply
  ['€', null], ['€', 'layout'], ['€', 5], ['€', []], ['€', true], ['€', { decimal: ',' }], ['€', { group: '.', symbolAfter: true }],
  ['€', { decimal: '', group: '.', symbolAfter: true }], ['€', { decimal: 5, group: '.', symbolAfter: true }],
  ['€', { decimal: ',', group: 5, symbolAfter: true }], ['€', { decimal: ',', group: null, symbolAfter: true }],
  ['€', { decimal: ',', group: '.', symbolAfter: 'true' }], ['€', { decimal: ',', group: '.', symbolAfter: 1 }],
  ['€', { decimal: ',', group: '.', symbolAfter: undefined }], ['€', { decimal: ',', group: '.', symbolAfter: true, extra: 1 }],
  ['€', Object.create(IT_LAYOUT)], ['€', Object.freeze({ ...IT_LAYOUT })],
  // a group that replace() would read as a pattern: the original passes it through as it is
  ['€', { decimal: ',', group: '$&', symbolAfter: true }], ['€', { decimal: ',', group: '$1', symbolAfter: false }],
  ['€', { decimal: ',', group: '$$', symbolAfter: true }], ['€', { decimal: ',', group: '$`', symbolAfter: true }],
  ['€', { decimal: ',', group: "$'", symbolAfter: true }], ['€', { decimal: '$&', group: '.', symbolAfter: true }],
  ['€', { decimal: ',', group: ' ', symbolAfter: true }], ['€', { decimal: ',', group: ' ', symbolAfter: true }],
  ['€', { decimal: ',', group: '..', symbolAfter: true }],
];

const portedAfter = (fn: (money: currency.Money, ...args: unknown[]) => unknown) =>
  (symbol: unknown, layout: unknown, ...args: unknown[]): unknown => fn(currency.moneyOf(symbol, layout), ...args);
const legacyAfter = (fn: (...args: unknown[]) => unknown) =>
  (symbol: unknown, layout: unknown, ...args: unknown[]): unknown => {
    legacyCurrencyJs.setCurrency(symbol, layout);
    try {
      return fn(...args);
    } finally {
      legacyCurrencyJs.setCurrency();
    }
  };
const withVenues = (...lists: readonly (readonly unknown[])[]): unknown[][] =>
  VENUES.flatMap(([symbol, layout]) => product(...lists).map(args => [symbol, layout, ...args]));

// Amounts already rounded to text, as moneyText is handed them, and everything that is not.
const FIXED_AMOUNTS: readonly unknown[] = [...ODD, '0.00', '6.50', '1234.56', '1234567.00', '-1234.50', '0.0035', '12', '999.99', '1000',
  '100', '10', '1', '12345678901234567890.12', '-0.00', '-', '--5', '+5', ' 5', '5 ', '5.', '.5', '1,5', '1.234,5', '1e-7', '1e+21',
  'NaN', 'Infinity', '٣', '1_000', '\n1', '1\n', 0, 1.5, -1234.5, 123456789, 1e21, -0, 0.1 + 0.2, 12345.678e3, 2 ** 53, 5n, -5n,
  new String('1234.5'), [1234.5], [1, 2], { toString: () => '1234.5' }, Symbol('amount')];

describe('currency: odd inputs', () => {
  // An adapted port: the original keeps the money in a module variable, the port is handed it. Each
  // case runs the js/ function after setCurrency(symbol, layout) and the TypeScript one with
  // moneyOf(symbol, layout).
  const m = currency;
  const l = legacyCurrencyJs;

  agree('moneyOf (the symbol)', portedAfter(money => money.symbol), legacyAfter(() => l.currentCurrency()),
    VENUES.map(([symbol, layout]) => [symbol, layout]));
  agree('moneyText', portedAfter((money, fixed) => m.moneyText(fixed as string, money)), legacyAfter(fixed => l.moneyText(fixed)),
    withVenues(FIXED_AMOUNTS));
  agree('localNumber', portedAfter((money, text) => m.localNumber(text, money)), legacyAfter(text => l.localNumber(text)),
    withVenues(FIXED_AMOUNTS));
  agree('localNumber (grouped)', portedAfter((money, text, grouped) => m.localNumber(text, money, grouped as boolean)),
    legacyAfter((text, grouped) => l.localNumber(text, grouped as boolean)),
    withVenues(FIXED_AMOUNTS.slice(0, 40), [undefined, true, false, 0, 1, null, '', 'no', {}]));
  agree('typedDecimal', m.typedDecimal, l.typedDecimal, product([...FIXED_AMOUNTS, ' 12,5 ', '12,5', '1.234,5', ',5', '5,', ',', '1,2,3',
    '\t7,5\n', '１２,５', undefined]));
});

// ── price-model ──────────────────────────────────────────────────────────────

// Numbers and number-shaped text as a price box, a spreadsheet or a document may hold them.
const PRICE_VALUES: readonly unknown[] = [...ODD, 7.2, '7.20', '7,20', ' 7.2 ', 0.035, 0.0035, 0.001745, 0.000049, 3.3333333333333335,
  600, 180, 1234.5, -7.2, -0, 0.5, 1.005, 0.1 + 0.2, 1e-7, 1e21, 1e300, '1e2', '0x10', '1e999', 'Infinity', 2 ** 53, 5n, new Number(7.2),
  [7.2], [1, 2], { valueOf: () => 7.2 }, { toString: () => '7.2' }, new Date(7), true, Symbol('price')];

// What a price can be quoted per, and near-misses of it.
const PRICE_UNIT_WORDS: readonly unknown[] = [...ODD, 'kg', 'l', 'pcs', 'g', 'KG', ' kg', 'crate', 'case', 'pack', new String('kg'), ['kg']];

describe('price-model: odd inputs', () => {
  // A partial port: only what it exports is compared. formatMoney and formatRate take the venue's money
  // as one more argument, so they are compared the way currency.ts is: js/ after setCurrency, the port
  // with moneyOf.
  const m = priceModel;
  const l = legacyPriceModel;

  agree('roundTo', m.roundTo, l.roundTo, product(PRICE_VALUES, [0, 1, 2, 4, 6, -1, 10, 100, NaN, undefined, '2', 2.5, Infinity, null]));
  agree('positiveNumber', m.positiveNumber, l.positiveNumber, product(PRICE_VALUES));
  agree('isPriceUnit', m.isPriceUnit, l.isPriceUnit, product([...ODD, 'kg', 'l', 'pcs', 'KG', ' kg', 'kg ', 'L', 'pc', 'g', 'toString',
    '__proto__', 'constructor', ['kg'], new String('kg')]));

  const RATE_INPUTS: readonly unknown[] = [undefined, {}, 5, 'str', true, [],
    { priceUnit: 'kg', pricePerUnit: 7.2 }, { priceUnit: 'kg' }, { pricePerUnit: 7.2 },
    ...varying({ priceUnit: 'kg', pricePerUnit: 7.2 }, { priceUnit: PRICE_UNIT_WORDS, pricePerUnit: PRICE_VALUES })];
  agree('normalizePrice', m.normalizePrice, l.normalizePrice, [...product(RATE_INPUTS), [null]]);

  agree('packWeightOf', m.packWeightOf, l.packWeightOf, product(WEIGHT_TEXTS));
  agree('packBaseOf', m.packBaseOf, l.packBaseOf, product(WEIGHT_TEXTS));

  const CASE_BASE = { casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' };
  const CASE_ITEM_UNIT_VALUES: readonly unknown[] = [...ODD, 'pcs', 'kg', 'g', 'l', 'ml', 'pack', 'oz', 'KG', ' kg', 'cl', 'box', new String('kg')];
  const CASE_INPUTS: readonly unknown[] = [undefined, {}, 5, 'str', true, [],
    CASE_BASE, { ...CASE_BASE, caseItemUnit: 'pcs' }, { ...CASE_BASE, caseItemUnit: 'pack' }, { ...CASE_BASE, caseItemUnit: 'g', caseItemSize: 500 },
    { ...CASE_BASE, caseItemUnit: 'ml', caseItemSize: 330, caseCount: 7, casePrice: 12 }, { casePrice: 0.0001, caseCount: 100000, caseItemUnit: 'pcs' },
    { casePrice: 3.49, caseCount: 2000, caseItemUnit: 'pcs' }, { casePrice: 10, caseCount: 3, caseItemUnit: 'pcs' },
    ...varying(CASE_BASE, {
      casePrice: PRICE_VALUES, caseCount: PRICE_VALUES, caseItemSize: PRICE_VALUES, caseItemUnit: CASE_ITEM_UNIT_VALUES,
    }),
    ...varying({ ...CASE_BASE, caseItemUnit: 'pack' }, { caseItemSize: PRICE_VALUES, caseCount: PRICE_VALUES })];
  const BASES: readonly unknown[] = [undefined, null, 'kg', 'l', 'pcs', 'KG', '', 5, {}, ['kg'], new String('kg')];
  agree('caseRate', m.caseRate, l.caseRate, [...product(CASE_INPUTS, [undefined]), ...product(CASE_INPUTS.slice(0, 30), BASES), [null], [null, 'kg']]);
  agree('caseOf', m.caseOf, l.caseOf, [...product([...CASE_INPUTS, null])]);

  // Stored price documents: every shape the readers meet, and each field replaced by an odd value.
  const FLOUR_CASE = { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' };
  const PACK_CASE = { ...FLOUR_CASE, caseItemUnit: 'pack' };
  const PCS_CASE = { priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' };
  const PRICE_DOCS: readonly unknown[] = [...ODD, 'price', 42, {}, { priceUnit: 'kg', pricePerUnit: 7.2 }, { priceUnit: 'l', pricePerUnit: 1.2 },
    { priceUnit: 'pcs', pricePerUnit: 2.1, unitWeightKg: 0.0035 }, { priceUnit: 'pcs', pricePerUnit: 0.3 },
    FLOUR_CASE, PACK_CASE, PCS_CASE, { ...PCS_CASE, caseCount: 1 }, { ...FLOUR_CASE, pricePerUnit: 3 }, { ...FLOUR_CASE, priceUnit: 'l' },
    { ...FLOUR_CASE, priceUnit: null, pricePerUnit: null }, { ...PACK_CASE, caseItemSize: null },
    { casePrice: 3.49, caseCount: 2000, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.001745 },
    { casePrice: 10, caseCount: 3, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 3.333333 },
    { casePrice: 12, caseCount: 7, caseItemSize: 330, caseItemUnit: 'ml', priceUnit: 'l', pricePerUnit: 5.194805 },
    ...varying(FLOUR_CASE, { priceUnit: PRICE_UNIT_WORDS, pricePerUnit: PRICE_VALUES, casePrice: PRICE_VALUES, caseCount: PRICE_VALUES, caseItemSize: PRICE_VALUES }),
    ...varying(PCS_CASE, { priceUnit: PRICE_UNIT_WORDS, pricePerUnit: PRICE_VALUES, unitWeightKg: PRICE_VALUES }),
    ...varying({ priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 }, { unitWeightKg: PRICE_VALUES, pricePerUnit: PRICE_VALUES, priceUnit: PRICE_UNIT_WORDS }),
    Object.create(FLOUR_CASE)];
  agree('storedCaseOf', m.storedCaseOf, l.storedCaseOf, product(PRICE_DOCS));
  agree('pricePerKg', m.pricePerKg, l.pricePerKg, product(PRICE_DOCS));
  agree('costState', m.costState, l.costState, product(PRICE_DOCS));
  agree('isCostable', m.isCostable, l.isCostable, product(PRICE_DOCS));

  const ING_ROWS: readonly unknown[] = [undefined, null, [], 'abc', 5, {}, [{ id: 'a' }], [{ id: 'a', name: 'Flour', pricePerUnit: 5, priceUnit: 'kg', priceBasis: 'rate' }],
    [{ id: 'a' }, { id: 'b' }, { id: 'c', pricePerUnit: 9 }], [null, undefined, 0, '', { id: 'a' }], [{ id: 5 }, { id: null }, { id: undefined }, {}],
    [{ id: 'a', casePrice: 1, caseCount: 1, caseItemSize: 1, caseItemUnit: 'kg', vatRate: 4, packPrice: 1, packSize: 1, unitWeightKg: 1, priceUpdatedAt: 'x' }],
    [{ id: '__proto__' }, { id: 'constructor' }, { id: 'toString' }], Object.freeze([{ id: 'a' }]), new Set([{ id: 'a' }]), { length: 1, 0: { id: 'a' } },
    [{ id: 'a', extra: { deep: 1 } }]];
  const PRICE_MAPS: readonly unknown[] = [undefined, null, {}, 'abc', 5, [], true,
    { a: { priceUnit: 'kg', pricePerUnit: 2 } }, { a: null }, { a: 5 }, { a: 'str' }, { a: [] }, { a: { casePrice: 1 } }, { b: { pricePerUnit: 3 } },
    { a: { priceUnit: 'kg', pricePerUnit: 2 }, b: { priceUnit: 'pcs', pricePerUnit: 3 }, c: { pricePerUnit: 4 } },
    { a: FLOUR_CASE, b: PCS_CASE }, Object.create({ a: { pricePerUnit: 1 } }), { constructor: { pricePerUnit: 1 } },
    { '5': { pricePerUnit: 6 } }, { undefined: { pricePerUnit: 7 }, null: { pricePerUnit: 8 } }];
  agree('withPrices', m.withPrices as (...args: unknown[]) => unknown, l.withPrices as (...args: unknown[]) => unknown, product(ING_ROWS, PRICE_MAPS));

  // The rate and the amount, in a few venues.
  const FEW_VENUES: readonly (readonly [unknown, unknown])[] = [[undefined, undefined], ['£', GB_LAYOUT], ['€', IT_LAYOUT],
    ['$', { decimal: '.', group: ',', symbolAfter: false }], ['€', { decimal: ',', group: '', symbolAfter: true }], ['€', null],
    ['€', { decimal: ',', group: '$&', symbolAfter: true }]];
  const withFewVenues = (...lists: readonly (readonly unknown[])[]): unknown[][] =>
    FEW_VENUES.flatMap(([symbol, layout]) => product(...lists).map(args => [symbol, layout, ...args]));
  // (The original's two formatters take one argument, so they are called on the module itself, not on
  // the copy typed like the port.)
  agree('formatMoney', portedAfter((money, value) => m.formatMoney(value, money)), legacyAfter(value => legacyPriceModelJs.formatMoney(value)),
    withFewVenues(PRICE_VALUES));
  agree('formatRate', portedAfter((money, value) => m.formatRate(value, money)), legacyAfter(value => legacyPriceModelJs.formatRate(value)),
    withFewVenues(PRICE_VALUES));
  // ⚠️ A rate of 1e21 or more: the original throws a TypeError (see the note at formatRate in price-model.ts).
  agree('formatRate (huge rates)', portedAfter((money, value) => m.formatRate(value, money)),
    legacyAfter(value => legacyPriceModelJs.formatRate(value)),
    withFewVenues([1e21, 1.5e21, 1.2345678901e21, 1e22, 1e100, 1.5e300, -1e21, -1.5e21, 9.99e20, 999999999999999900000, Number.MAX_VALUE]));
});

// ── order-cost ───────────────────────────────────────────────────────────────

describe('order-cost: odd inputs', () => {
  const m = orderCost;
  const l = legacyOrderCost;

  // Order units (the weight words in the forms people type them, the piece and case words, the
  // package word, the prototype's own names), pack texts, package words and packCounts.
  const OC_UNITS: readonly unknown[] = [undefined, '', ' ', 'kg', 'KG.', 'kgs', 'kilo', ' kili ', 'chilogrammi', 'g', 'gr', 'grammi', 'l', 'lt', 'litri',
    'ml', 'cl', 'pz', 'pz.', 'Pezzi', 'pcs', 'each', 'cartone', 'Cassa', 'box', 'pack', 'busta', 'Busta.', 'sacco', 'scatola', 'vaschetta',
    'constructor', 'toString', '__proto__', 'hasOwnProperty', 5, null, {}, ['kg'], new String('kg'), 'x'.repeat(150)];
  const OC_WEIGHTS: readonly unknown[] = [undefined, '', '25kg', '2.5kg', '2,27 kg', '500g', '750ml', '6x1kg', '12 x 500 g', 'sacco', '360 g',
    '60g', '0.06 kg', 25, null, {}, ['25kg']];
  const OC_PACK_UNITS: readonly unknown[] = [undefined, '', 'busta', 'Busta.', ' busta ', 'pezzo', 'scatola', 'sacco', 'vaschetta', 'uovo', 5, null];
  const CARTON = { unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg' };
  const PLAIN_CARD = { unit: 'cartone', packUnit: 'busta', weight: '2.5kg' };
  const INGREDIENTS: readonly unknown[] = [...ODD, 'ing', 42, CARTON, PLAIN_CARD, { unit: 'cartone', packUnit: 'pezzo', packCount: 50, weight: '' },
    { unit: 'cartone', packUnit: 'busta', packCount: 6, weight: '6x1kg' }, { unit: 'cartone', packUnit: 'vaschetta', packCount: 10, weight: '360g' },
    { unit: 'cartone', packUnit: 'uovo', packCount: 30, weight: '60g' },
    ...varying(CARTON, { unit: OC_UNITS, packUnit: OC_PACK_UNITS, packCount: PACK_COUNTS, weight: OC_WEIGHTS }),
    ...varying(PLAIN_CARD, { unit: OC_UNITS, packUnit: OC_PACK_UNITS, weight: OC_WEIGHTS }),
    ...product(OC_UNITS, OC_WEIGHTS, [undefined, 4]).map(([unit, weight, packCount]) => ({ unit, weight, packCount, packUnit: 'busta' })),
    Object.create(CARTON), { get unit(): string { throw new Error('boom'); } }];
  // The functions that read an ingredient AND a price meet every ingredient against every price: every
  // tenth ingredient keeps that to a size the suite can afford, and the odd values are listed ahead of it.
  const SOME_INGREDIENTS: readonly unknown[] = [...INGREDIENTS.slice(0, 20), ...INGREDIENTS.filter((_, i) => i % 10 === 0)];

  const FLOUR = { priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' };
  const PACK = { ...FLOUR, caseItemUnit: 'pack' };
  const PCS_CASE = { priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' };
  const ONE_BAG = { priceUnit: 'kg', pricePerUnit: 0.8, casePrice: 20, caseCount: 1, caseItemSize: 25, caseItemUnit: 'pack' };
  const PRICES: readonly unknown[] = [...ODD, 'price', 42, {}, { priceUnit: 'kg', pricePerUnit: 2 }, { priceUnit: 'l', pricePerUnit: 3.2 },
    { priceUnit: 'pcs', pricePerUnit: 0.4 }, { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 },
    { priceUnit: 'pcs', pricePerUnit: 3, unitWeightKg: 0.75 }, { priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.36 },
    { priceUnit: 'kg', pricePerUnit: 0 }, { priceUnit: 'box', pricePerUnit: 2 }, { priceUnit: 'kg', pricePerUnit: '2' },
    { priceUnit: 'kg', pricePerUnit: 'free' }, { priceUnit: 'kg', pricePerUnit: null },
    FLOUR, PACK, PCS_CASE, ONE_BAG, { ...PCS_CASE, caseCount: 1 }, { ...PACK, pricePerUnit: 3 }, { ...FLOUR, priceUnit: null, pricePerUnit: null },
    { ...PACK, caseItemSize: null }, { priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20 },
    ...varying(PACK, { casePrice: PRICE_VALUES.slice(0, 20), caseCount: PRICE_VALUES.slice(0, 20), priceUnit: PRICE_UNIT_WORDS, pricePerUnit: PRICE_VALUES.slice(0, 25) }),
    ...varying({ priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 }, { unitWeightKg: PRICE_VALUES.slice(0, 25), pricePerUnit: PRICE_VALUES.slice(0, 25) }),
    Object.create(PACK)];
  // The prices written by hand come first (the odd values, then the shapes that matter); then every
  // fifth of the one-field-at-a-time variations.
  const SOME_PRICES: readonly unknown[] = [...PRICES.slice(0, 43), ...PRICES.slice(43).filter((_, i) => i % 5 === 0)];

  agree('validPackCount', m.validPackCount, l.validPackCount, product(INGREDIENTS));
  agree('itemsPerOrderedUnit', m.itemsPerOrderedUnit, l.itemsPerOrderedUnit, product(INGREDIENTS));
  agree('pieceIsNotItem', m.pieceIsNotItem, l.pieceIsNotItem, product(SOME_INGREDIENTS, SOME_PRICES));
  agree('costPerItem', m.costPerItem, l.costPerItem, product(SOME_INGREDIENTS, SOME_PRICES));
  agree('unitCost', m.unitCost, l.unitCost, product(SOME_INGREDIENTS, SOME_PRICES));
  agree('lineUnitCost', m.lineUnitCost, l.lineUnitCost, product(SOME_INGREDIENTS.slice(0, 80), SOME_PRICES.slice(0, 45),
    [undefined, 'busta', 'Busta', 'cartone', 'sacco', 5]));

  // The tolerance a piece weight is compared to the card's weight with (a billionth of a kilo): both
  // sides of it, and exactly on it, for a card that reads in grams and one that reads in millilitres.
  const WEIGHED_CARDS = [{ weight: '60g' }, { weight: '0.06 kg' }, { weight: '750ml' }, { weight: '', unit: 'cartone' },
    { unit: 'cartone', packUnit: 'vaschetta', packCount: 10, weight: '60g' }, { unit: 'busta', packUnit: 'busta', weight: '60g' },
    { unit: 'cartone', packUnit: 'uovo', packCount: 30, weight: '750ml' }];
  const NEAR_WEIGHTS = [0.06, 0.75, ...[-1e-8, -5e-9, -1.1e-9, -1e-9, -9e-10, -1e-11, 0, 1e-11, 9e-10, 1e-9, 1.1e-9, 5e-9, 1e-8].flatMap(
    delta => [0.06 + delta, 0.75 + delta])];
  const WEIGHED_PRICES = NEAR_WEIGHTS.map(unitWeightKg => ({ priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg }));
  agree('pieceIsNotItem (at the tolerance)', m.pieceIsNotItem, l.pieceIsNotItem, product(WEIGHED_CARDS, WEIGHED_PRICES));
  agree('costPerItem (at the tolerance)', m.costPerItem, l.costPerItem, product(WEIGHED_CARDS, WEIGHED_PRICES));
  agree('unitCost (at the tolerance)', m.unitCost, l.unitCost, product(WEIGHED_CARDS, WEIGHED_PRICES));

  // Lines as a screen hands them over: one field at a time replaced by an odd value, then whole lists
  // of them, mixed rates, and lists that are not lists.
  const LINE = { qty: 2, unitCost: 10, vatRate: 4 };
  const QTYS: readonly unknown[] = [...ODD, 3, 2.5, '3', ' 2 ', '1e1', '0x10', 1e21, 1e-9, new Number(2), [2], [2, 3], { valueOf: () => 2 }, 5n, Symbol('qty')];
  const UNIT_COSTS: readonly unknown[] = [...ODD, 0.4, '0.4', 45, -3, 1e21, 5n, new Number(10), [10], { valueOf: () => 10 }, Symbol('cost')];
  const VAT_RATES: readonly unknown[] = [...ODD, 0, 4, 5, 10, 20, 22, '4', ' 4 ', 4.5, -5, 0.5, 1e3, 1e21, -0, '0', 5n, new Number(4), [4], Symbol('vat')];
  const ONE_LINE: readonly unknown[] = [undefined, null, 0, '', 'line', 42, {}, LINE, ...varying(LINE, { qty: QTYS, unitCost: UNIT_COSTS, vatRate: VAT_RATES })];
  const MIXED = [{ qty: 2, unitCost: 10, vatRate: 4 }, { qty: 1, unitCost: 100, vatRate: 22 }, { qty: 3, unitCost: 5, vatRate: 4 },
    { qty: 4, unitCost: 45, vatRate: null }, { qty: 1, unitCost: null, vatRate: 4 }, { qty: 0, unitCost: 5, vatRate: 4 },
    { qty: 2, unitCost: 10, vatRate: 0 }, { qty: 1.5, unitCost: 3.33, vatRate: 20 }, { qty: 3, unitCost: 0.1, vatRate: 5 },
    { qty: 7, unitCost: 0.7, vatRate: 4.0 }, { qty: 2, unitCost: 1, vatRate: '4' }];
  // A generator can be read once, so it stands in the list as a marker and each side gets a fresh one.
  const A_GENERATOR = { kind: 'a generator of two lines' };
  const fresh = (lines: unknown): unknown => (lines === A_GENERATOR ? (function* () { yield LINE; yield { qty: 1, unitCost: 2 }; })() : lines);
  const LINE_LISTS: readonly unknown[] = [undefined, null, [], 'abc', 5, {}, true, new Set([LINE]), new Set(MIXED), [[LINE]], [LINE, LINE], MIXED,
    MIXED.slice().reverse(), MIXED.slice(0, 4), [null, undefined, 0, '', 'x', LINE], Object.freeze([LINE]), A_GENERATOR,
    ...ONE_LINE.map(line => [line])];
  agree('orderCost', (lines: unknown) => m.orderCost(fresh(lines) as never), (lines: unknown) => l.orderCost(fresh(lines) as never), product(LINE_LISTS));
});

// ── inventory-model ──────────────────────────────────────────────────────────

// Month ids and near-misses: the real shape, the months 00 and 13, a missing zero, a day on the end,
// stray spaces and a trailing newline, digits that are not ASCII, and values that are not text.
const MONTH_IDS: readonly unknown[] = [...ODD, '2026-09', '2026-01', '2026-12', '2027-01', '0000-01', '9999-12', '2026-13', '2026-00', '2026-9',
  '2026-009', '2026-09-01', ' 2026-09', '2026-09 ', '2026-09\n', '2026/09', '202609', '٢٠٢٦-٠٩', '２０２６-０９', 'later', 202609,
  new String('2026-09'), ['2026-09'], { toString: () => '2026-09' }];

// What can be typed into a count box, or read back out of a document in that place.
const COUNT_VALUES: readonly unknown[] = [...ODD, 3, 3.5, 0.1 + 0.2, 1e21, 1e-7, -0, 0.0005, 0.0004, 3.14159, '3', '3,5', '3.5', ' 3 ', '3 5',
  '-2', '+3', '0', '0,0', '00.5', '.5', '5.', '1e3', '1,2,3', '1.2.3', '0x10', 'Infinity', '٣', '３', '１,５', '3\n', '\t4', 'HELLO', '1_000',
  '1e999', '3,', ',5', ',', '9'.repeat(400), new Number(2), new String('2'), [2], ['2'], { valueOf: () => 2 }, { toString: () => '2' }, 5n,
  Symbol('count'), Number.MAX_SAFE_INTEGER, Number.MAX_VALUE, Number.MIN_VALUE];

// A map of counts (or of prices) as a document may hold it, and everything near one.
const COUNT_MAP_VALUES: readonly unknown[] = [...ODD, { flour: 3 }, { flour: '3,5', butter: -1, salt: 'HELLO' }, { flour: 0 }, { 'olio.extra': 2 },
  { flour: 1e21 }, { flour: null, butter: undefined }, { flour: [3] }, { flour: 0.0004 }, { flour: 3.14159 },
  JSON.parse('{"__proto__": 5, "flour": 1}'), Object.create({ flour: 1 }), 'not a map', [3], [[1]], new Map([['flour', 1]])];
const NAME_MAP_VALUES: readonly unknown[] = [...ODD, { flour: 'Flour' }, { flour: '  Farina 00 25kg ', butter: 7 }, { flour: 'x'.repeat(250) },
  { flour: 'y'.repeat(200) }, { flour: '   ' }, { flour: ['x'] }, { flour: new String('x') }, JSON.parse('{"__proto__": "x", "flour": "F"}'),
  'not a map', ['a']];
const STAMPS: readonly unknown[] = [...ODD, '', '2026-10-01T09:00:00.000Z', 'x', ' ', new String('x'), 5, new Date(0)];

const GOOD_MONTH = {
  month: '2026-09', opening: { flour: 3 }, purchased: { flour: 12 }, closing: { flour: 4 }, packKg: { flour: 25 }, names: { flour: 'Flour 25kg' },
  unitPrice: { flour: 12.5 }, closedAt: '2026-10-01T09:00:00.000Z', createdAt: '2026-09-01T09:00:00.000Z', updatedAt: '2026-09-30T09:00:00.000Z',
};
// A month document as it may arrive: the real one, each of its fields replaced by odd values, and shapes that are not one.
const MONTH_DOCS: readonly unknown[] = [...ODD, 'doc', 42, GOOD_MONTH, { ...GOOD_MONTH, closedAt: '' }, { month: '2026-09' }, { id: '2026-08' },
  { id: '2026-08', month: 'junk' }, { month: 'junk', id: 'junk' }, Object.create(GOOD_MONTH), { get month(): string { throw new Error('boom'); } },
  ...varying(GOOD_MONTH, {
    month: MONTH_IDS, opening: COUNT_MAP_VALUES, purchased: COUNT_MAP_VALUES, closing: COUNT_MAP_VALUES, packKg: COUNT_MAP_VALUES,
    unitPrice: COUNT_MAP_VALUES, names: NAME_MAP_VALUES, closedAt: STAMPS, createdAt: STAMPS, updatedAt: STAMPS,
  })];

// The ids a box is looked up by: the real ones, a dotted one, the prototype's own names, and keys that are not text.
const BOX_IDS: readonly unknown[] = ['flour', 'butter', 'olio.extra', 'ghost', 0, 1, undefined, null, '', '__proto__', 'constructor', 'toString',
  'length', ['flour'], { toString: () => 'flour' }, Symbol('flour'), 5n];

// Products as a list may hold them.
const PRODUCT = { id: 'flour', name: 'Flour', weight: '25kg' };
const PRODUCT_NAMES: readonly unknown[] = [...ODD, 'Salt', '   ', ' Flour ', 5, ['x'], new String('x'), { toString: () => 'x' }, 'ünï', 0, 1n, Symbol('name')];
const PRODUCT_FLAGS: readonly unknown[] = [...ODD, false, true, 'false', 0, null];
const SPARSE_PRODUCTS = ((): unknown[] => { const list: unknown[] = [PRODUCT]; list[3] = { ...PRODUCT, id: 'salt' }; return list; })();
const PRODUCT_LISTS: readonly unknown[] = [undefined, null, [], 'abc', 5, {}, true, [null], [undefined, 0, '', false], [PRODUCT],
  [PRODUCT, { ...PRODUCT, id: 'salt', name: 'Salt' }],
  [PRODUCT, { ...PRODUCT, id: 'old', name: 'Retired', active: false }, { ...PRODUCT, id: 'blank', name: '   ' }, null],
  [PRODUCT, PRODUCT], Object.freeze([PRODUCT]), SPARSE_PRODUCTS, new Set([PRODUCT]), { length: 1, 0: PRODUCT }, Object.assign([PRODUCT], { extra: 1 }),
  ...ODD.map(value => [value]),
  ...varying(PRODUCT, { name: PRODUCT_NAMES, active: PRODUCT_FLAGS, id: BOX_IDS }).map(product_ => [product_])];

// A closed month and the maps it may carry, for the lists above to be read against.
const CLOSED_MONTH = { closedAt: 'yes', names: { flour: 'Flour 25kg', salt: 'Salt 1kg' }, closing: { flour: 2 } };
const PRODUCT_MONTHS: readonly unknown[] = [...ODD, 'month', 42, { closedAt: '' }, { closedAt: 'yes' }, { closedAt: 'yes', names: {} },
  CLOSED_MONTH, { ...CLOSED_MONTH, closedAt: '' }, { closedAt: 'yes', names: {}, closing: { ghost: 3 }, opening: { older: 1 } },
  { closedAt: 'yes', names: { flour: 'Flour' }, packKg: { flour: 25, salt: 1 } }, { closedAt: 'yes', closing: { flour: 1 }, purchased: { salt: 1 } },
  ...varying(CLOSED_MONTH, {
    closedAt: STAMPS, names: [...NAME_MAP_VALUES, 'abc', 5, { 0: 'x' }], closing: COUNT_MAP_VALUES, opening: COUNT_MAP_VALUES,
    purchased: COUNT_MAP_VALUES, packKg: COUNT_MAP_VALUES,
  })];

describe('inventory-model: odd inputs', () => {
  const m = inventoryModel;
  const l = legacyInventoryModel;

  agree('isMonthId', m.isMonthId, l.isMonthId, product(MONTH_IDS));

  // `undefined` is left out on purpose: the parameter defaults to the clock, and the clock is tried below with a fixed one.
  const MOMENTS: readonly unknown[] = [NOW, MIDNIGHT, LATE, NEXT_DAY, 0, NaN, new Date(2026, 0, 1, 0, 0).getTime(),
    new Date(2026, 11, 31, 23, 59, 59).getTime(), new Date(2024, 1, 29, 12).getTime(), new Date(2026, 9, 1, 0, 30).getTime(), 8.64e15,
    8.64e15 + 1, -8.64e15, 1e21, '2026-09-15', '2026-09-15T00:30:00', new Date(2026, 8, 15), new Date(NaN), '', 'abc', [NOW],
    { valueOf: () => NOW }, 5n, Symbol('moment'), ...ODD.filter(value => value !== undefined)];
  agree('monthKey', m.monthKey as AnyFn, l.monthKey as AnyFn, product(MOMENTS));

  test('monthKey: the same answer with no moment, at a fixed clock', () => {
    vi.useFakeTimers();
    try {
      for (const now of [new Date(2026, 9, 1, 0, 30), new Date(2026, 8, 30, 23, 59), new Date(2026, 11, 31, 23, 59, 59), new Date(2024, 1, 29, 12)]) {
        vi.setSystemTime(now);
        expect(outcome(() => m.monthKey())).toStrictEqual(outcome(() => l.monthKey()));
      }
    } finally {
      vi.useRealTimers();
    }
  });

  const DELTAS: readonly unknown[] = [...ODD, -12, -1, 12, 13, 1.5, -0, 24, 1000, 1e9, 1e21, 5n, '1', new Number(1), [1]];
  agree('shiftMonth', m.shiftMonth, l.shiftMonth, product(MONTH_IDS, DELTAS));
  agree('previousMonth', m.previousMonth, l.previousMonth, product(MONTH_IDS));
  agree('nextMonth', m.nextMonth, l.nextMonth, product(MONTH_IDS));
  agree('monthBounds', m.monthBounds, l.monthBounds, product(MONTH_IDS));

  agree('readCount', m.readCount, l.readCount, product(COUNT_VALUES));

  agree('normalizeMonth', m.normalizeMonth, l.normalizeMonth, [...product(MONTH_DOCS), ...product(MONTH_DOCS.slice(0, 40), MONTH_IDS)]);
  agree('isClosed', m.isClosed, l.isClosed, product(MONTH_DOCS));
  agree('toDocument', m.toDocument, l.toDocument, product(MONTH_DOCS));
  agree('carryOver', m.carryOver, l.carryOver, [...product(MONTH_DOCS.slice(0, 60), MONTH_IDS, [undefined, '2026-10-01T09:00:00.000Z', 5, null]),
    ...product(MONTH_DOCS.slice(60), ['2026-10', 'later'])]);

  agree('consumption', m.consumption, l.consumption, product(MONTH_DOCS, BOX_IDS));
  const ID_LISTS: readonly unknown[] = [...ODD, ['flour'], ['flour', 'butter'], ['flour', 'flour'], [null, undefined], 'flour', new Set(['flour']),
    { length: 1, 0: 'flour' }, Object.freeze(['flour']), ['__proto__'], ['flour', 'olio.extra', 'ghost'], [0, 1]];
  agree('progressOf', m.progressOf, l.progressOf, product(MONTH_DOCS.slice(0, 120), ID_LISTS));

  agree('countableProducts', m.countableProducts as AnyFn, l.countableProducts as AnyFn, product(PRODUCT_LISTS));
  agree('productsOfMonth', m.productsOfMonth as AnyFn, l.productsOfMonth as AnyFn,
    [...product(PRODUCT_MONTHS, PRODUCT_LISTS.slice(0, 20)), ...product(PRODUCT_MONTHS.slice(0, 30), PRODUCT_LISTS.slice(20))]);
});

// ── inventory-outbox ─────────────────────────────────────────────────────────

describe('inventory-outbox: odd inputs', () => {
  const m = inventoryOutbox;
  const l = legacyInventoryOutbox;

  // Outboxes as they are built, as a cache may give them back, and everything that is not one.
  const LAYER = { pending: { closing: { flour: 3 } }, cleared: { closing: { salt: true } } };
  const OUTBOXES: readonly unknown[] = [...ODD, 'outbox', 42, { pending: {}, cleared: {}, inFlight: null }, LAYER, { ...LAYER, inFlight: LAYER },
    { pending: { closing: { flour: 3 } }, cleared: {}, inFlight: { pending: { closing: { flour: 1, salt: 2 } }, cleared: { opening: { a: true } } } },
    { pending: {}, cleared: {}, inFlight: {} }, { inFlight: 'x' }, { inFlight: 0 }, { inFlight: true }, { inFlight: [] },
    { pending: 'no' }, { pending: { closing: 5 } }, { pending: { closing: null } }, { pending: { closing: [1] } }, { pending: { closing: 'str' } },
    { cleared: { closing: { a: true } } }, { cleared: { closing: 5 } }, { cleared: 'x' },
    { pending: { closing: { flour: 3 } }, cleared: { closing: { flour: true } } },
    { pending: { closing: { 'olio.extra': 1 } }, cleared: { closing: { 'olio.extra': true, other: true } } },
    { pending: { closing: { a: 0, b: null, c: undefined, d: '', e: false } } },
    JSON.parse('{"pending":{"__proto__":{"a":1},"closing":{"flour":1}}}'), Object.create(LAYER),
    { get pending(): unknown { throw new Error('boom'); } }, { get inFlight(): unknown { throw new Error('boom'); } },
    Object.freeze({ pending: Object.freeze({ closing: Object.freeze({ flour: 1 }) }), cleared: {}, inFlight: null }),
    new Map(), () => 1];

  // The shapes the fix added: how many writes are out, whether one was refused, what was handed over and
  // not yet seen back, what is held from an earlier visit — whole, half-written and wrong.
  const HANDED = { pending: { closing: { flour: 3 } }, cleared: { closing: { salt: true } } };
  const HELD = { pending: { closing: { flour: 1, sugar: 2 }, opening: { a: 4 } }, cleared: { closing: { oil: true } } };
  const FIXED_ONLY: readonly unknown[] = [
    { pending: {}, cleared: {}, inFlight: LAYER, writes: 2, failed: true, handed: HANDED, held: HELD },
    { pending: { closing: { flour: 9 } }, cleared: {}, inFlight: LAYER, writes: 1, failed: false, handed: HANDED, held: HELD },
    { pending: { closing: { flour: 9 } }, cleared: { closing: { sugar: true } }, inFlight: null, writes: 0, failed: false, handed: {}, held: HELD },
    { pending: {}, cleared: {}, inFlight: null, writes: 3, failed: true, handed: HANDED, held: { pending: {}, cleared: {} } },
    { inFlight: LAYER, writes: 0 }, { inFlight: LAYER, writes: -1 }, { inFlight: LAYER, writes: 1.5 }, { inFlight: LAYER, writes: '2' },
    { inFlight: LAYER, writes: NaN }, { inFlight: LAYER, writes: Infinity }, { inFlight: LAYER, writes: 2 ** 40 }, { inFlight: LAYER },
    { inFlight: LAYER, writes: 2, failed: 'yes' }, { inFlight: LAYER, writes: 2, failed: 1 }, { inFlight: LAYER, writes: 2, failed: true },
    { writes: 3, failed: true }, { failed: true }, { writes: 2 },
    { held: 'x' }, { held: 5 }, { held: null }, { held: [] }, { held: { pending: 'no' } }, { held: { pending: { closing: 5 } } },
    { held: { pending: { closing: { flour: -1, salt: 'x', sugar: 2 } }, cleared: { closing: { oil: 'yes', ham: true } } } },
    { handed: 'x' }, { handed: 5 }, { handed: null }, { handed: { cleared: 'x' } }, { handed: { pending: { closing: null } } },
    { handed: HANDED, held: HANDED }, { pending: { closing: { flour: 3 } }, held: { pending: { closing: { flour: 1 } }, cleared: {} } },
    { inFlight: LAYER, held: { cleared: { closing: { flour: true } }, pending: {} } },
    Object.freeze({ pending: {}, cleared: {}, inFlight: null, writes: 0, failed: false, handed: Object.freeze({ pending: {}, cleared: {} }), held: Object.freeze({ pending: {}, cleared: {} }) }),
    { get held(): unknown { throw new Error('boom'); } }, { get handed(): unknown { throw new Error('boom'); } },
    { get writes(): unknown { throw new Error('boom'); }, inFlight: LAYER }, { get failed(): unknown { throw new Error('boom'); }, inFlight: LAYER }];
  // Without the fix in js/ only the shapes both files read the same way are compared.
  const BOXES: readonly unknown[] = legacyOutboxHasTheFix ? [...OUTBOXES, ...FIXED_ONLY] : OUTBOXES;

  agree('hasWork', m.hasWork, l.hasWork, product(BOXES));
  agree('isSending', m.isSending, l.isSending, product(BOXES));
  if (legacyOutboxHasTheFix) {
    agree('confirm', m.confirm, l.confirm, product(BOXES));
    agree('restore', m.restore, l.restore, product(BOXES));
    agree('take', m.take, l.take, product(BOXES));
  }

  // Names of maps and of boxes: the real ones, a dotted id, the prototype's own names (a plain object
  // answers to them), nothing, and keys that are not text.
  // ⚠️ 'constructor' is not in this list, and the reason is the comparison, not the code: an object with an
  // OWN key called «constructor» can never be strictly equal to another one, because toStrictEqual compares
  // the two `.constructor` values and they are two different objects. It is tried below, compared as text.
  const KEYS: readonly unknown[] = ['closing', 'opening', 'purchased', 'packKg', 'flour', 'olio.extra', '', ' ', undefined, null, 5, 0, true, '__proto__',
    'toString', 'hasOwnProperty', ['closing'], { toString: () => 'closing' }, Symbol('key')];
  const VALUES: readonly unknown[] = [null, undefined, 0, 3, -1, '', 'x', NaN, 1e21, 0.1, true, false, {}, [], { a: 1 }, 5n, Symbol('v')];
  const asText = (value: unknown): string => JSON.stringify(value) ?? String(value);
  const VALUE_MAPS: readonly unknown[] = [undefined, {}, { a: 1 }, { a: null }, { a: undefined }, { a: 0, b: 2 }, null, 'abc', 5, ['x'],
    { 'olio.extra': 1 }, Object.create({ inherited: 1 })];
  const CLEAR_LISTS: readonly unknown[] = [undefined, [], ['a'], ['a', 'b'], 'ab', null, 5, new Set(['a']), [null], [''], ['olio.extra'], { length: 1, 0: 'a' }];
  // What stage and stageMany answer is an outbox, whose shape the fix changed.
  if (legacyOutboxHasTheFix) {
    agree('stage', m.stage as AnyFn, l.stage as AnyFn, [...product(OUTBOXES.slice(0, 40), KEYS.slice(0, 10), KEYS.slice(4, 14), VALUES),
      ...product(OUTBOXES.slice(0, 12), KEYS, KEYS, [3, null]),
      ...product(FIXED_ONLY, ['closing', 'opening', 'packKg', undefined], ['flour', 'sugar', 'oil', 'a', ''], [3, null, 0, undefined, 'x'])]);
    agree('stage (a map or a box called «constructor», compared as text)', (...args: unknown[]) => asText((m.stage as AnyFn)(...args)),
      (...args: unknown[]) => asText((l.stage as AnyFn)(...args)),
      [...product(OUTBOXES.slice(0, 12), ['constructor', 'closing'], ['constructor', 'flour'], [3, null, undefined, 'x']),
        ...product(FIXED_ONLY.slice(0, 8), ['constructor', 'closing'], ['constructor', 'flour'], [3, null])]);
    agree('stageMany', m.stageMany as AnyFn, l.stageMany as AnyFn,
      [...product(OUTBOXES.slice(0, 40), ['closing', 'purchased', '', undefined, 5], VALUE_MAPS, CLEAR_LISTS),
        ...product(FIXED_ONLY, ['closing', 'opening'], VALUE_MAPS.slice(0, 6), CLEAR_LISTS.slice(0, 4))]);
  }

  // applyOver changes the document it is given, so each call is handed a fresh one, by its index: the two
  // sides must never share a target, or the first would hand the second a document already laid over.
  const MAKE_TARGETS: readonly (() => unknown)[] = [
    () => ({ opening: {}, purchased: {}, closing: {}, packKg: {} }),
    () => ({ opening: { flour: 1 }, purchased: { flour: 2 }, closing: { flour: 1, salt: 5, 'olio.extra': 2 }, packKg: { flour: 25 } }),
    () => ({ closing: { flour: 1 } }), () => ({}), () => null, () => undefined, () => 'abc', () => 5, () => [],
    () => ({ closing: 'str' }), () => ({ closing: 5 }), () => ({ closing: null }), () => ({ closing: [] }),
    () => Object.freeze({ closing: Object.freeze({}) }), () => Object.freeze({ closing: {} }),
    () => ({ get closing(): unknown { throw new Error('boom'); } }),
  ];
  const MAP_LISTS: readonly unknown[] = [undefined, null, [], ['closing'], ['opening', 'purchased', 'closing', 'packKg'], 'closing', ['closing', 'closing'],
    ['packKg'], 5, {}, [null], ['closing', 5], new Set(['closing'])];
  const target = (make: unknown): unknown => (MAKE_TARGETS[make as number] as () => unknown)();
  // The answer is the target itself, and one target has a getter that throws, so what is compared is whether the
  // answer IS the target and what the target reads as text (a throwing getter reads as «unreadable» on both sides).
  const readAs = (value: unknown): string => {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return 'unreadable';
    }
  };
  const laidOver = (apply: (box: unknown, into: object, maps: unknown) => unknown) => (box: unknown, make: unknown, maps: unknown) => {
    const into = target(make) as object;
    const answer = apply(box, into, maps);
    return { theTarget: answer === into, text: readAs(answer) };
  };
  agree('applyOver', laidOver(m.applyOver), laidOver(l.applyOver), product(BOXES, MAKE_TARGETS.map((_, index) => index), MAP_LISTS));

  // The functions the fix added.
  const OKS: readonly unknown[] = [true, false, undefined, null, 0, 1, '', 'ok', 'yes', {}, [], NaN, new Error('refused'), 'true', Symbol('ok')];
  const SHOWN_DOCS: readonly unknown[] = [...ODD, 'doc', 42, { closing: { flour: 3 } }, { closing: { flour: 3, salt: 1 } }, { closing: { flour: 2 } },
    { closing: {} }, { opening: { flour: 3 } }, { opening: { flour: 2 }, closing: { flour: 3 } }, { closing: { flour: 0 } }, { closing: { 'olio.extra': 1 } },
    { closing: { flour: 3 }, opening: { a: 4 }, purchased: {}, packKg: {} }, { closing: 5 }, { closing: null }, { closing: [3] }, { closing: 'flour' },
    JSON.parse('{"closing":{"__proto__":3,"flour":3}}'), Object.create({ closing: { flour: 3 } }), { get closing(): unknown { throw new Error('boom'); } },
    Object.freeze({ closing: Object.freeze({ flour: 3 }) })];
  const SAVED: readonly unknown[] = [...ODD, 'saved', 42, LAYER, HANDED, HELD, { pending: {}, cleared: {} },
    { pending: { closing: { flour: -1, salt: 'x', sugar: 2, a: NaN, b: Infinity, c: null, d: {}, e: 0, f: 0.1, g: true } }, cleared: {} },
    { pending: {}, cleared: { closing: { x: true, y: 'yes', z: 1, w: false, v: null } } },
    { pending: { closing: { flour: 3 } }, cleared: { closing: { flour: true } } },
    { pending: { notAMap: { h: 1 }, opening: { h: 1 }, constructor: { h: 1 } }, cleared: { notAMap: { k: true }, packKg: { k: true } } },
    { pending: { closing: { '': 3, 'olio.extra': 3 } }, cleared: { closing: { '': true, 'olio.extra': false } } },
    { pending: 'no' }, { cleared: 'no' }, { pending: { closing: 5 } }, { pending: { closing: [1] } }, { pending: { closing: 'str' } },
    JSON.parse('{"pending":{"closing":{"__proto__":3,"flour":1}},"cleared":{}}'), Object.create(LAYER),
    { get pending(): unknown { throw new Error('boom'); } }, Object.freeze({ pending: Object.freeze({ closing: Object.freeze({ flour: 1 }) }), cleared: {} })];
  if (legacyOutboxHasTheFix) {
    agree('answered', m.answered as AnyFn, l.answered as AnyFn, product(BOXES, OKS));
    agree('echoed', m.echoed as AnyFn, l.echoed as AnyFn, product(BOXES, SHOWN_DOCS, MAP_LISTS));
    agree('unsaved', m.unsaved, l.unsaved, product(BOXES));
    agree('hasUnsaved', m.hasUnsaved, l.hasUnsaved, product(BOXES));
    agree('hasHeld', m.hasHeld, l.hasHeld, product(BOXES));
    agree('release', m.release, l.release, product(BOXES));
    agree('revive', m.revive as AnyFn, l.revive as AnyFn, product(BOXES, SAVED, MAP_LISTS));
  } else {
    // ⚠️ Only hasWork, isSending and applyOver are compared while js/ is the file before the fix, and
    // this pins that it is exactly that file: any other shape turns it red instead of being skipped in
    // silence. TO DELETE, with the `legacyOutboxHasTheFix` conditionals, once PR #343 is on main and
    // merged into this branch.
    test('inventory-outbox: js/ is exactly the file before the fix of 11 Oct 2026 (PR #343)', () => {
      expect(Object.keys(legacyInventoryOutboxJs).sort()).toStrictEqual(
        ['EMPTY_OUTBOX', 'applyOver', 'confirm', 'hasWork', 'isSending', 'restore', 'stage', 'stageMany', 'take'],
      );
      expect(Object.keys(l.EMPTY_OUTBOX).sort()).toStrictEqual(['cleared', 'inFlight', 'pending']);
    });
  }

  // Whole histories: every sequence of up to four of these steps is run from the empty outbox, and what
  // each step answered (the outbox, what was taken, the document laid over) must be the same.
  type Step = readonly ['stage', string, string, unknown] | readonly ['take'] | readonly ['confirm'] | readonly ['restore'] | readonly ['apply']
    | readonly ['answer', boolean] | readonly ['echo'] | readonly ['revive'] | readonly ['release'];
  const STEPS: readonly Step[] = [['stage', 'closing', 'flour', 3], ['stage', 'closing', 'flour', null], ['stage', 'closing', 'flour', 8],
    ['stage', 'closing', 'salt', 0], ['stage', 'opening', 'flour', 2], ['take'], ['confirm'], ['restore'], ['apply']];
  // The fix: several writes, their answers, what a snapshot shows back, what an earlier visit left, and its release.
  const FIX_STEPS: readonly Step[] = [['stage', 'closing', 'flour', 3], ['stage', 'closing', 'flour', null], ['stage', 'closing', 'salt', 0],
    ['take'], ['answer', true], ['answer', false], ['echo'], ['revive'], ['release'], ['apply']];
  const MAPS = ['opening', 'purchased', 'closing', 'packKg'];
  // What a snapshot shows back, and what an earlier visit left in localStorage.
  const SHOWN = { opening: {}, purchased: {}, closing: { flour: 3 }, packKg: {} };
  const LEFT_BEHIND = { pending: { closing: { flour: 1, sugar: 2 } }, cleared: { closing: { salt: true } } };
  function history(mod: typeof inventoryOutbox, steps: readonly Step[]): unknown[] {
    let box: inventoryOutbox.Outbox = mod.EMPTY_OUTBOX;
    const trace: unknown[] = [];
    for (const step of steps) {
      if (step[0] === 'stage') box = mod.stage(box, step[1], step[2], step[3]);
      else if (step[0] === 'take') { const taken = mod.take(box); box = taken.outbox; trace.push(taken); continue; }
      else if (step[0] === 'confirm') box = mod.confirm(box);
      else if (step[0] === 'restore') box = mod.restore(box);
      else if (step[0] === 'answer') box = mod.answered(box, step[1]);
      else if (step[0] === 'echo') box = mod.echoed(box, SHOWN, MAPS);
      else if (step[0] === 'revive') box = mod.revive(box, LEFT_BEHIND, MAPS);
      else if (step[0] === 'release') box = mod.release(box);
      else { trace.push(mod.applyOver(box, { opening: { flour: 1 }, purchased: {}, closing: { flour: 1, salt: 5 }, packKg: {} }, MAPS)); continue; }
      trace.push(box, mod.hasWork(box), mod.isSending(box));
      if (legacyOutboxHasTheFix) trace.push(mod.hasUnsaved(box), mod.hasHeld(box), mod.unsaved(box));
    }
    return trace;
  }
  function disagreeing(steps: readonly Step[]): string[] {
    const disagreements: string[] = [];
    let sequences: Step[][] = [[]];
    for (let length = 1; length <= 4; length += 1) {
      sequences = sequences.flatMap(sequence => steps.map(step => [...sequence, step]));
      for (const sequence of sequences) {
        try {
          expect(history(m, sequence)).toStrictEqual(history(l, sequence));
        } catch {
          disagreements.push(sequence.map(step => step.join(' ')).join(' / '));
        }
      }
    }
    return disagreements;
  }
  const sequencesOf = (steps: readonly Step[]): number => steps.length ** 4 + steps.length ** 3 + steps.length ** 2 + steps.length;
  if (legacyOutboxHasTheFix) {
    test(`histories: the same answers at every step of the ${sequencesOf(STEPS)} sequences of up to four steps`, () => {
      expect(disagreeing(STEPS).slice(0, 10)).toStrictEqual([]);
    }, 120_000);
    test(`histories of the fix: the same answers at every step of the ${sequencesOf(FIX_STEPS)} sequences of up to four steps`, () => {
      expect(disagreeing(FIX_STEPS).slice(0, 10)).toStrictEqual([]);
    }, 120_000);
  }
});

// ── inventory-purchases ──────────────────────────────────────────────────────

describe('inventory-purchases: odd inputs', () => {
  const m = inventoryPurchases;
  const l = legacyInventoryPurchases;

  // Order records as the history holds them: the real shape, each field replaced by odd values, and the
  // retired weekly record that has no date.
  const BASE_RECORD = { date: '2026-09-04', quantities: { flour: 10, butter: 2 }, missing: {}, units: {}, supplierId: 'alba' };
  const DATES_OF_ORDERS: readonly unknown[] = [...ODD, '2026-09-04', '2026-09-31', '2026-9-4', '2026-09-04T10:00', '20260904', 20260904, new String('2026-09-04'),
    ' 2026-09-04', '2026-09-04\n', '2026-08-31', '2026-10-01', '2026-09-01', '2026-09-30', '٢٠٢٦-٠٩-٠٤', '9999-99-99', new Date(2026, 8, 4), ['2026-09-04']];
  const QUANTITY_MAPS: readonly unknown[] = [...ODD, { flour: 10 }, { a: 0, b: -3, c: 'HELLO', d: Infinity, e: null, f: 2 }, { flour: '3' }, { flour: ' 3 ' },
    { flour: '3,5' }, { flour: [3] }, { flour: 5n }, { flour: Symbol('q') }, { flour: new Number(2) }, { flour: 1e21 }, { flour: 0.1, butter: 0.2 },
    { flour: true }, { 'olio.extra': 4 }, JSON.parse('{"__proto__": 3, "flour": 1}'), Object.create({ flour: 7 }), 'abc', ['x']];
  const MISSING_MAPS: readonly unknown[] = [...ODD, { flour: true }, { flour: 'yes' }, { flour: 1 }, { butter: true }, { flour: new Boolean(true) },
    'flour', ['flour'], { flour: true, butter: true }];
  const UNIT_MAPS: readonly unknown[] = [...ODD, { flour: 'busta' }, { flour: ' Busta ' }, { flour: 5 }, { flour: '' }, { flour: '   ' }, 'abc', ['x'],
    { butter: 'sacco' }, { flour: 'cartone' }, { flour: 'sacco' }, { flour: null }];
  const RECORDS: readonly unknown[] = [...ODD, 'record', 42, BASE_RECORD, { weekStart: '2026-07-06', quantities: { flour: 9 }, stock: {} },
    { ...BASE_RECORD, units: { flour: 'busta' }, quantities: { flour: 2 } }, { ...BASE_RECORD, units: { flour: 'busta' }, missing: { flour: true } },
    Object.create(BASE_RECORD), { get quantities(): unknown { throw new Error('boom'); } },
    ...varying(BASE_RECORD, { date: DATES_OF_ORDERS, quantities: QUANTITY_MAPS, missing: MISSING_MAPS, units: UNIT_MAPS })];

  agree('isInMonth', m.isInMonth, l.isInMonth, product(RECORDS, MONTH_IDS));
  agree('receivedFrom', m.receivedFrom, l.receivedFrom, product(RECORDS));

  // Cards as the priced ingredients: a plain one, a carton, a stored case of packages and the near-misses.
  const CASED = { id: 'flour', unit: 'cartone', packUnit: 'busta', priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
  const CARTON = { id: 'flour', unit: 'cartone', packUnit: 'busta', packCount: 4 };
  const CARD_UNITS: readonly unknown[] = [undefined, null, '', ' ', 'cartone', 'Cartone', 'busta', ' Busta. ', 'sacco', 'kg', 'pz', 5, {}, ['busta'], new String('busta')];
  const CARDS: readonly unknown[] = [...ODD, 'card', 42, CASED, CARTON, { id: 'flour', unit: 'cartone', packUnit: 'busta' }, { id: 'flour' },
    { ...CASED, caseItemUnit: 'pcs', caseItemSize: null }, { ...CASED, pricePerUnit: 9 }, { ...CASED, packCount: 8 }, { ...CASED, caseCount: 3, casePrice: 30, pricePerUnit: 4 },
    { unit: 'cartone', packUnit: 'pezzo', priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 20, caseCount: 50, caseItemUnit: 'pcs' },
    Object.create(CASED), { get unit(): unknown { throw new Error('boom'); } },
    ...varying(CARTON, { unit: CARD_UNITS, packUnit: CARD_UNITS, packCount: PACK_COUNTS }),
    ...varying(CASED, { unit: CARD_UNITS, packUnit: CARD_UNITS, packCount: PACK_COUNTS, caseCount: PRICE_VALUES.slice(0, 25), casePrice: PRICE_VALUES.slice(0, 25) })];
  const QUANTITIES: readonly unknown[] = [1, 2, 3, 8, 0.5, 100, 0, -1, NaN, Infinity, '3', undefined, null, 5n];
  const LINE_UNITS: readonly unknown[] = [...CARD_UNITS, 'Busta', 'CARTONE', 'x'.repeat(150)];
  agree('qtyInCardUnit', m.qtyInCardUnit as AnyFn, l.qtyInCardUnit as AnyFn, product(QUANTITIES, LINE_UNITS, CARDS));

  const CARD_MAPS: readonly unknown[] = [undefined, null, {}, 'abc', 5, [], true, { flour: CASED }, { flour: CARTON }, { flour: { id: 'flour', unit: 'cartone', packUnit: 'busta' } },
    { flour: null }, { flour: 5 }, { flour: 'str' }, { flour: CASED, butter: CARTON }, { constructor: CASED }, Object.create({ flour: CASED }),
    { flour: { ...CASED, caseItemUnit: 'pcs', caseItemSize: null } }, { flour: { ...CASED, pricePerUnit: 9 } }, { flour: { unit: 'cartone', packUnit: 'busta', packCount: 4 } }];
  const MIXED_RECORDS = [BASE_RECORD, { ...BASE_RECORD, date: '2026-09-18', quantities: { flour: 6, butter: 2 } }, { ...BASE_RECORD, date: '2026-08-30' },
    { ...BASE_RECORD, date: '2026-10-02' }, { ...BASE_RECORD, units: { flour: 'busta' }, quantities: { flour: 2 } },
    { ...BASE_RECORD, units: { flour: 'cartone' }, quantities: { flour: 3 } }, { ...BASE_RECORD, units: { flour: 'sacco' }, quantities: { flour: 1 } },
    { ...BASE_RECORD, units: { flour: 'busta' }, missing: { flour: true } }, { ...BASE_RECORD, quantities: { flour: 0.1 } }, { ...BASE_RECORD, quantities: { flour: 0.2 } },
    { weekStart: '2026-07-06', quantities: { flour: 9 } }, null];
  const RECORD_LISTS: readonly unknown[] = [undefined, null, [], 'abc', 5, {}, true, new Set(MIXED_RECORDS), { length: 1, 0: BASE_RECORD }, Object.freeze([BASE_RECORD]),
    MIXED_RECORDS, MIXED_RECORDS.slice().reverse(), MIXED_RECORDS.slice(0, 5), MIXED_RECORDS.slice(4, 8), [undefined, 0, '', false],
    ...RECORDS.map(record => [record])];
  agree('purchasesInMonth', m.purchasesInMonth as AnyFn, l.purchasesInMonth as AnyFn,
    product(RECORD_LISTS, ['2026-09', '2026-08', '2026-10', 'junk', undefined, 202609], CARD_MAPS));
});

// ── inventory-value ──────────────────────────────────────────────────────────

describe('inventory-value: odd inputs', () => {
  // A partial port: only what it exports is compared (formatTotal stays in js/; Mise 2 writes money with
  // price-model's formatMoney).
  const m = inventoryValue;
  const l = legacyInventoryValue;

  const FLOUR = { id: 'flour', name: 'Flour', weight: '25kg', priceUnit: 'kg', pricePerUnit: 0.8 };
  const PIECE = { id: 'box', name: 'Box', weight: '', priceUnit: 'pcs', pricePerUnit: 0.15 };
  const CARTON = { id: 'flour', unit: 'cartone', packUnit: 'busta', packCount: 4, weight: '2.5kg', priceUnit: 'kg', pricePerUnit: 2 };
  const PACK_CASE = { id: 'flour', unit: 'cartone', packUnit: 'busta', weight: 'sacco', priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack' };
  const EGG_CASE = { id: 'e', unit: 'pz', casePrice: 54, caseCount: 360, caseItemUnit: 'pcs', priceUnit: 'pcs', pricePerUnit: 0.15 };
  const WEIGHED_EGG = { id: 'e', unit: 'cartone', packUnit: 'uovo', packCount: 30, weight: '60g', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 };
  const CARD_WEIGHTS: readonly unknown[] = [undefined, '', '25kg', '2.5kg', '2,27 kg', '500g', '750ml', '1L', '6x1kg', '6x1l', '12 x 500 g', 'sacco', '360 g', '60g',
    'kg 5', '0kg', '-2kg', 25, null, {}, ['25kg'], new String('25kg')];
  const CARD_UNITS: readonly unknown[] = [undefined, null, '', 'kg', 'g', 'l', 'ml', 'pz', 'pezzi', 'cartone', 'Cassa', 'busta', 'sacco', 'scatola', 'vaschetta',
    'constructor', 5, {}, ['kg']];
  const CARD_PACK_UNITS: readonly unknown[] = [undefined, null, '', 'busta', 'Busta.', 'pezzo', 'scatola', 'sacco', 'uovo', 5];
  const CARD_RATES: readonly unknown[] = [undefined, null, 0, -1, 0.15, 0.8, 2, 3.2, 0.000049, 1e21, '2', ' 2 ', 'free', NaN, Infinity, {}, [2], true, 5n];
  const CARDS: readonly unknown[] = [...ODD, 'card', 42, FLOUR, PIECE, CARTON, PACK_CASE, EGG_CASE, WEIGHED_EGG, { ...CARTON, unit: 'busta' }, { ...CARTON, weight: '6x1kg' },
    { ...CARTON, weight: '6x1l', priceUnit: 'pcs', pricePerUnit: 0.4, packCount: 6 }, { ...CARTON, packCount: undefined }, { ...PIECE, packCount: 6, unit: 'cartone', weight: '' },
    { ...PACK_CASE, pricePerUnit: 3 }, { ...PACK_CASE, unit: 'busta' }, { ...PACK_CASE, unit: 'kg' }, { ...PACK_CASE, priceUnit: null, pricePerUnit: null },
    { ...PACK_CASE, caseItemSize: null }, { ...EGG_CASE, unit: 'cartone' }, { ...EGG_CASE, casePrice: 0.49, caseCount: 10000, pricePerUnit: 0.000049 },
    { id: 'e', unit: 'vaschetta', packUnit: 'vaschetta', priceUnit: 'pcs', pricePerUnit: 0.4, casePrice: 12, caseCount: 30, caseItemUnit: 'pcs' },
    Object.create(FLOUR), { id: 'x', get weight(): unknown { throw new Error('boom'); } }, { get id(): unknown { throw new Error('boom'); } },
    ...varying(FLOUR, { id: BOX_IDS, weight: CARD_WEIGHTS, priceUnit: PRICE_UNIT_WORDS, pricePerUnit: CARD_RATES, unit: CARD_UNITS, packCount: PACK_COUNTS }),
    ...varying(CARTON, { unit: CARD_UNITS, packUnit: CARD_PACK_UNITS, packCount: PACK_COUNTS, weight: CARD_WEIGHTS, pricePerUnit: CARD_RATES, priceUnit: PRICE_UNIT_WORDS }),
    ...varying(PIECE, { pricePerUnit: CARD_RATES, priceUnit: PRICE_UNIT_WORDS, packCount: PACK_COUNTS, unit: CARD_UNITS }),
    ...varying(PACK_CASE, { casePrice: PRICE_VALUES.slice(0, 25), caseCount: PRICE_VALUES.slice(0, 25), caseItemSize: PRICE_VALUES.slice(0, 25), unit: CARD_UNITS, packUnit: CARD_PACK_UNITS }),
  ];
  const SOME_CARDS: readonly unknown[] = [...CARDS.slice(0, 40), ...CARDS.slice(40).filter((_, index) => index % 4 === 0)];

  // Months as the screens hold them, whole or not: the weight typed in, the price frozen at the close, and what is near.
  const MONTHS: readonly unknown[] = [...ODD, 'month', 42, { packKg: {} }, { packKg: { flour: 20 } }, { packKg: { flour: 'HELLO' } }, { packKg: { flour: 0 } },
    { packKg: { flour: -5 } }, { packKg: { flour: '25' } }, { packKg: { flour: 1e21 } }, { packKg: 'abc' }, { packKg: null }, { packKg: [] }, { packKg: { x: 12 } },
    { packKg: { flour: 12 }, unitPrice: { flour: 12.5, box: 0.11 } }, { packKg: { flour: 25 }, unitPrice: { flour: 12.5 } }, { unitPrice: {} }, { unitPrice: { flour: 12.5 } },
    { unitPrice: { flour: 0 } }, { unitPrice: { flour: 'x' } }, { unitPrice: { flour: '12.5' } }, { unitPrice: [] }, { unitPrice: 'abc' }, { unitPrice: { flour: 1e21 } },
    { unitPrice: { e: 18, flour: 20 } }, Object.create({ packKg: { flour: 20 } }), { get packKg(): unknown { throw new Error('boom'); } },
    { get unitPrice(): unknown { throw new Error('boom'); } }];
  const CLOSED_FLAGS: readonly unknown[] = [undefined, true, false, 0, 1, '', 'closed', null];

  // Every month with the cards written by hand and every fifth of the one-field-at-a-time variations; then the
  // first months with every card. The functions that read a month and a card meet every combination of the two.
  const READERS = [...product(MONTHS, SOME_CARDS, CLOSED_FLAGS), ...product(MONTHS.slice(0, 12), CARDS, CLOSED_FLAGS.slice(0, 3))];
  agree('packKgFor', m.packKgFor as AnyFn, l.packKgFor as AnyFn, READERS);
  agree('packPrice', m.packPrice as AnyFn, l.packPrice as AnyFn, READERS);
  agree('valueBlocker', m.valueBlocker as AnyFn, l.valueBlocker as AnyFn, READERS);
  agree('casePackNote', m.casePackNote, l.casePackNote, product(CARDS));
  agree('parsePackSize (the re-export)', m.parsePackSize, l.parsePackSize, product(WEIGHT_TEXTS));

  const USED: readonly unknown[] = [...ODD, 3, 0.5, -2, 1e21, 0.1 + 0.2, '3', ' 3 ', 5n, new Number(3), [3], { valueOf: () => 3 }, Symbol('used')];
  agree('lineValue', m.lineValue as AnyFn, l.lineValue as AnyFn, product(MONTHS.slice(0, 12), SOME_CARDS.slice(0, 50), USED, CLOSED_FLAGS.slice(0, 3)));

  // monthCost is handed one object. The consumers answer with numbers, with nothing and with things that
  // are not numbers; the lists hold the usual, ties and holes.
  const TIES = [{ id: 'b', name: 'Beta' }, { id: 'a', name: 'Alpha' }, { id: 'c', name: 'Zed', shortName: 'Alpha' }, { id: 'd', name: 'alpha' }, { id: 'e', name: 'Éclair' },
    { id: 'f', name: 'eclair' }, { id: 'g', name: '' }, { id: 'h' }].map(card => ({ weight: '1kg', priceUnit: 'kg', pricePerUnit: 1, ...card }));
  const OIL = { ...FLOUR, id: 'oil', name: 'Oil', weight: 'damigiana', priceUnit: 'l', pricePerUnit: 3 };
  const COST_LISTS: readonly unknown[] = [undefined, null, [], 'abc', 5, {}, [FLOUR], [FLOUR, PIECE], [PIECE, FLOUR, OIL], [null, FLOUR], [FLOUR, FLOUR],
    [CARTON], [PACK_CASE, EGG_CASE], TIES, TIES.slice().reverse(), [{ id: 'flour', name: 'Flour 25kg', weight: '' }], Object.freeze([FLOUR]), new Set([FLOUR])];
  const COST_USED: readonly unknown[] = [() => 3, () => null, () => undefined, () => 0, () => -2, () => 0.5, () => '3', () => NaN, () => Infinity, () => ({}), () => [2],
    (ing: unknown) => ((ing as { id?: unknown } | null)?.id === 'flour' ? 3 : null), (ing: unknown) => ((ing as { id?: unknown } | null)?.id === 'box' ? 100 : 2),
    () => { throw new Error('boom'); }, undefined, null, 5];
  const COST_MONTHS: readonly unknown[] = [undefined, null, {}, { packKg: {} }, { packKg: { flour: 25 }, unitPrice: { flour: 12.5, box: 0.11, e: 18 } },
    { packKg: { flour: 12 } }, { unitPrice: {} }, 'month'];
  agree('monthCost', m.monthCost as AnyFn, l.monthCost as AnyFn, [
    ...product(COST_MONTHS, COST_LISTS, COST_USED, [undefined, true, false]).map(([month, ingredients, consumptionOf, closed]) => [{ month, ingredients, consumptionOf, closed }]),
    [undefined], [null], [{}], [5], ['abc'], [{ month: {}, ingredients: [FLOUR] }], [{ ingredients: [FLOUR], consumptionOf: () => 1 }],
  ]);
});

// ── vat-rates, ingredient-kind, product-limits, vat-guide ────────────────────

// Countries as a venue document, a typo or the prototype chain may hand them over.
const COUNTRY_WORDS: readonly unknown[] = [...ODD, 'IT', 'GB', 'FR', 'it', 'gb', 'IT ', ' GB', 'toString', '__proto__', 'constructor', 'hasOwnProperty',
  'valueOf', 'UK', 'DE', 5, ['IT'], new String('IT'), { toString: () => 'IT' }, Symbol('IT')];

describe('vat-rates: odd inputs', () => {
  agree('vatRatesFor', vatRates.vatRatesFor, legacyVatRates.vatRatesFor, product(COUNTRY_WORDS));
});

describe('ingredient-kind: odd inputs', () => {
  const ITEMS: readonly unknown[] = [...ODD, 'packaging', 42, { kind: 'packaging' }, { kind: 'ingredient' }, { kind: 'Packaging' }, { kind: 'packaging ' },
    { kind: ' packaging' }, { kind: ['packaging'] }, { kind: new String('packaging') }, { kind: null }, { kind: 1 }, { kind: undefined }, { name: 'Flour' },
    Object.create({ kind: 'packaging' }), [], Object.assign([], { kind: 'packaging' }), () => 'packaging', new Map([['kind', 'packaging']]),
    { get kind(): unknown { throw new Error('boom'); } }];
  agree('isPackaging', ingredientKind.isPackaging, legacyIngredientKind.isPackaging, product(ITEMS));
  agree('kindOf', ingredientKind.kindOf, legacyIngredientKind.kindOf, product(ITEMS));
});

describe('product-limits: odd inputs', () => {
  const m = productLimits;
  const l = legacyProductLimits;

  const LIMIT_VALUES: readonly unknown[] = [...PRICE_VALUES, 0, 1, 100, 100.0001, 101, 1000, 1000.5, 1001, 100000, 100001, 1000000, 1000001, 10000, 10000.01,
    Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -0];
  const LIMITS: readonly unknown[] = [...ODD, ...m.PRODUCT_NUMBER_LIMITS, { min: 0, minInclusive: true, max: null }, { min: 0, minInclusive: false },
    { min: 5, max: 10 }, { min: '0', minInclusive: 1, max: '10' }, { key: 'x', min: -1, minInclusive: false, max: 0 }];
  agree('numberAllowed', m.numberAllowed as AnyFn, l.numberAllowed as AnyFn, product(LIMITS, LIMIT_VALUES));

  const PRODUCT_BASE = { piecesPerBatch: 100, packSize: 250, labourMinutes: 90, labourPeople: 2, sellingPrice: 1.2, vatRate: 20, foodCostTarget: 30 };
  const PRODUCTS: readonly unknown[] = [...ODD, 'product', 42, PRODUCT_BASE, ...varying(PRODUCT_BASE, Object.fromEntries(
    m.PRODUCT_NUMBER_LIMITS.map(limit => [limit.key, LIMIT_VALUES]))), { piecesPerBatch: 0, labourPeople: 0 }, Object.create(PRODUCT_BASE),
  { get packSize(): unknown { throw new Error('boom'); } }];
  agree('firstInvalidNumber', m.firstInvalidNumber, l.firstInvalidNumber, product(PRODUCTS));
  agree('labourRateAllowed', m.labourRateAllowed, l.labourRateAllowed, product(LIMIT_VALUES));
});

describe('vat-guide: odd inputs', () => {
  agree('vatGuideFor', vatGuide.vatGuideFor, legacyVatGuide.vatGuideFor, product(COUNTRY_WORDS));
});

// ── catalogue-model ──────────────────────────────────────────────────────────

// Units a recipe row may carry, and near-misses of them.
const ROW_UNITS: readonly unknown[] = [...ODD, 'g', 'kg', 'mg', 'ml', 'cl', 'dl', 'l', 'pcs', 'tsp', 'tbsp', 'pinch', 'to taste', 'G', ' g', 'oz', 'lb', 'toString',
  '__proto__', 'constructor', 'hasOwnProperty', new String('kg'), ['kg'], { toString: () => 'kg' }];

describe('catalogue-model: odd inputs', () => {
  // A partial port: only what it exports is compared.
  const m = catalogueModel;
  const l = legacyCatalogueModel;

  const ROWS: readonly unknown[] = [...ODD, 'row', 42, { label: 'Flour', grams: 800, unit: 'g' }, { grams: 1 }, { grams: 1, unit: 'kg' },
    ...varying({ label: 'Flour', grams: 500, unit: 'g' }, { grams: PRICE_VALUES.slice(0, 30), unit: ROW_UNITS }),
    Object.create({ grams: 5, unit: 'kg' }), { get unit(): unknown { throw new Error('boom'); } }];
  agree('unitOf', m.unitOf, l.unitOf, product(ROWS));
  agree('isWeighableUnit', m.isWeighableUnit, l.isWeighableUnit, product(ROW_UNITS));
  // ⚠️ QUIRK COPIED: a null or undefined row throws a TypeError in both (see ingredientGrams in catalogue-model.ts).
  agree('ingredientGrams', m.ingredientGrams, l.ingredientGrams, product(ROWS));

  const RECIPE_BASE = { ingredients: [{ label: 'A', grams: 1, unit: 'kg' }, { label: 'B', grams: 500, unit: 'g' }, { label: 'C', grams: 0.5, unit: 'l' },
    { label: 'D', grams: 3, unit: 'pcs' }] };
  agree('weighableTotalGrams', m.weighableTotalGrams, l.weighableTotalGrams, product([...ODD, RECIPE_BASE, { ingredients: [] }, { ingredients: 'x' },
    { ingredients: [null] }, { ingredients: [undefined, { grams: 2 }] }, { ingredients: [{ grams: 'x' }, { grams: 3, unit: 'kg' }] },
    ...ROWS.slice(0, 40).map(row => ({ ingredients: [row] }))]));

  const LINKS: readonly unknown[] = [...ODD, 'link', { refId: 'X' }, { refId: '' }, { refId: '   ' }, { refId: 5 }, { refId: 0 }, { refId: ' R1 ', kind: 'recipe' },
    { refId: 'X', kind: 'nonsense' }, { refId: 'X', kind: 'ingredient' }, { refId: 'X', kind: 'Recipe' }, { refId: 'X', kind: ['recipe'] },
    { refId: 'X', kind: 'toString' }, { refId: null, kind: 'recipe' }, { refId: undefined }, { refId: { toString: () => 'obj' }, kind: 'recipe' },
    { refId: ['a'] }, Object.create({ refId: 'P', kind: 'recipe' }), { get refId(): unknown { throw new Error('boom'); } }];
  agree('linkOf', m.linkOf, l.linkOf, product(LINKS));

  agree('normalizeLossPct', m.normalizeLossPct, l.normalizeLossPct, product([...PRICE_VALUES, 99, 99.5, 100, 12.5, 0.01, '12.5', '99.9', '100']));
  agree('normalizeWeight', m.normalizeWeight, l.normalizeWeight, product([...PRICE_VALUES, 10000000, 10000001, 850, '850', 1e7, 0.5]));
  const WEIGHTS: readonly unknown[] = [...PRICE_VALUES.slice(0, 30), 1000, 800, 8380, 7374, 7373, 3000, 2555, 1, 1100, 10000000, 99, 0.001, '1000', ' 800 '];
  agree('weightLoss', m.weightLoss, l.weightLoss, product(WEIGHTS, WEIGHTS));

  agree('normalizeSearchText', m.normalizeSearchText, l.normalizeSearchText, product([...ODD, 'Però CRÈME fraîche', '  Burro  ', 'ÀÈÌÒÙ àèìòù', 'ﬁ', 'Å', 'á', 'İstanbul',
    'x'.repeat(300), 'tab\there', 'ǅ', '̀', 5, 0, true, [1, 2], { toString: () => 'ÉCLAIR' }, new String('É'), 5n, Symbol('s')]));

  const SG_INGREDIENTS: readonly unknown[] = [undefined, null, {}, 'abc', 5, [], true, new Map(),
    { B1: { id: 'B1', name: 'Burro Occelli', weight: '1 kg', supplierId: 'S1' }, B2: { id: 'B2', name: 'Burro chiarificato', supplierId: 'S2' },
      P1: { id: 'P1', name: 'Pasta sfoglia al burro' }, OLD: { id: 'OLD', name: 'Burro vecchio', active: false },
      BOX: { id: 'BOX', name: 'Burro box', kind: 'packaging' }, CR: { id: 'CR', name: 'Crème fraîche', shortName: 'Crème F.' } },
    { a: { id: 'a', name: 'Insalata' }, b: { id: 'b', name: 'Olio di semi al sale' }, c: { id: 'c', name: 'Salmone' }, d: { id: 'd', name: 'Sale fino' } },
    { a: null, b: 5, c: 'str', d: [], e: { id: 'e', name: 'Sale' }, f: { name: 'Salvia' }, g: { id: 'g' }, h: { id: 'h', name: '  ' } },
    { a: { id: 'z1', name: 'Zucchero 1' }, b: { id: 'z2', name: 'Zucchero 2' }, c: { id: 'z3', name: 'Zucchero 3' }, d: { id: 'z4', name: 'Zucchero 4' },
      e: { id: 'z5', name: 'Zucchero 5' }, f: { id: 'z6', name: 'Zucchero 6' }, g: { id: 'z7', name: 'Zucchero 7' } },
    { a: { id: 7, name: 'Burro 7' }, b: { id: 'b', name: 'Burro', shortName: 5 }, c: { id: 'c', name: 5 }, d: { id: 'd', name: 'Burro', shortName: ' Bur ' } },
    { a: { id: 'a', name: 'Burro', active: 0 }, b: { id: 'b', name: 'Burro', active: false }, c: { id: 'c', name: 'Burro', active: null } },
    new Map([['a', { id: 'a', name: 'Burro' }]])];
  const SG_RECIPES: readonly unknown[] = [undefined, null, [], 'abc', 5, {}, [{ id: 'R1', name: 'Crema al burro' }, { id: 'SELF', name: 'Burro montato' }],
    { R1: { id: 'R1', name: 'Crema al burro' }, SELF: { id: 'SELF', name: 'Burro montato' } },
    [{ id: 'r', name: 'Miele caramellato' }], [null, 0, '', { id: 'x' }, { id: 'y', name: '  ' }, { id: 'z', name: 'Burro z' }],
    [{ id: 'a', name: 'Burro b' }, { id: 'b', name: 'Burro a' }, { id: 'a', name: 'Burro' }], [{ id: 5, name: 'Burro 5' }, { id: 'SELF', name: 'Self' }]];
  const SG_SUPPLIERS: readonly unknown[] = [undefined, null, {}, 'abc', 5, { S1: { name: 'Brava Fresh' }, S2: { name: 'Latteria', shortName: ' Latt. ' } },
    { S1: null, S2: 5, S3: { name: 5 } }, new Map([['S1', { name: 'Brava' }]])];
  const SG_QUERIES: readonly unknown[] = [...ODD, 'bu', 'burro', 'BURRO', 'creme', 'CRÈME', 'crème fr', 'sal', 'zucchero', 'miele', 'brava', 'latteria', '500 g', 'z',
    ' ', '  b ', 'sa', 'bur', 'u', 'burro  ', 'ro', 'ì', 5, { toString: () => 'burro' }];
  const SG_LINKED: readonly unknown[] = [undefined, null, { kind: 'ingredient', refId: 'B1' }, { kind: 'recipe', refId: 'R1' }, { kind: 'recipe', refId: 'B1' },
    { kind: 'ingredient', refId: 'a' }, {}, 5, 'x'];
  const SG_LIMITS: readonly unknown[] = [undefined, null, 0, 1, 3, 5, 50, 2.9, 0.5, -1, '3', 'junk', NaN, Infinity, [], {}, true];
  const SG_EXCLUDE: readonly unknown[] = [undefined, null, 'SELF', 'R1', 'a', 5, ''];

  const suggestInputs = (): unknown[][] => [
    [], [undefined], [null], [5], ['abc'], [{}],
    ...product(SG_INGREDIENTS, SG_RECIPES, SG_QUERIES.slice(0, 20)).map(([ingredients, recipes, query]) => [{ ingredients, recipes, query, excludeRecipeId: 'SELF' }]),
    ...product(SG_INGREDIENTS.slice(7), SG_RECIPES, SG_SUPPLIERS, ['bu', 'burro', 'sal']).map(([ingredients, recipes, suppliers, query]) => [{ ingredients, recipes, suppliers, query }]),
    ...product(SG_QUERIES).map(([query]) => [{ ingredients: SG_INGREDIENTS[8], recipes: SG_RECIPES[6], suppliers: SG_SUPPLIERS[5], query, excludeRecipeId: 'SELF' }]),
    ...product(SG_LINKED, SG_LIMITS, SG_EXCLUDE).map(([linked, limit, excludeRecipeId]) => [{
      ingredients: SG_INGREDIENTS[8], recipes: SG_RECIPES[6], suppliers: SG_SUPPLIERS[5], query: 'burro', linked, limit, excludeRecipeId }]),
    [{ ingredients: SG_INGREDIENTS[11], recipes: [], query: 'zucchero' }], [{ ingredients: SG_INGREDIENTS[11], recipes: [], query: 'zucchero', limit: 3 }],
  ];
  agree('suggestLinks', m.suggestLinks as AnyFn, l.suggestLinks as AnyFn, suggestInputs());
});

// ── recipe-cost-model ────────────────────────────────────────────────────────

// The ingredients and recipes the cost models are tried against: priced by weight, volume and piece, unpriced, deleted, looping.
const RC_INGREDIENTS = {
  FLOUR: { name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 },
  BUTTER: { name: 'Butter', priceUnit: 'kg', pricePerUnit: 8 },
  MILK: { name: 'Milk', priceUnit: 'l', pricePerUnit: 1.2 },
  EGG: { name: 'Egg', priceUnit: 'pcs', pricePerUnit: 0.3, unitWeightKg: 0.055 },
  EGG2: { name: 'Egg, no weight', priceUnit: 'pcs', pricePerUnit: 0.3 },
  SALT: { name: 'Salt' },
  FREE: { name: 'Free', priceUnit: 'kg', pricePerUnit: 0 },
  JUNK: 5,
  NOTHING: null,
};
const rcRow = (label: unknown, grams: unknown, over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ label, grams, unit: 'g', kind: 'ingredient', ...over });
const RC_RECIPES: Record<string, Record<string, unknown>> = {
  CREAM: { id: 'CREAM', name: 'Pastry cream', lossPct: 0, ingredients: [rcRow('Milk', 500, { refId: 'MILK', unit: 'ml' }), rcRow('Egg', 500, { refId: 'EGG' })] },
  DOUGH: { id: 'DOUGH', name: 'Dough', lossPct: 0, ingredients: [rcRow('Flour', 800, { refId: 'FLOUR' }), rcRow('Butter', 200, { refId: 'BUTTER' })] },
  BAKED: { id: 'BAKED', name: 'Baked', lossPct: 25, ingredients: [rcRow('Flour', 800, { refId: 'FLOUR' }), rcRow('Butter', 200, { refId: 'BUTTER' })] },
  HALF: { id: 'HALF', name: 'Half', lossPct: 0, ingredients: [rcRow('Flour', 500, { refId: 'FLOUR' }), rcRow('Mystery', 500)] },
  MYSTERY: { id: 'MYSTERY', name: 'Mystery', lossPct: 0, ingredients: [rcRow('Something', 500)] },
  LOOP: { id: 'LOOP', name: 'Loop', lossPct: 0, ingredients: [rcRow('Itself', 100, { kind: 'recipe', refId: 'LOOP' })] },
  A: { id: 'A', name: 'A', lossPct: 0, ingredients: [rcRow('B', 100, { kind: 'recipe', refId: 'B' })] },
  B: { id: 'B', name: 'B', lossPct: 0, ingredients: [rcRow('A', 100, { kind: 'recipe', refId: 'A' })] },
  CAKE: { id: 'CAKE', name: 'Cake', lossPct: 10, ingredients: [rcRow('Cream', 500, { kind: 'recipe', refId: 'CREAM' }), rcRow('Flour', 500, { refId: 'FLOUR' })] },
  L0: { id: 'L0', name: 'L0', lossPct: 0, ingredients: [rcRow('L1', 1000, { kind: 'recipe', refId: 'L1' })] },
  L1: { id: 'L1', name: 'L1', lossPct: 0, ingredients: [rcRow('L2', 1000, { kind: 'recipe', refId: 'L2' })] },
  L2: { id: 'L2', name: 'L2', lossPct: 0, ingredients: [rcRow('L3', 1000, { kind: 'recipe', refId: 'L3' })] },
  L3: { id: 'L3', name: 'L3', lossPct: 0, ingredients: [rcRow('L4', 1000, { kind: 'recipe', refId: 'L4' })] },
  L4: { id: 'L4', name: 'L4', lossPct: 0, ingredients: [rcRow('Flour', 1000, { refId: 'FLOUR' })] },
  NOLOSS: { id: 'NOLOSS', name: 'Old', ingredients: [rcRow('Flour', 1000, { refId: 'FLOUR' })] },
  NOID: { name: 'No id', lossPct: 0, ingredients: [rcRow('Flour', 1000, { refId: 'FLOUR' })] },
  EMPTY: { id: 'EMPTY', name: 'Empty', lossPct: 0, ingredients: [] },
};

const RC_TABLES: readonly unknown[] = [undefined, {}, { ingredients: RC_INGREDIENTS }, { recipes: RC_RECIPES }, { ingredients: RC_INGREDIENTS, recipes: RC_RECIPES },
  { ingredients: new Map(Object.entries(RC_INGREDIENTS)), recipes: new Map(Object.entries(RC_RECIPES)) },
  { ingredients: RC_INGREDIENTS, recipes: { LOOP: RC_RECIPES['LOOP'] } }, { ingredients: 5, recipes: 'abc' }, { ingredients: null, recipes: null },
  { ingredients: [], recipes: [] }, { ingredients: { get: () => RC_INGREDIENTS.FLOUR }, recipes: {} }, { ingredients: { get: 5, FLOUR: RC_INGREDIENTS.FLOUR } },
  { ingredients: Object.create(RC_INGREDIENTS), recipes: Object.create(RC_RECIPES) },
  { ingredients: RC_INGREDIENTS, recipes: { CREAM: { id: 'CREAM', ingredients: [rcRow('Milk', 500, { refId: 'MILK' })] }, X: 5, Y: null } }];

describe('recipe-cost-model: odd inputs', () => {
  // A partial port: only what it exports is compared (costReasonLabel and partialCostText stay in js/).
  const m = recipeCostModel;
  const l = legacyRecipeCostModel;

  const RC_GRAMS: readonly unknown[] = [...PRICE_VALUES.slice(0, 30), 800, 1000, 1, 165, 500];
  const RC_LABELS: readonly unknown[] = ['Flour', '', '  ', undefined, null, 5, 'x'];
  const RC_REFS: readonly unknown[] = ['FLOUR', 'BUTTER', 'MILK', 'EGG', 'EGG2', 'SALT', 'FREE', 'JUNK', 'NOTHING', 'NOPE', '', undefined, 5, 'toString', '__proto__', 'constructor'];
  const RC_LOSSES: readonly unknown[] = [undefined, null, 0, 20, 99, 100, 1000, -5, '20', 'abc', NaN, {}];
  const rcBase = { id: 'R1', name: 'Test', lossPct: 0, ingredients: [rcRow('Flour', 800, { refId: 'FLOUR' })] };
  const RECIPES: readonly unknown[] = [...ODD, 'recipe', 42, ...Object.values(RC_RECIPES), rcBase, { ingredients: [] }, { ingredients: 'x' }, { ingredients: [null] },
    { ingredients: [undefined, 5, 'row'] }, { ingredients: [{}] }, { ingredients: [{ label: 'x' }] },
    ...RC_LOSSES.map(lossPct => ({ ...rcBase, lossPct })),
    ...RC_GRAMS.map(grams => ({ ...rcBase, ingredients: [rcRow('Flour', grams, { refId: 'FLOUR' })] })),
    ...ROW_UNITS.map(unit => ({ ...rcBase, ingredients: [rcRow('Flour', 1000, { refId: 'FLOUR', unit })] })),
    ...RC_REFS.map(refId => ({ ...rcBase, ingredients: [rcRow('Row', 500, { refId })] })),
    ...RC_REFS.map(refId => ({ ...rcBase, ingredients: [rcRow('Row', 500, { refId, kind: 'recipe' })] })),
    ...RC_LABELS.map(label => ({ ...rcBase, ingredients: [rcRow(label, 500), rcRow(label, 500, { refId: 'FLOUR' })] })),
    ...[undefined, null, '', 5, 'x', 0].map(id => ({ ...rcBase, id })),
    { ...rcBase, ingredients: [rcRow('Flour', 1000, { refId: 'FLOUR', kind: 'nonsense' }), rcRow('X', 10, { refId: 'CREAM', kind: 'recipe' })] },
    Object.create(rcBase), { get ingredients(): unknown { throw new Error('boom'); } }];
  agree('costRecipe', m.costRecipe as AnyFn, l.costRecipe as AnyFn, [
    ...product(RECIPES, RC_TABLES.slice(0, 6)),
    ...product(RECIPES.slice(0, 40), RC_TABLES.slice(6)),
    ...product([RC_RECIPES['CAKE'], RC_RECIPES['L0'], RC_RECIPES['LOOP'], RC_RECIPES['A']], RC_TABLES.slice(0, 6), [undefined, 1, 2, 3, 4, 5, 0, -1, NaN, '2', null],
      [undefined, new Set(), new Set(['A']), new Set(['CREAM']), ['A'], 'ab', null, new Set(['L1'])]),
  ]);
});

// ── foodcost-weighing ────────────────────────────────────────────────────────

describe('foodcost-weighing: odd inputs', () => {
  const m = foodcostWeighing;
  const l = legacyFoodcostWeighing;

  const foc = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'foc', name: 'Focaccia',
    ingredients: [{ label: 'Flour', grams: 600, unit: 'g' }, { label: 'Water', grams: 400, unit: 'g' }, { label: 'Rosemary', grams: 0, unit: 'to taste' }],
    ...extra,
  });
  const WEIGH_NUMS: readonly unknown[] = [...PRICE_VALUES.slice(0, 30), 1000, 800, 1250, 1100, 1, 0.5, 10000000, 1e7 + 1, '1000', ' 800 ', '', '   ', 1000.5];
  const RECIPES: readonly unknown[] = [...ODD, 'recipe', 42, foc(), foc({ lossPct: 0 }), foc({ lossPct: 12 }), foc({ lossPct: 20, rawGrams: 1000, cookedGrams: 800 }),
    foc({ lossPct: 5, rawGrams: 1000, cookedGrams: 1200 }), foc({ rawGrams: 1000 }), foc({ cookedGrams: 800 }), { id: 'x', ingredients: [] }, { id: 'y' },
    ...WEIGH_NUMS.slice(0, 40).map(rawGrams => foc({ rawGrams, cookedGrams: 800, lossPct: 20 })),
    ...WEIGH_NUMS.slice(0, 40).map(lossPct => foc({ lossPct })),
    ...WEIGH_NUMS.slice(0, 40).map(cookedGrams => foc({ rawGrams: 1000, cookedGrams })),
    Object.create(foc({ lossPct: 12 })), { get rawGrams(): unknown { throw new Error('boom'); } }];
  agree('startWeighing', m.startWeighing, l.startWeighing, product(RECIPES));

  const STATES: readonly unknown[] = [...RECIPES.slice(0, 30).map(r => l.startWeighing(r)),
    ...[0, 1000, 800, 1250, '5', NaN, -3].flatMap(raw => [true, false].flatMap(rawTyped => [true, false].flatMap(touched => [true, false].map(weighed =>
      ({ raw, cooked: 800, rawTyped, weighed, touched }))))),
    { raw: 1000, cooked: 1100, rawTyped: true, weighed: true, touched: true }, { raw: 1000, cooked: 1, rawTyped: true, weighed: true, touched: true },
    { raw: 1000, cooked: 0, rawTyped: true, weighed: true, touched: true }, { raw: 0, cooked: 800, rawTyped: false, weighed: true, touched: true },
    {}, { touched: true }];
  agree('typeRaw', m.typeRaw, l.typeRaw, product(STATES.slice(0, 30), WEIGH_NUMS));
  agree('typeCooked', m.typeCooked, l.typeCooked, product(STATES.slice(0, 30), WEIGH_NUMS));
  agree('readWeighing', m.readWeighing, l.readWeighing, [...product(RECIPES.slice(0, 60), STATES), ...product(RECIPES.slice(60), STATES.slice(0, 12)),
    [null, undefined], [undefined, null], [foc(), 5], [foc(), 'x']]);

  const PATCHES: readonly unknown[] = [...ODD, 'patch', { foc: { lossPct: 20, rawGrams: 1000, cookedGrams: 800 } }, { nope: { lossPct: 5 } },
    { foc: null }, { foc: 5 }, { foc: 'x' }, { foc: [] }, { foc: { name: 'Renamed' }, bri: { lossPct: 1 } }, { toString: { lossPct: 5 } },
    JSON.parse('{"__proto__":{"lossPct":5}}'), Object.create({ foc: { lossPct: 7 } })];
  const TABLES: readonly unknown[] = [undefined, null, {}, 5, 'x', { recipes: { foc: foc({ lossPct: 12 }) }, ingredients: {} }, { recipes: {} }, { recipes: null },
    { recipes: { foc: null } }, { recipes: { foc: 5 } }, { recipes: 'abc' }, { ingredients: {} }, { recipes: { foc: foc() }, bakery: 'main' }, []];
  agree('withWeighings', m.withWeighings as AnyFn, l.withWeighings as AnyFn, product(TABLES, PATCHES));

  const RECIPE_MAPS: readonly unknown[] = [undefined, null, {}, 5, 'abc', { foc: foc({ lossPct: 12 }) }, { foc: foc({ lossPct: 20, rawGrams: 1000, cookedGrams: 800 }) },
    { foc: foc(), bri: { id: 'bri', ingredients: [{ label: 'Flour', grams: 500, unit: 'g' }] } }, { foc: null }, { foc: 5 }, { foc: {} },
    Object.create({ foc: foc() }), { toString: foc() }];
  const STATE_MAPS: readonly unknown[] = [undefined, null, {}, 5, 'abc', [],
    { foc: l.typeCooked(l.startWeighing(foc({ lossPct: 12 })), '800') }, { foc: l.startWeighing(foc()) }, { foc: null }, { foc: undefined }, { foc: 5 },
    { foc: l.typeCooked(l.typeRaw(l.startWeighing(foc()), '1000'), '800'), bri: l.typeCooked(l.startWeighing(foc()), '400') },
    { gone: l.typeCooked(l.typeRaw(l.startWeighing(foc()), '1000'), '800') }, { foc: l.typeCooked(l.startWeighing(foc()), '1100') },
    { foc: l.typeCooked(l.startWeighing(foc()), '1') }];
  const ID_LISTS: readonly unknown[] = [undefined, null, [], ['foc'], ['foc', 'bri', 'gone', ''], 'foc', 5, {}, new Set(['foc']), [5, null], 'bri'];
  agree('weighingPatches', m.weighingPatches, l.weighingPatches, product(RECIPE_MAPS, STATE_MAPS, ID_LISTS));

  const PATCH = { lossPct: 20, rawGrams: 1000, cookedGrams: 800 };
  const NOWS_AND_PREVS: readonly unknown[] = [undefined, null, 0, 'x', {}, foc({ lossPct: 12 }), foc({ lossPct: 5, rawGrams: 900, cookedGrams: 855 }), { ...foc({ lossPct: 12 }), ...PATCH },
    { ...foc({ lossPct: 12 }), lossPct: 25, rawGrams: 1000, cookedGrams: 750 }, { ...foc(), ...PATCH, extra: 1 }, { ...PATCH, lossPct: '20' }, { ...PATCH, rawGrams: undefined },
    Object.create(PATCH), { lossPct: 20, rawGrams: 1000 }, { get lossPct(): unknown { throw new Error('boom'); } }];
  const PATCH_VALUES: readonly unknown[] = [undefined, null, 0, 'x', {}, PATCH, { lossPct: 20, rawGrams: 1000 }, { lossPct: 20 }, { ...PATCH, name: 'x' }, Object.create(PATCH),
    { lossPct: 20, rawGrams: 1000, cookedGrams: undefined }];
  agree('restoreAfterRefusal', m.restoreAfterRefusal, l.restoreAfterRefusal, product(NOWS_AND_PREVS, NOWS_AND_PREVS, PATCH_VALUES));

  const PRODUCT_LISTS: readonly unknown[] = [undefined, null, [], 'abc', 5, {},
    [{ id: 'p1', components: [{ recipeId: 'foc', qtyKg: 1 }] }, { id: 'p2', components: [{ recipeId: 'foc', qtyKg: 2 }, { recipeId: 'bri', qtyKg: 1 }] },
      { id: 'p3', components: [{ recipeId: 'bri', qtyKg: 1 }] }, null],
    [null, undefined, 0, '', { id: 'p' }, { id: 'p', components: null }, { id: 'q', components: [null, undefined, 5, { recipeId: 'foc' }] }],
    [{ id: 'p', components: 'foc' }], [{ id: 'p', components: {} }], [{ id: 'p', components: 5 }], [{ components: [{ recipeId: 'foc' }] }],
    [{ id: 'p', components: [{ kind: 'ingredient', ingredientId: 'foc' }] }]];
  agree('otherProductsUsing', m.otherProductsUsing, l.otherProductsUsing, product(PRODUCT_LISTS, [...ODD, 'foc', 'bri', 'none'], [...ODD, 'p1', 'p', 'q']));
});

// ── foodcost-model ───────────────────────────────────────────────────────────

describe('foodcost-model: odd inputs', () => {
  // A partial port: only what it exports is compared (blockerText stays in js/).
  const m = foodcostModel;
  const l = legacyFoodcostModel;

  const FC_ING: Record<string, unknown> = {
    ...RC_INGREDIENTS,
    ICING: { id: 'ICING', name: 'Icing sugar', priceUnit: 'kg', pricePerUnit: 1.5 },
    BUTTON: { id: 'BUTTON', name: 'Chocolate button', priceUnit: 'pcs', pricePerUnit: 0.05, unitWeightKg: 0.002 },
    BOX: { id: 'BOX', name: 'Cake box', priceUnit: 'pcs', pricePerUnit: 0.12 },
    BAGS: { id: 'BAGS', name: 'Paper bags', priceUnit: 'kg', pricePerUnit: 3 },
    TRAY: { id: 'TRAY', name: 'Tray', priceUnit: 'pcs', pricePerUnit: 0.2, kind: 'packaging' },
    SHORT: { id: 'SHORT', name: 'Burro Président', shortName: 'Burro P.', priceUnit: 'kg', pricePerUnit: 8 },
    CASE: { id: 'CASE', name: 'Case', priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' },
    NOID: { name: 'Anonymous', priceUnit: 'pcs', pricePerUnit: 1 },
  };
  const FC_TABLES: readonly unknown[] = [undefined, {}, { ingredients: FC_ING }, { recipes: RC_RECIPES }, { ingredients: FC_ING, recipes: RC_RECIPES },
    { ingredients: FC_ING, recipes: RC_RECIPES, labourCostPerHour: 14 }, { ingredients: FC_ING, recipes: RC_RECIPES, labourCostPerHour: '14' },
    { ingredients: FC_ING, recipes: RC_RECIPES, labourCostPerHour: 0 }, { ingredients: FC_ING, recipes: RC_RECIPES, labourCostPerHour: null },
    { ingredients: FC_ING, recipes: RC_RECIPES, labourCostPerHour: -3 }, { ingredients: FC_ING, recipes: RC_RECIPES, labourCostPerHour: NaN },
    { ingredients: new Map(Object.entries(FC_ING)), recipes: new Map(Object.entries(RC_RECIPES)), labourCostPerHour: 9.5 },
    { ingredients: 5, recipes: 'abc' }, { ingredients: null, recipes: null }, { ingredients: [], recipes: [] },
    { ingredients: { get: () => FC_ING['FLOUR'] }, recipes: RC_RECIPES }, { ingredients: FC_ING, recipes: { LOOP: RC_RECIPES['LOOP'] } },
    { ingredients: Object.create(FC_ING), recipes: Object.create(RC_RECIPES) }, null, 5, 'str', []];
  const SOME_TABLES = FC_TABLES.slice(0, 9);
  const FEW_TABLES = [FC_TABLES[1], FC_TABLES[4], FC_TABLES[5], FC_TABLES[7], FC_TABLES[11], FC_TABLES[12]];

  const NUMS: readonly unknown[] = [...ODD, 0.5, 2, 5, 12, 20, 22, 30, 100, 101, 250, 1000, 1e21, -5, -0, '12', ' 3 ', '1e2', '0', '3,5', 0.1 + 0.2, 1e-7, 5n,
    new Number(12), [12], { valueOf: () => 12 }, Symbol('n')];
  const MODES: readonly unknown[] = [...ODD, 'piece', 'weight', 'pack', 'Piece', ' pack', 'pezzo', 'toString', '__proto__', ['piece'], new String('piece')];
  const PACK_UNIT_WORDS: readonly unknown[] = [...ODD, 'g', 'kg', 'pcs', 'G', 'box', 'l', ' g', 'toString', ['g']];
  const LINE_UNIT_WORDS: readonly unknown[] = [...ODD, 'g', 'kg', 'pcs', 'lb', 'G', ' kg', 'ml', 'toString'];
  const IDS: readonly unknown[] = ['DOUGH', 'HALF', 'MYSTERY', 'BAKED', 'CAKE', 'LOOP', 'GONE', 'FLOUR', 'ICING', 'EGG', 'BOX', 'TRAY', 'BAGS', 'NOPRICE', 'NOID', 'SHORT',
    '', '  ', ' DOUGH ', undefined, null, 5, 0, ['DOUGH'], 'toString', '__proto__', 'constructor', { toString: () => 'DOUGH' }];
  const RECIPE_LINES: readonly unknown[] = [{ recipeId: 'DOUGH', qtyKg: 10 }, ...IDS.map(recipeId => ({ recipeId, qtyKg: 1 })),
    ...NUMS.map(qtyKg => ({ recipeId: 'DOUGH', qtyKg })), { qtyKg: 1 }, { recipeId: 'DOUGH' }, { kind: 'recipe', recipeId: 'DOUGH', qtyKg: 2 }];
  const INGREDIENT_LINES: readonly unknown[] = [{ kind: 'ingredient', ingredientId: 'ICING', qty: 200, unit: 'g' },
    ...IDS.map(ingredientId => ({ kind: 'ingredient', ingredientId, qty: 100, unit: 'g' })),
    ...NUMS.map(qty => ({ kind: 'ingredient', ingredientId: 'ICING', qty, unit: 'g' })),
    ...LINE_UNIT_WORDS.map(unit => ({ kind: 'ingredient', ingredientId: 'ICING', qty: 200, unit })),
    ...LINE_UNIT_WORDS.map(unit => ({ kind: 'ingredient', ingredientId: 'BUTTON', qty: 100, unit })),
    ...LINE_UNIT_WORDS.map(unit => ({ kind: 'ingredient', ingredientId: 'EGG2', qty: 10, unit })),
    { kind: 'ingredient', qty: 5 }, { kind: 'Ingredient', ingredientId: 'ICING', qty: 5, unit: 'g' }];
  const ONE_LINE_LISTS: readonly unknown[] = [...RECIPE_LINES, ...INGREDIENT_LINES, ...ODD].map(line => [line]);
  const COMPONENT_LISTS: readonly unknown[] = [...ODD, 'components', 42, [], [{ recipeId: 'DOUGH', qtyKg: 10 }], [{ recipeId: 'DOUGH', qtyKg: 10 }, { recipeId: 'MYSTERY', qtyKg: 5 }],
    [{ recipeId: 'DOUGH', qtyKg: 10 }, { kind: 'ingredient', ingredientId: 'ICING', qty: 200, unit: 'g' }],
    [{ recipeId: 'DOUGH', qtyKg: 10 }, { kind: 'ingredient', ingredientId: 'NOPRICE', qty: 50, unit: 'g' }, { kind: 'ingredient', ingredientId: 'GONE', qty: 50, unit: 'g' }],
    [{ kind: 'ingredient', ingredientId: 'BUTTON', qty: 1000, unit: 'pcs' }], [{ recipeId: 'HALF', qtyKg: 1 }], [{ recipeId: 'BAKED', qtyKg: 10 }],
    [{ recipeId: 'CAKE', qtyKg: 3 }, { recipeId: 'DOUGH', qtyKg: 1.7 }], [{ recipeId: 'LOOP', qtyKg: 1 }], [{ recipeId: 'DOUGH', qtyKg: 0 }],
    [null, undefined, 5, 'x', {}, { recipeId: 'DOUGH', qtyKg: 'x' }], [{ recipeId: 'L0', qtyKg: 2 }], [{ recipeId: 'DOUGH', qtyKg: 10 }, { recipeId: 'DOUGH', qtyKg: 5 }],
    ...ONE_LINE_LISTS];
  const PACKAGING_LISTS: readonly unknown[] = [...ODD, 'packaging', 42, [], [{ ingredientId: 'BOX', qtyPcs: 1 }], [{ ingredientId: 'BOX', qtyPcs: 100 }],
    [{ ingredientId: 'BAGS', qtyPcs: 1 }], [{ ingredientId: 'TRAY', qtyPcs: 2 }], [{ ingredientId: 'GONE', qtyPcs: 1 }], [{ ingredientId: 'BOX', qtyPcs: 37 }, { ingredientId: 'TRAY', qtyPcs: 1 }],
    [null, 5, { qtyPcs: 1 }, { ingredientId: 'B', qtyPcs: -3 }],
    ...IDS.map(ingredientId => [{ ingredientId, qtyPcs: 1 }]), ...NUMS.map(qtyPcs => [{ ingredientId: 'BOX', qtyPcs }])];

  const BASE = {
    id: 'P1', name: ' Test product ', components: [{ recipeId: 'DOUGH', qtyKg: 10 }], packaging: [], sellingMode: 'piece', piecesPerBatch: 100, packSize: null, packUnit: null,
    sellingPrice: 1.2, vatRate: 20, foodCostTarget: 30, labourMinutes: 90, labourPeople: 2, model: 2,
  };
  const PACK = { ...BASE, sellingMode: 'pack', packSize: 250, packUnit: 'g', piecesPerBatch: null, sellingPrice: 3 };
  const PRODUCTS: readonly unknown[] = [...ODD, 'product', 42, BASE, PACK, { id: 'P', name: 'New product' }, { ...BASE, sellingMode: 'weight', piecesPerBatch: null, sellingPrice: 12 },
    { ...PACK, packSize: 6, packUnit: 'pcs', piecesPerBatch: 100 }, { ...PACK, packUnit: 'kg', packSize: 0.25 },
    ...varying(BASE, {
      id: NUMS.slice(0, 12), name: [...ODD, '  Cake  ', 5, { toString: () => 'obj' }], components: COMPONENT_LISTS, packaging: PACKAGING_LISTS, sellingMode: MODES, piecesPerBatch: NUMS,
      packSize: NUMS, packUnit: PACK_UNIT_WORDS, sellingPrice: NUMS, vatRate: NUMS, foodCostTarget: NUMS, labourMinutes: NUMS, labourPeople: NUMS, model: [...NUMS, 2, 3, 1.5, -2],
    }),
    ...varying(PACK, { packSize: NUMS, packUnit: PACK_UNIT_WORDS, piecesPerBatch: NUMS }),
    ...varying({ ...BASE, sellingMode: 'weight', piecesPerBatch: null }, { components: COMPONENT_LISTS.slice(0, 40), packaging: PACKAGING_LISTS.slice(0, 40) }),
    Object.create(BASE), { get components(): unknown { throw new Error('boom'); } }, { ...BASE, extra: { deep: 1 } }];
  // The one-field-at-a-time variations come after the hand-written ones; the heavy functions meet them all with
  // a few tables, and the hand-written ones with every table.
  const HAND_WRITTEN = PRODUCTS.slice(0, ODD.length + 8);

  agree('zeroOrMore', m.zeroOrMore, l.zeroOrMore, product(NUMS));
  agree('isSellingMode', m.isSellingMode, l.isSellingMode, product(MODES));
  agree('vatSelection', m.vatSelection, l.vatSelection, product(NUMS, COUNTRY_WORDS));
  agree('normalizeProduct', m.normalizeProduct, l.normalizeProduct, product(PRODUCTS));
  agree('normalizeProducts', m.normalizeProducts, l.normalizeProducts, product([...ODD, [], [BASE], [BASE, null, 5, PACK], PRODUCTS.slice(0, 80), 'nonsense', { length: 1, 0: BASE }]));
  agree('netPrice', m.netPrice, l.netPrice, product(PRICE_VALUES, NUMS));
  agree('statusFor', m.statusFor, l.statusFor, product(PRICE_VALUES, PRICE_VALUES));
  agree('suggestedGrossPrice', m.suggestedGrossPrice as AnyFn, l.suggestedGrossPrice as AnyFn, [[], [undefined], [null], [5], ['abc'], [{}],
    ...varying({ unitCost: 0.6, vatRate: 10, targetPct: 30 }, { unitCost: NUMS, vatRate: NUMS, targetPct: NUMS }).map(input => [input]),
    [{ unitCost: 0.72, vatRate: 0, targetPct: 30 }], [{ unitCost: 0.5, vatRate: 10, targetPct: 30 }], [{ unitCost: 1.25, vatRate: 20, targetPct: 25 }]]);

  const LINES: readonly unknown[] = [...ODD, ...INGREDIENT_LINES, ...[200, 0.2, 100, 10, 5, 50, '200', -1, 1e21].flatMap(qty => ['g', 'kg', 'pcs'].map(unit => ({ qty, unit })))];
  const ING_CARDS: readonly unknown[] = [...ODD, ...Object.values(FC_ING), ...varying({ priceUnit: 'pcs', pricePerUnit: 0.05, unitWeightKg: 0.002 }, {
    priceUnit: PRICE_UNIT_WORDS, pricePerUnit: PRICE_VALUES.slice(0, 30), unitWeightKg: PRICE_VALUES.slice(0, 30) }),
  ...varying({ priceUnit: 'kg', pricePerUnit: 2, casePrice: 20, caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'kg' }, { priceUnit: PRICE_UNIT_WORDS, pricePerUnit: PRICE_VALUES.slice(0, 30) }),
  Object.create(FC_ING['BUTTON'] as object)];
  agree('ingredientLineCost', m.ingredientLineCost, l.ingredientLineCost, [...product(LINES.slice(0, 60), ING_CARDS.slice(0, 60)), ...product(LINES, ING_CARDS.filter((_, i) => i % 4 === 0))]);

  agree('batchTotals', m.batchTotals as AnyFn, l.batchTotals as AnyFn, [...product(HAND_WRITTEN, FC_TABLES), ...product(PRODUCTS, FEW_TABLES), ...product(PRODUCTS.slice(0, 40), [undefined, null, 5])]);
  agree('packagingPerUnit', m.packagingPerUnit as AnyFn, l.packagingPerUnit as AnyFn, [...product(HAND_WRITTEN, FC_TABLES), ...product(PRODUCTS, FEW_TABLES)]);
  agree('productionCost', m.productionCost as AnyFn, l.productionCost as AnyFn, [...product(HAND_WRITTEN, FC_TABLES), ...product(PRODUCTS, FEW_TABLES)]);
  agree('costProduct', m.costProduct as AnyFn, l.costProduct as AnyFn, [...product(HAND_WRITTEN, FC_TABLES), ...product(PRODUCTS, FEW_TABLES)]);
  agree('labourBatchCost', m.labourBatchCost as AnyFn, l.labourBatchCost as AnyFn, [...product(HAND_WRITTEN, FC_TABLES), ...product(PRODUCTS, FEW_TABLES)]);

  // unitsPerBatch is handed the product as the screen holds it: raw documents and normalised ones, with every kind of batch.
  const BATCHES: readonly unknown[] = [...ODD, { kg: 10 }, { kg: 0 }, { kg: -1 }, { kg: '5' }, { kg: NaN }, { kg: Infinity }, { kg: 10, cost: 32 }, { cost: 32 }, { kg: null }];
  agree('unitsPerBatch', m.unitsPerBatch, l.unitsPerBatch, [...product(PRODUCTS, BATCHES.slice(0, 24)),
    ...product(PRODUCTS.slice(0, 60).map(p => l.normalizeProduct(p)), BATCHES)]);

  const PRODUCT_LISTS: readonly unknown[] = [undefined, null, [], 'abc', 5, {}, [BASE], [BASE, PACK, null, 5, { id: 'X', name: 'Half filled in' }],
    [{ ...BASE, id: 'A', name: 'Cheap', sellingPrice: 2.4 }, { ...BASE, id: 'B', name: 'Dear', sellingPrice: 0.6 }, { ...BASE, id: 'C', name: 'Middle', sellingPrice: 1.2 }],
    [{ ...BASE, id: 'A', name: 'same' }, { ...BASE, id: 'B', name: 'same' }, { id: 'X', name: 'same' }, { id: 'Y', name: 'Éclair' }, { id: 'Z', name: 'eclair' }],
    [null, undefined], [{ name: 5 }, { name: null }, { name: { toString: () => 'obj' } }, { id: 'n' }],
    [{ ...PACK, id: 'P', name: 'Pack' }, { ...BASE, id: 'Q', name: 'Piece 0 VAT', vatRate: 0 }], new Set([BASE]), Object.freeze([BASE]),
    [{ ...BASE, id: 'W', sellingMode: 'weight', piecesPerBatch: null, sellingPrice: 12, components: [{ recipeId: 'DOUGH', qtyKg: 0 }] }]];
  agree('sortByMargin', m.sortByMargin as AnyFn, l.sortByMargin as AnyFn, [...product(PRODUCT_LISTS, FC_TABLES), ...product([PRODUCTS.slice(0, 120)], FEW_TABLES)]);

  const RECIPE_IDS: readonly unknown[] = ['DOUGH', 'CREAM', 'NOTHING', 'GONE', '', '  ', ' DOUGH ', undefined, null, 5, 0, ['DOUGH'], { toString: () => 'DOUGH' }, 'toString'];
  agree('productsUsingRecipe', m.productsUsingRecipe as AnyFn, l.productsUsingRecipe as AnyFn, product(
    [undefined, null, [], 'abc', 5, {}, [BASE], [BASE, null, 7, {}, PACK], PRODUCTS.slice(0, 100), [{ id: 'A', components: [{ kind: 'ingredient', ingredientId: 'DOUGH', qty: 1, unit: 'kg' }] }],
      [{ id: 'B', components: [{ recipeId: 'DOUGH' }, { recipeId: 'CREAM', qtyKg: 1 }] }], [{ id: 'C', components: [{ recipeId: ' DOUGH ', qtyKg: 1 }] }]],
    RECIPE_IDS));
  agree('draftFromRecipe', m.draftFromRecipe, l.draftFromRecipe, product([...ODD, 'recipe', 42, { id: 'DOUGH', name: '  Brioche dough ', ingredients: [] }, { name: 'no id' },
    { id: '  ' }, { id: 5, name: 5 }, { id: 'X' }, { id: 'X', name: null }, { id: ['X'] }, { id: { toString: () => 'T' }, name: { toString: () => 'N' } }, Object.create({ id: 'P' }),
    { get id(): unknown { throw new Error('boom'); } }]));

  agree('snapshotWorthTaking', m.snapshotWorthTaking, l.snapshotWorthTaking, [...product(PRODUCTS.slice(0, 70), PRODUCTS.slice(0, 70)),
    ...product([BASE], PRODUCTS), ...product(PRODUCTS, [BASE])]);

  const RESULTS: readonly unknown[] = [{ unitCost: 0.32, foodCostPct: 32 }, { unitCost: null, foodCostPct: null }, {}, undefined, null, 5, 'str', { unitCost: 'x', foodCostPct: [1] }];
  const STAMPS: readonly unknown[] = ['2026-08-10T09:00:00.000Z', undefined, null, 5];
  agree('productSnapshot', m.productSnapshot as AnyFn, l.productSnapshot as AnyFn, [
    ...product(HAND_WRITTEN, RESULTS, STAMPS, SOME_TABLES), ...product(PRODUCTS, RESULTS.slice(0, 2), STAMPS.slice(0, 1), FEW_TABLES),
    ...product(PRODUCTS.slice(0, 30), RESULTS.slice(0, 1), STAMPS.slice(0, 1), [undefined]),
  ]);
});

// ── The Calculator (step 3c-1) ───────────────────────────────────────────────

// What the Calculator's models are fed: the bakery fixture (a test fixture, never shipped), the defaults,
// what `normalizeConfig` makes of strange documents, and a few hand-written shapes with holes.
const CALC_CONFIGS: readonly unknown[] = [
  ...ODD, 'config', 42, BAKERY_CONFIG, legacyCalculatorConfig.DEFAULT_CONFIG, legacyCalculatorConfig.normalizeConfig(BAKERY_CONFIG),
  legacyCalculatorConfig.normalizeConfig({}), legacyCalculatorConfig.normalizeConfig(null),
  { clients: [] }, { clients: [null, 5, {}, { id: 'c', products: null }, { id: 'c2', name: 'C2', products: [null, { id: 'p' }] }] },
  { recipes: [{ id: 'r1', name: 'One', logic: 'total', ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }] }, null, { id: 'r2' }] },
  { clients: BAKERY_CONFIG.clients, extraDoughTabs: { focaccia: true }, divisor: { focaccia: { included: ['f-pizze'], n: 2 } } },
  { showClientOrdersButton: false, askDoughDay: false, logVisibility: { focaccia: false }, logRetentionHours: 48 },
  { configModel: 4, recipes: 'x', clients: 'y' }, Object.freeze({ clients: Object.freeze([]) }),
];
const CALC_IDS: readonly unknown[] = [...ODD, 'focaccia', 'brioche', 'sourdough', 'f-pizze', 'c-bakery', 'toString', '__proto__', 'c-bakery::f-pizze'];
const QTY_FNS: readonly unknown[] = [() => 3, () => '4', () => -1, () => NaN, () => undefined, (id: string) => (id === 'f-pizze' ? 10 : 0), 5, null];
const CALC_RECIPES: readonly unknown[] = [
  ...ODD, 'recipe', { logic: 'total' }, { logic: 'trays', trayWeight: 800 }, { logic: 'both', ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }] },
  { logic: 'orders', leaveningKey: 'yeast', baselinePct: 0.5, ingredients: [{ key: 'yeast', label: 'Yeast', grams: 5 }, { key: 'flour', label: 'Flour', grams: 995 }] },
  { logic: 'traysTotal', trayWeight: 'x' }, { trayWeight: -5 }, { trayWeight: 1e9 }, { name: 5, ingredients: 'x' }, { catalogueId: 'cat-1', leaveningRid: 'r' },
  ...legacyCalculatorConfig.getRecipes(BAKERY_CONFIG),
];

describe('calculator-config: odd inputs', () => {
  // A partial port: only what it exports is compared. Every exported function is tried with one odd value, a
  // pair, and a triple (config, id, quantity reader), so a function added to the port is covered at once.
  const m = calculatorConfig as unknown as Record<string, unknown>;
  const l = legacyCalculatorConfig as unknown as Record<string, unknown>;
  const names = Object.keys(m).filter(name => typeof m[name] === 'function' && !['cloneConfig', 'normalizeConfig', 'formatGrams'].includes(name));

  test('every exported name is one the original has too', () => {
    for (const name of Object.keys(m)) expect(name in l, name).toBe(true);
  });

  for (const name of names) {
    agree(name, m[name] as AnyFn, l[name] as AnyFn, [
      ...product([...CALC_CONFIGS, ...CALC_RECIPES, ...ODD, -3, 2.5, 'g', 'kg', 1e12]),
      ...product(CALC_CONFIGS, CALC_IDS),
      ...product(CALC_RECIPES, [...ODD, 3, 12, 'x', 2.5]),
      ...product(CALC_CONFIGS.slice(0, 16), CALC_IDS.slice(0, 22), QTY_FNS),
    ]);
  }

  agree('cloneConfig', m.cloneConfig as AnyFn, l.cloneConfig as AnyFn, product(CALC_CONFIGS));
  agree('normalizeConfig (market title)', m.normalizeConfig as AnyFn, l.normalizeConfig as AnyFn,
    product(CALC_CONFIGS, [undefined, 'Market order', 'Ordine mercato', '', 5]));
  // The original reads the interface language itself (English here); the port is handed the tag (its default is
  // the English one), so only the English tag is comparable. The Italian grouping is pinned in calculator-config.spec.ts.
  agree('formatGrams (English)', m.formatGrams as AnyFn, l.formatGrams as AnyFn,
    product([...ODD, 12345.6, 1234567, -9999, 0.4, 1e21], ['en-GB', undefined]));
});

describe('calculator-dough-math: odd inputs', () => {
  const m = calculatorDoughMath;
  const l = legacyCalculatorDoughMath;
  const AMOUNTS: readonly unknown[] = [...ODD, { a: 1, b: 2 }, { a: 0, b: 0 }, { a: -5, b: 10 }, { a: NaN, b: 1 }, { a: '3', b: 1 }, { a: 1e9, b: 1 }, {}];
  const TARGETS: readonly unknown[] = [...ODD, 100, 5000, 0.4, -50, 1e12, '2000'];
  agree('recipeTotal', m.recipeTotal as AnyFn, l.recipeTotal as AnyFn, product(AMOUNTS));
  agree('fixRounding', m.fixRounding as AnyFn, l.fixRounding as AnyFn,
    product([...ODD, [1.4, 2.4], [0.5, 0.5, 0.5], [10, 20, 30], [NaN, 1], [-1, 5], []], TARGETS));
  const SPECS: readonly unknown[] = [...ODD, ...AMOUNTS.map(amounts => ({ amounts, leaveningKey: null, baselinePct: null })),
    { amounts: { flour: 1000, yeast: 5 }, leaveningKey: 'yeast', baselinePct: 0.5 }, { amounts: { flour: 1000, yeast: 5 }, leaveningKey: 'yeast', baselinePct: 0 },
    { amounts: { flour: 1000, yeast: 5 }, leaveningKey: 'nothing', baselinePct: 1 }, { amounts: { flour: 1000, yeast: 5 }, leaveningKey: 'yeast', baselinePct: null },
    { amounts: { flour: 1000, yeast: 0 }, leaveningKey: 'yeast', baselinePct: 1 }, { amounts: { yeast: 5 }, leaveningKey: 'yeast', baselinePct: 1 }];
  agree('scaleRecipe', m.scaleRecipe as AnyFn, l.scaleRecipe as AnyFn, product(SPECS, TARGETS, [...ODD, 0.65, 3, 40, -2, 100]));
  const NAMED: readonly unknown[] = [...ODD, { flourBlu: 1, flourT65: 1, malt: 1, sugar: 1, salt: 1, yeast: 1, oil: 1, water1: 1, water2: 1 },
    { flour: 3000, yeast: 100, water: 1500 }, { flourBlu: 1, flourT65: 1, flourWhole: 1, water1: 1, starter: 1, malt: 1, salt: 1, water2: 1 }, { flourBlu: 0, flourT65: 0, yeast: 0 }];
  for (const name of ['scaleFocaccia', 'scaleBrioche', 'scaleSourdough'] as const) {
    agree(name, m[name] as AnyFn, l[name] as AnyFn, product(NAMED, TARGETS, [...ODD, 0.65, 4, 18, 40]));
  }
});

describe('calculator-recipe-source: odd inputs', () => {
  const m = calculatorRecipeSource;
  const l = legacyCalculatorRecipeSource;
  const ROWS: readonly unknown[] = [...ODD, { label: 'Flour', grams: 800, unit: 'g' }, { label: 'Flour', grams: 0.8, unit: 'kg' }, { label: 'Salt', unit: 'to taste' },
    { label: 'Milk', grams: 100, unit: 'ml' }, { rid: 'r1', label: 'Yeast', grams: 5, unit: 'g' }, { rid: ' ', label: 'x', grams: NaN, unit: 'g' }, { label: 5, grams: '7', unit: 'g' }];
  const RECIPES: readonly unknown[] = [...ODD, { name: 'Old', ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }], leaveningKey: 'flour' },
    { name: 'Linked', catalogueId: 'cat-1', leaveningRid: 'r1' }, { name: 'Linked', catalogueId: 'gone' }, { catalogueId: '' }, { catalogueId: 5 },
    { name: 'Both', catalogueId: 'cat-1', ingredients: [{ key: 'a', label: 'A', grams: 1 }] }];
  const CATALOGUES: readonly unknown[] = [undefined, null, {}, 5, { 'cat-1': { name: 'F', ingredients: [{ rid: 'r1', label: 'Yeast', grams: 5, unit: 'g' }, { rid: 'r2', label: 'Flour', grams: 995, unit: 'g' }] } },
    { 'cat-1': { name: 'Empty', ingredients: [] } }, { 'cat-1': { name: 'Bad', ingredients: [{ rid: 'r1', label: 'Milk', grams: 100, unit: 'ml' }] } },
    { 'cat-1': null }, { 'cat-1': { ingredients: 'x' } }, new Map([['cat-1', { name: 'M' }]])];
  agree('isWeighable', m.isWeighable as AnyFn, l.isWeighable as AnyFn, product(ROWS));
  agree('linkedRecipeIds', m.linkedRecipeIds as AnyFn, l.linkedRecipeIds as AnyFn, product([...ODD, RECIPES, RECIPES.slice(-4), [null, RECIPES[22]]]));
  agree('isLinked', m.isLinked as AnyFn, l.isLinked as AnyFn, product(RECIPES));
  agree('resolveRecipe', m.resolveRecipe as AnyFn, l.resolveRecipe as AnyFn, product(RECIPES, CATALOGUES));
  const RESOLVED = RECIPES.flatMap(recipe => CATALOGUES.map(c => outcome(() => (l.resolveRecipe as AnyFn)(recipe, c)))).flatMap(o => ('returned' in o ? [o.returned] : []));
  agree('sheetRecipe', m.sheetRecipe as AnyFn, l.sheetRecipe as AnyFn, [...product(RECIPES, [...ODD, ...RESOLVED.slice(0, 30)]), ...product(RECIPES.slice(-3), RESOLVED)]);
  agree('canCalculate', m.canCalculate as AnyFn, l.canCalculate as AnyFn, product([...ODD, ...RESOLVED]));
  agree('leaveningLost', m.leaveningLost as AnyFn, l.leaveningLost as AnyFn, [...product(RECIPES, [...ODD, ...RESOLVED.slice(0, 30)]), ...product(RECIPES.slice(-3), RESOLVED)]);
  test('PROBLEMS is the same object shape', () => {
    expect(m.PROBLEMS).toStrictEqual(l.PROBLEMS);
  });
});

describe('calculator-recipe-text: odd inputs', () => {
  // ⚠️ `Flour uniqua blue` is left out on purpose: it is the one input on which the port differs from the
  // original, by decision (calculator-recipe-text.spec.ts asserts each file's answer separately).
  const m = calculatorRecipeText;
  const l = legacyCalculatorRecipeText;
  const ROWS: readonly unknown[] = [...ODD, [{ name: 'Flour', grams: 1000 }], [{ name: 'Yeast', grams: 4.5 }, { name: 'A very long ingredient name', grams: 123456 }],
    [{ name: 'Flour', grams: NaN }], [{ name: '', grams: 0 }], [{ name: 5, grams: '7' }], [null], [{ grams: 3 }], [{ name: 'Water' }], [{ name: 'Water', grams: -4 }], [{ name: 'Salt', grams: 0.4 }]];
  agree('buildRecipeText', m.buildRecipeText as AnyFn, l.buildRecipeText as AnyFn,
    product([...ODD, 'Focaccia', 'a b c', 'Ünïcode Dough', 'x'.repeat(40)], ROWS, [...ODD, 2500, 1000, 999.5, 1e7, -3]));
});

describe('confirm-flow: odd inputs', () => {
  // The two things a Confirm can do are recorded rather than performed, so the test also compares WHICH ran.
  function run(fn: AnyFn, recipeId: unknown, flow: unknown): unknown {
    const calls: string[] = [];
    const f = flow && typeof flow === 'object'
      ? { ...(flow as object), openDayPicker: (id: unknown) => calls.push('picker:' + String(id)), saveToday: (id: unknown) => calls.push('today:' + String(id)) }
      : flow;
    return { answer: fn(recipeId, f), calls };
  }
  const CONFIGS: readonly unknown[] = [...ODD, {}, { askDoughDay: false }, { askDoughDay: true }, { askDoughDay: 0 }, { askDoughDay: null }, { askDoughDay: 'false' }];
  test('the same answer and the same call for every odd input', () => {
    const disagreements: string[] = [];
    const cases: [unknown, unknown][] = [
      ...product([...ODD, 'focaccia'], CONFIGS.map(config => ({ config }))).map(([r, f]) => [r, f] as [unknown, unknown]),
      ...[undefined, null, 5, 'x'].map(flow => ['r', flow] as [unknown, unknown]),
    ];
    for (const [recipeId, flow] of cases) {
      const a = outcome(() => run(confirmFlow.runConfirm as AnyFn, recipeId, flow));
      const b = outcome(() => run(legacyConfirmFlow.runConfirm as AnyFn, recipeId, flow));
      try { expect(a).toStrictEqual(b); } catch { disagreements.push(`runConfirm(${show(recipeId)}, ${show(flow)}): ${show(a)} / ${show(b)}`); }
    }
    expect(disagreements.slice(0, 10)).toStrictEqual([]);
  });
});

describe('log-time: odd inputs', () => {
  const DATES: readonly unknown[] = [undefined, null, 0, NaN, 'x', {}, [], new Date(2026, 5, 8, 0, 7), new Date(2026, 5, 8, 12, 0), new Date(2026, 11, 31, 23, 59),
    new Date(NaN), new Date(0), new Date(2026, 1, 29), { getDate: () => 3, getHours: () => 13, getMinutes: () => 5, getDay: () => 2, getMonth: () => 4 }];
  agree('logTimestamp', logTime.logTimestamp as AnyFn, legacyLogTime.logTimestamp as AnyFn, product(DATES));
});

describe('zoom-steps: odd inputs', () => {
  const m = zoomSteps;
  const l = legacyZoomSteps;
  const STEPS: readonly unknown[] = [...ODD, 0, 1, 2, 3, 4, 5, 6, 99, -9, '0', '3', ' 2 ', '5', '6', '-1', '1.5', '1e1', '٣', '0x1', 2.0000001, new String('2'), { toString: () => '3' }];
  agree('clampStep', m.clampStep, l.clampStep, product(STEPS));
  agree('parseStep', m.parseStep, l.parseStep, product(STEPS));
  agree('stepBy', m.stepBy, l.stepBy, product(STEPS, [...ODD, 1, -1, 2, -6, 0.5]));
  agree('canStep', m.canStep, l.canStep, product(STEPS, [...ODD, 1, -1, 2, -6, 0.5]));
  agree('scaleOf', m.scaleOf, l.scaleOf, product(STEPS));
});

describe('guided-model: odd inputs', () => {
  // A partial port: only the row-id functions are compared (`makeRowId` with a fixed random source; `withRowIds`
  // with a fixed generator, so the minted ids are the same in both).
  agree('makeRowId', () => guidedModel.makeRowId(() => 0.5), () => legacyGuidedModel.makeRowId(() => 0.5), [[]]);
  {
    const fixed = () => { let n = 0; return () => 'r' + (++n); };
    agree('withRowIds', (rows: unknown) => guidedModel.withRowIds(rows, fixed()), (rows: unknown) => legacyGuidedModel.withRowIds(rows, fixed()),
      product([...ODD, [null, 5, 'x', {}], [{ rid: 'a' }, { rid: 'a' }, { rid: ' a ' }, { label: 'L' }], [{ rid: '' }, { rid: null }, []], [{ rid: 'r1' }, {}]]));
  }
  agree('ridOf', guidedModel.ridOf, legacyGuidedModel.ridOf, product([...ODD, { rid: 'a' }, { rid: ' a ' }, { rid: 5 }, { rid: null }, { rid: '' }, { rid: [] }, { rid: { toString: () => 'o' } },
    Object.create({ rid: 'p' }), { get rid(): unknown { throw new Error('boom'); } }]));
});

describe('log-model: odd inputs', () => {
  // A partial port: only what it exports is compared.
  const m = logModel as unknown as Record<string, unknown>;
  const l = legacyLogModel as unknown as Record<string, unknown>;
  const ITEMS: readonly unknown[] = [...ODD, [{ id: 'a', name: 'Loaf', clientName: 'C', qty: 10, weightG: 500, kind: 'number', crate: { show: false } }],
    [{ qty: '3', weightG: '200' }, null, { qty: NaN, weightG: 5 }], [{ id: 'k', name: 'Kg', qty: 2.5, weightG: 1000, kind: 'kg', crate: { show: true, perBox: 20 } }]];
  agree('buildSheet', m.buildSheet as AnyFn, l.buildSheet as AnyFn, [
    ...product([null, undefined, 5, {}]),
    ...[...CALC_RECIPES, null].flatMap(recipe => ITEMS.flatMap(items => [0, 100, -5, 'x', NaN, undefined].flatMap(extraGrams =>
      [{ recipe, items, extraGrams }, { recipe, items, totalInput: 3000, extraGrams, trays: 4, leaveningPct: 0.65 },
        { recipe, items, totalInput: -1, trays: 'x', leaveningPct: NaN, divisor: { includedIds: ['a'], n: 2 } },
        { recipe, items, divisor: { includedIds: 'a', n: 0 } }].map(arg => [arg])))),
  ]);
  const OCC: readonly unknown[] = [...ODD, [{ name: 'X', products: [{ name: 'Roll', qty: 4, weightG: 50, unit: 'pz' }] }], [{ name: 'Y', products: [] }, null, { name: 5 }]];
  const WORDS: readonly unknown[] = [undefined, {}, { extra: 'Extra', unit: 'pz' }, { extra: 5 }, null];
  agree('buildLogText', m.buildLogText as AnyFn, l.buildLogText as AnyFn, [...product(ITEMS, OCC, [0, 100, 'x', undefined, -3]), ...product(ITEMS.slice(0, 6), OCC.slice(0, 6), [100], WORDS.slice(0, 1))]);
  agree('recipeSnapshot', m.recipeSnapshot as AnyFn, l.recipeSnapshot as AnyFn, product(CALC_RECIPES));
  const VERSIONS: readonly unknown[] = [...ODD, { sheet: { total_g: 5000, typed_g: 3000, extra_g: 100 } }, { sheet: { total_g: 5000, extra_g: 100 }, items: [{ qty: 2, weightG: 500 }] },
    { sheet: { total_g: 10, extra_g: 'x' }, items: [{ qty: 20, weightG: 500 }] }, { sheet: { total_g: 1000, typed_g: '' } }, { sheet: { typed_g: null, total_g: 7 } },
    { sheet: { total_g: 1000, typed_g: 'x' }, occasional: [{ products: [{ qty: 1, weightG: 100 }] }, null] }, { sheet: {} }, { sheet: null }];
  agree('typedTotalOf', m.typedTotalOf as AnyFn, l.typedTotalOf as AnyFn, product(CALC_RECIPES, VERSIONS));
  const LOGS: readonly unknown[] = [...ODD, { versions: [] }, { versions: [{ kind: 'create' }] }, { versions: [{ kind: 'create' }, { kind: 'edit' }], forDay: 'today' }, { versions: 'x' },
    { id: 'l', forDay: 'tomorrow', versions: [{ a: 1 }] }];
  agree('latestVersion', m.latestVersion as AnyFn, l.latestVersion as AnyFn, product(LOGS));
  agree('addVersion', m.addVersion as AnyFn, l.addVersion as AnyFn, product(LOGS, [...ODD, { kind: 'edit' }]));
  agree('setForDay', m.setForDay as AnyFn, l.setForDay as AnyFn, product(LOGS, [...ODD, 'today', 'tomorrow', 'yesterday']));
  agree('createLog', m.createLog as AnyFn, l.createLog as AnyFn, [...product([undefined, null, 5]),
    ...product([{ id: 'l1', dough: 'Focaccia', recipeId: 'focaccia', forDay: 'today', version: { kind: 'create' }, createdAtMs: 5, origin: 'calculator' },
      { id: 'l2', dough: 5, recipeId: null, forDay: 'nope', version: {}, createdAtMs: 'x', origin: 'manual' }, { id: 'l3', version: null }, { version: { items: [1] } }])]);
  agree('confirmTarget', m.confirmTarget as AnyFn, l.confirmTarget as AnyFn, product([undefined, null, {}, 5, { linkedId: 'a', linkedExists: true }, { linkedId: 'a', linkedExists: false },
    { linkedId: '', linkedExists: true }, { linkedId: 'a' }, { linkedExists: 1 }, { linkedId: 0, linkedExists: 'yes' }]));
  agree('workDayIndex', m.workDayIndex as AnyFn, l.workDayIndex as AnyFn, product([...ODD, ...NOWS, new Date(2026, 2, 29, 1, 30).getTime(), new Date(2026, 9, 25, 1, 30).getTime(),
    new Date(2026, 9, 25, 3, 59).getTime(), new Date(2026, 9, 25, 4, 0).getTime(), -86400000, 8.64e15, '1700000000000']));
  const SHEETS: readonly unknown[] = [...ODD, { trays: 4, trayWeight_g: 900, total_g: 3700 }, { trays: '3', total_g: 'x' }, { trayWeight_g: 20, trays: -2 }, { trays: 2, total_g: 1600 }];
  agree('traysEditState', m.traysEditState as AnyFn, l.traysEditState as AnyFn, product(SHEETS, [...CALC_RECIPES, ...ODD, { logic: 'traysTotal', trayWeight: 1200 }, { logic: 'trays' }]));
  agree('traysSheetRecipe', m.traysSheetRecipe as AnyFn, l.traysSheetRecipe as AnyFn, product([...CALC_RECIPES, ...ODD, { logic: 'traysTotal' }, { logic: 'trays', trayWeight: 5 }], [900, 'x', undefined, NaN, 0]));
  const SAVED: readonly unknown[] = [...ODD, [{ id: 'a', name: 'Loaf', clientName: 'C', qty: 3, weightG: 500, kind: 'number' }, null, { id: 'a', clientName: 'C', qty: 9 }],
    [{ id: 'b', qty: 'abc', weightG: 'x', crate: { show: true, perBox: 5 } }, { id: 'b' }, { name: 5 }]];
  agree('editRows', m.editRows as AnyFn, l.editRows as AnyFn, product(SAVED, [...SAVED, [{ id: 'a', clientName: 'C', name: 'New' }, { id: 'z', qty: 4 }, { id: 'a', clientName: 'D' }]]));
  const logWith = (n: number): unknown => ({ id: 'l', versions: Array.from({ length: n }, (_, i) => ({ kind: 'create', text: 'v' + i, calculatedBy: 'A', at: { date: 'd', time: 't' } })) });
  agree('restoreVersion', m.restoreVersion as AnyFn, l.restoreVersion as AnyFn, [
    ...product([...LOGS, logWith(3), logWith(1)], [0, 1, 2, 5, -1, NaN, 'x', undefined, 0.5], [{ calculatedBy: 'R', at: { date: 'x', time: 'y' } }, { calculatedBy: null }, {}, { calculatedBy: 5, at: null }]),
    ...product([logWith(2)], [0, 1], [undefined, null]),
  ]);
  const DOUGH_LOGS: readonly unknown[] = [...ODD, [{ id: 'a', recipeId: 'focaccia', dough: 'F', createdAtMs: NOW, forDay: 'today' }, { id: 'b', dough: 'Brioche', createdAtMs: NOW - 86400000 * 2, forDay: 'tomorrow' },
    null, { id: 'c', createdAtMs: 0 }, { id: 'd', recipeId: 'x', createdAtMs: 'x', forDay: 'nope' }, 5]];
  agree('filterVisibleLogs', m.filterVisibleLogs as AnyFn, l.filterVisibleLogs as AnyFn, [
    ...product(DOUGH_LOGS, [{ visibility: { focaccia: false }, retentionHours: 24, nowMs: NOW }, { visibility: {}, retentionHours: { focaccia: 48, brioche: 0 }, nowMs: NEXT_DAY }, { retentionHours: 'x', nowMs: NaN },
      { retentionHours: 0 }, { visibility: { brioche: false, x: false }, retentionHours: -5, nowMs: LATE }, {}, undefined]),
    ...product([[{ id: 'a' }]], [{ visibility: null }, null]),
  ]);
  agree('sortLogs', m.sortLogs as AnyFn, l.sortLogs as AnyFn, product([...ODD, [{ id: 'a', createdAtMs: 1 }, { id: 'b', createdAtMs: 3 }, { id: 'c', createdAtMs: 3 }, { id: 'd', createdAtMs: 'x' }, { id: 5 }],
    [{ id: 'b', createdAtMs: 1 }, { id: 'a', createdAtMs: 1 }], [null]]));
  test('the day constants agree', () => {
    expect(m.DAY_START_HOUR).toBe(l.DAY_START_HOUR);
    expect(m.FOR_DAYS).toStrictEqual(l.FOR_DAYS);
  });
});
