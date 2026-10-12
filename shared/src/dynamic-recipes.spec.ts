// Unit tests for the recipes-in-config model and the generic, data-driven dough math (P15 — the owner cannot
// read code, so this is the safety net for the app's CORE: the dough quantities), run against BOTH
// implementations: the TypeScript ports in shared/ and the js/ files the live app uses today. Ported from
// tests/dynamic-recipes.test.mjs (all 21 of its tests); the two must stay equal until the switch to Mise 2.
//
// The headline guarantee: scaling a recipe from its config data (recipeSpec → scaleRecipe) produces the SAME
// numbers as the hand-written scaleFocaccia / scaleBrioche / scaleSourdough. Each side uses its OWN config
// and its OWN dough math, so a drift in either file is a failure here.
//
// ⚠️ THE BAKERY'S DATA IS A FIXTURE, NOT THE APP'S DEFAULT (13 Aug 2026): tests/fixtures/bakery-config.mjs.

import { describe, expect, test } from 'vitest';
import * as portedConfig from './calculator-config';
import * as portedMath from './calculator-dough-math';
import * as legacyConfigJs from '../../js/calculator-config.js';
import * as legacyMathJs from '../../js/calculator-dough-math.js';
import { BAKERY_CONFIG as bakeryFixture } from '../../tests/fixtures/bakery-config.mjs';

type Loose = any;
const BAKERY_CONFIG: Loose = bakeryFixture;

describe.each([
  ['shared/ (TypeScript)', { config: portedConfig, math: portedMath }],
  ['js/ (current app)', {
    config: legacyConfigJs as unknown as typeof portedConfig,
    math: legacyMathJs as unknown as typeof portedMath,
  }],
] as const)('%s', (_name, w) => {
  const {
    pairId, getRecipes, getRecipeById, getVisibleRecipes, getIngredients, recipeSpec, showsLeaveningKnob,
    computeRecipeTarget, LOGICS, MAX_VISIBLE_RECIPES,
  } = w.config as unknown as Record<string, Loose>;
  const normalizeConfig = (raw: unknown): Loose => w.config.normalizeConfig(raw);
  const { scaleRecipe, scaleFocaccia, scaleBrioche, scaleSourdough } = w.math as unknown as Record<string, Loose>;

  // The recipe amount objects the legacy scale functions expect (mirror RECIPE_DEFAULTS
  // in js/recipes.js — recipes.js can't load under Node, it reads localStorage).
  const FOCACCIA = { flourBlu: 278, flourT65: 278, malt: 3, sugar: 8, salt: 11, yeast: 3.6, oil: 56, water1: 334, water2: 24 };
  const BRIOCHE = { flour: 3185, yeast: 127.4, water: 1575 };
  const SOURDOUGH = { flourBlu: 2560, flourT65: 2560, flourWhole: 570, water1: 3800, starter: 1024, malt: 30, salt: 124, water2: 300 };

  const scaleViaConfig = (config: Loose, id: string, target: number, pct: number): Loose => scaleRecipe(recipeSpec(getRecipeById(config, id)), target, pct);

  // ── The default recipes ────────────────────────────────────────────────────────

  test('the default config ships three recipes, all visible, in order', () => {
    expect(getRecipes(BAKERY_CONFIG).map((r: Loose) => r.id)).toStrictEqual(['focaccia', 'brioche', 'sourdough']);
    expect(getVisibleRecipes(BAKERY_CONFIG).map((r: Loose) => r.id)).toStrictEqual(['focaccia', 'brioche', 'sourdough']);
    for (const r of getRecipes(BAKERY_CONFIG)) expect(r.logic).toBe('orders');
  });

  test('the ingredient registry is seeded with the recipes’ distinct names', () => {
    const names = getIngredients(BAKERY_CONFIG).map((i: Loose) => i.name);
    for (const n of ['Flour uniqua blue', 'Yeast', 'Starter', 'Mella brioche pof', '2° Water']) {
      expect(names.includes(n), 'registry has ' + n).toBeTruthy();
    }
  });

  // ── Generic math equals the legacy per-recipe math (BYTE-IDENTICAL) ─────────────

  test('focaccia: config-driven scaling equals scaleFocaccia across the knob range', () => {
    for (const target of [1000, 3217, 5000, 12345]) {
      for (const pct of [0.5, 0.65, 1, 1.5]) {
        expect(scaleViaConfig(BAKERY_CONFIG, 'focaccia', target, pct), `focaccia ${target}g @ ${pct}%`).toStrictEqual(scaleFocaccia(FOCACCIA, target, pct));
      }
    }
  });

  test('brioche: config-driven scaling equals scaleBrioche EXACTLY across the knob range', () => {
    for (const target of [2000, 4887.4, 9000, 18000]) {
      for (const pct of [2, 4, 6, 8]) {
        expect(scaleViaConfig(BAKERY_CONFIG, 'brioche', target, pct), `brioche ${target}g @ ${pct}%`).toStrictEqual(scaleBrioche(BRIOCHE, target, pct));
      }
    }
  });

  test('sourdough: config-driven scaling equals scaleSourdough EXACTLY across the knob range', () => {
    for (const target of [5000, 9000, 18100]) {
      for (const pct of [12, 18, 25, 30]) {
        expect(scaleViaConfig(BAKERY_CONFIG, 'sourdough', target, pct), `sourdough ${target}g @ ${pct}%`).toStrictEqual(scaleSourdough(SOURDOUGH, target, pct));
      }
    }
  });

  test('the displayed integers always sum to Math.round(target)', () => {
    for (const id of ['focaccia', 'brioche', 'sourdough']) {
      for (const target of [1234, 5000, 9999]) {
        const out = scaleViaConfig(BAKERY_CONFIG, id, target, getRecipeById(BAKERY_CONFIG, id).leaveningDefaultPct);
        expect(out.reduce((a: number, b: number) => a + b, 0), `${id} sums to ${target}`).toBe(Math.round(target));
      }
    }
  });

  // ── recipeSpec ──────────────────────────────────────────────────────────────────

  test('recipeSpec builds ordered amounts, the leavening key and the stored baseline', () => {
    const spec = recipeSpec(getRecipeById(BAKERY_CONFIG, 'focaccia'));
    expect(Object.keys(spec.amounts)).toStrictEqual(['flourBlu', 'flourT65', 'malt', 'sugar', 'salt', 'yeast', 'oil', 'water1', 'water2']);
    expect(spec.amounts.yeast).toBe(3.6);
    expect(spec.leaveningKey).toBe('yeast');
    expect(Math.abs(spec.baselinePct - 0.6474820143884892) < 1e-9).toBeTruthy();
  });

  test('recipeSpec on a leavening-less recipe scales pro-rata (no leavening key)', () => {
    const recipe = {
      id: 'r1', name: 'Bread', logic: 'total',
      ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }, { key: 'water', label: 'Water', grams: 600 }],
      leaveningKey: null, baselinePct: null,
    };
    const spec = recipeSpec(recipe);
    expect(spec.leaveningKey).toBe(null);
    const out = scaleRecipe(spec, 800, 0); // half size, pro-rata
    expect(out).toStrictEqual([500, 300]);
  });

  // ── Leavening-knob visibility ───────────────────────────────────────────────────

  test('showsLeaveningKnob: only orders/both with a designated, shown leavening', () => {
    const base = { leaveningKey: 'yeast', showLeavening: true };
    expect(showsLeaveningKnob({ ...base, logic: 'orders' })).toBe(true);
    expect(showsLeaveningKnob({ ...base, logic: 'both' })).toBe(true);
    expect(showsLeaveningKnob({ ...base, logic: 'total' })).toBe(false);     // total → never
    expect(showsLeaveningKnob({ logic: 'orders', leaveningKey: null })).toBe(false); // no leavening
    expect(showsLeaveningKnob({ logic: 'orders', leaveningKey: 'yeast', showLeavening: false })).toBe(false);
  });

  // ── Normalisation ───────────────────────────────────────────────────────────────

  // ⚠️ REVERSED 13 Aug 2026, ON PURPOSE. This used to assert that a document with no
  // recipes GAINED three — The Italian Club Bakery's three. It was reasonable while
  // the app had one user and became two defects the moment it had customers: a new
  // customer opened the Calculator holding one bakery's formulas, and a customer who
  // deleted all their own recipes had those formulas appear from nowhere.
  //
  // No recipes is now a real answer, and the screen says so instead of filling the
  // silence with somebody else's work.
  test('a config without recipes STAYS without recipes', () => {
    const nested = { clients: [{ id: 'c1', name: 'A', products: [{ id: 'p1', name: 'X', dough: 'focaccia', weight: 100, kind: 'number' }] }] };
    const norm = normalizeConfig(nested);
    expect(getRecipes(norm).map((r: Loose) => r.id), 'an empty recipe list must never be refilled with the bakery’s own recipes').toStrictEqual([]);
  });

  // And deleting the last recipe must not bring them back either — the same defect
  // seen from the other side, and the one a customer would actually hit.
  test('deleting every recipe leaves none, not three', () => {
    const emptied = normalizeConfig({ ...BAKERY_CONFIG, recipes: [] });
    expect(getRecipes(emptied).map((r: Loose) => r.id)).toStrictEqual([]);
  });

  test('normalizeRecipe: repairs logic, validates the leavening key, keeps unique keys', () => {
    const raw = {
      products: [], clients: [],
      recipes: [{
        id: 'r1', name: 'Custom', logic: 'weird',
        ingredients: [
          { key: 'a', label: 'Flour', grams: 1000 },
          { key: 'a', label: 'Water', grams: 500 }, // duplicate key -> made unique
          { label: 'Yeast', grams: 20 },            // no key -> derived from label
        ],
        leaveningKey: 'ghost', leaveningDefaultPct: 2,
      }],
    };
    const r = getRecipeById(normalizeConfig(raw), 'r1');
    expect(r.logic).toBe('orders');                 // 'weird' -> default
    expect(r.leaveningKey).toBe(null);              // 'ghost' is not an ingredient key
    const keys = r.ingredients.map((i: Loose) => i.key);
    expect(new Set(keys).size).toBe(keys.length);   // keys are unique
    expect(r.ingredients[2].key).toBe('yeast');     // derived from the label slug
  });

  test('normalizeRecipe: baseline falls back to the default leavening % when unset', () => {
    const raw = {
      products: [], clients: [],
      recipes: [{
        id: 'r1', name: 'Custom', logic: 'orders',
        ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }, { key: 'yeast', label: 'Yeast', grams: 20 }],
        leaveningKey: 'yeast', leaveningDefaultPct: 2, // no baselinePct given
      }],
    };
    const r = getRecipeById(normalizeConfig(raw), 'r1');
    expect(r.baselinePct).toBe(2); // falls back to the default leavening %
  });

  test('normalizeRecipes: de-duplicates by id (first wins)', () => {
    const raw = {
      products: [], clients: [],
      recipes: [
        { id: 'r1', name: 'First', logic: 'orders', ingredients: [{ key: 'a', label: 'A', grams: 1 }] },
        { id: 'r1', name: 'Dup', logic: 'total', ingredients: [{ key: 'b', label: 'B', grams: 2 }] },
      ],
    };
    const recipes = getRecipes(normalizeConfig(raw));
    expect(recipes.length).toBe(1);
    expect(recipes[0].name).toBe('First');
  });

  test('normalizeIngredients: registry is the union of saved names and recipe labels', () => {
    const raw = {
      products: [], clients: [],
      recipes: [{ id: 'r1', name: 'R', logic: 'total', ingredients: [{ key: 'flour', label: 'Special Flour', grams: 1000 }] }],
      ingredients: [{ id: 'i1', name: 'Olives' }, { id: 'i2', name: 'olives' }], // case-dup collapsed
    };
    const names = getIngredients(normalizeConfig(raw)).map((i: Loose) => i.name);
    expect(names.includes('Olives')).toBeTruthy();
    expect(names.includes('Special Flour')).toBeTruthy(); // recipe label seeded into the registry
    expect(names.filter((n: Loose) => n.toLowerCase() === 'olives').length).toBe(1); // de-duped
  });

  test('getVisibleRecipes caps at MAX_VISIBLE_RECIPES and honours order + visible', () => {
    const mk = (id: string, order: number, visible: boolean): Loose => ({ id, name: id, logic: 'orders', ingredients: [{ key: 'a', label: 'A', grams: 1 }], order, visible });
    const raw = { products: [], clients: [], recipes: [
      mk('e', 4, true), mk('a', 0, true), mk('hidden', 1, false), mk('b', 1, true), mk('c', 2, true), mk('d', 3, true),
    ] };
    const visible = getVisibleRecipes(normalizeConfig(raw)).map((r: Loose) => r.id);
    expect(visible.length).toBe(MAX_VISIBLE_RECIPES);
    expect(visible).toStrictEqual(['a', 'b', 'c', 'd']); // hidden excluded, sorted by order, capped at 4
  });

  test('LOGICS lists the five calc logics', () => {
    expect(LOGICS).toStrictEqual(['orders', 'total', 'both', 'trays', 'traysTotal']);
  });

  // ── computeRecipeTarget (per-logic target, the dangerous math) ──────────────────

  test('computeRecipeTarget: orders = Σ(qty×weight) + extra; ignores any typed total', () => {
    const recipe = getRecipeById(BAKERY_CONFIG, 'focaccia'); // logic 'orders'
    const getQty = (id: string): number => ({ [pairId('c-bakery', 'f-pizze')]: 10 } as Record<string, number>)[id] || 0; // 10×201
    const t = computeRecipeTarget(BAKERY_CONFIG, recipe, { getQty, extraGrams: 500, totalInput: 9999 });
    expect(t).toBe(10 * 201 + 500); // typed total ignored for 'orders'
  });

  test('computeRecipeTarget: total = the typed total only (no orders, no extra)', () => {
    const recipe = { id: 'r1', logic: 'total', ingredients: [] };
    const getQty = () => 5; // would-be orders ignored
    expect(computeRecipeTarget(BAKERY_CONFIG, recipe, { getQty, extraGrams: 500, totalInput: 8000 })).toBe(8000);
  });

  test('computeRecipeTarget: both = orders + typed total + extra', () => {
    const recipe = { ...getRecipeById(BAKERY_CONFIG, 'focaccia'), logic: 'both' };
    const getQty = (id: string): number => ({ [pairId('c-bakery', 'f-pizze')]: 10 } as Record<string, number>)[id] || 0;
    const t = computeRecipeTarget(BAKERY_CONFIG, recipe, { getQty, extraGrams: 500, totalInput: 2000 });
    expect(t).toBe(10 * 201 + 2000 + 500);
  });

  test('computeRecipeTarget never produces NaN/negative from junk inputs', () => {
    const recipe = { id: 'r1', logic: 'both', ingredients: [] };
    const t = computeRecipeTarget(BAKERY_CONFIG, recipe, { getQty: () => 0, extraGrams: 'oops', totalInput: -50 });
    expect(Number.isFinite(t) && t >= 0).toBeTruthy();
  });
});
