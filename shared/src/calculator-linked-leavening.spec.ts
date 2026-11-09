// The leavening of a Calculator tab LINKED to a Catalogue recipe (P15 — the owner cannot read code), run
// against BOTH implementations: the TypeScript ports in shared/ and the js/ files the live app uses today.
// Ported from tests/calculator-linked-leavening.test.mjs (the current app's fix, PR #376, live v1.125.11).
//
// ⚠️ THE DEFECT (found 18 Oct 2026, driving a linked tab on the emulator): the knob, the box and the derived
// baseline read the tab's own leftover `leaveningKey`, so a tab linked after it had a leavening showed a knob
// that moved the % and changed no gram, and a tab linked fresh showed no knob at all. A pick on a linked tab
// also kept the baseline of the tab's OLD own recipe, silently changing the Catalogue's yeast.

import { describe, expect, test } from 'vitest';
import * as portedSource from './calculator-recipe-source';
import * as portedConfig from './calculator-config';
import * as portedMath from './calculator-dough-math';
import * as legacySourceJs from '../../js/calculator-recipe-source.js';
import * as legacyConfigJs from '../../js/calculator-config.js';
import * as legacyMathJs from '../../js/calculator-dough-math.js';

type Loose = any;

const CATALOGUE = {
  'cat-1': {
    name: 'Focaccia',
    ingredients: [
      { rid: 'r-flour', label: 'Flour', grams: 1000, unit: 'g' },
      { rid: 'r-water', label: 'Water', grams: 700, unit: 'g' },
      { rid: 'r-yeast', label: 'Fresh yeast', grams: 10, unit: 'g' },
    ],
  },
};

// A tab linked after it had its own leavening — the shape left behind by linking.
const legacyTab = (): Loose => ({
  id: 'r1', name: 'Focaccia', logic: 'both', catalogueId: 'cat-1', leaveningRid: null,
  ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }, { key: 'yeast', label: 'Yeast', grams: 10 }],
  leaveningKey: 'yeast', leaveningDefaultPct: 1, baselinePct: 1, showLeavening: true,
});
// A tab linked with nothing of its own.
const freshTab = (): Loose => ({
  id: 'r2', name: 'Focaccia', logic: 'both', catalogueId: 'cat-1', leaveningRid: null,
  ingredients: [], leaveningKey: null, leaveningDefaultPct: 0, baselinePct: null, showLeavening: true,
});

describe.each([
  ['shared/ (TypeScript)', portedSource, portedConfig, portedMath],
  ['js/ (current app)', legacySourceJs, legacyConfigJs, legacyMathJs],
] as const)('%s', (_name, source, config, math) => {
  const { chooseLeavening, leaveningLost, resolveRecipe, sheetRecipe } = source as unknown as Record<string, Loose>;
  const { tabLeaveningId, showsLeaveningKnob, normalizeConfig, recipeSpec } = config as unknown as Record<string, Loose>;
  const { scaleRecipe } = math as unknown as Record<string, Loose>;
  const rowsOf = (tab: Loose) => resolveRecipe(tab, CATALOGUE).ingredients;

  test('tabLeaveningId: a linked tab answers with its Catalogue row, never its leftover key', () => {
    expect(tabLeaveningId(legacyTab())).toBe(null);
    expect(tabLeaveningId({ ...legacyTab(), leaveningRid: 'r-yeast' })).toBe('r-yeast');
    expect(tabLeaveningId({ ...legacyTab(), leaveningRid: '  ' })).toBe(null);
    expect(tabLeaveningId({ leaveningKey: 'yeast' })).toBe('yeast');
    expect(tabLeaveningId({ leaveningKey: 'yeast', leaveningRid: 'r-yeast' }), 'an own tab ignores leaveningRid').toBe('yeast');
    expect(tabLeaveningId(null)).toBe(null);
  });

  test('chooseLeavening on a linked tab saves the Catalogue row id it was offered', () => {
    for (const tab of [legacyTab(), freshTab()]) {
      expect(chooseLeavening(tab, 'r-yeast', rowsOf(tab))).toBe(true);
      expect(tab.leaveningRid).toBe('r-yeast');
    }
  });

  test('chooseLeavening on a fresh linked tab starts the % and the baseline at 1', () => {
    const tab = freshTab();
    chooseLeavening(tab, 'r-yeast', rowsOf(tab));
    expect(tab.leaveningDefaultPct).toBe(1);
    expect(tab.baselinePct).toBe(1);
  });

  test('chooseLeavening on a linked tab keeps its starting % and restarts the baseline there', () => {
    const tab = { ...legacyTab(), leaveningDefaultPct: 0.8, baselinePct: 0.65 };
    chooseLeavening(tab, 'r-yeast', rowsOf(tab));
    expect(tab.leaveningDefaultPct).toBe(0.8);
    expect(tab.baselinePct).toBe(0.8);
    const atStart = scaleRecipe(recipeSpec(sheetRecipe(tab, resolveRecipe(tab, CATALOGUE))), 1710, 0.8);
    expect(atStart, 'at the starting % the Catalogue grams come out as written').toStrictEqual([1000, 700, 10]);
  });

  test('chooseLeavening on an own tab keeps a % and a baseline that are already there', () => {
    const own: Loose = { leaveningDefaultPct: 2.5, baselinePct: 3, ingredients: [{ key: 'yeast', label: 'Yeast', grams: 10 }] };
    chooseLeavening(own, 'yeast', null);
    expect(own.leaveningDefaultPct).toBe(2.5);
    expect(own.baselinePct).toBe(3);
  });

  test('chooseLeavening on a linked tab refuses a row the Catalogue does not have', () => {
    const tab = legacyTab();
    expect(chooseLeavening(tab, 'yeast', rowsOf(tab)), 'the leftover own key is not a Catalogue row').toBe(false);
    expect(tab.leaveningRid).toBe(null);
  });

  test('chooseLeavening «nothing rises» clears the side the tab reads', () => {
    const linked = { ...legacyTab(), leaveningRid: 'r-yeast' };
    chooseLeavening(linked, '', rowsOf(linked));
    expect(linked.leaveningRid).toBe(null);
    const own: Loose = { leaveningKey: 'yeast', ingredients: [{ key: 'yeast', label: 'Yeast', grams: 10 }] };
    chooseLeavening(own, '', null);
    expect(own.leaveningKey).toBe(null);
  });

  test('chooseLeavening on an own tab still works by key and mints a key for a keyless row', () => {
    const own: Loose = { ingredients: [{ key: 'flour', label: 'Flour', grams: 1000 }, { key: '', label: 'Lievito Madre', grams: 200 }] };
    expect(chooseLeavening(own, 'flour', null)).toBe(true);
    expect(own.leaveningKey).toBe('flour');
    expect(chooseLeavening(own, '#1', null)).toBe(true);
    expect(own.leaveningKey).toBe('lievito-madre-1');
    expect(own.ingredients[1].key).toBe('lievito-madre-1');
    expect(chooseLeavening(own, 'nope', null)).toBe(false);
  });

  test('showsLeaveningKnob: a linked tab shows the knob for its Catalogue row, not for its leftover key', () => {
    expect(showsLeaveningKnob(legacyTab()), 'a knob here moved the % and scaled nothing').toBe(false);
    expect(showsLeaveningKnob({ ...legacyTab(), leaveningRid: 'r-yeast' })).toBe(true);
    expect(showsLeaveningKnob({ ...freshTab(), leaveningRid: 'r-yeast' })).toBe(true);
    expect(showsLeaveningKnob({ ...freshTab(), leaveningRid: 'r-yeast', showLeavening: false })).toBe(false);
    expect(showsLeaveningKnob({ ...freshTab(), leaveningRid: 'r-yeast', logic: 'total' })).toBe(false);
    expect(showsLeaveningKnob({ logic: 'orders', leaveningKey: 'yeast', showLeavening: true }), 'own tabs unchanged').toBe(true);
  });

  test('normalizeRecipe derives the baseline from the default % when a linked tab has a leavening row', () => {
    const [withRid, withoutRid] = normalizeConfig({ clients: [], recipes: [
      { ...freshTab(), leaveningRid: 'r-yeast', leaveningDefaultPct: 2 },
      { ...legacyTab(), id: 'r3', baselinePct: null, leaveningDefaultPct: 2 },
    ] }).recipes;
    expect(withRid.baselinePct).toBe(2);
    expect(withoutRid.baselinePct, 'the leftover own key gives a linked tab no baseline').toBe(null);
  });

  test('a fresh linked tab, after the pick, scales the yeast with the knob', () => {
    const tab = freshTab();
    chooseLeavening(tab, 'r-yeast', rowsOf(tab));
    const saved = normalizeConfig({ clients: [], recipes: [tab] }).recipes[0];
    expect(showsLeaveningKnob(saved)).toBe(true);
    const grams = (pct: number) => scaleRecipe(recipeSpec(sheetRecipe(saved, resolveRecipe(saved, CATALOGUE))), 1710, pct);
    expect(grams(2)[2]).toBeGreaterThan(grams(1)[2]);
    expect(Math.round(grams(2).reduce((a: number, b: number) => a + b, 0))).toBe(1710);
  });

  test('a linked leavening row deleted from the Catalogue is «lost»: the knob would scale nothing', () => {
    const tab = { ...freshTab(), leaveningRid: 'r-yeast', leaveningDefaultPct: 1, baselinePct: 1 };
    const gone = { 'cat-1': { ...CATALOGUE['cat-1'], ingredients: CATALOGUE['cat-1'].ingredients.slice(0, 2) } };
    const resolved = resolveRecipe(tab, gone);
    expect(showsLeaveningKnob(tab), 'the tab alone cannot tell — only the resolved recipe can').toBe(true);
    expect(leaveningLost(tab, resolved)).toBe(true);
    const grams = (pct: number) => scaleRecipe(recipeSpec(sheetRecipe(tab, resolved)), 1700, pct);
    expect(grams(2), 'pro-rata: the % changes no gram, so no knob may be drawn').toStrictEqual(grams(1));
    expect(leaveningLost(tab, resolveRecipe(tab, CATALOGUE))).toBe(false);
    expect(leaveningLost(tab, resolveRecipe(tab, {})), 'still loading is not lost (the tab refuses instead)').toBe(false);
  });
});
