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
      try {
        expect(a).toStrictEqual(b);
      } catch {
        disagreements.push(`${name}(${args.map(show).join(', ')}): ported ${show(a)} / current ${show(b)}`);
      }
    }
    expect(disagreements.slice(0, 10)).toStrictEqual([]);
  });
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
    });
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
