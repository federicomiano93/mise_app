// Rolling allergens up from ingredients to a recipe — run against BOTH implementations: the TypeScript
// port in shared/ and js/catalogue/recipe-allergen-model.js, which the live app uses today. Ported from
// tests/recipe-allergen-model.test.mjs; the two must stay equal until the switch to Mise 2.
//
// ⚠️ THE RULE EVERY TEST HERE ORBITS: a gap anywhere makes the whole recipe
// incomplete, and an incomplete recipe may not be turned into a label. The cost
// model answers the same gaps with an honest partial number; here a partial
// answer is the dangerous one, because the row nobody linked could be the one
// with the hazelnuts.
//
// recipe-allergen-model.ts is a PARTIAL port, so parity.spec.ts does not pair it:
//   * `incompleteText` is left out (it reads the dictionary). Its two tests are not ported as such: the
//     happy-path line `incompleteText(out) === ''` and 'the incomplete line counts the gaps and says a label
//     cannot be made'. What they pinned in the model is pinned here as `complete` and `gaps.length` (which the
//     app turns into `cat.nothingInThisRecipe` / `cat.alg.notDeclaredCount`); the sentence itself is the app
//     slice's to test against its typed messages.
//   * `blockingIngredients` takes the word for an ingredient with no name as a third argument. This file hands
//     the TypeScript one the English text of `cat.unknownIngredient` and the js/ one its two arguments.
// The last block stands in for what pairing would have checked: the same names, constants, frozen-ness and
// function shapes, for everything the port does export.
//
// PORTED: all 37 tests of the original but those two (the 2 that name incompleteText), so 35, plus the
// added ones marked «Added».

import { describe, expect, test } from 'vitest';
import * as ported from './recipe-allergen-model';
import { MAX_RECIPE_DEPTH } from './recipe-cost-model';
import * as legacyJs from '../../js/catalogue/recipe-allergen-model.js';

const legacy = legacyJs as unknown as typeof ported;

// The English text of `cat.unknownIngredient` in js/i18n.js: what the original answers for a nameless one.
const UNKNOWN_INGREDIENT = 'Unknown ingredient';

type Obj = Record<string, any>;

const STAMP = '2026-08-11T09:00:00.000Z';

// Ingredients as Firestore holds them, keyed by id.
const ingredients = (): Obj => ({
  FLOUR: { id: 'FLOUR', name: 'Flour', allergens: ['gluten-wheat'], allergensCheckedAt: STAMP },
  BUTTER: { id: 'BUTTER', name: 'Butter', allergens: ['milk'], allergensCheckedAt: STAMP },
  WATER: { id: 'WATER', name: 'Water', allergens: [], allergensCheckedAt: STAMP },
  SUGAR: { id: 'SUGAR', name: 'Sugar', allergens: [], mayContain: ['nuts-hazelnut'], allergensCheckedAt: STAMP },
  MYSTERY: { id: 'MYSTERY', name: 'Mystery mix' },   // nobody has checked it
});

const row = (label: string, refId: string, grams = 100, kind = 'ingredient'): Obj =>
  ({ label, grams, unit: 'g', kind, refId });

const recipe = (id: string, rows: unknown[], extra: Obj = {}): Obj => ({ id, name: id, ingredients: rows, ...extra });

describe.each([
  ['shared/ (TypeScript)', ported, (r: unknown, t: Obj) => ported.blockingIngredients(r, t, UNKNOWN_INGREDIENT)],
  ['js/ (current app)', legacy, (r: unknown, t: Obj) => (legacy.blockingIngredients as (r: unknown, t: Obj) => unknown)(r, t)],
] as const)('%s', (_name, m, blocking) => {
  const blockingList = (r: unknown, t: Obj) => blocking(r, t) as { id: string; name: string; blocks: number }[];

  // ── The happy case ─────────────────────────────────────────────────────────

  test('a fully linked, fully declared recipe is complete and gathers its allergens', () => {
    const r = recipe('R1', [row('Flour', 'FLOUR', 1000), row('Butter', 'BUTTER', 500), row('Water', 'WATER', 600)]);
    const out = m.recipeAllergens(r, { ingredients: ingredients() });
    expect(out.allergens).toStrictEqual(['gluten-wheat', 'milk']);
    expect(out.complete).toBe(true);
    expect(m.canLabel(out)).toBe(true);
    expect(out.gaps).toStrictEqual([]);
  });

  test('an ingredient checked as containing none contributes nothing but does not block', () => {
    // Water is the case: really 0 allergens, and it must not make a recipe unlabelable.
    const out = m.recipeAllergens(recipe('R1', [row('Water', 'WATER')]), { ingredients: ingredients() });
    expect(out.allergens).toStrictEqual([]);
    expect(out.complete, 'a checked "contains none" must not block').toBe(true);
    expect(m.canLabel(out)).toBe(true);
  });

  // ── THE ONES THAT MATTER ───────────────────────────────────────────────────

  test('AN UNDECLARED INGREDIENT MAKES THE WHOLE RECIPE UNLABELABLE', () => {
    // Mystery mix has never been checked. It might contain anything.
    const r = recipe('R1', [row('Flour', 'FLOUR'), row('Mystery', 'MYSTERY')]);
    const out = m.recipeAllergens(r, { ingredients: ingredients() });
    expect(out.complete).toBe(false);
    expect(m.canLabel(out)).toBe(false);
    expect(out.gaps.length).toBe(1);
    expect(out.gaps[0]?.label).toBe('Mystery');
    expect(out.gaps[0]?.reason).toBe('not-declared');
    // …and what IS known is still returned, for the working sheet.
    expect(out.allergens).toStrictEqual(['gluten-wheat']);
  });

  test('A ROW LINKED TO NOTHING MAKES THE WHOLE RECIPE UNLABELABLE', () => {
    // The commonest gap by far: recipes written before links existed.
    const r = recipe('R1', [row('Flour', 'FLOUR'), { label: 'Something', grams: 50, unit: 'g' }]);
    const out = m.recipeAllergens(r, { ingredients: ingredients() });
    expect(m.canLabel(out)).toBe(false);
    expect(out.gaps[0]?.reason).toBe('not-linked');
  });

  test('AN UNWEIGHABLE ROW IS NOT AN EXCUSE — a pinch of mustard is still mustard', () => {
    // ⚠️ THE SHARPEST DIFFERENCE FROM THE COST MODEL, which skips these because a
    // pinch costs nothing worth counting. An allergen declaration cannot skip them.
    const r = recipe('R1', [
      row('Flour', 'FLOUR'),
      { label: 'Mustard', unit: 'pinch' },
    ]);
    const out = m.recipeAllergens(r, { ingredients: ingredients() });
    expect(m.canLabel(out), 'an unlinked pinch must still block').toBe(false);
    expect(out.gaps.length).toBe(1);
  });

  test('a row linked to an ingredient that has been deleted blocks, and says which', () => {
    const r = recipe('R1', [row('Gone', 'DELETED')]);
    const out = m.recipeAllergens(r, { ingredients: ingredients() });
    expect(m.canLabel(out)).toBe(false);
    expect(out.gaps[0]?.reason).toBe('missing-ingredient');
  });

  test('a recipe with NO ROWS AT ALL is not "contains none"', () => {
    // Saying "contains none of the 14" about an empty recipe is a statement nobody
    // made. It is unknown, not clean.
    const out = m.recipeAllergens(recipe('R1', []), { ingredients: ingredients() });
    expect(out.complete).toBe(false);
    expect(m.canLabel(out)).toBe(false);
  });

  test('a blank half-typed line is not counted as a gap', () => {
    // Somebody mid-edit must not make the recipe permanently unlabelable for a
    // reason nobody can act on — there is nothing to go and fix.
    const r = recipe('R1', [row('Flour', 'FLOUR'), { label: '   ', grams: 0 }]);
    const out = m.recipeAllergens(r, { ingredients: ingredients() });
    expect(m.canLabel(out)).toBe(true);
    expect(out.gaps).toStrictEqual([]);
  });

  // ── Through sub-recipes ────────────────────────────────────────────────────

  test('allergens travel up from a sub-recipe', () => {
    const filling = recipe('SUB', [row('Butter', 'BUTTER')]);
    const cake = recipe('R1', [row('Flour', 'FLOUR'), row('Filling', 'SUB', 200, 'recipe')]);
    const out = m.recipeAllergens(cake, { ingredients: ingredients(), recipes: { SUB: filling } });
    expect(out.allergens).toStrictEqual(['gluten-wheat', 'milk']);
    expect(m.canLabel(out)).toBe(true);
  });

  test('AN INCOMPLETE SUB-RECIPE POISONS THE WHOLE THING', () => {
    // ⚠️ Taking a sub-recipe's KNOWN allergens while ignoring its gaps is how doubt
    // disappears one level up and a half-known answer starts looking complete.
    const filling = recipe('SUB', [row('Butter', 'BUTTER'), row('Mystery', 'MYSTERY')]);
    const cake = recipe('R1', [row('Flour', 'FLOUR'), row('Filling', 'SUB', 200, 'recipe')]);
    const out = m.recipeAllergens(cake, { ingredients: ingredients(), recipes: { SUB: filling } });
    expect(m.canLabel(out)).toBe(false);
    expect(out.gaps[0]?.reason).toBe('sub-incomplete');
    // The milk from the sub-recipe must NOT have leaked up as if it were the answer.
    expect(out.allergens).toStrictEqual(['gluten-wheat']);
  });

  test('a recipe that contains itself is reported as a cycle, not a hung screen', () => {
    const self = recipe('R1', [row('Itself', 'R1', 100, 'recipe')]);
    const out = m.recipeAllergens(self, { ingredients: ingredients(), recipes: { R1: self } });
    expect(m.canLabel(out)).toBe(false);
    expect(out.gaps[0]?.reason).toBe('cycle');
  });

  test('two rows using the SAME sub-recipe are not mistaken for a cycle', () => {
    const filling = recipe('SUB', [row('Butter', 'BUTTER')]);
    const cake = recipe('R1', [row('A', 'SUB', 100, 'recipe'), row('B', 'SUB', 100, 'recipe')]);
    const out = m.recipeAllergens(cake, { ingredients: ingredients(), recipes: { SUB: filling } });
    expect(m.canLabel(out), 'a shared sub-recipe is legitimate, not a cycle').toBe(true);
    expect(out.allergens).toStrictEqual(['milk']);
  });

  test('nesting too deep ends in a message rather than a stack overflow', () => {
    const recipes: Obj = {};
    for (let i = 0; i <= MAX_RECIPE_DEPTH + 2; i += 1) {
      recipes['L' + i] = recipe('L' + i, [row('down', 'L' + (i + 1), 100, 'recipe')]);
    }
    const out = m.recipeAllergens(recipes['L0'], { ingredients: ingredients(), recipes });
    expect(m.canLabel(out)).toBe(false);
    expect(['too-deep', 'sub-incomplete']).toContain(out.gaps[0]?.reason);
  });

  // ── "May contain" ──────────────────────────────────────────────────────────

  test('"may contain" travels up but stays separate from "contains"', () => {
    const out = m.recipeAllergens(recipe('R1', [row('Sugar', 'SUGAR')]), { ingredients: ingredients() });
    expect(out.allergens).toStrictEqual([]);
    expect(out.mayContain).toStrictEqual(['nuts-hazelnut']);
    expect(m.canLabel(out)).toBe(true);
  });

  test('"may contain X" is dropped when the recipe already CONTAINS X', () => {
    // Butter puts milk in outright; another row saying "may contain traces of milk"
    // adds nothing but noise to a label with very little room.
    const ings = ingredients();
    ings['SUGAR'] = { id: 'SUGAR', allergens: [], mayContain: ['milk'], allergensCheckedAt: STAMP };
    const out = m.recipeAllergens(recipe('R1', [row('Butter', 'BUTTER'), row('Sugar', 'SUGAR')]), { ingredients: ings });
    expect(out.allergens).toStrictEqual(['milk']);
    expect(out.mayContain).toStrictEqual([]);
  });

  // ── What the screen says ───────────────────────────────────────────────────

  test('the reason for every gap has plain words to show', () => {
    const texts = m.ALLERGEN_REASON_TEXT as Record<string, string>;
    for (const reason of Object.keys(texts)) {
      expect((texts[reason] as string).length, `${reason} has no text`).toBeGreaterThan(0);
    }
  });

  test('junk never throws (a recipe)', () => {
    for (const bad of [null, undefined, {}, { ingredients: 'nope' }]) {
      const out = m.recipeAllergens(bad, {});
      expect(m.canLabel(out), `${JSON.stringify(bad)} produced a labelable result`).toBe(false);
    }
    expect(m.canLabel(null)).toBe(false);
    expect(m.canLabel(undefined)).toBe(false);
    expect(m.canLabel({ complete: 'yes' }), 'only a real boolean counts').toBe(false);
  });

  // ── Where to start ─────────────────────────────────────────────────────────
  //
  // ⚠️ THE ANSWER TO "DO I REALLY HAVE TO FILL IN 65 INGREDIENTS?" A handful appear
  // in almost everything; handed a flat list somebody starts at A and gives up at F
  // having unblocked nothing.

  test('the busiest undeclared ingredient comes first', () => {
    const ings = ingredients();
    ings['YEAST'] = { id: 'YEAST', name: 'Yeast' };        // undeclared, in three recipes
    ings['SEEDS'] = { id: 'SEEDS', name: 'Seeds' };        // undeclared, in one
    const recipes = [
      recipe('A', [row('Flour', 'FLOUR'), row('Yeast', 'YEAST')]),
      recipe('B', [row('Flour', 'FLOUR'), row('Yeast', 'YEAST')]),
      recipe('C', [row('Yeast', 'YEAST'), row('Seeds', 'SEEDS')]),
    ];
    const out = blockingList(recipes, { ingredients: ings });
    expect(out.map(x => [x.name, x.blocks])).toStrictEqual([['Yeast', 3], ['Seeds', 1]]);
  });

  test('a declared ingredient is not on the work list at all', () => {
    const out = blockingList([recipe('A', [row('Flour', 'FLOUR')])], { ingredients: ingredients() });
    expect(out).toStrictEqual([]);
  });

  test('an ingredient blocking one recipe TWICE is counted once', () => {
    // Two rows of the same undeclared thing is still one job.
    const ings = ingredients();
    ings['YEAST'] = { id: 'YEAST', name: 'Yeast' };
    const out = blockingList([recipe('A', [row('Yeast', 'YEAST'), row('More yeast', 'YEAST')])],
      { ingredients: ings });
    expect(out.map(x => x.blocks)).toStrictEqual([1]);
  });

  test('it reaches through a sub-recipe', () => {
    const ings = ingredients();
    ings['YEAST'] = { id: 'YEAST', name: 'Yeast' };
    const sub = recipe('SUB', [row('Yeast', 'YEAST')]);
    const out = blockingList([recipe('A', [row('Filling', 'SUB', 100, 'recipe')])],
      { ingredients: ings, recipes: { SUB: sub } });
    expect(out.map(x => [x.name, x.blocks])).toStrictEqual([['Yeast', 1]]);
  });

  test('A DELETED INGREDIENT IS NOT PUT ON THE WORK LIST', () => {
    // It cannot be declared — it does not exist — so it would sit at the top for
    // ever. The recipe's own gaps still report it, which is where it can be acted on.
    const out = blockingList([recipe('A', [row('Gone', 'DELETED')])], { ingredients: ingredients() });
    expect(out).toStrictEqual([]);
  });

  test('an unlinked row is not on this list either — it is a different job', () => {
    // "Link it" and "declare it" are two different actions; this list is the second.
    const out = blockingList([recipe('A', [{ label: 'Something', grams: 10, unit: 'g' }])],
      { ingredients: ingredients() });
    expect(out).toStrictEqual([]);
  });

  test('a cycle does not hang the work list', () => {
    const self = recipe('A', [row('Itself', 'A', 100, 'recipe')]);
    expect(blockingList([self], { ingredients: ingredients(), recipes: { A: self } })).toStrictEqual([]);
  });

  test('the order is stable between two runs', () => {
    const ings = ingredients();
    ings['AAA'] = { id: 'AAA', name: 'Aaa' };
    ings['BBB'] = { id: 'BBB', name: 'Bbb' };
    const recipes = [recipe('A', [row('a', 'AAA'), row('b', 'BBB')])];
    const first = blockingList(recipes, { ingredients: ings }).map(x => x.name);
    const second = blockingList(recipes, { ingredients: ings }).map(x => x.name);
    expect(first).toStrictEqual(second);
    expect(first, 'ties break by name, not by insertion order').toStrictEqual(['Aaa', 'Bbb']);
  });

  test('junk never throws (the work list)', () => {
    expect(blockingList(null, {})).toStrictEqual([]);
    expect(blockingList([null, {}], {})).toStrictEqual([]);
  });

  // ── The job BEFORE declaring ───────────────────────────────────────────────
  //
  // ⚠️ THIS EXISTS BECAUSE THE WORK LIST WAS EMPTY ON THE REAL DATA. On 11 August
  // 2026 the bakery had 77 recipe rows and NONE of them linked, so
  // blockingIngredients() had nothing to count and the screen whose whole point is
  // "start here" showed nothing at all. Linking comes first, strictly: a
  // declaration cannot reach a recipe that does not point at the ingredient.

  test('THE ROWS THAT ARE NOT LINKED ARE THEIR OWN JOB, counted by name', () => {
    const recipes = [
      recipe('A', [{ label: 'Flour', grams: 1000, unit: 'g' }, { label: 'Salt', grams: 20, unit: 'g' }]),
      recipe('B', [{ label: 'Flour', grams: 500, unit: 'g' }]),
      recipe('C', [{ label: 'Flour', grams: 500, unit: 'g' }]),
    ];
    expect(m.unlinkedRowNames(recipes).map(x => [x.name, x.rows])).toStrictEqual([['Flour', 3], ['Salt', 1]]);
  });

  test('a LINKED row is not on the linking list', () => {
    expect(m.unlinkedRowNames([recipe('A', [row('Flour', 'FLOUR')])])).toStrictEqual([]);
  });

  test('the same name in one recipe twice is TWO links to make', () => {
    // Unlike declaring, which is one job per ingredient however often it appears,
    // linking is one action per ROW.
    const r = recipe('A', [{ label: 'Flour', grams: 100, unit: 'g' }, { label: 'Flour', grams: 50, unit: 'g' }]);
    expect(m.unlinkedRowNames([r]).map(x => x.rows)).toStrictEqual([2]);
  });

  test('a blank line is not a job here either', () => {
    expect(m.unlinkedRowNames([recipe('A', [{ label: '  ', grams: 0 }])])).toStrictEqual([]);
  });

  test('the order is busiest first, ties by name, and stable', () => {
    const recipes = [recipe('A', [{ label: 'Bbb', grams: 1 }, { label: 'Aaa', grams: 1 }])];
    expect(m.unlinkedRowNames(recipes).map(x => x.name)).toStrictEqual(['Aaa', 'Bbb']);
  });

  test('junk never throws (the linking list)', () => {
    expect(m.unlinkedRowNames(null)).toStrictEqual([]);
    expect(m.unlinkedRowNames([null, {}])).toStrictEqual([]);
  });

  // ── What a one-line row says about a recipe ────────────────────────────────
  //
  // ⚠️⚠️ THIS DECISION USED TO LIVE INSIDE allergen-sheet.js, WHERE NO TEST COULD
  // REACH IT — on the one screen in this app that can send somebody to hospital.
  // Moved into the model so a mutation has something to break.

  test('the four states, and the dangerous one is told apart from the safe one', () => {
    const tables = { ingredients: ingredients() };

    // Checked, and it contains something.
    expect(m.rowState(m.recipeAllergens(recipe('R', [row('Flour', 'FLOUR')]), tables))).toBe('declared-listed');

    // Checked, and it contains none of the fourteen. ⚠️ NOT the same as nobody
    // having looked, and the screen must dress it as a statement somebody made.
    const none = m.recipeAllergens(recipe('R', [row('Water', 'WATER')]), tables);
    expect(m.rowState(none)).toBe('declared-none');
    expect(none.allergens).toStrictEqual([]);

    // Nobody has said anything, and there are rows waiting.
    expect(m.rowState(m.recipeAllergens(recipe('R', [row('Mystery', 'MYSTERY')]), tables))).toBe('not-declared');

    // A recipe with nothing in it is NOT "contains none" — nobody has said so.
    expect(m.rowState(m.recipeAllergens(recipe('R', []), tables))).toBe('nothing-yet');
  });

  // ⚠️⚠️ THE MUTATION THAT MATTERS MOST IN THIS FILE. A recipe with two of six rows
  // declared HAS allergens — and is incomplete. Anything that reads the list instead
  // of asking canLabel() calls it declared, and the row nobody linked could be the
  // one with the hazelnuts.
  test('allergens present but incomplete answers NOT DECLARED, never declared', () => {
    const half = {
      complete: false,
      allergens: ['gluten-wheat', 'milk'],
      mayContain: [],
      gaps: [{ name: 'Mystery mix', reason: 'not-declared' }],
    };
    expect(m.canLabel(half)).toBe(false);
    expect(m.rowState(half)).toBe('not-declared');
    expect(m.rowIsBlocked(m.rowState(half))).toBe(true);
  });

  // ⚠️ EVERY DEFAULT IN THIS FILE POINTS THE SAME WAY: doubt reads as "we do not
  // know". A missing result must never answer the clean-looking state.
  test('junk answers not-declared rather than anything reassuring', () => {
    for (const bad of [null, undefined, 0, '', false, NaN]) {
      expect(m.rowState(bad), String(bad)).toBe('not-declared');
    }
    // A result whose shape is wrong is still not an answer.
    expect(m.rowState({ complete: true })).toBe('declared-none');
    expect(m.rowState({ complete: false })).toBe('nothing-yet');
  });

  test('only the two declared states are unblocked', () => {
    expect([...m.ROW_STATES]).toStrictEqual(['declared-listed', 'declared-none', 'nothing-yet', 'not-declared']);
    expect(m.rowIsBlocked('declared-listed')).toBe(false);
    expect(m.rowIsBlocked('declared-none')).toBe(false);
    expect(m.rowIsBlocked('nothing-yet')).toBe(true);
    expect(m.rowIsBlocked('not-declared')).toBe(true);
    // ⚠️ Stated plainly because it is the one direction that could bite: rowState()
    // is the only producer, and it can only ever return one of the four above.
    expect(m.ROW_STATES.length).toBe(4);
  });

  // ── Added ──────────────────────────────────────────────────────────────────
  // Not in tests/recipe-allergen-model.test.mjs: what the left-out incompleteText leaves to the app, the
  // rest of the health-critical rules said once more as a whole, and the one place the third argument shows.

  // What incompleteText was built from: the count of gaps decides which sentence the app shows.
  test('the number of gaps is what the app turns into its «N ingredients are not declared» line', () => {
    const r = recipe('R1', [row('Flour', 'FLOUR'), row('Mystery', 'MYSTERY'), { label: 'Loose', grams: 1 }]);
    const out = m.recipeAllergens(r, { ingredients: ingredients() });
    expect(out.complete).toBe(false);
    expect(out.gaps.length).toBe(2);
    const empty = m.recipeAllergens(recipe('R2', []), { ingredients: ingredients() });
    expect(empty.complete).toBe(false);
    expect(empty.gaps.length, 'no rows at all: the «nothing in this recipe» sentence').toBe(0);
  });

  test('⚠️ complete === false NEVER reads as labelable, whatever else the result holds', () => {
    for (const result of [
      { complete: false, allergens: [], mayContain: [], gaps: [] },
      { complete: false, allergens: ['milk'], gaps: [] },
      { complete: 0 }, { complete: 1 }, { complete: 'true' }, { complete: null }, {}, [],
    ]) {
      expect(m.canLabel(result), JSON.stringify(result)).toBe(false);
    }
    expect(m.canLabel({ complete: true })).toBe(true);
  });

  test('an unweighable row that IS linked and declared still counts its allergens', () => {
    const r = recipe('R1', [{ label: 'Mustard', unit: 'pinch', kind: 'ingredient', refId: 'MUSTARD' }, row('Flour', 'FLOUR')]);
    const ings = { ...ingredients(), MUSTARD: { id: 'MUSTARD', name: 'Mustard', allergens: ['mustard'], allergensCheckedAt: STAMP } };
    const out = m.recipeAllergens(r, { ingredients: ings });
    expect(out.allergens).toStrictEqual(['gluten-wheat', 'mustard']);
    expect(out.complete).toBe(true);
  });

  test('a recipe built from a Map answers like one built from an object', () => {
    const r = recipe('R1', [row('Flour', 'FLOUR'), row('Filling', 'SUB', 100, 'recipe')]);
    const sub = recipe('SUB', [row('Butter', 'BUTTER')]);
    const fromObjects = m.recipeAllergens(r, { ingredients: ingredients(), recipes: { SUB: sub } });
    const fromMaps = m.recipeAllergens(r, {
      ingredients: new Map(Object.entries(ingredients())), recipes: new Map([['SUB', sub]]),
    });
    expect(fromMaps).toStrictEqual(fromObjects);
  });

  test('an ingredient nobody named is shown as the word the caller handed over', () => {
    const ings = { NONAME: { id: 'NONAME' } };
    const out = blockingList([recipe('A', [row('x', 'NONAME')])], { ingredients: ings });
    expect(out.map(x => [x.id, x.name, x.blocks])).toStrictEqual([['NONAME', UNKNOWN_INGREDIENT, 1]]);
  });

  test('a short name is what the work list shows, as for every screen', () => {
    const ings = { Y: { id: 'Y', name: 'Yeast, fresh, 500 g block', shortName: ' Yeast ' } };
    const out = blockingList([recipe('A', [row('x', 'Y')])], { ingredients: ings });
    expect(out.map(x => x.name)).toStrictEqual(['Yeast']);
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port against the original', () => {
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;
  const LEFT_OUT = ['incompleteText'];
  const shared = Object.keys(original).filter(name => !LEFT_OUT.includes(name)).sort();

  test('the original still exports the one function this port leaves out', () => {
    // If it did not, the exclusion above would be hiding a rename instead of a decision.
    for (const name of LEFT_OUT) expect(typeof original[name], name).toBe('function');
  });

  test('exports exactly the same names, except that one', () => {
    expect(Object.keys(port).sort()).toStrictEqual(shared);
  });

  test('every non-function export is strictly equal and frozen the same way', () => {
    for (const name of shared) {
      if (typeof original[name] === 'function') continue;
      expect(port[name], name).toStrictEqual(original[name]);
      expect(Object.isFrozen(port[name]), `${name}: frozen`).toBe(Object.isFrozen(original[name]));
    }
  });

  test('every function has the same name and the same number of required parameters, except blockingIngredients (one more)', () => {
    for (const name of shared) {
      const mine = port[name];
      const theirs = original[name];
      if (typeof mine !== 'function' || typeof theirs !== 'function') continue;
      expect(mine.name, name).toBe(theirs.name);
      if (name === 'blockingIngredients') continue;
      expect(mine.length, `${name}: arity`).toBe(theirs.length);
    }
  });
});
