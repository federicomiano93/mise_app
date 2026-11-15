// Unit tests for the oven loss, typed on a product's recipe line in Food cost and stored on the RECIPE (P15
// — the owner cannot read code, so these tests are the safety net), run against BOTH implementations: the
// TypeScript port in shared/ and js/foodcost/foodcost-weighing.js, which the live app uses today. Ported
// from tests/foodcost-weighing.test.mjs, the tests of the 5 Nov 2026 change too (df7e6313: both boxes empty, kept wrong pairs, weighingsChangeCost). The
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

  test('⚠️ an unweighed recipe opens with BOTH boxes empty — the raw box is never filled with the total', () => {
    const state = m.startWeighing(recipe({ lossPct: 12 }));
    expect(state.weighed).toBe(false);
    expect(state.raw, 'Federico, Nov 2026: until both are written, the whole recipe weight stands').toBe(0);
    expect(state.cooked, 'no cooked weight is derived from a percentage').toBe(0);
    expect('rawTyped' in state, 'there is no «raw follows the total» state any more').toBe(false);
    expect('rawShown' in m.readWeighing(recipe({ lossPct: 12 }), state)).toBe(false);
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

  test('⚠️⚠️ the cooked weight ALONE writes no patch and leaves the stored loss as it is', () => {
    const r = recipe({ lossPct: 12 });
    const shown = m.readWeighing(r, m.typeCooked(m.startWeighing(r), '800'));
    expect(shown.patch, 'it used to work the loss out against the recipe total — an unmeasured raw').toBe(null);
    expect(shown.message, 'one box alone says that both are needed, rather than «weigh the baked dough»')
      .toStrictEqual({ key: 'fc.lossNeedBoth', params: {} });
    expect(shown.warning).toBe(null);
  });

  test('⚠️ nothing half-filled keeps the stored message; exactly one weight asks for the other', () => {
    const stored = recipe({ lossPct: 12 });
    expect(m.readWeighing(stored, m.startWeighing(stored)).message).toStrictEqual({ key: 'fc.lossStored', params: { pct: '12' } });
    const none = recipe();
    expect(m.readWeighing(none, m.startWeighing(none)).message).toStrictEqual({ key: 'fc.lossNotYet', params: {} });
    // Typed and then both cleared: nothing is half-filled any more.
    const both = m.typeCooked(m.typeRaw(m.startWeighing(stored), '1000'), '800');
    expect(m.readWeighing(stored, m.typeCooked(m.typeRaw(both, ''), '')).message)
      .toStrictEqual({ key: 'fc.lossStored', params: { pct: '12' } });
    for (const state of [m.typeRaw(m.startWeighing(none), '1000'), m.typeCooked(m.startWeighing(none), '800')]) {
      expect(m.readWeighing(none, state).message).toStrictEqual({ key: 'fc.lossNeedBoth', params: {} });
    }
  });

  test('⚠️⚠️ the raw weight ALONE writes no patch either, and keeps naming the stored percentage', () => {
    const r = recipe({ lossPct: 12 });
    const shown = m.readWeighing(r, m.typeRaw(m.startWeighing(r), '1000'));
    expect(shown.patch, 'one weight cannot make a percentage').toBe(null);
    expect(shown.message).toStrictEqual({ key: 'fc.lossNeedBoth', params: {} });
    expect(shown.warning).toBe(null);
  });

  test('⚠️ both boxes written: the loss is worked out and a patch exists', () => {
    const r = recipe({ lossPct: 12 });
    const state = m.typeCooked(m.typeRaw(m.startWeighing(r), '1250'), '1000');
    const shown = m.readWeighing(r, state);
    expect(shown.patch).toStrictEqual({ lossPct: 20, rawGrams: 1250, cookedGrams: 1000 });
    expect(shown.keepsOnly).toBe(false);
    expect(shown.message).toStrictEqual({ key: 'fc.lossIs', params: { pct: '20' } });
    expect(shown.warning).toBe(null);
  });

  test('⚠️ both written and then ONE cleared: no patch, the stored loss stays', () => {
    const r = recipe({ lossPct: 12 });
    const both = m.typeCooked(m.typeRaw(m.startWeighing(r), '1250'), '1000');
    for (const state of [m.typeRaw(both, '   '), m.typeCooked(both, ''), m.typeRaw(both, '0')]) {
      const shown = m.readWeighing(r, state);
      expect(shown.patch).toBe(null);
      expect(shown.message).toStrictEqual({ key: 'fc.lossNeedBoth', params: {} });
    }
  });

  test('a recipe weighed before opens showing its weights; changing one box re-works the loss', () => {
    const r = recipe({ lossPct: 20, rawGrams: 1000, cookedGrams: 800 });
    const state = m.typeCooked(m.startWeighing(r), '700');
    expect(state.raw, 'the stored raw weight is the other half of the pair').toBe(1000);
    expect(m.readWeighing(r, state).patch).toStrictEqual({ lossPct: 30, rawGrams: 1000, cookedGrams: 700 });
  });

  test('⚠️⚠️ a cooked dough heavier than the raw one is KEPT, with the stored loss untouched', () => {
    // Federico, Nov 2026: «per sbaglio avevo scritto il peso cotto maggiore del crudo, l'ho salvato e quando sono
    // tornato nella scheda i valori non c'erano più».
    const r = recipe({ lossPct: 12 });
    const shown = m.readWeighing(r, m.typeCooked(m.typeRaw(m.startWeighing(r), '1000'), '1100'));
    expect(shown.patch,
      'the numbers are written and the loss is NOT sent at all: a typo must never make a product cheaper, '
      + 'and this phone’s copy of the loss must never overwrite another phone’s weighing')
      .toStrictEqual({ rawGrams: 1000, cookedGrams: 1100 });
    expect('lossPct' in (shown.patch ?? {})).toBe(false);
    expect(shown.keepsOnly).toBe(true);
    expect(shown.warning).toStrictEqual({ key: 'fc.lossCookedHeavier', params: {} });
    expect(shown.message).toStrictEqual({ key: 'fc.lossStored', params: { pct: '12' } });
  });

  test('a kept wrong pair on a recipe with no loss yet writes no loss either — «nobody has said»', () => {
    const r = recipe();
    const shown = m.readWeighing(r, m.typeCooked(m.typeRaw(m.startWeighing(r), '1000'), '1100'));
    expect(shown.patch).toStrictEqual({ rawGrams: 1000, cookedGrams: 1100 });
    expect(shown.message, 'never «loses 0%»').toStrictEqual({ key: 'fc.lossNotYet', params: {} });
  });

  test('⚠️ a wrong pair that is already stored is not written again, and still warns', () => {
    const r = recipe({ lossPct: 12, rawGrams: 1000, cookedGrams: 1100 });
    const shown = m.readWeighing(r, m.typeCooked(m.typeRaw(m.startWeighing(r), '1000'), '1100'));
    expect(shown.patch).toBe(null);
    expect(shown.warning).toStrictEqual({ key: 'fc.lossCookedHeavier', params: {} });
  });

  test('⚠️⚠️ a kept wrong pair opens RED again, showing its stored numbers, with no patch', () => {
    const r = recipe({ lossPct: 5, rawGrams: 1000, cookedGrams: 1200 });
    const state = m.startWeighing(r);
    expect(state.raw).toBe(1000);
    expect(state.cooked, 'the boxes show what was kept').toBe(1200);
    const shown = m.readWeighing(r, state);
    expect(shown.warning).toStrictEqual({ key: 'fc.lossCookedHeavier', params: {} });
    expect(shown.patch, 'opening it writes nothing').toBe(null);
    expect(shown.message).toStrictEqual({ key: 'fc.lossStored', params: { pct: '5' } });
    const never = recipe({ rawGrams: 1000, cookedGrams: 1200 });
    expect(m.readWeighing(never, m.startWeighing(never)).message, 'a recipe that was never given a loss does not say «loses 0%»')
      .toStrictEqual({ key: 'fc.lossNotYet', params: {} });
  });

  test('⚠️⚠️ a loss past 99% is capped and the screen admits it', () => {
    const r = recipe();
    const shown = m.readWeighing(r, m.typeCooked(m.typeRaw(m.startWeighing(r), '1000'), '1'));
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
      foc: m.typeCooked(m.typeRaw(m.startWeighing(recipes.foc), '1000'), '800'),
      bri: m.typeCooked(m.typeRaw(m.startWeighing(recipes.bri), '500'), '400'),   // typed, then its line removed
      // Its recipe was deleted. Both boxes typed, so the pair alone WOULD make a patch — only the «still
      // exists» rule stops it.
      gone: m.typeCooked(m.typeRaw(m.startWeighing(recipe()), '1000'), '800'),
      same: m.typeCooked(m.startWeighing(recipes.same), '800'),       // retyped, unchanged
    };
    const patches = m.weighingPatches(recipes, states, ['foc', 'same', 'gone', '']);
    expect(patches).toStrictEqual({ foc: { lossPct: 20, rawGrams: 1000, cookedGrams: 800 } });
  });

  test('⚠️ a kept wrong pair is written but is NOT a cost change, so no margin point is recorded for it', () => {
    const recipes = { foc: recipe({ lossPct: 12 }), bri: recipe({ id: 'bri', lossPct: 12 }) };
    const wrong = m.typeCooked(m.typeRaw(m.startWeighing(recipes.foc), '1000'), '1100');
    const right = m.typeCooked(m.typeRaw(m.startWeighing(recipes.bri), '1000'), '800');
    expect(m.weighingPatches(recipes, { foc: wrong }, ['foc'])).toStrictEqual({ foc: { rawGrams: 1000, cookedGrams: 1100 } });
    expect(m.weighingsChangeCost(recipes, { foc: wrong }, ['foc'])).toBe(false);
    expect(m.weighingsChangeCost(recipes, { foc: wrong, bri: right }, ['foc', 'bri']), 'one real change among them is enough').toBe(true);
    expect(m.weighingsChangeCost(recipes, { bri: right }, []), 'a recipe off the product counts for nothing').toBe(false);
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

  test('⚠️ a refused kept wrong pair puts back ONLY the two numbers it carried', () => {
    const prev = recipe({ lossPct: 12, rawGrams: 900, cookedGrams: 700 });
    const patch = { rawGrams: 1000, cookedGrams: 1100 };
    const restored = m.restoreAfterRefusal({ ...prev, ...patch }, prev, patch) as Record<string, unknown>;
    expect({ lossPct: restored['lossPct'], rawGrams: restored['rawGrams'], cookedGrams: restored['cookedGrams'] })
      .toStrictEqual({ lossPct: 12, rawGrams: 900, cookedGrams: 700 });
    // The loss moved on another phone meanwhile: that is not what the patch carried, so it must neither block the
    // rollback nor be rolled back.
    const moved = { ...prev, ...patch, lossPct: 25 };
    expect((m.restoreAfterRefusal(moved, prev, patch) as Record<string, unknown>)['lossPct']).toBe(25);
    const never = recipe({ lossPct: 12 });
    const back = m.restoreAfterRefusal({ ...never, ...patch }, never, patch) as Record<string, unknown>;
    expect('rawGrams' in back || 'cookedGrams' in back).toBe(false);
    expect(back['lossPct']).toBe(12);
    expect(m.restoreAfterRefusal({ ...prev }, prev, {}), 'an empty patch rolls back nothing').toBe(null);
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

  test('a finished product («no weight loss») is not among the products a loss changes', () => {
    const products = [
      { id: 'p1', components: [{ recipeId: 'foc', qtyKg: 1 }] },
      { id: 'p2', noWeightLoss: true, components: [{ recipeId: 'foc', qtyKg: 1 }] },
      { id: 'p3', noWeightLoss: 'true', components: [{ recipeId: 'foc', qtyKg: 1 }] },
    ];
    expect(m.otherProductsUsing(products, 'foc', 'p1'), 'only a literal true lays the loss aside').toBe(1);
  });

  // POST-SWITCH (10 Nov 2026, «il calo è del prodotto»): change G, so this runs for the port only. A product saved in the new
  // shape (model 3) owns its loss and costs the recipe's raw price, so a recipe's loss moves nothing of what it costs: it is
  // not counted. The current app's products (model 2, or none) are still read through the recipe's loss until their next Save.
  test.runIf(m === ported)('POST-SWITCH: only a product still below model 3 is among those a recipe’s loss changes', () => {
    const line = [{ recipeId: 'foc', qtyKg: 1 }];
    const products = [
      { id: 'new', model: 3, components: line },
      { id: 'old', model: 2, components: line },
      { id: 'none', components: line },
      { id: 'old-finished', model: 2, noWeightLoss: true, components: line },
    ];
    expect(m.otherProductsUsing(products, 'foc', null), 'model 2 and no model, not model 3, not a finished one').toBe(2);
    expect(m.otherProductsUsing(products, 'foc', 'old'), 'the product being edited is not "other"').toBe(1);
    expect(m.otherProductsUsing([products[0]], 'foc', null)).toBe(0);
  });
});
