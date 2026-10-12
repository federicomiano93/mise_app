import { describe, expect, it } from 'vitest';
import { getRecipeById, normalizeConfig } from '@mise/shared/calculator-config';
import type { Recipe } from '@mise/shared/calculator-config';
import { calculateTab, sourceRecipe, stillLoading } from './calculatorResult';
import type { TabNumbers } from './calculatorResult';
import { BRIOCHE, CLIENTS, FOCACCIA, SOURDOUGH } from '../testing/renderCalculator';

// The result of a tab, without a screen: what is made, from what, and the four ways of refusing.

const config = normalizeConfig({ clients: CLIENTS, recipes: [FOCACCIA, BRIOCHE, SOURDOUGH] });
const recipe = (id: string): Recipe => {
  const found = getRecipeById(config, id);
  if (!found) throw new Error(id);
  return found;
};
const numbers = (over: Partial<TabNumbers> = {}): TabNumbers => ({
  qty: () => 0, extraG: 0, totalG: 0, trays: 0, knob: null, ...over,
});
const sum = (rows: readonly { grams: number }[]) => rows.reduce((a, row) => a + row.grams, 0);

describe('nothing to make', () => {
  it('is no result at all', () => {
    expect(calculateTab(config, recipe('focaccia'), {}, numbers()).kind).toBe('none');
    expect(calculateTab(config, recipe('brioche'), {}, numbers()).kind).toBe('none');
    expect(calculateTab(config, recipe('sourdough'), {}, numbers()).kind).toBe('none');
  });

  it('even when the linked recipe is gone: there is nothing to refuse', () => {
    const linked = { ...recipe('brioche'), catalogueId: 'cat-1' };
    expect(calculateTab(config, linked, { 'cat-1': null }, numbers()).kind).toBe('none');
  });
});

describe('by logic', () => {
  it('orders: quantities x weights, plus the extra dough', () => {
    const result = calculateTab(config, recipe('focaccia'), {}, numbers({
      qty: id => (id === 'roma::tray' ? 4 : id === 'sole::cheese' ? 1.5 : 0), extraG: 500,
    }));
    expect(result.kind).toBe('ready');
    expect(result.target).toBe(4 * 500 + 1.5 * 1000 + 500);
  });

  it('total: the typed total only', () => {
    const result = calculateTab(config, recipe('brioche'), {}, numbers({ totalG: 1000, extraG: 99, qty: () => 9 }));
    expect(result.target).toBe(1000);
  });

  it('trays: trays x the recipe\'s tray weight', () => {
    expect(calculateTab(config, recipe('sourdough'), {}, numbers({ trays: '3', totalG: 99 })).target).toBe(3600);
  });

  it('a fraction of a tray is a whole tray less', () => {
    expect(calculateTab(config, recipe('sourdough'), {}, numbers({ trays: '2.9' })).target).toBe(2400);
  });
});

describe('the rows', () => {
  it.each([1, 7, 333, 1000, 1234, 4321, 99999])('add up EXACTLY to the target of %s g', grams => {
    const result = calculateTab(config, recipe('focaccia'), {}, numbers({ extraG: grams }));
    if (result.kind !== 'ready') throw new Error('not ready');
    expect(sum(result.rows)).toBe(grams);
    expect(result.totalG).toBe(grams);
  });

  it('are named as the recipe names them, in its order', () => {
    const result = calculateTab(config, recipe('focaccia'), {}, numbers({ extraG: 1725 }));
    if (result.kind !== 'ready') throw new Error('not ready');
    expect(result.rows).toEqual([
      { name: 'Flour', grams: 1000 }, { name: 'Water', grams: 700 }, { name: 'Salt', grams: 20 }, { name: 'Yeast', grams: 5 },
    ]);
  });

  it('follow the knob', () => {
    const resting = calculateTab(config, recipe('focaccia'), {}, numbers({ extraG: 1000, knob: '0.5' }));
    const more = calculateTab(config, recipe('focaccia'), {}, numbers({ extraG: 1000, knob: '1' }));
    if (resting.kind !== 'ready' || more.kind !== 'ready') throw new Error('not ready');
    expect(more.rows[3]?.grams).toBeGreaterThan(resting.rows[3]?.grams ?? 99);
    expect(sum(more.rows)).toBe(1000);
  });

  it('use the recipe\'s default % when the knob is empty or was never touched', () => {
    const a = calculateTab(config, recipe('focaccia'), {}, numbers({ extraG: 1000, knob: null }));
    const b = calculateTab(config, recipe('focaccia'), {}, numbers({ extraG: 1000, knob: '' }));
    expect(a).toEqual(b);
  });

  it('ignore the knob when the recipe does not show it', () => {
    const hidden = normalizeConfig({ clients: CLIENTS, recipes: [{ ...FOCACCIA, showLeavening: false }] });
    const r = getRecipeById(hidden, 'focaccia')!;
    const a = calculateTab(hidden, r, {}, numbers({ extraG: 1000, knob: '3' }));
    const b = calculateTab(hidden, r, {}, numbers({ extraG: 1000, knob: null }));
    expect(a).toEqual(b);
  });

  it('scale a trays recipe purely pro rata, whatever leavening the recipe names', () => {
    const odd = normalizeConfig({
      clients: [], recipes: [{ ...SOURDOUGH, leaveningKey: 'water', leaveningDefaultPct: 10, baselinePct: 10, showLeavening: true }],
    });
    const result = calculateTab(odd, getRecipeById(odd, 'sourdough')!, {}, numbers({ trays: '1', knob: '40' }));
    if (result.kind !== 'ready') throw new Error('not ready');
    expect(result.rows.map(row => row.grams)).toEqual([720, 480]);
  });
});

describe('a recipe taken from the catalogue', () => {
  const linked = (extra: Record<string, unknown> = {}): Recipe => ({
    ...recipe('brioche'), ingredients: [], catalogueId: 'cat-1', ...extra,
  });
  const doc = (rows: unknown[]) => ({ id: 'cat-1', name: 'Catalogue', ingredients: rows });
  const GOOD = [
    { rid: 'r-flour', label: 'Flour', grams: 600, unit: 'g' },
    { rid: 'r-yeast', label: 'Yeast', grams: 400, unit: 'g' },
  ];

  it('is «loading» until the recipe has been heard of — a missing key — and «gone» when the answer is null', () => {
    expect(stillLoading(linked(), {})).toBe(true);
    expect(stillLoading(linked(), { 'cat-1': null })).toBe(false);
    expect(stillLoading(linked(), { 'cat-1': doc(GOOD) })).toBe(false);
    expect(stillLoading(recipe('brioche'), {})).toBe(false);
    expect(calculateTab(config, linked(), {}, numbers({ totalG: 1000 })).kind).toBe('loading');
    expect(calculateTab(config, linked(), { 'cat-1': null }, numbers({ totalG: 1000 }))).toMatchObject({ kind: 'problem', problem: 'missing' });
  });

  it('reads the catalogue\'s rows, never the tab\'s own copy', () => {
    const own = linked({ ingredients: [{ key: 'old', label: 'Stale copy', grams: 1 }] });
    const result = calculateTab(config, own, { 'cat-1': doc(GOOD) }, numbers({ totalG: 1000 }));
    if (result.kind !== 'ready') throw new Error('not ready');
    expect(result.rows).toEqual([{ name: 'Flour', grams: 600 }, { name: 'Yeast', grams: 400 }]);
  });

  it('refuses a recipe with no ingredients', () => {
    expect(calculateTab(config, linked(), { 'cat-1': doc([]) }, numbers({ totalG: 1000 })))
      .toMatchObject({ kind: 'problem', problem: 'empty' });
  });

  it('refuses a recipe with a row that has no weight, and NAMES the row', () => {
    const rows = [...GOOD, { rid: 'r-p', label: 'Pinch of salt', grams: 0, unit: 'pinch' }];
    expect(calculateTab(config, linked(), { 'cat-1': doc(rows) }, numbers({ totalG: 1000 })))
      .toMatchObject({ kind: 'problem', problem: 'unweighable', row: 'Pinch of salt' });
  });

  it('calculates the leavening from the catalogue\'s own row, matched by its rid', () => {
    const both = linked({ logic: 'both', leaveningRid: 'r-yeast', leaveningDefaultPct: 40, baselinePct: 40, showLeavening: true });
    const { source } = sourceRecipe(both, { 'cat-1': doc(GOOD) });
    expect(source.leaveningKey).toBe('r-yeast');
    const rest = calculateTab(config, both, { 'cat-1': doc(GOOD) }, numbers({ totalG: 1000, knob: '40' }));
    const less = calculateTab(config, both, { 'cat-1': doc(GOOD) }, numbers({ totalG: 1000, knob: '20' }));
    if (rest.kind !== 'ready' || less.kind !== 'ready') throw new Error('not ready');
    expect(rest.rows.map(row => row.grams)).toEqual([600, 400]);
    expect(less.rows[1]?.grams).toBeLessThan(400);
    expect(sum(less.rows)).toBe(1000);
  });
});
