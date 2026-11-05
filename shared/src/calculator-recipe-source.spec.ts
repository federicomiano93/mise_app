// Where a Calculator tab's ingredients come from — the old shape and the new one (P15 — the owner cannot
// read code), run against BOTH implementations: the TypeScript port in shared/ and
// js/calculator-recipe-source.js, which the live app uses today. Ported from
// tests/calculator-recipe-source.test.mjs (all 13 of its tests); the two must stay equal until the switch to
// Mise 2. calculator-recipe-source.ts is a FULL port, so parity.spec.ts pairs it.
//
// ⚠️⚠️ THE TESTS THAT MATTER MOST ARE THE REFUSALS. An empty ingredient list calculates perfectly happily and
// produces a dough of zero; that is the July defect — the data moved before the code could read it and the
// app was left with no weights for everybody — wearing a different hat. Every way a linked recipe can fail
// to be read must REFUSE, never bake with nothing.

import { describe, expect, test } from 'vitest';
import * as ported from './calculator-recipe-source';
import * as legacyJs from '../../js/calculator-recipe-source.js';

const legacy = legacyJs as unknown as typeof ported;

type Loose = any;

// ── A row in kilos (Mise 2 only: the live app reads «1 kg» as 1 g until its own fix lands) ───────────────────────────────

describe('a linked row in kilos is worth its grams (Mise 2 only)', () => {
  const MIXED = {
    'cat-1': { name: 'Pane', ingredients: [
      { rid: 'r1', label: 'Flour', grams: 1, unit: 'kg' },
      { rid: 'r2', label: 'Salt', grams: 20, unit: 'g' },
      { rid: 'r3', label: 'Water', grams: 0.5, unit: 'kg' },
    ] },
  };
  const TAB = { id: 't', name: 'Pane', catalogueId: 'cat-1', ingredients: [{ key: 'old', label: 'Old', grams: 5 }] };

  test('1 kg is 1000, 20 g stays 20, 0.5 kg is 500', () => {
    const r = ported.resolveRecipe(TAB, MIXED);
    expect(r.problem).toBe(null);
    expect(r.ingredients.map(i => [i.label, i.grams])).toStrictEqual([['Flour', 1000], ['Salt', 20], ['Water', 500]]);
  });

  test('the saved dough (sheetRecipe) is built from the same grams', () => {
    const sheet = ported.sheetRecipe(TAB, ported.resolveRecipe(TAB, MIXED));
    expect(sheet.ingredients.map(i => i.grams)).toStrictEqual([1000, 20, 500]);
  });

  test('a row in grams is exactly as the original reads it', () => {
    const grams = { 'cat-1': { name: 'P', ingredients: [{ rid: 'r1', label: 'Flour', grams: 995, unit: 'g' }, { rid: 'r2', label: 'Y', grams: 5 }] } };
    expect(ported.resolveRecipe(TAB, grams)).toStrictEqual(legacy.resolveRecipe(TAB, grams));
  });
});

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const { PROBLEMS, isWeighable, linkedRecipeIds, isLinked, resolveRecipe, canCalculate, leaveningLost } = m as unknown as Record<string, Loose>;

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
});
