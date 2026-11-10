// The products made from the recipe book (item 29 of docs/mise2-port-owed.md), run against BOTH implementations: the port in shared/
// and js/foodcost/from-recipes.js. A mirror of tests/foodcost-cards-from-recipes.test.mjs (current app 5f2fcb67): what would go
// wrong unseen is a duplicate (the link lost, or a hand-made product ignored), a product with numbers nobody typed, and an id
// Firestore refuses. The two source-reading tests of that file (the create asks the SERVER first, the written fields are in the
// rules whitelist) are specs of the data layer here: app/src/foodcost/foodcostSource.spec.ts and foodcostStore.spec.ts.

import { describe, expect, test } from 'vitest';
import * as ported from './from-recipes';
import * as legacyJs from '../../js/foodcost/from-recipes.js';
import { normalizeProduct, PRODUCT_MODEL } from './foodcost-model';
import * as legacyModel from '../../js/foodcost/foodcost-model.js';

const legacy = legacyJs as unknown as typeof ported;

const recipe = (id: string, name: string, rows: unknown[] = [{ label: 'Farina', grams: 1000, unit: 'g' }], extra: Record<string, unknown> = {}) =>
  ({ id, name, ingredients: rows, ...extra });

describe.each([
  ['shared/ (TypeScript)', ported, normalizeProduct as (p: unknown) => { name: string; components: unknown[] }],
  ['js/ (current app)', legacy, legacyModel.normalizeProduct as unknown as (p: unknown) => { name: string; components: unknown[] }],
] as const)('%s', (_name, m, normalise) => {
  // ── The link ───────────────────────────────────────────────────────────────

  test('the product id comes from the recipe id, and back', () => {
    expect(m.recipeProductId('abc123')).toBe('recipe-abc123');
    expect(m.recipeIdOfProduct('recipe-abc123')).toBe('abc123');
    expect(m.recipeIdOfProduct('Xy7randomId'), 'a product made by hand').toBe('');
    expect(m.recipeProductId('  abc  '), 'trimmed').toBe('recipe-abc');
  });

  test('an id Firestore would refuse makes no product at all', () => {
    for (const id of ['', '   ', null, undefined, 'a/b']) expect(m.recipeProductId(id), String(id)).toBe('');
    expect(m.productFromRecipe(recipe('a/b', 'Pane'))).toBeNull();
  });

  // ── What the recipe gives ──────────────────────────────────────────────────

  test('the whole recipe, less its oven loss, in kilos', () => {
    expect(m.wholeRecipeKg(recipe('r', 'Pane', [
      { label: 'Farina', grams: 1, unit: 'kg' },
      { label: 'Acqua', grams: 700, unit: 'g' },
      { label: 'Uova', grams: 2, unit: 'pcs' }, // pieces weigh nothing here
    ], { lossPct: 10 }))).toBe(1.53);
    expect(m.wholeRecipeKg(recipe('r', 'Pane', [{ label: 'Uova', grams: 3, unit: 'pcs' }]))).toBe(0);
    expect(m.wholeRecipeKg(null)).toBe(0);
  });

  test('the weighable rows, less the oven loss, in kilos to the gram', () => {
    expect(m.wholeRecipeKg({ ingredients: [{ label: 'Flour', grams: 1, unit: 'kg' }, { label: 'Water', grams: 0.65, unit: 'l' }] })).toBe(1.65);
    expect(m.wholeRecipeKg({ lossPct: 12, ingredients: [{ label: 'Flour', grams: 1000, unit: 'g' }] })).toBe(0.88);
    expect(m.wholeRecipeKg({ ingredients: [{ label: 'Salt', grams: 333.3333, unit: 'g' }] }), 'rounded to the gram').toBe(0.333);
  });

  test('a recipe of pieces and spoons only, an empty one or nothing at all weighs 0', () => {
    expect(m.wholeRecipeKg({ ingredients: [{ label: 'Eggs', grams: 4, unit: 'pcs' }, { label: 'Salt', grams: 1, unit: 'pinch' }] })).toBe(0);
    expect(m.wholeRecipeKg({ ingredients: [] })).toBe(0);
    expect(m.wholeRecipeKg({})).toBe(0);
    expect(m.wholeRecipeKg(null)).toBe(0);
    expect(m.wholeRecipeKg(undefined)).toBe(0);
  });

  test('a loss that is not a number, or 0 and below, is no loss', () => {
    const rows = [{ label: 'Flour', grams: 500, unit: 'g' }];
    for (const lossPct of [null, 'abc', 0, -5]) expect(m.wholeRecipeKg({ lossPct, ingredients: rows }), String(lossPct)).toBe(0.5);
  });

  test('a product from a recipe: its name and its line — and nothing nobody typed', () => {
    const p = m.productFromRecipe(recipe('r1', '  Brioche col tuppo ', undefined, { lossPct: 0 }));
    expect(p).not.toBeNull();
    const made = p as unknown as Record<string, unknown>;
    expect(made['id']).toBe('recipe-r1');
    expect(made['name']).toBe('Brioche col tuppo');
    expect(made['components']).toEqual([{ recipeId: 'r1', qtyKg: 1 }]);
    expect(made['packaging']).toEqual([]);
    for (const key of ['sellingMode', 'piecesPerBatch', 'packSize', 'packUnit', 'sellingPrice',
      'vatRate', 'foodCostTarget', 'labourMinutes', 'labourPeople']) {
      expect(made[key], key).toBeNull();
    }
    expect(made['model']).toBe(PRODUCT_MODEL);
    // It survives the normaliser the store runs every product through, unchanged.
    const norm = normalise(made);
    expect(norm.name).toBe(made['name']);
    expect(norm.components).toEqual(made['components']);
  });

  test('a recipe without a name makes no product; a long one is cut to what the rules take', () => {
    expect(m.productFromRecipe(recipe('r', '   '))).toBeNull();
    expect(m.productFromRecipe(recipe('r', 'x'.repeat(250)))?.name.length).toBe(200);
  });

  // ── Which recipes are missing ──────────────────────────────────────────────

  test('⚠️ a recipe whose own product exists is never offered again — renamed or emptied', () => {
    const recipes = { r1: recipe('r1', 'Pane') };
    const products = [{ id: 'recipe-r1', name: 'Pagnotta', components: [] }];
    expect(m.recipesWithoutProducts(recipes, products)).toEqual({ create: [], maybe: [] });
  });

  test('⚠️ a hand-made product is only a «maybe», never a link', () => {
    const recipes = [recipe('r1', 'Crema pasticcera'), recipe('r2', 'Focaccia'), recipe('r3', 'Sfincione')];
    const products = [
      { id: 'p1', name: 'Cornetto alla crema', components: [{ recipeId: 'r1', qtyKg: 1 }] },
      { id: 'p2', name: '  FOCÀCCIA ', components: [] },
    ];
    const out = m.recipesWithoutProducts<{ id: string }>(recipes, products);
    expect(out.create.map(c => c.recipe.id)).toEqual(['r3']);
    expect(out.maybe.map(x => [x.recipe.id, x.reason, x.productName])).toEqual([
      ['r1', 'used', 'Cornetto alla crema'],
      ['r2', 'same-name', 'FOCÀCCIA'],
    ]);
  });

  test('sorted by name; nameless recipes left out; kilos carried for the screen', () => {
    const out = m.recipesWithoutProducts<{ id: string }>({
      b: recipe('b', 'sfincione'), a: recipe('a', 'Brioche'), c: recipe('c', ''),
    }, []);
    expect(out.create.map(c => c.recipe.id)).toEqual(['a', 'b']);
    expect(out.create[0]?.kg).toBe(1);
  });

  test('a recipe is offered with the very object it was given', () => {
    const mine = recipe('r1', 'Pane');
    expect(m.recipesWithoutProducts([mine], []).create[0]?.recipe).toBe(mine);
  });

  test('junk in, empty out', () => {
    expect(m.recipesWithoutProducts(null, null)).toEqual({ create: [], maybe: [] });
    expect(m.recipesWithoutProducts([null, 5, 'x'], [null])).toEqual({ create: [], maybe: [] });
  });
});

test('the two files give the same answer for a handful of shapes', () => {
  const shapes: unknown[] = [
    { lossPct: 99.5, ingredients: [{ grams: 1000 }] },
    { lossPct: '15', ingredients: [{ grams: '700', unit: 'g' }, { grams: 2, unit: 'dl' }] },
    { ingredients: 'not a list' },
    { ingredients: [{ grams: 5, unit: 'KG' }] },
  ];
  for (const shape of shapes) expect(ported.wholeRecipeKg(shape), JSON.stringify(shape)).toBe(legacy.wholeRecipeKg(shape));
});
