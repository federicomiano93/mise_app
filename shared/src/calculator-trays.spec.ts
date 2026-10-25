// The two tray logics of a Calculator recipe (P15 — the owner cannot read code), run against BOTH
// implementations: the TypeScript ports in shared/ and the js/ files the live app uses today. Ported from
// tests/calculator-trays.test.mjs; the two must stay equal until the switch to Mise 2.
//   • 'trays'      → the person types HOW MANY TRAYS; dough = trays × the recipe's tray weight;
//   • 'traysTotal' → trays × tray weight + a typed total in grams;
//   both scale the ingredients pro-rata, with the leavening neutralised, like 'total'.
//   • `trayWeight` (whole grams, default 1000, 50…100000) is kept on the recipe whatever the logic;
//   • a saved dough keeps the trays and the weight it was made with (sheet.trays / trayWeight_g);
//   • configModel is at least 3, so an app that does not know trays cannot overwrite a trays recipe.
//
// PORTED from tests/calculator-trays.test.mjs: 19 of its 29 tests (the pure ones: the target maths, the tray
// weight, the config, the saved sheet and snapshot, formatGrams, the 50 g floor, the trays box text).
//
// NOT PORTED: the dictionary tests ('both dictionaries carry every tray string', '«5 trays × 1,000 g»…',
// the words inside 'a tray weight under 50 g…') — the dictionary stays in js/i18n.js until Mise 2 has its own;
// the source-text tests of the screens ('the Calculator tab: trays field…', 'the Recipes row…', 'manual add
// and edit…', 'Add and Edit show the «= N g» line…', 'the tray count is grouped…') — they read js/ files as
// text and describe the old pages; the Log half ('editing a trays log keeps the weight…' needs
// `traysEditState`, step 3c-3); and the two Catalogue import tests ('re-importing from the Catalogue…', 'a
// refused Catalogue import…'), which belong to step 3d.

import { describe, expect, test } from 'vitest';
import * as portedConfig from './calculator-config';
import * as portedLog from './log-model';
import * as legacyConfigJs from '../../js/calculator-config.js';
import * as legacyLogJs from '../../js/log-model.js';

type Loose = any;

describe.each([
  ['shared/ (TypeScript)', { config: portedConfig, log: portedLog }],
  ['js/ (current app)', {
    config: legacyConfigJs as unknown as typeof portedConfig,
    log: legacyLogJs as unknown as typeof portedLog,
  }],
] as const)('%s', (_name, w) => {
  const {
    LOGICS, CONFIG_MODEL, DEFAULT_TRAY_WEIGHT, MAX_TRAY_WEIGHT, MAX_TRAYS, computeRecipeTarget, normalizeTrayWeight,
    normalizeTrays, isValidTrayWeight, MIN_TRAY_WEIGHT, settledTraysText, traysGrams, formatGrams, showsLeaveningKnob,
    usesOrders, usesTrays, usesTypedTotal, isProRata,
  } = w.config as unknown as Record<string, Loose>;
  const normalizeConfig = (raw: unknown): Loose => w.config.normalizeConfig(raw);
  const { buildSheet, recipeSnapshot } = w.log as unknown as Record<string, Loose>;



  const INGS = [
    { key: 'flour', label: 'Flour', grams: 600 },
    { key: 'water', label: 'Water', grams: 380 },
    { key: 'salt', label: 'Salt', grams: 20 },
  ];
  function recipe(over: Loose = {}): Loose {
    return {
      id: 'r1', name: 'Pizza', logic: 'trays', trayWeight: 1000, ingredients: INGS,
      leaveningKey: null, leaveningDefaultPct: 0, showLeavening: true, baselinePct: null, ...over,
    };
  }
  const cfg: Loose = {};

  // ── The math ────────────────────────────────────────────────────────────────────────
  test('the logic list holds the two new logics, and the helpers classify all five', () => {
    expect(LOGICS).toStrictEqual(['orders', 'total', 'both', 'trays', 'traysTotal']);
    expect(LOGICS.map(usesOrders)).toStrictEqual([true, false, true, false, false]);
    expect(LOGICS.map(usesTrays)).toStrictEqual([false, false, false, true, true]);
    expect(LOGICS.map(usesTypedTotal)).toStrictEqual([false, true, true, false, true]);
    expect(LOGICS.map(isProRata)).toStrictEqual([false, true, false, true, true]);
  });

  test('trays: trays × tray weight, nothing else counts', () => {
    const r = recipe();
    expect(computeRecipeTarget(cfg, r, { trays: 5 })).toBe(5000);
    expect(computeRecipeTarget(cfg, r, { trays: 5, totalInput: 777, extraGrams: 123 })).toBe(5000);
    expect(computeRecipeTarget(cfg, recipe({ trayWeight: 1200 }), { trays: 5 })).toBe(6000);
  });

  test('traysTotal: trays × tray weight + the typed total', () => {
    const r = recipe({ logic: 'traysTotal' });
    expect(computeRecipeTarget(cfg, r, { trays: 5, totalInput: 500 })).toBe(5500);
    expect(computeRecipeTarget(cfg, r, { trays: 0, totalInput: 500 })).toBe(500);
    expect(computeRecipeTarget(cfg, r, { trays: 2, totalInput: 0 })).toBe(2000);
    expect(computeRecipeTarget(cfg, r, { trays: 5, totalInput: 500, extraGrams: 999 }), 'no extra-dough box').toBe(5500);
  });

  test('the other logics ignore trays', () => {
    for (const logic of ['total', 'orders', 'both']) {
      const out = computeRecipeTarget(cfg, recipe({ logic }), { trays: 9, totalInput: 100 });
      expect(out, logic).toBe(logic === 'orders' ? 0 : 100);
    }
  });

  test('bad inputs never give NaN or a negative: negative, text, NaN, Infinity, null', () => {
    for (const logic of ['trays', 'traysTotal']) {
      const r = recipe({ logic });
      for (const bad of [-3, 'abc', NaN, Infinity, -Infinity, null, undefined, {}, []]) {
        const out = computeRecipeTarget(cfg, r, { trays: bad, totalInput: bad });
        expect(Number.isFinite(out) && out >= 0, `${logic} / ${String(bad)} → ${out}`).toBeTruthy();
      }
      expect(computeRecipeTarget(cfg, r, { trays: -3, totalInput: 0 })).toBe(0);
      expect(computeRecipeTarget(cfg, r, { trays: 'abc', totalInput: 0 })).toBe(0);
    }
    expect(computeRecipeTarget(cfg, null, { trays: 5 })).toBe(0);
  });

  test('whole trays only: a fraction is cut down, a huge number is capped', () => {
    expect(normalizeTrays(2.9)).toBe(2);
    expect(normalizeTrays('4')).toBe(4);
    expect(normalizeTrays('')).toBe(0);
    expect(normalizeTrays(-1)).toBe(0);
    expect(normalizeTrays(1e9)).toBe(MAX_TRAYS);
    expect(traysGrams(recipe({ trayWeight: 1500 }), 3)).toBe(4500);
  });

  test('trays recipes show no leavening knob, whatever the flag says', () => {
    for (const logic of ['trays', 'traysTotal', 'total']) {
      expect(showsLeaveningKnob(recipe({ logic, leaveningKey: 'salt', showLeavening: true })), logic).toBe(false);
    }
    expect(showsLeaveningKnob(recipe({ logic: 'orders', leaveningKey: 'salt', showLeavening: true }))).toBe(true);
  });

  // ── The tray weight on the recipe ───────────────────────────────────────────────────
  test('normalizeTrayWeight: missing, text, NaN, zero or negative → 1000; whole grams; capped', () => {
    expect(DEFAULT_TRAY_WEIGHT).toBe(1000);
    for (const bad of [undefined, null, '', 'abc', NaN, 0, -5, 0.2, Infinity, {}]) {
      expect(normalizeTrayWeight(bad), String(bad)).toBe(1000);
    }
    expect(normalizeTrayWeight(1200)).toBe(1200);
    expect(normalizeTrayWeight('850')).toBe(850);
    expect(normalizeTrayWeight(1200.6)).toBe(1201);
    expect(normalizeTrayWeight(1e9)).toBe(MAX_TRAY_WEIGHT);
  });

  test('isValidTrayWeight: only a real number from 50 g to the cap is an answer', () => {
    for (const ok of [50, 1000, '750', MAX_TRAY_WEIGHT]) expect(isValidTrayWeight(ok), String(ok)).toBe(true);
    for (const bad of ['', null, undefined, 0, '0', 1, 1.2, 30, 49.9, -1, 'abc', NaN, MAX_TRAY_WEIGHT + 1]) {
      expect(isValidTrayWeight(bad), String(bad)).toBe(false);
    }
  });

  test('the config keeps trayWeight on every recipe, whatever the logic, and defaults it', () => {
    const raw = {
      clients: [],
      recipes: [
        { id: 'a', name: 'A', logic: 'trays', trayWeight: 1200, ingredients: INGS },
        { id: 'b', name: 'B', logic: 'orders', trayWeight: 1500, ingredients: INGS },
        { id: 'c', name: 'C', logic: 'traysTotal', ingredients: INGS },
        { id: 'd', name: 'D', logic: 'trays', trayWeight: 'junk', ingredients: INGS },
      ],
    };
    const byId = Object.fromEntries(normalizeConfig(raw).recipes.map((r: Loose) => [r.id, r]));
    expect(byId.a.logic).toBe('trays');
    expect(byId.a.trayWeight).toBe(1200);
    expect(byId.b.logic).toBe('orders');
    expect(byId.b.trayWeight, 'kept after switching away from trays').toBe(1500);
    expect(byId.c.logic).toBe('traysTotal');
    expect(byId.c.trayWeight).toBe(1000);
    expect(byId.d.trayWeight).toBe(1000);
    // A round trip changes nothing.
    expect(normalizeConfig(normalizeConfig(raw)).recipes).toStrictEqual(normalizeConfig(raw).recipes);
  });

  test('configModel is at least 3: an older app cannot overwrite a trays recipe', () => {
    expect(CONFIG_MODEL >= 3).toBeTruthy();
    expect(normalizeConfig({ clients: [], configModel: 1 }).configModel).toBe(CONFIG_MODEL);
  });

  // ── The saved dough ─────────────────────────────────────────────────────────────────
  test('buildSheet: trays → ingredients exactly ×5, trays and weight stored', () => {
    const sheet = buildSheet({ recipe: recipe(), items: [], trays: 5, leaveningPct: 0 });
    expect(sheet.total_g).toBe(5000);
    expect(sheet.trays).toBe(5);
    expect(sheet.trayWeight_g).toBe(1000);
    expect(sheet.ingredients.map((i: Loose) => i.grams)).toStrictEqual([3000, 1900, 100]);
    expect(sheet.param).toBe(null);
  });

  test('buildSheet: a different tray weight, and trays + total', () => {
    const a = buildSheet({ recipe: recipe({ trayWeight: 1200 }), items: [], trays: 5 });
    expect(a.total_g).toBe(6000);
    expect(a.trayWeight_g).toBe(1200);
    const b = buildSheet({ recipe: recipe({ logic: 'traysTotal' }), items: [], trays: 5, totalInput: 500 });
    expect(b.total_g).toBe(5500);
    expect(b.trays).toBe(5);
    expect(b.ingredients.map((i: Loose) => i.grams)).toStrictEqual([3300, 2090, 110]);
  });

  test('buildSheet: leavening is neutralised for a trays recipe even when one is designated', () => {
    const r = recipe({ leaveningKey: 'salt', leaveningDefaultPct: 2, baselinePct: 2 });
    const sheet = buildSheet({ recipe: r, items: [], trays: 5, leaveningPct: 9 });
    expect(sheet.ingredients.map((i: Loose) => i.grams)).toStrictEqual([3000, 1900, 100]);
    expect(sheet.param).toBe(null);
  });

  test('buildSheet: bad trays give a zero dough, never NaN; other logics store no trays', () => {
    for (const bad of [-2, 'abc', NaN, null, undefined]) {
      const s = buildSheet({ recipe: recipe(), items: [], trays: bad });
      expect(s.total_g, String(bad)).toBe(0);
      expect(s.ingredients.every((i: Loose) => i.grams === 0)).toBeTruthy();
    }
    const old = buildSheet({ recipe: recipe({ logic: 'total' }), items: [], totalInput: 400, trays: 7 });
    expect(old.total_g).toBe(400);
    expect('trays' in old).toBe(false);
    expect('trayWeight_g' in old).toBe(false);
  });

  test('recipeSnapshot freezes the tray weight of a trays recipe only', () => {
    expect(recipeSnapshot(recipe({ trayWeight: 1300 })).trayWeight).toBe(1300);
    expect('trayWeight' in recipeSnapshot(recipe({ logic: 'orders' }))).toBe(false);
    // The frozen recipe rebuilds the same sheet.
    const frozen = recipeSnapshot(recipe({ logic: 'traysTotal', trayWeight: 900 }));
    expect(buildSheet({ recipe: frozen, items: [], trays: 4, totalInput: 100 }).total_g).toBe(3700);
  });

  // ── Words ───────────────────────────────────────────────────────────────────────────
  test('formatGrams groups four-digit numbers (Italian Intl would not by default)', () => {
    expect(formatGrams(5000)).toBe('5,000'); // the interface language is English under test
    expect(formatGrams(NaN)).toBe('0');
    expect(formatGrams(1234.6)).toBe('1,235');
  });

  // ── Wiring (the DOM cannot run here; the shapes that broke before are pinned) ───────
  test('a tray weight under 50 g is refused on Save and never read as grams per tray', () => {
    expect(MIN_TRAY_WEIGHT).toBe(50);
    expect(isValidTrayWeight(49)).toBe(false);
    expect(isValidTrayWeight(50)).toBe(true);
    // A stored weight under 50 (from anywhere but the Recipes screen) reads as the default.
    for (const low of [1, 1.2, 30, 49]) expect(normalizeTrayWeight(low), String(low)).toBe(1000);
    expect(normalizeTrayWeight(50)).toBe(50);
    expect(normalizeConfig({ clients: [], recipes: [{ id: 'a', name: 'A', logic: 'trays', trayWeight: 1.2, ingredients: INGS }] }).recipes[0].trayWeight).toBe(1000);
  });

  test('the trays box shows what is computed: a fraction is replaced by the whole number used', () => {
    expect(settledTraysText('2.9')).toBe('2');
    expect(settledTraysText('007')).toBe('7');
    expect(settledTraysText('-3')).toBe('0');
    expect(settledTraysText('99999')).toBe(String(MAX_TRAYS));
    expect(settledTraysText('5'), 'already whole: left alone').toBe(null);
    expect(settledTraysText(''), 'empty is left alone while typing').toBe(null);
    expect(settledTraysText('2.9') === String(normalizeTrays('2.9'))).toBe(true);
  });
});
