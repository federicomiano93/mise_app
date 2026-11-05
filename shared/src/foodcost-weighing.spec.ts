// Unit tests for the oven loss, typed on a product's recipe line in Food cost and stored on the RECIPE (P15
// — the owner cannot read code, so these tests are the safety net), run against BOTH implementations: the
// TypeScript port in shared/ and js/foodcost/foodcost-weighing.js, which the live app uses today. Ported
// from tests/foodcost-weighing.test.mjs, every one of its 17 tests (none reads a screen's source). The
// module is a FULL port, so parity.spec.ts also compares its exports name by name.
//
// Federico, 13 Sep 2026: «togli dalla scheda ricetta il peso crudo e cotto e aggiungilo nella scheda del
// food cost» — and, asked, the loss belongs to the recipe.
//
// ⚠️⚠️ THESE RUN THE CODE. The same rules used to be guarded by reading the recipe editor's source, which
// is how a guard ends up green on a branch it never reached. What they protect is the one property nothing
// on screen can show: A PRODUCT SOMEBODY ONLY OPENS MUST NOT CHANGE WHAT A RECIPE COSTS.

import { describe, expect, test } from 'vitest';
import * as ported from './foodcost-weighing';
import * as legacyJs from '../../js/foodcost/foodcost-weighing.js';

const legacy = legacyJs as unknown as typeof ported;

// 600 + 400 = 1000 g of weighable dough, plus a row with no weight that must not count.
const recipe = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'foc', name: 'Focaccia',
  ingredients: [
    { label: 'Flour', grams: 600, unit: 'g' },
    { label: 'Water', grams: 400, unit: 'g' },
    { label: 'Rosemary', grams: 0, unit: 'to taste' },
  ],
  ...extra,
});

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  // ── 1. Nothing is written unless a person typed it ─────────────────────────

  test('⚠️⚠️ an untouched line produces no patch, whatever the recipe carries', () => {
    const variants = [
      recipe(),
      recipe({ lossPct: 0 }),
      recipe({ lossPct: 12 }),
      recipe({ lossPct: 20, rawGrams: 1000, cookedGrams: 800 }),
      // An old document the recipe editor could store: a pair that disagrees with its own percentage.
      // Opening it must still write nothing.
      recipe({ lossPct: 5, rawGrams: 1000, cookedGrams: 1200 }),
      recipe({ rawGrams: 1000 }),
    ];
    for (const r of variants) {
      const state = m.startWeighing(r);
      expect(state.touched).toBe(false);
      expect(m.readWeighing(r, state).patch, JSON.stringify(r)).toBe(null);
    }
  });

  test('an unweighed recipe: the raw box follows the total, the cooked box is empty', () => {
    const state = m.startWeighing(recipe({ lossPct: 12 }));
    expect(state.rawTyped).toBe(false);
    expect(state.weighed).toBe(false);
    expect(state.cooked, 'no cooked weight is derived from a percentage').toBe(0);
    expect(m.readWeighing(recipe({ lossPct: 12 }), state).rawShown,
      'the total of the rows that have a weight — «to taste» is not in it').toBe('1000');
  });

  test('⚠️⚠️ a stored 0 is «nobody has weighed it», never «loses 0%»', () => {
    const r = recipe({ lossPct: 0 });
    const shown = m.readWeighing(r, m.startWeighing(r));
    expect(shown.message).toStrictEqual({ key: 'fc.lossNotYet', params: {} });
  });

  test('a stored percentage above zero is named, and invites a new weighing', () => {
    const r = recipe({ lossPct: 12 });
    expect(m.readWeighing(r, m.startWeighing(r)).message).toStrictEqual({ key: 'fc.lossStored', params: { pct: '12' } });
  });

  test('⚠️ a weighed recipe opens showing its weights, and states the percentage it is COSTED at', () => {
    const r = recipe({ lossPct: 5, rawGrams: 1000, cookedGrams: 800 });
    const state = m.startWeighing(r);
    expect(state.raw).toBe(1000);
    expect(state.cooked).toBe(800);
    expect(m.readWeighing(r, state).message,
      'the boxes work out to 20%, but the cost model divides by the stored 5% — say that one')
      .toStrictEqual({ key: 'fc.lossIs', params: { pct: '5' } });
  });

  // ── 2. A person types ──────────────────────────────────────────────────────

  test('typing the cooked weight alone works the loss out against the recipe total', () => {
    const r = recipe({ lossPct: 12 });
    const state = m.typeCooked(m.startWeighing(r), '800');
    const shown = m.readWeighing(r, state);
    expect(shown.patch).toStrictEqual({ lossPct: 20, rawGrams: 1000, cookedGrams: 800 });
    expect(shown.message).toStrictEqual({ key: 'fc.lossIs', params: { pct: '20' } });
    expect(shown.warning).toBe(null);
  });

  test('a typed raw weight overrides the total, and clearing it hands the box back', () => {
    const r = recipe();
    let state = m.typeRaw(m.startWeighing(r), '1250');
    state = m.typeCooked(state, '1000');
    expect(m.readWeighing(r, state).patch).toStrictEqual({ lossPct: 20, rawGrams: 1250, cookedGrams: 1000 });
    state = m.typeRaw(state, '   ');
    expect(state.rawTyped).toBe(false);
    expect(m.readWeighing(r, state).rawShown).toBe('1000');
    expect(m.readWeighing(r, state).patch?.rawGrams).toBe(1000);
  });

  test('⚠️ a half-filled pair writes nothing and still names the stored percentage', () => {
    const r = recipe({ lossPct: 12 });
    const state = m.typeRaw(m.startWeighing(r), '1000');
    const shown = m.readWeighing(r, state);
    expect(shown.patch, 'one weight cannot make a percentage').toBe(null);
    expect(shown.message, 'and it must not hide the real percentage the recipe already carries')
      .toStrictEqual({ key: 'fc.lossStored', params: { pct: '12' } });
  });

  test('⚠️ a cooked dough heavier than the raw one is refused, not read as «loses nothing»', () => {
    const r = recipe({ lossPct: 12 });
    const shown = m.readWeighing(r, m.typeCooked(m.startWeighing(r), '1100'));
    expect(shown.patch).toBe(null);
    expect(shown.warning).toStrictEqual({ key: 'fc.lossCookedHeavier', params: {} });
    expect(shown.message).toStrictEqual({ key: 'fc.lossStored', params: { pct: '12' } });
  });

  test('⚠️⚠️ a loss past 99% is capped and the screen admits it', () => {
    const r = recipe();
    const shown = m.readWeighing(r, m.typeCooked(m.startWeighing(r), '1'));
    expect(shown.patch?.lossPct,
      'a stored 100 divides the price per kilo by zero: every product on it would cost Infinity').toBe(99);
    expect(shown.warning).toStrictEqual({ key: 'fc.lossCapped', params: { max: '99' } });
  });

  test('retyping the numbers a recipe already carries is not a change', () => {
    const r = recipe({ lossPct: 20, rawGrams: 1000, cookedGrams: 800 });
    const state = m.typeCooked(m.typeRaw(m.startWeighing(r), '1000'), '800');
    expect(state.touched).toBe(true);
    expect(m.readWeighing(r, state).patch,
      'a patch here would record a margin point for something that did not happen').toBe(null);
  });

  test('typing does not change the state it was given', () => {
    const start = m.startWeighing(recipe());
    const copy = { ...start };
    m.typeRaw(start, '900');
    m.typeCooked(start, '700');
    expect(start).toStrictEqual(copy);
  });

  // ── 3. What Save writes, and what the screen costs with ───────────────────

  test('⚠️ Save writes only for recipes still on the product, still existing, and really changed', () => {
    const recipes = {
      foc: recipe({ lossPct: 12 }),
      bri: { id: 'bri', name: 'Brioche', ingredients: [{ label: 'Flour', grams: 500, unit: 'g' }] },
      same: recipe({ id: 'same', lossPct: 20, rawGrams: 1000, cookedGrams: 800 }),
    };
    const states = {
      foc: m.typeCooked(m.startWeighing(recipes.foc), '800'),
      bri: m.typeCooked(m.startWeighing(recipes.bri), '400'),        // typed, then its line removed
      // Its recipe was deleted. Both boxes typed, so the pair alone WOULD make a patch — only the «still
      // exists» rule stops it.
      gone: m.typeCooked(m.typeRaw(m.startWeighing(recipe()), '1000'), '800'),
      same: m.typeCooked(m.startWeighing(recipes.same), '800'),       // retyped, unchanged
    };
    const patches = m.weighingPatches(recipes, states, ['foc', 'same', 'gone', '']);
    expect(patches).toStrictEqual({ foc: { lossPct: 20, rawGrams: 1000, cookedGrams: 800 } });
  });

  test('the screen costs with the typed weighing, without touching the stored tables', () => {
    const tables = { recipes: { foc: recipe({ lossPct: 12 }) }, ingredients: {} };
    const frozen = JSON.stringify(tables);
    const live = m.withWeighings(tables, { foc: { lossPct: 20, rawGrams: 1000, cookedGrams: 800 } });
    expect((live.recipes.foc as { lossPct: number }).lossPct).toBe(20);
    expect((live.recipes.foc as { name: string }).name, 'the recipe keeps everything else').toBe('Focaccia');
    expect(live.ingredients).toBe(tables.ingredients);
    expect(JSON.stringify(tables), 'the stored tables are not mutated').toBe(frozen);
    expect(m.withWeighings(tables, {}), 'no weighing, no copy').toBe(tables);
    expect((m.withWeighings(tables, { nope: { lossPct: 5 } }).recipes as Record<string, unknown>)['nope'],
      'a patch for a recipe that is not there invents nothing').toBe(undefined);
  });

  // ── 4. When the database refuses ───────────────────────────────────────────

  test('⚠️ a refused weighing puts back exactly what the recipe had', () => {
    const prev = recipe({ lossPct: 12 });
    const patch = { lossPct: 20, rawGrams: 1000, cookedGrams: 800 };
    const restored = m.restoreAfterRefusal({ ...prev, ...patch }, prev, patch) as Record<string, unknown>;
    expect(restored['lossPct']).toBe(12);
    expect('rawGrams' in restored || 'cookedGrams' in restored,
      '⚠️ a weight the recipe never had is REMOVED, not left behind and not set to 0').toBe(false);
    expect(restored['name'], 'the rest of the recipe is untouched').toBe('Focaccia');

    const weighed = recipe({ lossPct: 5, rawGrams: 900, cookedGrams: 855 });
    const back = m.restoreAfterRefusal({ ...weighed, ...patch }, weighed, patch) as Record<string, unknown>;
    expect({ lossPct: back['lossPct'], rawGrams: back['rawGrams'], cookedGrams: back['cookedGrams'] })
      .toStrictEqual({ lossPct: 5, rawGrams: 900, cookedGrams: 855 });
  });

  test('⚠️⚠️ …but never over a newer weighing that has landed since', () => {
    const prev = recipe({ lossPct: 12 });
    const patch = { lossPct: 20, rawGrams: 1000, cookedGrams: 800 };
    const newer = { ...prev, lossPct: 25, rawGrams: 1000, cookedGrams: 750 };
    expect(m.restoreAfterRefusal(newer, prev, patch),
      'somebody else’s real number must not be thrown away to put an older one back').toBe(null);
    expect(m.restoreAfterRefusal(null, prev, patch), 'a recipe gone meanwhile is left gone').toBe(null);
  });

  test('the note counts the OTHER products a recipe’s loss changes', () => {
    const products = [
      { id: 'p1', components: [{ recipeId: 'foc', qtyKg: 1 }] },
      { id: 'p2', components: [{ recipeId: 'foc', qtyKg: 2 }, { recipeId: 'bri', qtyKg: 1 }] },
      { id: 'p3', components: [{ recipeId: 'bri', qtyKg: 1 }] },
      null,
    ];
    expect(m.otherProductsUsing(products, 'foc', 'p1')).toBe(1);
    expect(m.otherProductsUsing(products, 'foc', null), 'a new product has no id yet').toBe(2);
    expect(m.otherProductsUsing(products, 'none', 'p1')).toBe(0);
  });
});
