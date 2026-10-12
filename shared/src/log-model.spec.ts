// Unit tests for the WRITE half of the log data model (P15 — the owner cannot read code, so these are the
// safety net for the irreversible parts: the append-only version chain and the generic sheet math driven by
// the config recipe), run against BOTH implementations: the TypeScript ports in shared/ and the js/ files the
// live app uses today. Ported from tests/log-model.test.mjs and tests/log-typed-total.test.mjs; the two must
// stay equal until the switch to Mise 2.
//
// log-model.ts is a PARTIAL port, so parity.spec.ts does not pair it: the original also exports the legacy
// migration (it stays in the current app) and `dayLabel`, which looks words up in the interface dictionary (the
// port has the pure `dayLabelParts` instead). The last block of this file stands in for what pairing would
// have checked: the same names, the same constants, the same frozen-ness, the same function shapes.
//
// PORTED from tests/log-model.test.mjs: 23 of its 25 tests (buildSheet ×7, buildLogText, createLog,
// addVersion, restoreVersion ×2, sortLogs, filterVisibleLogs, the day constants, dayLabel ×8); from
// tests/log-typed-total.test.mjs: its first test ('buildSheet stores typed_g…'); the other four, which call
// `typedTotalOf`, are in log-typed-total.spec.ts. From tests/log-visibility.test.mjs: the 14 tests of
// `filterVisibleLogs` (the config helpers `isLogVisible`, `getLogRetention*` and `normalizeConfig` are
// calculator-config's, not this file's). From tests/log-edit-rows.test.mjs: all 15 (editRows ×9,
// recipeSnapshot ×6). The `traysEditState` / `traysSheetRecipe` test of tests/calculator-trays.test.mjs is in
// calculator-trays.spec.ts.
// Added: buildLogText with the words handed in, the stored text staying byte-identical, `bakery: 'main'`
// staying the placeholder the data layer overwrites, latestVersion, workDayIndex (the 4 am rollover),
// dayLabelParts against the original on a spread of moments.
//
// dayLabel ×8: the original is run with the interface set to English and its {text, tone} is compared with
// the English formatter written IN THIS FILE (`englishLabel`, the spec's stand-in for the screen) applied to
// `dayLabelParts`; the tone must be equal exactly.
//
// NOT PORTED (on purpose): migrateOldRecord and migrateOldLogs ×2 tests — the legacy migration stays in the
// current app.
//
// ⚠️ THE BAKERY'S DATA IS A FIXTURE, NOT THE APP'S DEFAULT (13 Aug 2026): tests/fixtures/bakery-config.mjs.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as portedLog from './log-model';
import * as portedConfig from './calculator-config';
import * as legacyLogJs from '../../js/log-model.js';
import { currentLanguage, setLanguage } from '../../js/i18n.js';
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
    FOR_DAYS, buildSheet, buildLogText, createLog, latestVersion, addVersion, restoreVersion, sortLogs, filterVisibleLogs,
    editRows, recipeSnapshot,
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

  // ── The list and edit half (step 3c-3) ────────────────────────────────────────────────────────────────────

  test('restoreVersion: appends a copy on top, never truncates history', () => {
    let log = createLog({ id: 'L1', dough: 'Focaccia', forDay: 'today', version: mkVersion({ text: 'v1' }), createdAtMs: 1 });
    log = addVersion(log, mkVersion({ text: 'v2', kind: 'edit' }));
    log = addVersion(log, mkVersion({ text: 'v3', kind: 'edit' }));
    const restored = restoreVersion(log, 0, { calculatedBy: 'Restorer', at: { date: 'Tue', time: '9:00 AM' } });
    expect(restored.versions.length).toBe(4);
    expect(latestVersion(restored).text).toBe('v1');
    expect(latestVersion(restored).kind).toBe('restore');
    expect(latestVersion(restored).restoredFrom).toBe(0);
    expect(restored.versions.map((v: Loose) => v.text)).toStrictEqual(['v1', 'v2', 'v3', 'v1']);
  });

  test('restoreVersion: out-of-range index is a no-op (clone returned)', () => {
    const log = createLog({ id: 'L1', dough: 'Focaccia', forDay: 'today', version: mkVersion(), createdAtMs: 1 });
    expect(restoreVersion(log, 9, { calculatedBy: 'x', at: {} }).versions.length).toBe(1);
  });

  test('sortLogs: newest first by createdAtMs', () => {
    const mk = (id: string, ms: number): Loose => createLog({ id, dough: 'Focaccia', forDay: 'today', version: mkVersion(), createdAtMs: ms });
    expect(sortLogs([mk('a', 1), mk('c', 3), mk('b', 2)]).map((l: Loose) => l.id)).toStrictEqual(['c', 'b', 'a']);
  });

  test('filterVisibleLogs: keyed by recipeId, falling back to the dough name', () => {
    const recent = (id: string, recipeId: string, dough: string): Loose => ({ id, recipeId, dough, createdAtMs: 1000 });
    const logs = [recent('a', 'focaccia', 'Focaccia'), recent('b', 'r-new', 'My Recipe'), recent('c', '', 'Brioche')];
    const out = filterVisibleLogs(logs, {
      visibility: { focaccia: false, 'r-new': true, brioche: true },
      retentionHours: 0, nowMs: 1000,
    });
    // focaccia hidden by recipeId; r-new shown; the third (no recipeId) keyed by 'brioche'.
    expect(out.map((l: Loose) => l.id)).toStrictEqual(['b', 'c']);
  });

  // ── From tests/log-visibility.test.mjs ──────────────────────────────────────────────────────────────────
  describe('filterVisibleLogs: visibility and retention', () => {
    const HOUR = 3600 * 1000;
    const NOW = 1_000_000_000_000; // fixed "now" so the tests are deterministic
    const log = (dough: string, ageHours: number): Loose => ({ id: dough + '-' + ageHours, dough, createdAtMs: NOW - ageHours * HOUR });

    test('a dough turned off is hidden, others stay', () => {
      const logs = [log('Focaccia', 1), log('Brioche', 1), log('Sourdough', 1)];
      const out = filterVisibleLogs(logs, { visibility: { focaccia: false, brioche: true, sourdough: true }, retentionHours: 24, nowMs: NOW });
      expect(out.map((l: Loose) => l.dough)).toStrictEqual(['Brioche', 'Sourdough']);
    });

    test('a missing visibility key defaults to visible', () => {
      expect(filterVisibleLogs([log('Focaccia', 1)], { visibility: {}, retentionHours: 24, nowMs: NOW }).length).toBe(1);
    });

    test('dough match is case-insensitive', () => {
      expect(filterVisibleLogs([log('Sourdough', 1)], { visibility: { sourdough: false }, retentionHours: 24, nowMs: NOW }).length).toBe(0);
    });

    // The window runs from the END of the work day the dough is FOR (work days roll over at 4am), not from the
    // moment the log was written. Times below are LOCAL and explicit.
    const at = (y: number, m: number, d: number, hh: number, mm = 0): number => new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
    const made = (whenMs: number, forDay = 'today', dough = 'Focaccia'): Loose => ({ id: dough + '-' + whenMs, dough, forDay, createdAtMs: whenMs });
    const shown = (logs: Loose[], hours: unknown, nowMs: number): number => filterVisibleLogs(logs, { visibility: {}, retentionHours: hours, nowMs }).length;

    test('a dough made for TOMORROW is still listed all through tomorrow', () => {
      const l = [made(at(2026, 8, 1, 9, 0), 'tomorrow')];
      expect(shown(l, 24, at(2026, 8, 2, 9, 30)), 'still there mid-morning').toBe(1);
      expect(shown(l, 24, at(2026, 8, 2, 22, 0)), 'still there that evening').toBe(1);
    });

    test('...and goes once that day is over plus the window', () => {
      const l = [made(at(2026, 8, 1, 9, 0), 'tomorrow')];
      expect(shown(l, 24, at(2026, 8, 4, 3, 59))).toBe(1);
      expect(shown(l, 24, at(2026, 8, 4, 4, 1))).toBe(0);
    });

    test('a dough made at 22:00 for today does NOT vanish at midnight', () => {
      const l = [made(at(2026, 8, 1, 22, 0), 'today')];
      expect(shown(l, 24, at(2026, 8, 2, 0, 30)), 'half past midnight, same night shift').toBe(1);
      expect(shown(l, 24, at(2026, 8, 2, 3, 30)), 'still before the 4am rollover').toBe(1);
    });

    test('a dough made for today is gone the day after, once the window runs out', () => {
      const l = [made(at(2026, 8, 1, 9, 0), 'today')];
      expect(shown(l, 24, at(2026, 8, 3, 3, 59))).toBe(1);
      expect(shown(l, 24, at(2026, 8, 3, 4, 1))).toBe(0);
    });

    test('48 hours keeps what 24 hours hides', () => {
      const l = [made(at(2026, 8, 1, 9, 0), 'today')];
      const when = at(2026, 8, 3, 12, 0);
      expect(shown(l, 24, when)).toBe(0);
      expect(shown(l, 48, when)).toBe(1);
    });

    test('no log lives SHORTER than it used to', () => {
      const hours = 24;
      for (const [h, forDay] of [[0, 'today'], [3, 'today'], [9, 'today'], [22, 'today'], [9, 'tomorrow']] as [number, string][]) {
        const createdAtMs = at(2026, 8, 1, h, 0);
        const oldExpiry = createdAtMs + hours * HOUR;
        expect(shown([made(createdAtMs, forDay)], hours, oldExpiry), `a log made at ${h}:00 for ${forDay}`).toBe(1);
      }
    });

    test('the clock change does not shift the day', () => {
      const l = [made(at(2026, 10, 24, 9, 0), 'tomorrow')];
      expect(shown(l, 24, at(2026, 10, 25, 20, 0)), 'visible all through the long day').toBe(1);
      expect(shown(l, 24, at(2026, 10, 26, 3, 59))).toBe(1);
      expect(shown(l, 24, at(2026, 10, 27, 4, 1))).toBe(0);
    });

    test('a log with no usable creation time is hidden, as before', () => {
      expect(shown([{ id: 'x', dough: 'Focaccia', createdAtMs: 0 }], 24, NOW)).toBe(0);
    });

    test('a zero/absent window means no expiry at all', () => {
      expect(shown([made(at(2020, 1, 1, 9, 0))], 0, at(2026, 8, 1, 9, 0))).toBe(1);
    });

    test('tolerates a missing/garbage list', () => {
      expect(filterVisibleLogs(null, {})).toStrictEqual([]);
      expect(filterVisibleLogs(undefined, {})).toStrictEqual([]);
    });

    test('a per-dough retention map applies the right window to each dough', () => {
      const logs = [made(at(2026, 8, 1, 9, 0), 'today', 'Focaccia'), made(at(2026, 8, 1, 9, 0), 'today', 'Brioche')];
      const out = filterVisibleLogs(logs, { visibility: {}, retentionHours: { focaccia: 48, brioche: 24 }, nowMs: at(2026, 8, 3, 12, 0) });
      expect(out.map((l: Loose) => l.dough)).toStrictEqual(['Focaccia']);
    });
  });

  // ── From tests/log-edit-rows.test.mjs: a saved log must keep what it saved ─────────────────────────────
  describe('editRows and recipeSnapshot', () => {
    const saved = (over: Loose = {}): Loose => ({
      id: 'f-pizze', name: 'Pizzas', clientName: 'Bakery', qty: 40, weightG: 201, kind: 'number', crate: { show: false, perBox: 20 }, ...over,
    });
    const current = (over: Loose = {}): Loose => ({
      id: 'f-pizze', name: 'Pizzas', clientName: 'Bakery', weightG: 201, kind: 'number', crate: { show: false, perBox: 20 }, ...over,
    });

    test('a saved row survives when the product no longer exists today', () => {
      const rows = editRows([saved()], []);
      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe('f-pizze');
      expect(rows[0].qty).toBe(40);
    });

    test('a saved row keeps the name it had, not the renamed one', () => {
      const rows = editRows([saved()], [current({ name: 'Pizza bases' })]);
      expect(rows.length, 'the renamed product is the same row, not a second one').toBe(1);
      expect(rows[0].name).toBe('Pizzas');
    });

    test('a saved row keeps the weight it had, not a changed one', () => {
      expect(editRows([saved()], [current({ weightG: 250 })])[0].weightG).toBe(201);
    });

    test('a product added since the log appears at zero, after the saved rows', () => {
      const rows = editRows([saved()], [current(), current({ id: 'f-focacce', name: 'Focaccias' })]);
      expect(rows.map((r: Loose) => r.id)).toStrictEqual(['f-pizze', 'f-focacce']);
      expect(rows[1].qty).toBe(0);
    });

    test('a row present in both is not duplicated and keeps the SAVED quantity', () => {
      const rows = editRows([saved({ qty: 12 })], [current()]);
      expect(rows.length).toBe(1);
      expect(rows[0].qty).toBe(12);
    });

    test('the same product for two clients stays two independent rows', () => {
      const rows = editRows(
        [saved({ clientName: 'Bakery', qty: 10 })],
        [current({ clientName: 'Bakery' }), current({ clientName: 'Market', name: 'Pizzas' })],
      );
      expect(rows.length).toBe(2);
      expect(rows.map((r: Loose) => [r.clientName, r.qty])).toStrictEqual([['Bakery', 10], ['Market', 0]]);
    });

    test('a saved row with no crate falls back instead of yielding undefined', () => {
      const { crate: _crate, ...noCrate } = saved();
      expect(editRows([noCrate], [])[0].crate).toStrictEqual({ show: false, perBox: 20 });
    });

    test('a corrupt quantity becomes 0 rather than NaN', () => {
      expect(editRows([saved({ qty: 'abc' })], [])[0].qty).toBe(0);
    });

    test('junk input never throws and never invents rows', () => {
      expect(editRows(null, null)).toStrictEqual([]);
      expect(editRows(undefined, undefined)).toStrictEqual([]);
      expect(editRows([null, undefined], [null])).toStrictEqual([]);
    });

    test('the snapshot carries every field buildSheet reads', () => {
      const snap = recipeSnapshot(FOCACCIA);
      for (const key of ['id', 'name', 'logic', 'ingredients', 'leaveningKey', 'leaveningDefaultPct', 'baselinePct']) expect(key in snap, 'missing ' + key).toBe(true);
      expect(snap.ingredients.map((i: Loose) => i.key)).toStrictEqual(FOCACCIA.ingredients.map((i: Loose) => i.key));
    });

    test('a sheet built from the snapshot is identical to one built from the recipe', () => {
      const items = [{ id: 'f-pizze', name: 'Pizzas', clientName: 'Bakery', qty: 40, weightG: 201, kind: 'number' }];
      expect(buildSheet({ recipe: recipeSnapshot(FOCACCIA), items, leaveningPct: 0.8 })).toStrictEqual(buildSheet({ recipe: FOCACCIA, items, leaveningPct: 0.8 }));
    });

    test('the snapshot is frozen: changing the recipe afterwards does not change it', () => {
      const recipe = JSON.parse(JSON.stringify(FOCACCIA));
      const snap = recipeSnapshot(recipe);
      recipe.ingredients[0].grams = 9999;
      recipe.name = 'Something else';
      expect(snap.ingredients[0].grams).not.toBe(9999);
      expect(snap.name).toBe(FOCACCIA.name);
    });

    test('re-snapshotting a snapshot changes nothing (a log carries its recipe forward)', () => {
      const once = recipeSnapshot(FOCACCIA);
      expect(recipeSnapshot(once)).toStrictEqual(once);
    });

    test("a missing recipe yields null, so the caller can fall back to today's", () => {
      expect(recipeSnapshot(null)).toBe(null);
      expect(recipeSnapshot(undefined)).toBe(null);
    });

    test('a recipe with a corrupt baseline stores null, never NaN', () => {
      expect(recipeSnapshot({ ...FOCACCIA, baselinePct: 'oops' }).baselinePct).toBe(null);
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

// ── dayLabel: the badge is relative to the day the log is READ ────────────────
// The original looks its words up in the interface dictionary, so it is run with the interface in English and its
// {text, tone} is compared with this English formatter applied to `dayLabelParts` — the spec's stand-in for the
// screen (day words with an «inSentence» form, `madeFor` when made !== target). The tone must be equal exactly.

describe('dayLabel (the original, in English) against dayLabelParts', () => {
  let before = 'en';
  beforeAll(() => { before = currentLanguage(); setLanguage('en'); });
  afterAll(() => { setLanguage(before); });

  const dayName = (diff: number, inSentence = false): string => {
    const first = (w: string): string => (inSentence ? w : w[0]!.toUpperCase() + w.slice(1));
    if (diff === 0) return first('today');
    if (diff === 1) return first('tomorrow');
    if (diff === -1) return first('yesterday');
    return diff > 1 ? first('in ' + diff + ' days') : -diff + ' days ago';
  };
  function englishLabel(parts: portedLog.DayLabelParts): { text: string; tone: string } {
    const { text, tone } = parts;
    if (text.kind === 'stored') return { text: text.forDay === 'tomorrow' ? 'Tomorrow' : 'Today', tone };
    return { text: text.made === text.target ? dayName(text.made) : dayName(text.made) + ' for ' + dayName(text.target, true), tone };
  }
  // The label from the port, checked on the way against the original's.
  const label = (log: unknown, nowMs: unknown): { text: string; tone: string } => {
    const mine = englishLabel(portedLog.dayLabelParts(log, nowMs));
    expect(mine).toStrictEqual((legacyLogJs.dayLabel as (l: unknown, n: unknown) => unknown)(log, nowMs));
    return mine;
  };

  // Local wall-clock timestamp, so these tests read as calendar days in any timezone.
  const at = (y: number, m: number, d: number, h = 12, min = 0): number => new Date(y, m - 1, d, h, min).getTime();
  const madeOn = (ms: number, forDay: string): Loose => portedLog.createLog({
    id: 'x', dough: 'Focaccia', forDay, version: { kind: 'create', items: [], occasional: [], sheet: null, text: '' }, createdAtMs: ms,
  });

  test('a log made FOR today reads Today on the day it was made', () => {
    expect(label(madeOn(at(2026, 7, 12), 'today'), at(2026, 7, 12, 18))).toStrictEqual({ text: 'Today', tone: 'today' });
  });

  test('THE BUG — the same "today" log reads Yesterday the next day', () => {
    expect(label(madeOn(at(2026, 7, 12), 'today'), at(2026, 7, 13, 9))).toStrictEqual({ text: 'Yesterday', tone: 'past' });
  });

  test('a "tomorrow" log says what it is FOR, and later when it was MADE', () => {
    const log = madeOn(at(2026, 7, 12), 'tomorrow');
    expect(label(log, at(2026, 7, 12, 20)).text).toBe('Today for tomorrow');
    expect(label(log, at(2026, 7, 13, 8))).toStrictEqual({ text: 'Yesterday for today', tone: 'today' });
    expect(label(log, at(2026, 7, 14, 8)).text).toBe('2 days ago for yesterday');
  });

  test('when made and needed fall on the same day, one word is enough', () => {
    const log = madeOn(at(2026, 7, 12), 'today');
    expect(label(log, at(2026, 7, 12, 20)).text).toBe('Today');
    expect(label(log, at(2026, 7, 13, 8)).text).toBe('Yesterday');
  });

  test('the colour follows the day it is FOR, not the day it was made', () => {
    expect(label(madeOn(at(2026, 7, 12), 'tomorrow'), at(2026, 7, 13, 8)).tone).toBe('today');
    expect(label(madeOn(at(2026, 7, 12), 'tomorrow'), at(2026, 7, 12, 8)).tone).toBe('tomorrow');
    expect(label(madeOn(at(2026, 7, 12), 'today'), at(2026, 7, 14, 8)).tone).toBe('past');
  });

  test('further in the past it says how many days ago, never a wrong "Today"', () => {
    expect(label(madeOn(at(2026, 7, 12), 'today'), at(2026, 7, 15, 9))).toStrictEqual({ text: '3 days ago', tone: 'past' });
  });

  test('it counts WORK days, so the night shift stays one day', () => {
    const late = madeOn(at(2026, 7, 12, 23, 30), 'today');
    expect(label(late, at(2026, 7, 13, 0, 30)).text).toBe('Today');
    expect(label(late, at(2026, 7, 13, 6, 0)).text).toBe('Yesterday');
    const early = madeOn(at(2026, 7, 12, 0, 30), 'today');
    expect(label(early, at(2026, 7, 12, 3, 0)).text).toBe('Today');
    expect(label(early, at(2026, 7, 12, 12, 0)).text).toBe('Yesterday');
  });

  test('a log with no usable creation time falls back to the stored choice', () => {
    expect(label({ forDay: 'tomorrow', createdAtMs: 0 }, at(2026, 7, 12))).toStrictEqual({ text: 'Tomorrow', tone: 'tomorrow' });
    expect(label({}, at(2026, 7, 12))).toStrictEqual({ text: 'Today', tone: 'today' });
  });

  test('the parts themselves: the work-day differences, and the stored fallback', () => {
    expect(portedLog.dayLabelParts(madeOn(at(2026, 7, 12), 'tomorrow'), at(2026, 7, 14, 8)))
      .toStrictEqual({ tone: 'past', text: { kind: 'relative', made: -2, target: -1 } });
    expect(portedLog.dayLabelParts({ forDay: 'tomorrow' }, at(2026, 7, 12))).toStrictEqual({ tone: 'tomorrow', text: { kind: 'stored', forDay: 'tomorrow' } });
    expect(portedLog.dayLabelParts(madeOn(at(2026, 7, 12), 'today'), NaN)).toStrictEqual({ tone: 'today', text: { kind: 'stored', forDay: 'today' } });
  });

  test('the same words as the original on a spread of moments and logs, junk included', () => {
    const made = [at(2026, 7, 12), at(2026, 7, 12, 23, 30), at(2026, 7, 13, 3, 59), at(2026, 3, 28, 12), at(2026, 10, 24, 9), 0, -5, NaN];
    const nows = [at(2026, 7, 12, 18), at(2026, 7, 13, 0, 30), at(2026, 7, 16, 9), at(2026, 7, 5, 9), at(2026, 3, 30, 1, 30), at(2026, 10, 26, 3, 59), NaN, 'x', null, undefined];
    for (const ms of made) for (const forDay of ['today', 'tomorrow', 'x']) for (const now of nows) label({ forDay, createdAtMs: ms }, now);
    for (const odd of [null, undefined, 5, 'x', [], {}]) label(odd, at(2026, 7, 12));
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port against the original', () => {
  // The legacy migration (it stays in the current app) and `dayLabel` (it looks words up in the interface
  // dictionary; the port has `dayLabelParts` instead).
  const LEFT_OUT = ['migrateOldRecord', 'migrateOldLogs', 'dayLabel'];
  const original = legacyLogJs as unknown as Record<string, unknown>;
  const port = portedLog as unknown as Record<string, unknown>;
  const shared = Object.keys(original).filter(name => !LEFT_OUT.includes(name)).sort();

  test('the original still exports everything this port leaves out', () => {
    // If it did not, the exclusion above would be hiding a rename instead of a decision.
    for (const name of LEFT_OUT) expect(original[name] !== undefined, name).toBe(true);
  });

  test('exports exactly the same names, except those, plus dayLabelParts', () => {
    expect(Object.keys(port).sort()).toStrictEqual([...shared, 'dayLabelParts'].sort());
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
