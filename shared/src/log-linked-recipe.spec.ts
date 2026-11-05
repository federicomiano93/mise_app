// A linked tab must SAVE the dough its screen shows (P15 — the owner cannot read code), run against BOTH
// implementations: the TypeScript ports in shared/ and the js/ files the live app uses today. Ported from
// tests/log-linked-recipe.test.mjs (all 5 of its tests); the two must stay equal until the switch to Mise 2.
//
// The tab's own ingredients are only a leftover copy once it is linked; saving from them stored old (or zero)
// grams after the Catalogue recipe was corrected.

import { describe, expect, test } from 'vitest';
import * as portedSource from './calculator-recipe-source';
import * as portedLog from './log-model';
import * as portedConfig from './calculator-config';
import * as portedMath from './calculator-dough-math';
import * as legacySourceJs from '../../js/calculator-recipe-source.js';
import * as legacyLogJs from '../../js/log-model.js';
import * as legacyConfigJs from '../../js/calculator-config.js';
import * as legacyMathJs from '../../js/calculator-dough-math.js';

type Loose = any;

describe.each([
  ['shared/ (TypeScript)', { source: portedSource, log: portedLog, config: portedConfig, math: portedMath }],
  ['js/ (current app)', {
    source: legacySourceJs as unknown as typeof portedSource,
    log: legacyLogJs as unknown as typeof portedLog,
    config: legacyConfigJs as unknown as typeof portedConfig,
    math: legacyMathJs as unknown as typeof portedMath,
  }],
] as const)('%s', (_name, w) => {
  const { resolveRecipe, sheetRecipe, canCalculate } = w.source as unknown as Record<string, Loose>;
  const { buildSheet, recipeSnapshot } = w.log as unknown as Record<string, Loose>;
  const { recipeSpec } = w.config as unknown as Record<string, Loose>;
  const { scaleRecipe } = w.math as unknown as Record<string, Loose>;

  const catalogue: Loose = {
    'cat-1': {
      name: 'Focaccia',
      ingredients: [
        { rid: 'r-flour', label: 'Flour', grams: 650, unit: 'g' },
        { rid: 'r-water', label: 'Water', grams: 400, unit: 'g' },
        { rid: 'r-yeast', label: 'Yeast', grams: 10, unit: 'g' },
      ],
    },
  };
  const STALE = [{ key: 'flour', label: 'Flour', grams: 600 }, { key: 'water', label: 'Water', grams: 400 }];
  const tab: Loose = {
    id: 'foc', name: 'Focaccia', logic: 'total', catalogueId: 'cat-1', leaveningRid: 'r-yeast',
    ingredients: STALE, leaveningDefaultPct: 1, baselinePct: 1,
  };

  test('a linked tab saves the Catalogue grams, equal to what the screen scales', () => {
    const resolved = resolveRecipe(tab, catalogue);
    const sheet = buildSheet({ recipe: sheetRecipe(tab, resolved), items: [], totalInput: 2000, leaveningPct: 1 });
    const spec = recipeSpec(resolved);
    spec.leaveningKey = null; // logic 'total', as calc.js does
    const screen = scaleRecipe(spec, 2000, 1).map(Math.round);
    expect(sheet.ingredients.map((i: Loose) => i.grams)).toStrictEqual(screen);
    expect(sheet.ingredients.map((i: Loose) => i.name)).toStrictEqual(['Flour', 'Water', 'Yeast']);
    expect(sheet.ingredients[0].grams > 0).toBeTruthy();
  });

  test('the snapshot freezes the Catalogue ingredients, not the leftover copy', () => {
    const snap = recipeSnapshot(sheetRecipe(tab, resolveRecipe(tab, catalogue)));
    expect(snap.ingredients.map((i: Loose) => i.grams)).toStrictEqual([650, 400, 10]);
    expect(snap.leaveningKey).toBe('r-yeast');
    expect(snap.name).toBe('Focaccia');
    expect(snap.id).toBe('foc');
  });

  test('a leftover copy that is empty no longer gives a sheet of zeros', () => {
    const empty = { ...tab, ingredients: [] };
    const sheet = buildSheet({ recipe: sheetRecipe(empty, resolveRecipe(empty, catalogue)), items: [], totalInput: 2000, leaveningPct: 1 });
    expect(sheet.ingredients.length).toBe(3);
    expect(sheet.ingredients.every((i: Loose) => i.grams > 0)).toBeTruthy();
  });

  test('an unlinked tab is returned untouched', () => {
    const own = { id: 'x', name: 'X', ingredients: STALE, leaveningKey: 'water' };
    expect(sheetRecipe(own, resolveRecipe(own, {}))).toBe(own);
  });

  test('an unresolved link cannot be calculated, so the save is refused', () => {
    expect(canCalculate(resolveRecipe(tab, {}))).toBe(false);
  });
});
