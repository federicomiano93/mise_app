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

import { describe, expect, test } from 'vitest';
import * as joinCode from './join-code';
import * as pushModel from './push-model';
import * as homeCards from './home-cards';
import * as awayModel from './away-model';
import * as allergenModel from './allergen-model';
import * as sections from './sections';
import * as firebaseTarget from './firebase-target';
import * as localData from './local-data';
import * as legacyJoinCodeJs from '../../js/join-code.js';
import * as legacyPushModelJs from '../../js/push-model.js';
import * as legacyHomeCardsJs from '../../js/home-cards.js';
import * as legacyAwayModelJs from '../../js/away-model.js';
import * as legacyAllergenModelJs from '../../js/allergen-model.js';
import * as legacySectionsJs from '../../js/sections.js';
import * as legacyFirebaseTargetJs from '../../js/firebase-target.js';
import * as legacyLocalDataJs from '../../js/local-data.js';

const legacyJoinCode = legacyJoinCodeJs as unknown as typeof joinCode;
const legacyPushModel = legacyPushModelJs as unknown as typeof pushModel;
const legacyHomeCards = legacyHomeCardsJs as unknown as typeof homeCards;
const legacyAwayModel = legacyAwayModelJs as unknown as typeof awayModel;
const legacyAllergenModel = legacyAllergenModelJs as unknown as typeof allergenModel;
const legacySections = legacySectionsJs as unknown as typeof sections;
const legacyFirebaseTarget = legacyFirebaseTargetJs as unknown as typeof firebaseTarget;
const legacyLocalData = legacyLocalDataJs as unknown as typeof localData;

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
