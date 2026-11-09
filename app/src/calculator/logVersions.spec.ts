import { describe, expect, test } from 'vitest';
import { normalizeConfig } from '@mise/shared/calculator-config';
import type { CalculatorConfig, Recipe } from '@mise/shared/calculator-config';
import type { Log, LogVersion } from '@mise/shared/log-model';
import {
  buildEditedVersion, buildManualVersion, editStart, editsTrays, manualRows, recipeToSave, resolveLogRecipeId,
} from './logVersions';

// What the Dough history's two editors save (js/log-add.js `doCommit`, js/log-edit.js `openLogEdit`/`doSave`).
// The traps are the current app's: a «both» edit once dropped the typed total and lowered every ingredient
// (tests/log-typed-total.test.mjs), an edit rebuilt from today's products once dropped the line of a deleted
// product (tests/log-edit-rows.test.mjs), and a trays edit must keep the tray weight the dough was MADE with
// (tests/calculator-trays.test.mjs).

const NOW = new Date(2026, 9, 12, 14, 5).getTime();
const WORDS = { occasionalClient: 'Occasional client', extraDough: 'Extra dough: ' };

const recipe = (over: Partial<Recipe> & { id: string }): Record<string, unknown> => ({
  name: over.id, logic: 'orders', ingredients: [
    { key: 'flour', label: 'Flour', grams: 1000 },
    { key: 'water', label: 'Water', grams: 700 },
    { key: 'yeast', label: 'Yeast', grams: 10 },
  ],
  leaveningKey: 'yeast', leaveningDefaultPct: 1, showLeavening: true, visible: true, trayWeight: 1000, ...over,
});

function config(recipes: Record<string, unknown>[], products: { id: string; recipeId: string; weight: number }[] = []): CalculatorConfig {
  return normalizeConfig({
    recipes,
    clients: [{ id: 'c1', name: 'Café', items: products.map(p => ({ productId: p.id })) }],
    products: products.map(p => ({ id: p.id, name: p.id.toUpperCase(), recipeId: p.recipeId, weight: p.weight, kind: 'number' })),
  });
}

function log(over: Partial<Log> & { versions: LogVersion[] }): Log {
  return { id: 'log-1', bakery: 'main', dough: 'pizza', recipeId: 'pizza', forDay: 'today', origin: 'manual', createdAtMs: NOW, ...over } as Log;
}

describe('recipeToSave', () => {
  const own = recipe({ id: 'pizza' }) as unknown as Recipe;
  const linkedTab = { ...own, catalogueId: 'cat-1' } as Recipe;

  test('an own recipe is saved as it is', () => {
    expect(recipeToSave(own, {})).toEqual({ recipe: own });
  });

  test('⚠️ a linked recipe not heard of yet is «loading», not «gone»', () => {
    expect(recipeToSave(linkedTab, {})).toEqual({ problem: 'loading' });
  });

  test('a linked recipe that is gone refuses, never a sheet of zeros', () => {
    expect(recipeToSave(linkedTab, { 'cat-1': null })).toMatchObject({ problem: 'missing' });
  });

  test('a linked recipe that arrived is saved with the catalogue\'s rows', () => {
    const doc = { id: 'cat-1', ingredients: [{ rid: 'a', label: 'Semola', grams: 2000, unit: 'g' }] };
    const out = recipeToSave(linkedTab, { 'cat-1': doc });
    expect('recipe' in out && out.recipe.ingredients.map(i => i.label)).toEqual(['Semola']);
  });
});

describe('«Add log»', () => {
  const cfg = config(
    [recipe({ id: 'pizza' }), recipe({ id: 'loaf', logic: 'total' }), recipe({ id: 'tray', logic: 'trays', trayWeight: 1500 })],
    [{ id: 'p1', recipeId: 'pizza', weight: 250 }, { id: 'p2', recipeId: 'pizza', weight: 100 }],
  );

  test('a recipe that takes orders starts with every product at zero; one that does not, with none', () => {
    expect(manualRows(cfg, 'pizza').map(row => [row.id, row.qty, row.weightG])).toEqual([['p1', 0, 250], ['p2', 0, 100]]);
    expect(manualRows(cfg, 'loaf')).toEqual([]);
    expect(manualRows(cfg, 'nope')).toEqual([]);
  });

  test('the version: the recipe\'s default leavening, no extra dough, the divisor at 0, the English timestamp', () => {
    const rows = manualRows(cfg, 'pizza').map(row => (row.id === 'p1' ? { ...row, qty: 4 } : row));
    const pizza = cfg.recipes.find(r => r.id === 'pizza')!;
    const v = buildManualVersion({ config: cfg, recipeId: 'pizza', recipe: pizza, rows, totalInput: 0, trays: 0, words: WORDS, nowMs: NOW });
    expect(v.sheet!.total_g).toBe(1000);
    expect(v.sheet!.extra_g).toBe(0);
    expect(v.sheet!.param).toMatchObject({ value: 1 });
    expect(v.sheet!.divisor === null || v.sheet!.divisor.n === 0).toBe(true);
    expect(v.at).toEqual({ date: 'Monday 12 October', time: '2:05 PM' });
    expect(v.calculatedBy).toBe('');
    expect(v.items!.map(it => it.qty)).toEqual([4, 0]);
    expect(v.recipe).toMatchObject({ id: 'pizza', logic: 'orders' });
    expect(v.text).toContain('P1');
  });

  test('a typed total and whole trays become the sheet\'s total', () => {
    const loaf = cfg.recipes.find(r => r.id === 'loaf')!;
    expect(buildManualVersion({ config: cfg, recipeId: 'loaf', recipe: loaf, rows: [], totalInput: '3200', trays: 0, words: WORDS, nowMs: NOW }).sheet!.total_g).toBe(3200);
    const tray = cfg.recipes.find(r => r.id === 'tray')!;
    const v = buildManualVersion({ config: cfg, recipeId: 'tray', recipe: tray, rows: [], totalInput: 0, trays: '3', words: WORDS, nowMs: NOW });
    expect(v.sheet).toMatchObject({ total_g: 4500, trays: 3, trayWeight_g: 1500 });
  });
});

describe('«Edit log»', () => {
  test('the recipe: the stored id, else the dough\'s name (migrated logs), else the first recipe', () => {
    const cfg = config([recipe({ id: 'pizza' }), recipe({ id: 'loaf', name: 'Loaf' })]);
    expect(resolveLogRecipeId(cfg, log({ recipeId: 'loaf', versions: [] }))).toBe('loaf');
    expect(resolveLogRecipeId(cfg, log({ recipeId: 'gone', dough: 'Loaf', versions: [] }))).toBe('loaf');
    expect(resolveLogRecipeId(cfg, log({ recipeId: undefined as never, dough: 'Other', versions: [] }))).toBe('pizza');
  });

  test('⚠️ the saved lines come first, verbatim; products added since follow at zero; a deleted product\'s line stays', () => {
    const cfg = config([recipe({ id: 'pizza' })], [{ id: 'p2', recipeId: 'pizza', weight: 100 }, { id: 'p3', recipeId: 'pizza', weight: 50 }]);
    const saved = [
      { id: 'p1', name: 'Old one', clientName: 'Café', qty: 3, weightG: 300, kind: 'number', crate: { show: false, perBox: 20 } },
      { id: 'p2', name: 'Renamed since', clientName: 'Café', qty: 2, weightG: 90, kind: 'number', crate: { show: false, perBox: 20 } },
    ];
    const start = editStart(cfg, log({ versions: [{ kind: 'create', items: saved, sheet: null }] }));
    expect(start.rows.map(row => [row.id, row.name, row.qty, row.weightG])).toEqual([
      ['p1', 'Old one', 3, 300], ['p2', 'Renamed since', 2, 90], ['p3', 'P3', 0, 50],
    ]);
  });

  test('⚠️ a «both» edit keeps the typed total, the leavening %, the extra and the divisor n of the version it edits', () => {
    const cfg = config([recipe({ id: 'pizza', logic: 'both' })], [{ id: 'p1', recipeId: 'pizza', weight: 100 }]);
    const frozen = { ...recipe({ id: 'pizza', logic: 'both' }) };
    const previous: LogVersion = {
      kind: 'create', calculatedBy: '', recipe: frozen as never,
      items: [{ id: 'p1', name: 'P1', clientName: 'Café', qty: 10, weightG: 100, kind: 'number', crate: { show: false, perBox: 20 } }],
      sheet: { dough: 'pizza', recipeId: 'pizza', param: { label: 'Yeast', value: 2.5 }, total_g: 3300, extra_g: 300, typed_g: 2000, ingredients: [], divisor: { names: [], total: 0, n: 4, result: 0 }, crates: [] },
    };
    const start = editStart(cfg, log({ versions: [previous] }));
    const working = { ...start, rows: start.rows.map(row => ({ ...row, qty: 12 })), calculatedBy: '  Ann  ' };
    const v = buildEditedVersion({ config: cfg, working, previous, words: WORDS, nowMs: NOW });
    expect(v.sheet!.total_g).toBe(1200 + 2000 + 300);
    expect(v.sheet!.param!.value).toBe(2.5);
    expect(v.sheet!.extra_g).toBe(300);
    expect(v.calculatedBy).toBe('Ann');
    expect(v.text).toContain('Extra dough: ');
  });

  test('⚠️ the sheet is rebuilt with the recipe the log was MADE with, not today\'s', () => {
    const today = recipe({ id: 'pizza', ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }, { key: 'salt', label: 'Salt', grams: 30 }] });
    const cfg = config([today], [{ id: 'p1', recipeId: 'pizza', weight: 1000 }]);
    const made = recipe({ id: 'pizza' });
    const previous: LogVersion = {
      kind: 'create', recipe: made as never,
      items: [{ id: 'p1', name: 'P1', clientName: 'Café', qty: 1, weightG: 1000, kind: 'number', crate: { show: false, perBox: 20 } }],
      sheet: { dough: 'pizza', recipeId: 'pizza', param: { label: 'Yeast', value: 1 }, total_g: 1000, extra_g: 0, ingredients: [], divisor: null, crates: [] },
    };
    const start = editStart(cfg, log({ versions: [previous] }));
    const v = buildEditedVersion({ config: cfg, working: start, previous, words: WORDS, nowMs: NOW });
    expect(v.sheet!.ingredients.map(i => i.name)).toEqual(['Flour', 'Water', 'Yeast']);
  });

  test('a log saved before the frozen recipe existed falls back to today\'s, or it could not be edited at all', () => {
    const cfg = config([recipe({ id: 'pizza' })]);
    const start = editStart(cfg, log({ versions: [{ kind: 'create', items: [], sheet: null }] }));
    expect(start.recipe).toMatchObject({ id: 'pizza' });
  });

  test('⚠️ a trays dough is edited by its trays, at the tray weight it was MADE with, and keeps the grams on top', () => {
    const cfg = config([recipe({ id: 'tray', logic: 'traysTotal', trayWeight: 2000 })]);
    const made = recipe({ id: 'tray', logic: 'traysTotal', trayWeight: 1500 });
    const previous: LogVersion = {
      kind: 'create', recipe: made as never, items: [],
      sheet: { dough: 'tray', recipeId: 'tray', param: null, total_g: 3500, extra_g: 0, ingredients: [], divisor: null, crates: [], trays: 2, trayWeight_g: 1500 },
    };
    const start = editStart(cfg, log({ recipeId: 'tray', versions: [previous] }));
    expect(editsTrays(start.recipe)).toBe(true);
    expect([start.trays, start.trayWeight, start.typedTotal]).toEqual([2, 1500, 500]);
    const v = buildEditedVersion({ config: cfg, working: { ...start, trays: 3 }, previous, words: WORDS, nowMs: NOW });
    expect(v.sheet).toMatchObject({ total_g: 3 * 1500 + 500, trays: 3, trayWeight_g: 1500 });
  });

  test('older logs\' occasional clients are carried forward; a nameless one gets the word handed in; empty ones go', () => {
    const cfg = config([recipe({ id: 'pizza' })]);
    const previous: LogVersion = {
      kind: 'create', items: [], recipe: recipe({ id: 'pizza' }) as never,
      occasional: [
        { name: '', products: [{ name: ' Roll ', qty: 2, weightG: 100, unit: 'pz' }] },
        { name: '', products: [{ name: 'x', qty: 0, weightG: 100, unit: 'pz' }] },
      ],
      sheet: { dough: 'pizza', recipeId: 'pizza', param: null, total_g: 200, extra_g: 0, ingredients: [], divisor: null, crates: [] },
    };
    const start = editStart(cfg, log({ versions: [previous] }));
    const v = buildEditedVersion({ config: cfg, working: start, previous, words: { ...WORDS, occasionalClient: 'Cliente occasionale' }, nowMs: NOW });
    expect(v.occasional).toEqual([{ name: 'Cliente occasionale', products: [{ name: 'Roll', qty: 2, weightG: 100, unit: 'pz', productId: '' }] }]);
    expect(v.sheet!.total_g).toBe(200);
  });
});
