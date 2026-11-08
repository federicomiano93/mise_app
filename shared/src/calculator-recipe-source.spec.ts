// Where a Calculator tab's ingredients come from — the old shape and the new one (P15 — the owner cannot
// read code), run against BOTH implementations: the TypeScript port in shared/ and
// js/calculator-recipe-source.js, which the live app uses today. Ported from
// tests/calculator-recipe-source.test.mjs (every test but the one that reads js/recipes.js — its Mise 2 twin is
// app/src/calculator/RecipeList's own spec) and the four pure tests of tests/calculator-source-problem-screen.test.mjs
// (8 Nov 2026, item 38 of docs/mise2-port-owed.md); the two must stay equal until the switch to Mise 2.
// calculator-recipe-source.ts is a FULL port, so parity.spec.ts pairs it.
//
// ⚠️⚠️ THE TESTS THAT MATTER MOST ARE THE REFUSALS. An empty ingredient list calculates perfectly happily and
// produces a dough of zero; that is the July defect — the data moved before the code could read it and the
// app was left with no weights for everybody — wearing a different hat. Every way a linked recipe can fail
// to be read must REFUSE, never bake with nothing.

import { describe, expect, test } from 'vitest';
import * as ported from './calculator-recipe-source';
import * as legacyJs from '../../js/calculator-recipe-source.js';
import { CATALOGUE_UNITS, isWeighableUnit } from './catalogue-model';

const legacy = legacyJs as unknown as typeof ported;

type Loose = any;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const {
    PROBLEMS, isWeighable, linkedRecipeIds, isLinked, resolveRecipe, canCalculate, leaveningLost, ingredientCount, showsSourceProblem,
    sheetRecipe,
  } = m as unknown as Record<string, Loose>;

  const OLD = {
    name: 'Focaccia',
    ingredients: [
      { key: 'flour', label: 'Flour', grams: 1000 },
      { key: 'yeast', label: 'Yeast', grams: 10 },
    ],
    leaveningKey: 'yeast',
  };

  const LINKED = { name: 'Focaccia', catalogueId: 'cat-1', leaveningRid: 'r-yeast' };

  const CATALOGUE = {
    'cat-1': {
      name: 'Focaccia',
      ingredients: [
        { rid: 'r-flour', label: 'Flour', grams: 1000, unit: 'g' },
        { rid: 'r-yeast', label: 'Yeast', grams: 10, unit: 'g' },
      ],
    },
  };

  // ── The shape today keeps working, untouched ─────────────────────────────────

  // ⚠️ THIS IS WHAT LETS THE CODE SHIP BEFORE ANY DATA MOVES. A tab nobody has
  // linked behaves exactly as it does now.
  test('a tab with its own ingredients is left exactly as it is', () => {
    const r = resolveRecipe(OLD, CATALOGUE);
    expect(r.linked).toBe(false);
    expect(r.problem).toBe(null);
    expect(r.ingredients).toStrictEqual(OLD.ingredients);
    expect(r.leaveningKey).toBe('yeast');
    expect(canCalculate(r)).toBe(true);
  });

  test('…even when the Catalogue is not loaded at all', () => {
    const r = resolveRecipe(OLD, {});
    expect(canCalculate(r)).toBe(true);
    expect(r.ingredients.length).toBe(2);
  });

  // ── The linked shape ─────────────────────────────────────────────────────────

  test('a linked tab takes its name and rows from the Catalogue', () => {
    const r = resolveRecipe(LINKED, CATALOGUE);
    expect(r.linked).toBe(true);
    expect(r.name).toBe('Focaccia');
    expect(r.ingredients.map((i: Loose) => i.label)).toStrictEqual(['Flour', 'Yeast']);
    expect(r.ingredients.map((i: Loose) => i.grams)).toStrictEqual([1000, 10]);
    expect(canCalculate(r)).toBe(true);
  });

  // ⚠️ BY THE ROW'S OWN id, NEVER ITS NAME. Not hypothetical: the real Sourdough
  // calls its leavening "Starter" in the Calculator and "Sourdough starter" in the
  // Catalogue TODAY, so a name match would have switched the knob off on day one.
  test('the leavening is found by the row id, so a rename cannot silence it', () => {
    const renamed = {
      'cat-1': {
        name: 'Focaccia',
        ingredients: [
          { rid: 'r-flour', label: 'Flour', grams: 1000, unit: 'g' },
          { rid: 'r-yeast', label: 'Fresh yeast, changed name', grams: 10, unit: 'g' },
        ],
      },
    };
    const r = resolveRecipe(LINKED, renamed);
    expect(r.leaveningKey).toBe('r-yeast');
    expect(leaveningLost(LINKED, r)).toBe(false);
  });

  // ⚠️ AND WHEN THE ROW REALLY IS GONE, THE SCREEN IS TOLD. The dough still
  // calculates — every other ingredient is there — but the knob must not go on
  // being shown while it scales nothing.
  test('a leavening row that no longer exists is reported, not ignored', () => {
    const gone = {
      'cat-1': { name: 'Focaccia', ingredients: [{ rid: 'r-flour', label: 'Flour', grams: 1000, unit: 'g' }] },
    };
    const r = resolveRecipe(LINKED, gone);
    expect(r.leaveningKey).toBe(null);
    expect(canCalculate(r), 'the rest of the dough is still fine').toBe(true);
    expect(leaveningLost(LINKED, r)).toBe(true);
  });

  // ── ⚠️ THE REFUSALS ──────────────────────────────────────────────────────────

  test('⚠️ a linked recipe that cannot be read REFUSES rather than baking nothing', () => {
    const r = resolveRecipe(LINKED, {});
    expect(r.problem).toBe(PROBLEMS.missing);
    expect(r.ingredients).toStrictEqual([]);
    expect(canCalculate(r)).toBe(false);
  });

  // ⚠️ NOT A FALLBACK TO THE OLD COPY. A stale copy is exactly what this change
  // removes; using one here would mean the app quietly bakes last month's recipe
  // whenever the network hiccups.
  test('…and does NOT fall back to the tab’s own leftover ingredients', () => {
    const both = { ...OLD, catalogueId: 'cat-1', leaveningRid: 'r-yeast' };
    const r = resolveRecipe(both, {});
    expect(r.problem).toBe(PROBLEMS.missing);
    expect(r.ingredients, 'the leftover copy must not be used').toStrictEqual([]);
  });

  test('an empty Catalogue recipe refuses too', () => {
    const r = resolveRecipe(LINKED, { 'cat-1': { name: 'Focaccia', ingredients: [] } });
    expect(r.problem).toBe(PROBLEMS.empty);
    expect(canCalculate(r)).toBe(false);
  });

  // ⚠️ A ROW MEASURED IN PIECES OR "TO TASTE" BLOCKS THE WHOLE RECIPE AND IS NAMED.
  // Skipping it would produce a dough quietly light by exactly that ingredient —
  // the one direction a recipe must not be wrong in.
  test('⚠️ an unweighable row blocks the recipe AND is named', () => {
    const withPinch = {
      'cat-1': {
        name: 'Almond cream',
        ingredients: [
          { rid: 'r1', label: 'Flour', grams: 1000, unit: 'g' },
          { rid: 'r2', label: 'Vanilla', grams: 0, unit: '' },
        ],
      },
    };
    const r = resolveRecipe(LINKED, withPinch);
    expect(r.problem).toBe(PROBLEMS.unweighable);
    expect(r.problemRow).toBe('Vanilla');
    expect(canCalculate(r)).toBe(false);
  });

  test('what counts as weighable', () => {
    expect(isWeighable({ grams: 100, unit: 'g' })).toBe(true);
    expect(isWeighable({ grams: 1.5, unit: 'kg' })).toBe(true);
    expect(isWeighable({ grams: 100 }), 'no unit means grams').toBe(true);
    expect(isWeighable({ grams: 0, unit: 'g' })).toBe(false);
    expect(isWeighable({ grams: 2, unit: 'pcs' })).toBe(false);
    expect(isWeighable({ grams: 1, unit: 'pinch' })).toBe(false);
    expect(isWeighable(null)).toBe(false);
  });

  // ⚠️⚠️ THE CATALOGUE STORES THE NUMBER AS TYPED, IN ITS OWN UNIT. «Flour 1 kg» is { grams: 1, unit: 'kg' }. Copied raw
  // it read as 1 g, and a 1720 g dough of Flour 1 kg / Water 700 g / Salt 20 g came out 2 g of flour and ~1670 g of water.
  test('⚠️ a kg row reaches the Calculator in grams', () => {
    const kg = {
      'cat-1': {
        name: 'Bread',
        ingredients: [
          { rid: 'r-flour', label: 'Flour', grams: 1, unit: 'kg' },
          { rid: 'r-water', label: 'Water', grams: 700, unit: 'g' },
          { rid: 'r-salt', label: 'Salt', grams: 20, unit: 'g' },
        ],
      },
    };
    const r = resolveRecipe({ catalogueId: 'cat-1' }, kg);
    expect(canCalculate(r)).toBe(true);
    expect(r.ingredients.map((i: Loose) => i.grams)).toStrictEqual([1000, 700, 20]);
  });

  test('kg is read loosely, and a fractional kg has no float tail', () => {
    const rows = [
      { rid: 'a', label: 'A', grams: 1.5, unit: 'kg' },
      { rid: 'b', label: 'B', grams: 1.005, unit: ' KG ' },
      { rid: 'c', label: 'C', grams: 250, unit: 'gr' },
      { rid: 'd', label: 'D', grams: 30 },
      { rid: 'e', label: 'E', grams: '0.4', unit: 'Kg' },
    ];
    const r = resolveRecipe({ catalogueId: 'x' }, { x: { name: 'X', ingredients: rows } });
    expect(r.ingredients.map((i: Loose) => i.grams)).toStrictEqual([1500, 1005, 250, 30, 400]);
  });

  // Not in the original tests (it was the Mise 2-only block before the current app made the same fix).
  test('the saved dough (sheetRecipe) is built from the same grams', () => {
    const tab = { id: 't', name: 'Pane', catalogueId: 'cat-1', ingredients: [{ key: 'old', label: 'Old', grams: 5 }] };
    const mixed = { 'cat-1': { name: 'Pane', ingredients: [
      { rid: 'r1', label: 'Flour', grams: 1, unit: 'kg' },
      { rid: 'r2', label: 'Salt', grams: 20, unit: 'g' },
      { rid: 'r3', label: 'Water', grams: 0.5, unit: 'kg' },
    ] } };
    const sheet = sheetRecipe(tab, resolveRecipe(tab, mixed));
    expect(sheet.ingredients.map((i: Loose) => i.grams)).toStrictEqual([1000, 20, 500]);
  });

  // ⚠️⚠️ A VOLUME ROW IS WEIGHED AS THE RECIPE BOOK WEIGHS IT, 1 ml = 1 g. It used to refuse the whole tab — «“Acqua” non
  // ha un peso» — while the recipe book counted the same litres in its total and its Food cost. An Italian bakery writes
  // its water in litres, so every linked recipe calculated nothing (Panificio Miano, 30 Oct 2026).
  test('⚠️ litre, dl, cl and ml rows reach the Calculator in grams, 1 ml = 1 g', () => {
    const rows = [
      { rid: 'a', label: 'Farina 0', grams: 1, unit: 'kg' },
      { rid: 'b', label: 'Acqua', grams: 0.65, unit: 'l' },
      { rid: 'c', label: 'Latte', grams: 2, unit: 'dl' },
      { rid: 'd', label: 'Olio', grams: 3, unit: 'cl' },
      { rid: 'e', label: 'Malto', grams: 15, unit: 'ml' },
      { rid: 'f', label: 'Acqua tiepida', grams: '0.1', unit: 'L' },
    ];
    const r = resolveRecipe({ catalogueId: 'x' }, { x: { name: 'Pane', ingredients: rows } });
    expect(r.problem).toBe(null);
    expect(canCalculate(r)).toBe(true);
    expect(r.ingredients.map((i: Loose) => i.grams)).toStrictEqual([1000, 650, 200, 30, 15, 100]);
  });

  test('pieces, spoons, a pinch and «to taste» still refuse the whole tab and name the row', () => {
    for (const unit of ['pcs', 'tsp', 'tbsp', 'pinch', 'to taste']) {
      const r = resolveRecipe({ catalogueId: 'x' }, { x: { name: 'X', ingredients: [
        { rid: 'a', label: 'Farina', grams: 1, unit: 'kg' },
        { rid: 'b', label: 'Uova', grams: 4, unit },
      ] } });
      expect(r.problem, unit).toBe(PROBLEMS.unweighable);
      expect(r.problemRow, unit).toBe('Uova');
    }
  });

  // ⚠️ ONE ANSWER TO «CAN THIS ROW BE WEIGHED?». The Calculator and the recipe book disagreed on litres for months; this
  // pins every unit the recipe book can save.
  test('the Calculator weighs exactly the units the recipe book weighs', () => {
    for (const unit of CATALOGUE_UNITS) {
      expect(isWeighable({ grams: 5, unit }), unit).toBe(isWeighableUnit(unit));
    }
  });

  // ── ⚠️ THE COST TRAP ─────────────────────────────────────────────────────────

  // The Catalogue is built for 500+ recipes and the Calculator needs three. A
  // listener on the collection would turn every app open from 3 reads into 500+ —
  // the same mistake made and corrected on the Home's order badge (v207).
  test('⚠️ only the LINKED recipes are ever asked for', () => {
    const recipes = [
      { catalogueId: 'a' }, { catalogueId: 'b' }, { catalogueId: 'a' },
      { name: 'not linked' }, { catalogueId: '  ' },
    ];
    expect(linkedRecipeIds(recipes).sort()).toStrictEqual(['a', 'b']);
    expect(linkedRecipeIds([])).toStrictEqual([]);
    expect(linkedRecipeIds(null)).toStrictEqual([]);
  });

  test('isLinked ignores whitespace and junk', () => {
    expect(isLinked({ catalogueId: 'x' })).toBe(true);
    expect(isLinked({ catalogueId: '   ' })).toBe(false);
    expect(isLinked({})).toBe(false);
    expect(isLinked(null)).toBe(false);
  });

  test('nothing at all is refused rather than throwing', () => {
    const r = resolveRecipe(null, {});
    expect(canCalculate(r)).toBe(false);
    expect(r.ingredients).toStrictEqual([]);
  });

  // ── How many ingredients the Recipes list says a recipe has ─────────────────────
  // Found on the lab tablet, 31 Oct 2026: a recipe linked to the recipe book said «0 ingredienti» in Calculator → Settings →
  // Recipes, because the list counted the tab's own (empty) ingredients instead of the linked recipe's rows.

  test('a recipe of its own counts its own rows', () => {
    expect(ingredientCount(OLD, resolveRecipe(OLD, {}))).toBe(2);
    expect(ingredientCount({ name: 'New' }, resolveRecipe({ name: 'New' }, {}))).toBe(0);
  });

  test('a linked recipe counts the linked recipe’s rows, not the tab’s empty copy', () => {
    const tab = { name: 'Pane', catalogueId: 'CAT_1', ingredients: [] };
    const source = { id: 'CAT_1', name: 'Pane', ingredients: [
      { label: 'Farina', grams: 1000, unit: 'g' },
      { label: 'Acqua', grams: 700, unit: 'g' },
      { label: 'Sale', grams: 20, unit: 'g' },
    ] };
    expect(ingredientCount(tab, resolveRecipe(tab, { CAT_1: source }))).toBe(3);
  });

  test('a linked recipe not read yet gives no number rather than a wrong «0»', () => {
    const tab = { name: 'Pane', catalogueId: 'CAT_1', ingredients: [] };
    expect(ingredientCount(tab, resolveRecipe(tab, {}))).toBe(null);
  });

  test('a linked recipe with a row that cannot be weighed still counts its rows; a really empty one says 0', () => {
    const tab = { name: 'Pane', catalogueId: 'CAT_1' };
    const pinch = { id: 'CAT_1', ingredients: [{ label: 'Farina', grams: 1000, unit: 'g' }, { label: 'Sale', grams: 1, unit: 'pinch' }, { label: '' }] };
    const resolved = resolveRecipe(tab, { CAT_1: pinch });
    expect(resolved.problem).toBe(PROBLEMS.unweighable);
    expect(resolved.ingredients, 'still refuses to calculate').toStrictEqual([]);
    expect(ingredientCount(tab, resolved)).toBe(2);
    expect(ingredientCount(tab, resolveRecipe(tab, { CAT_1: { id: 'CAT_1', ingredients: [] } }))).toBe(0);
  });

  // ── A linked tab that cannot be calculated says WHY, on the tab itself ──────────
  // (tests/calculator-source-problem-screen.test.mjs.) calc.js refused a linked tab whose recipe could not be weighed —
  // correctly — but said nothing; the reason came out only after Confirm and a day, in a dialog.

  const PANEL_TAB = { id: 'r1', name: 'Focaccia', logic: 'total', catalogueId: 'cat-1' };
  const book = (rows: unknown[]) => ({ 'cat-1': { name: 'Focaccia', ingredients: rows } });
  const FLOUR = { rid: 'a', label: 'Farina', grams: 1000, unit: 'g' };

  test('a linked tab whose recipe cannot be weighed shows its problem', () => {
    const resolved = resolveRecipe(PANEL_TAB, book([FLOUR, { rid: 'b', label: 'Olio', unit: 'to taste' }]));
    expect(resolved.problem).toBe(PROBLEMS.unweighable);
    expect(showsSourceProblem(PANEL_TAB, resolved, false)).toBe(true);
  });

  test('an empty or deleted recipe-book recipe shows its problem too', () => {
    expect(showsSourceProblem(PANEL_TAB, resolveRecipe(PANEL_TAB, book([])), false)).toBe(true);
    expect(showsSourceProblem(PANEL_TAB, resolveRecipe(PANEL_TAB, {}), false)).toBe(true);
  });

  test('a recipe still on its way says nothing yet (not «it is gone»)', () => {
    expect(showsSourceProblem(PANEL_TAB, resolveRecipe(PANEL_TAB, {}), true)).toBe(false);
  });

  test('a tab that calculates, or one with its own ingredients, shows nothing', () => {
    expect(showsSourceProblem(PANEL_TAB, resolveRecipe(PANEL_TAB, book([FLOUR])), false)).toBe(false);
    const own = { id: 'r2', name: 'Pane', logic: 'total', ingredients: [] };
    expect(showsSourceProblem(own, resolveRecipe(own, {}), false)).toBe(false);
    expect(showsSourceProblem(null, null, false)).toBe(false);
  });
});
