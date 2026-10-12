// Unit tests for the WRITE half of the log data model (P15 — the owner cannot read code, so these are the
// safety net for the irreversible parts: the append-only version chain and the generic sheet math driven by
// the config recipe), run against BOTH implementations: the TypeScript ports in shared/ and the js/ files the
// live app uses today. Ported from tests/log-model.test.mjs and tests/log-typed-total.test.mjs; the two must
// stay equal until the switch to Mise 2.
//
// log-model.ts is a PARTIAL port, so parity.spec.ts does not pair it: the original also exports the list and
// edit half (step 3c-3) and `dayLabel`, which looks words up in the interface dictionary. The last block of
// this file stands in for what pairing would have checked: the same names, the same constants, the same
// frozen-ness, the same function shapes.
//
// PORTED from tests/log-model.test.mjs: 11 of its 25 tests (buildSheet ×7, buildLogText, createLog,
// addVersion, the day constants); from tests/log-typed-total.test.mjs: 1 of its 5 ('buildSheet stores typed_g…').
// Added: buildLogText with the words handed in, the stored text staying byte-identical, `bakery: 'main'`
// staying the placeholder the data layer overwrites, latestVersion, workDayIndex (the 4 am rollover).
//
// NOT PORTED (they test what is left out, step 3c-3): restoreVersion ×2, migrateOldRecord, migrateOldLogs,
// sortLogs, filterVisibleLogs, dayLabel ×9 (tests/log-model.test.mjs); the other four tests of
// tests/log-typed-total.test.mjs, which call `typedTotalOf`.
//
// ⚠️ THE BAKERY'S DATA IS A FIXTURE, NOT THE APP'S DEFAULT (13 Aug 2026): tests/fixtures/bakery-config.mjs.

import { describe, expect, test } from 'vitest';
import * as portedLog from './log-model';
import * as portedConfig from './calculator-config';
import * as legacyLogJs from '../../js/log-model.js';
import * as legacyConfigJs from '../../js/calculator-config.js';
import { BAKERY_CONFIG as bakeryFixture } from '../../tests/fixtures/bakery-config.mjs';

type Loose = any;
const BAKERY_CONFIG: Loose = bakeryFixture;

const legacyLog = legacyLogJs as unknown as typeof portedLog;

describe.each([
  ['shared/ (TypeScript)', { log: portedLog, config: portedConfig }],
  ['js/ (current app)', { log: legacyLog, config: legacyConfigJs as unknown as typeof portedConfig }],
] as const)('%s', (_name, w) => {
  const {
    FOR_DAYS, buildSheet, buildLogText, createLog, latestVersion, addVersion,
  } = w.log as unknown as Record<string, Loose>;
  const { computeTarget, getRecipeById, pairId } = w.config as unknown as Record<string, Loose>;

  const FOCACCIA = getRecipeById(BAKERY_CONFIG, 'focaccia');
  const BRIOCHE = getRecipeById(BAKERY_CONFIG, 'brioche');

  function mkVersion(over: Loose = {}): Loose {
    return {
      calculatedBy: 'Mario', at: { date: 'Monday 09 June', time: '2:05 PM' },
      kind: 'create', items: [], occasional: [], sheet: null, text: '', ...over,
    };
  }

  // ── buildSheet (generic, recipe-driven) ─────────────────────────────────────────
  test('buildSheet: orders total = Σ qty×weightG + extra; names the recipe + param', () => {
    const sheet = buildSheet({
      recipe: FOCACCIA, leaveningPct: 0.65, extraGrams: 100,
      items: [
        { id: 'a', name: 'Pizzas', qty: 2, weightG: 200 },    // 400
        { id: 'b', name: 'Focaccias', qty: 3, weightG: 100 }, // 300
      ],
    });
    expect(sheet.total_g).toBe(800); // 400 + 300 + 100
    expect(sheet.extra_g).toBe(100);
    expect(sheet.dough).toBe('Focaccia');
    expect(sheet.recipeId).toBe('focaccia');
    expect(sheet.param.label).toBe('Yeast %');
  });

  test('buildSheet: ingredient grams sum exactly to the rounded total', () => {
    const sheet = buildSheet({ recipe: FOCACCIA, leaveningPct: 0.65, items: [{ id: 'a', name: 'X', qty: 10, weightG: 151 }] });
    expect(sheet.ingredients.reduce((s: number, r: Loose) => s + r.grams, 0)).toBe(sheet.total_g);
    expect(sheet.ingredients.length).toBe(9);
    expect(sheet.ingredients[0].name).toBe('Flour uniqua blue');
  });

  test('buildSheet: zero total produces zero ingredients, no NaN', () => {
    const sheet = buildSheet({ recipe: BRIOCHE, leaveningPct: 4, items: [] });
    expect(sheet.total_g).toBe(0);
    expect(sheet.ingredients.every((r: Loose) => r.grams === 0)).toBeTruthy();
  });

  test("buildSheet: 'total' logic uses the typed total, no products, pro-rata, no param", () => {
    const recipe = {
      id: 'r1', name: 'Bread', logic: 'total',
      ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }, { key: 'water', label: 'Water', grams: 600 }],
      leaveningKey: null, baselinePct: null,
    };
    const sheet = buildSheet({ recipe, totalInput: 800, items: [] });
    expect(sheet.total_g).toBe(800);
    expect(sheet.param).toBe(null);                 // no leavening line for a total recipe
    expect(sheet.ingredients.map((i: Loose) => i.grams)).toStrictEqual([500, 300]); // pro-rata
  });

  test('buildSheet: matches the live computeTarget for the same quantities', () => {
    const getQty = (id: string): number => ({ [pairId('c-bakery', 'f-pizze')]: 4, [pairId('c-bakery', 'f-focacce')]: 2 } as Record<string, number>)[id] || 0;
    const target = computeTarget(BAKERY_CONFIG, 'focaccia', getQty);
    const sheet = buildSheet({
      recipe: FOCACCIA, leaveningPct: 0.65,
      items: [
        { id: 'f-pizze', name: 'Pizzas', qty: 4, weightG: 201 },
        { id: 'f-focacce', name: 'Focaccias', qty: 2, weightG: 181 },
      ],
    });
    expect(sheet.total_g).toBe(Math.round(target));
  });

  test('buildSheet: divisor splits only included lines with a quantity', () => {
    const sheet = buildSheet({
      recipe: FOCACCIA, leaveningPct: 0.65,
      items: [
        { id: 'a', name: 'Ciabatta', qty: 40, weightG: 150 }, // 6000
        { id: 'b', name: 'Pizzas', qty: 1, weightG: 200 },
      ],
      divisor: { includedIds: ['a'], n: 3 },
    });
    expect(sheet.divisor.names).toStrictEqual(['Ciabatta']);
    expect(sheet.divisor.total).toBe(6000);
    expect(sheet.divisor.n).toBe(3);
    expect(sheet.divisor.result).toBe(2000);
  });

  test('buildSheet: crate boxes only for opted-in lines with a quantity', () => {
    const sheet = buildSheet({
      recipe: FOCACCIA, leaveningPct: 0.65,
      items: [
        { id: 'a', name: 'Ciabatta', qty: 40, weightG: 150, crate: { show: true, perBox: 20 } },
        { id: 'b', name: 'Pizzas', qty: 0, weightG: 200, crate: { show: true, perBox: 10 } },
        { id: 'c', name: 'Plain', qty: 5, weightG: 100 },
      ],
    });
    expect(sheet.crates.length).toBe(1);
    expect(sheet.crates[0].name).toBe('Ciabatta');
    expect(sheet.crates[0].count).toBe(2);       // 40 / 20
    expect(sheet.crates[0].eachBoxG).toBe(3000); // 20 × 150
  });

  test('buildLogText: groups by client, adds occasional and extra', () => {
    const text = buildLogText(
      [
        { name: 'Pizzas', clientName: 'Bakery', qty: 2, kind: 'number' },
        { name: 'Focaccias', clientName: 'Bakery', qty: 0, kind: 'number' }, // skipped (0)
        { name: 'Ciabatta', clientName: 'Client 1', qty: 40, kind: 'dropdown' },
      ],
      [{ name: 'Walk-in', products: [{ name: 'Special', qty: 3, unit: 'pz' }] }],
      { grams: 1000, value: 1, unit: 'kg' },
    );
    expect(text.includes('Bakery:')).toBeTruthy();
    expect(text.includes('  Pizzas: 2 pz')).toBeTruthy();
    expect(!text.includes('Focaccias')).toBeTruthy();
    expect(text.includes('Client 1:')).toBeTruthy();
    expect(text.includes('  Ciabatta: 40 pz')).toBeTruthy();
    expect(text.includes('Walk-in:')).toBeTruthy();
    expect(text.includes('  Special: 3 pz')).toBeTruthy();
    expect(text.includes('Extra dough: 1 kg')).toBeTruthy();
  });

  test('createLog: one version, keeps the recipe name + id, clamps the day', () => {
    const log = createLog({ id: 'L1', dough: 'My Recipe', recipeId: 'r-x', forDay: 'whenever', version: mkVersion(), createdAtMs: 5 });
    expect(log.dough).toBe('My Recipe');   // any name kept (recipes are arbitrary now)
    expect(log.recipeId).toBe('r-x');
    expect(log.forDay).toBe('today');      // invalid forDay → default
    expect(log.bakery).toBe('main');
    expect(log.versions.length).toBe(1);
    expect(latestVersion(log).calculatedBy).toBe('Mario');
  });

  test('addVersion: append-only, previous versions preserved, original not mutated', () => {
    const log = createLog({ id: 'L1', dough: 'Focaccia', forDay: 'today', version: mkVersion({ text: 'v1' }), createdAtMs: 1 });
    const log2 = addVersion(log, mkVersion({ text: 'v2', kind: 'edit' }));
    expect(log.versions.length).toBe(1);
    expect(log2.versions.length).toBe(2);
    expect(log2.versions[0].text).toBe('v1');
    expect(latestVersion(log2).text).toBe('v2');
    log2.versions[0].text = 'HACKED';
    expect(log.versions[0].text).toBe('v1');
  });

  test('exports: the day constants', () => {
    expect(FOR_DAYS).toStrictEqual(['today', 'tomorrow']);
  });

  // ── From tests/log-typed-total.test.mjs: the part that is the WRITE half ──────────────────────────────────

  describe('typed_g', () => {
    const ings = [{ key: 'flour', label: 'Flour', grams: 1000 }, { key: 'water', label: 'Water', grams: 600 }];
    const mk = (logic: string): Loose => ({ id: 'r', name: 'Dough', logic, ingredients: ings, leaveningKey: null, leaveningDefaultPct: 0, baselinePct: 0 });
    const items = [{ id: 'a', name: 'Loaf', clientName: 'C', qty: 10, weightG: 500, kind: 'number', crate: { show: false } }];

    test('buildSheet stores typed_g for total and both, not for orders', () => {
      expect(buildSheet({ recipe: mk('both'), items, totalInput: 3000, extraGrams: 100 }).typed_g).toBe(3000);
      expect(buildSheet({ recipe: mk('total'), items: [], totalInput: 2500 }).typed_g).toBe(2500);
      expect('typed_g' in buildSheet({ recipe: mk('orders'), items })).toBe(false);
    });
  });

  // ── What the stored document looks like (both apps read each other's logs) ───────────────────────────────

  test('⚠️ createLog writes bakery «main» as a placeholder: the data layer stamps the real venue over it', () => {
    const log = createLog({ id: 'L1', dough: 'Focaccia', recipeId: 'foc', forDay: 'today', version: mkVersion(), createdAtMs: 5 });
    expect(Object.keys(log)).toStrictEqual(['id', 'bakery', 'dough', 'recipeId', 'forDay', 'origin', 'createdAtMs', 'versions']);
    expect(log.bakery).toBe('main');
    expect(log.createdAtMs).toBe(5);
  });

  test('createLog copies the version it is given, so a later change to it does not reach the log', () => {
    const v = mkVersion({ text: 'v1' });
    const log = createLog({ id: 'L1', dough: 'Focaccia', forDay: 'today', version: v, createdAtMs: 1 });
    v.text = 'changed';
    expect(log.versions[0].text).toBe('v1');
  });

  test('latestVersion is the last element, and null for a log with no versions or no log', () => {
    expect(latestVersion({ versions: [{ text: 'a' }, { text: 'b' }] }).text).toBe('b');
    for (const none of [null, undefined, {}, { versions: [] }, { versions: 'x' }, 5]) expect(latestVersion(none), JSON.stringify(none)).toBe(null);
  });

  test('buildLogText: the sheet text for a quantity of kg and an occasional client without a name', () => {
    const text = buildLogText(
      [{ name: 'Flour', clientName: 'Bakery', qty: 2.5, kind: 'kg' }, { name: 'Buns', qty: 3, kind: 'number' }],
      [{ products: [{ name: 'Roll', qty: 4, unit: 'kg' }] }],
      { grams: 1500, unit: 'g' },
    );
    expect(text).toBe([
      'Bakery:', '  Flour: 2.5 kg', 'Client:', '  Buns: 3 pz', 'Occasional client:', '  Roll: 4 kg', 'Extra dough: 1500 g',
    ].join('\n'));
  });

  test('buildLogText on nothing is an empty text', () => {
    expect(buildLogText([], [], null)).toBe('');
    expect(buildLogText(null, undefined, undefined)).toBe('');
  });
});

describe('the port with the words it is handed', () => {
  test('buildLogText writes the interface words it is given, for the two places the original calls t()', () => {
    const words = { occasionalClient: 'Cliente occasionale', extraDough: 'Impasto extra: ' };
    const text = portedLog.buildLogText(
      [], [{ products: [{ name: 'Panino', qty: 4 }] }], { grams: 1000, value: 1, unit: 'kg' }, words,
    );
    expect(text).toBe(['Cliente occasionale:', '  Panino: 4 pz', 'Impasto extra: 1 kg'].join('\n'));
    // A client the person NAMED is never replaced by the word.
    expect(portedLog.buildLogText([], [{ name: 'Walk-in', products: [{ name: 'X', qty: 1 }] }], null, words)).toBe('Walk-in:\n  X: 1 pz');
  });
});

describe('workDayIndex: the bakery day rolls over at 4 am', () => {
  const at = (y: number, mo: number, d: number, h = 12, min = 0): number => new Date(y, mo - 1, d, h, min).getTime();

  test('23:30 and 00:30 are the same work day; 03:59 too; 04:00 starts the next one', () => {
    for (const m of [portedLog, legacyLog]) {
      const late = m.workDayIndex(at(2026, 7, 12, 23, 30));
      expect(m.workDayIndex(at(2026, 7, 13, 0, 30))).toBe(late);
      expect(m.workDayIndex(at(2026, 7, 13, 3, 59))).toBe(late);
      expect(m.workDayIndex(at(2026, 7, 13, 4, 0))).toBe(late + 1);
    }
  });

  test('consecutive days differ by exactly one, also across a month and a year end', () => {
    for (const m of [portedLog, legacyLog]) {
      expect(m.workDayIndex(at(2026, 8, 1, 12)) - m.workDayIndex(at(2026, 7, 31, 12))).toBe(1);
      expect(m.workDayIndex(at(2027, 1, 1, 12)) - m.workDayIndex(at(2026, 12, 31, 12))).toBe(1);
      expect(m.workDayIndex(at(2026, 3, 1, 12)) - m.workDayIndex(at(2026, 2, 28, 12))).toBe(1);
    }
  });

  test('both files give the same index for a spread of moments, junk included', () => {
    const moments: unknown[] = [0, -1, NaN, 'x', null, undefined, at(2026, 3, 29, 1, 30), at(2026, 10, 25, 1, 30), at(2026, 10, 25, 3, 59), at(2026, 10, 26, 4, 0)];
    for (const x of moments) expect(portedLog.workDayIndex(x), String(x)).toBe(legacyLog.workDayIndex(x));
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port against the original', () => {
  // The list and edit half (step 3c-3), the migration (it stays in the current app) and `dayLabel`
  // (it looks words up in the interface dictionary).
  const LEFT_OUT = [
    'traysEditState', 'traysSheetRecipe', 'typedTotalOf', 'editRows', 'restoreVersion', 'migrateOldRecord',
    'migrateOldLogs', 'filterVisibleLogs', 'dayLabel', 'sortLogs',
  ];
  const original = legacyLogJs as unknown as Record<string, unknown>;
  const port = portedLog as unknown as Record<string, unknown>;
  const shared = Object.keys(original).filter(name => !LEFT_OUT.includes(name)).sort();

  test('the original still exports everything this port leaves out', () => {
    // If it did not, the exclusion above would be hiding a rename instead of a decision.
    for (const name of LEFT_OUT) expect(original[name] !== undefined, name).toBe(true);
  });

  test('exports exactly the same names, except those', () => {
    expect(Object.keys(port).sort()).toStrictEqual(shared);
  });

  test('every non-function export is strictly equal and frozen the same way', () => {
    for (const name of shared) {
      if (typeof original[name] === 'function') continue;
      expect(port[name], name).toStrictEqual(original[name]);
      expect(Object.isFrozen(port[name]), `${name}: frozen`).toBe(Object.isFrozen(original[name]));
    }
  });

  test('every function has the same name and the same number of required parameters', () => {
    for (const name of shared) {
      const mine = port[name];
      const theirs = original[name];
      if (typeof mine !== 'function' || typeof theirs !== 'function') continue;
      expect(mine.name, name).toBe(theirs.name);
      expect(mine.length, `${name}: arity`).toBe(theirs.length);
    }
  });
});
