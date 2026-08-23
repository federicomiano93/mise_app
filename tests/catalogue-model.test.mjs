// Unit tests for the Recipe catalogue pure model (P15 — the owner cannot read code,
// so these lock the core behaviour: junk-safe normalization, exact-sum kg scaling,
// list ordering/search, editor validation, and the Calculator-import mapping).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCatalogueRecipe,
  normalizeCatalogueRecipes,
  sortByUsage,
  filterByName,
  scaleCatalogue,
  baseAmounts,
  formatWeight,
  batchWarning,
  MAX_SANE_BATCH_G,
  MAX_SANE_MULTIPLE,
  findInvalidRecipe,
  toCalculatorRecipe,
  mergeImportedRecipe,
  findCalculatorImport,
  isScaledEntryFresh,
  SCALED_TTL_MS,
  unitOf,
  isWeighableUnit,
  weighableTotalGrams,
  nonWeighableLabels,
  weightLoss,
  cookedFromLossPct,
  normalizeWeight,
  MAX_LOSS_PCT,
  MAX_WEIGHT_G,
} from '../js/catalogue/catalogue-model.js';

const FOCACCIA = {
  id: 'foc',
  name: 'Focaccia',
  ingredients: [
    { label: 'Flour uniqua blue', grams: 278 },
    { label: 'Flour T65', grams: 278 },
    { label: 'Malt', grams: 3 },
    { label: 'Sugar', grams: 8 },
    { label: 'Salt', grams: 11 },
    { label: 'Yeast', grams: 3.6 },
    { label: 'Oil', grams: 56 },
    { label: '1° Water', grams: 334 },
    { label: '2° Water', grams: 24 },
  ],
};

const sum = (arr) => arr.reduce((a, b) => a + b, 0);

// ── normalization ──────────────────────────────────────────────────────────────

test('normalizeCatalogueRecipe coerces junk safely (never NaN, never throws)', () => {
  const r = normalizeCatalogueRecipe({
    id: 42, name: '  Ciabatta  ',
    ingredients: [
      { label: 'Flour', grams: '500' },            // numeric string
      { name: 'Water', grams: -5 },                 // legacy `name`, negative -> 0
      { label: 'Salt', grams: 'abc' },              // non-numeric -> 0
      { label: 'Milk', grams: 2, unit: 'l' },       // valid unit preserved
      { label: 'Eggs', grams: 3, unit: 'pcs' },     // valid unit preserved
      { label: 'Bad', grams: 1, unit: 'xyz' },      // unknown unit -> grams
      null,                                          // dropped
      'garbage',                                     // dropped
    ],
  });
  assert.equal(r.id, '42');
  assert.equal(r.name, 'Ciabatta');
  assert.deepEqual(r.ingredients, [
    { label: 'Flour', grams: 500, unit: 'g' },
    { label: 'Water', grams: 0, unit: 'g' },
    { label: 'Salt', grams: 0, unit: 'g' },
    { label: 'Milk', grams: 2, unit: 'l' },
    { label: 'Eggs', grams: 3, unit: 'pcs' },
    { label: 'Bad', grams: 1, unit: 'g' },
  ]);
});

test('normalizeCatalogueRecipe returns null for non-object input', () => {
  assert.equal(normalizeCatalogueRecipe(null), null);
  assert.equal(normalizeCatalogueRecipe('x'), null);
});

test('normalizeCatalogueRecipes drops junk entries', () => {
  const list = normalizeCatalogueRecipes([FOCACCIA, null, 5, { name: 'X' }]);
  assert.equal(list.length, 2);
  assert.equal(list[0].name, 'Focaccia');
  assert.equal(list[1].name, 'X');
});

// ── scaleCatalogue: the core invariant (integers sum EXACTLY to the target) ─────

test('scaleCatalogue keeps the base recipe when target equals its total', () => {
  const total = FOCACCIA.ingredients.reduce((s, i) => s + i.grams, 0); // 995.6 (raw, fractional)
  const out = scaleCatalogue(FOCACCIA, total);
  assert.equal(sum(out), Math.round(total));
});

test('baseAmounts rounds to whole grams that sum to the rounded base total', () => {
  const out = baseAmounts(FOCACCIA);
  assert.ok(out.every(Number.isInteger), 'every base amount is a whole number');
  const rawTotal = FOCACCIA.ingredients.reduce((s, i) => s + i.grams, 0); // 995.6
  assert.equal(sum(out), Math.round(rawTotal)); // 996 — rows add up to the shown total
});

test('baseAmounts on an empty recipe is []', () => {
  assert.deepEqual(baseAmounts({ ingredients: [] }), []);
});

test('scaleCatalogue to 10 kg: proportional and sums to exactly 10000 g', () => {
  const out = scaleCatalogue(FOCACCIA, 10000);
  assert.equal(sum(out), 10000);
  // proportionality: the two equal flours stay equal, and each is ~10x the base
  assert.equal(out[0], out[1]);
  assert.ok(out[0] > 2700 && out[0] < 2900);
});

test('scaleCatalogue sums to target across many weights (rounding residual absorbed)', () => {
  for (const kg of [0.5, 1, 3, 7, 12.5, 33]) {
    const out = scaleCatalogue(FOCACCIA, kg * 1000);
    assert.equal(sum(out), Math.round(kg * 1000), `sum must equal target for ${kg} kg`);
  }
});

test('scaleCatalogue is defensive: empty recipe / non-positive / bad target -> zeros', () => {
  assert.deepEqual(scaleCatalogue({ ingredients: [] }, 10000), []);
  assert.deepEqual(scaleCatalogue(FOCACCIA, 0).every(x => x === 0), true);
  assert.deepEqual(scaleCatalogue(FOCACCIA, -5).every(x => x === 0), true);
  assert.deepEqual(scaleCatalogue(FOCACCIA, NaN).every(x => x === 0), true);
});

// ── isScaledEntryFresh (persisted "keep the calculated batch" for 12h) ──────────

test('isScaledEntryFresh: valid within 12h, expired after, junk-safe', () => {
  const now = 1_000_000_000_000; // fixed reference ms (Date.now() not used in tests)
  assert.equal(isScaledEntryFresh({ target: 10000, ts: now - 1000 }, now), true);       // 1s ago
  assert.equal(isScaledEntryFresh({ target: 10000, ts: now - (SCALED_TTL_MS - 1) }, now), true);  // just under 12h
  assert.equal(isScaledEntryFresh({ target: 10000, ts: now - SCALED_TTL_MS }, now), false);       // exactly 12h → stale
  assert.equal(isScaledEntryFresh({ target: 10000, ts: now - (SCALED_TTL_MS + 1) }, now), false);  // over 12h
  assert.equal(isScaledEntryFresh(null, now), false);
  assert.equal(isScaledEntryFresh({ target: 0, ts: now }, now), false);      // non-positive target
  assert.equal(isScaledEntryFresh({ target: 5000 }, now), false);            // missing ts
});

// ── Units: conversion, mixed-unit scaling, import filtering ─────────────────────

test('unitOf / isWeighableUnit / weighableTotalGrams', () => {
  assert.equal(unitOf({ grams: 1 }), 'g');                 // legacy row -> grams
  assert.equal(unitOf({ grams: 1, unit: 'kg' }), 'kg');
  assert.equal(unitOf({ grams: 1, unit: 'nope' }), 'g');   // unknown -> grams
  assert.equal(isWeighableUnit('kg'), true);
  assert.equal(isWeighableUnit('l'), true);
  assert.equal(isWeighableUnit('pcs'), false);
  assert.equal(isWeighableUnit('to taste'), false);
  // 1 kg (1000) + 500 g + 0.5 l (500) + 3 pcs (0) = 2000 g weighable
  assert.equal(weighableTotalGrams({ ingredients: [
    { label: 'A', grams: 1, unit: 'kg' }, { label: 'B', grams: 500, unit: 'g' },
    { label: 'C', grams: 0.5, unit: 'l' }, { label: 'D', grams: 3, unit: 'pcs' },
  ] }), 2000);
});

test('scaleCatalogue mixed units: weighable + pieces scale by the same factor', () => {
  const recipe = { ingredients: [
    { label: 'Flour', grams: 1000, unit: 'g' },
    { label: 'Eggs', grams: 2, unit: 'pcs' },
    { label: 'Salt', grams: 0, unit: 'to taste' },
  ] };
  assert.deepEqual(scaleCatalogue(recipe, 2000), [2000, 4, null]); // factor 2; to-taste has no number
});

test('scaleCatalogue mixed: kg + l convert into the weighable total, then scale', () => {
  const recipe = { ingredients: [
    { label: 'Flour', grams: 1, unit: 'kg' },  // 1000 g
    { label: 'Water', grams: 1, unit: 'l' },   // 1000 g
  ] };
  assert.deepEqual(scaleCatalogue(recipe, 4000), [2, 2]); // factor 2 -> 2 kg, 2 l
});

test('baseAmounts with non-weight units: whole numbers in each unit, null for to-taste', () => {
  assert.deepEqual(baseAmounts({ ingredients: [
    { label: 'Flour', grams: 500.4, unit: 'g' },
    { label: 'Eggs', grams: 2, unit: 'pcs' },
    { label: 'Salt', grams: 0, unit: 'to taste' },
  ] }), [500, 2, null]);
});

test('toCalculatorRecipe converts weighable to grams and drops non-weighable', () => {
  const cr = toCalculatorRecipe({ id: 'r1', name: 'Mix', ingredients: [
    { label: 'Flour', grams: 1, unit: 'kg' },       // -> 1000 g
    { label: 'Water', grams: 0.5, unit: 'l' },      // -> 500 g
    { label: 'Eggs', grams: 3, unit: 'pcs' },       // dropped
    { label: 'Salt', grams: 0, unit: 'to taste' },  // dropped
  ] });
  assert.deepEqual(cr.ingredients, [
    { label: 'Flour', grams: 1000 },
    { label: 'Water', grams: 500 },
  ]);
});

test('nonWeighableLabels lists only what the grams-only Calculator cannot take', () => {
  assert.deepEqual(nonWeighableLabels({ ingredients: [
    { label: 'Flour', grams: 1, unit: 'kg' },
    { label: 'Eggs', grams: 3, unit: 'pcs' },
    { label: 'Vanilla', grams: 0, unit: 'to taste' },
    { label: '', grams: 1, unit: 'pcs' }, // blank label ignored
  ] }), ['Eggs', 'Vanilla']);
});

// ── sortByUsage / filterByName ──────────────────────────────────────────────────

test('sortByUsage: open-count desc, then name asc; does not mutate input', () => {
  const recipes = [
    { id: 'a', name: 'Brioche' },
    { id: 'b', name: 'Focaccia' },
    { id: 'c', name: 'Sourdough' },
  ];
  const snapshot = recipes.slice();
  const sorted = sortByUsage(recipes, { b: 5, c: 5, a: 1 });
  assert.deepEqual(sorted.map(r => r.id), ['b', 'c', 'a']); // b,c tie on 5 -> name asc (Focaccia<Sourdough)
  assert.deepEqual(recipes, snapshot); // original untouched
});

test('sortByUsage: missing counts treated as 0', () => {
  const sorted = sortByUsage([{ id: 'x', name: 'Zebra' }, { id: 'y', name: 'Apple' }], {});
  assert.deepEqual(sorted.map(r => r.name), ['Apple', 'Zebra']);
});

test('filterByName: case-insensitive substring; empty query returns all', () => {
  const recipes = [{ name: 'Focaccia' }, { name: 'Brioche' }, { name: 'Sourdough' }];
  assert.deepEqual(filterByName(recipes, 'bri').map(r => r.name), ['Brioche']);
  assert.deepEqual(filterByName(recipes, 'O').length, 3); // focaccia, brioche, sourdough
  assert.deepEqual(filterByName(recipes, '   ').length, 3);
});

// ── findInvalidRecipe ────────────────────────────────────────────────────────────

test('findInvalidRecipe flags blank name and no-named-ingredient, passes valid', () => {
  assert.equal(findInvalidRecipe({ name: '', ingredients: [{ label: 'Flour', grams: 1 }] }), 'name');
  assert.equal(findInvalidRecipe({ name: 'X', ingredients: [] }), 'ingredients');
  assert.equal(findInvalidRecipe({ name: 'X', ingredients: [{ label: '  ', grams: 1 }] }), 'ingredients');
  assert.equal(findInvalidRecipe(FOCACCIA), null);
});

test('findInvalidRecipe flags an all-zero-weight recipe (cannot be scaled)', () => {
  assert.equal(findInvalidRecipe({ name: 'X', ingredients: [{ label: 'Flour', grams: 0 }] }), 'weight');
  assert.equal(findInvalidRecipe({ name: 'X', ingredients: [{ label: 'Flour', grams: 0 }, { label: 'Salt', grams: 0 }] }), 'weight');
  assert.equal(findInvalidRecipe({ name: 'X', ingredients: [{ label: 'Flour', grams: 5 }] }), null);
});

// ── toCalculatorRecipe / mergeImportedRecipe (the import mapping) ────────────────

test('toCalculatorRecipe maps to a hidden pro-rata Calculator recipe', () => {
  const cr = toCalculatorRecipe(FOCACCIA);
  assert.equal(cr.id, 'cat-foc');
  assert.equal(cr.name, 'Focaccia');
  assert.equal(cr.logic, 'total');
  assert.equal(cr.visible, false);
  assert.equal(cr.ingredients.length, FOCACCIA.ingredients.length);
  assert.deepEqual(cr.ingredients[0], { label: 'Flour uniqua blue', grams: 278 });
});

test('mergeImportedRecipe appends a new recipe (action: added)', () => {
  const cfg = { recipes: [{ id: 'focaccia' }] };
  const { config, action } = mergeImportedRecipe(cfg, toCalculatorRecipe(FOCACCIA));
  assert.equal(action, 'added');
  assert.equal(config.recipes.length, 2);
  assert.equal(config.recipes[1].id, 'cat-foc');
});

test('mergeImportedRecipe updates in place, no duplicate, preserving order/visible', () => {
  const cfg = { recipes: [
    { id: 'focaccia' },
    { id: 'cat-foc', name: 'Old', order: 2, visible: true },
  ] };
  const updated = toCalculatorRecipe({ ...FOCACCIA, name: 'New name' });
  const { config, action } = mergeImportedRecipe(cfg, updated);
  assert.equal(action, 'updated');
  assert.equal(config.recipes.length, 2); // no duplicate
  assert.equal(config.recipes[1].name, 'New name');
  assert.equal(config.recipes[1].order, 2);    // preserved
  assert.equal(config.recipes[1].visible, true); // preserved
});

// ── findCalculatorImport (drives the "was this imported?" delete warning) ────────

test('findCalculatorImport finds the imported copy by its cat-<id> provenance id', () => {
  const cfg = { recipes: [{ id: 'brioche' }, { id: 'cat-foc', name: 'Focaccia' }] };
  const hit = findCalculatorImport(cfg, 'foc');
  assert.ok(hit);
  assert.equal(hit.id, 'cat-foc');
});

test('findCalculatorImport returns null when the recipe was never imported', () => {
  const cfg = { recipes: [{ id: 'brioche' }, { id: 'cat-other' }] };
  assert.equal(findCalculatorImport(cfg, 'foc'), null);
});

test('findCalculatorImport is junk-safe (null config / missing recipes -> null)', () => {
  assert.equal(findCalculatorImport(null, 'foc'), null);
  assert.equal(findCalculatorImport({}, 'foc'), null);
  assert.equal(findCalculatorImport({ recipes: 'x' }, 'foc'), null);
});

// ── Batch size: readable weight + the mistyped-total guard ────────────────────
// The real incident this locks down: the field took KILOGRAMS while the recipe and
// every row read in grams, so typing 17500 (meaning 17500 g) asked for 17500 kg and
// silently produced a 17.5-tonne batch — 9,100,543 g of flour. The field now takes
// grams, and a total outside any real batch must be flagged, not quietly scaled.

// The REAL recipe from the incident, read off the editor screen. Note it sums to
// 14153 g — NOT the 14000 g (4 x 3500) its own name promises. That 153 g gap is the
// recipe's, not a bug, and it is exactly what an editor with no visible total hides.
const CROISSANT = normalizeCatalogueRecipe({
  id: 'croissant', name: 'Croissant (4 x 3500gr.)',
  ingredients: [
    { label: 'Flour T45', grams: 7360, unit: 'g' },
    { label: 'Caster sugar', grams: 955, unit: 'g' },
    { label: 'Salt', grams: 148, unit: 'g' },
    { label: 'Fresh yeast', grams: 295, unit: 'g' },
    { label: 'Fresh milk', grams: 1470, unit: 'g' },
    { label: 'Water', grams: 1950, unit: 'g' },
    { label: 'Butter', grams: 505, unit: 'g' },
    { label: 'Croissant scraps', grams: 1470, unit: 'g' },
  ],
});

test('the croissant weighs what its ingredients say (14153 g), not what its name says', () => {
  assert.equal(weighableTotalGrams(CROISSANT), 14153);
});

test('formatWeight: names a weight the way a person would say it', () => {
  assert.equal(formatWeight(500), '500 g');
  assert.equal(formatWeight(17500), '17.5 kg');
  assert.equal(formatWeight(18000), '18 kg');       // no trailing .0
  assert.equal(formatWeight(17500000), '17.5 tonnes');
  assert.equal(formatWeight(0), '0 g');
  assert.equal(formatWeight('junk'), '0 g');        // never NaN
});

test('batchWarning: a normal batch passes without a warning', () => {
  const base = weighableTotalGrams(CROISSANT);
  // What Federico actually meant to ask for: 17500 g = 17.5 kg, ~1.2x the recipe.
  assert.equal(batchWarning(17500, base), null);
  assert.equal(batchWarning(base, base), null);
  assert.equal(batchWarning(0, base), null);        // empty field is not a warning
});

test('batchWarning: THE INCIDENT — a tonne-scale total is flagged, not scaled in silence', () => {
  const base = weighableTotalGrams(CROISSANT);
  const w = batchWarning(17500000, base); // what "17500 kg" used to mean
  assert.ok(w, 'a 17.5-tonne batch must warn');
  assert.match(w, /17\.5 tonnes/);
  assert.match(w, /1236\.49×/);           // 17500000 / 14153
  assert.match(w, /14\.15 kg/);           // compared against the recipe as written
});

test('batchWarning: one extra zero (175 kg instead of 17.5 kg) is caught too', () => {
  const base = weighableTotalGrams(CROISSANT);
  const w = batchWarning(175000, base);
  assert.ok(w, 'a fat-finger extra zero must warn');
  assert.match(w, /175 kg/);
});

test('batchWarning: flags on absolute weight OR on the multiple of the recipe', () => {
  // Too heavy for any mixer, even though it is only a few times a big base recipe.
  assert.ok(batchWarning(MAX_SANE_BATCH_G + 1, 50000));
  assert.equal(batchWarning(MAX_SANE_BATCH_G, 50000), null); // exactly at the line: fine
  // Wildly out of proportion to a small recipe, though under the absolute cap.
  assert.ok(batchWarning(MAX_SANE_MULTIPLE * 100 + 100, 100));
  assert.equal(batchWarning(MAX_SANE_MULTIPLE * 100, 100), null);
});

test('scaleCatalogue: the scaling itself was never wrong — it reproduces the screenshot', () => {
  // Golden check against the amounts the app actually displayed. They were right to
  // the gram; only the UNIT of the input was the trap.
  const rows = scaleCatalogue(CROISSANT, 17500000);
  assert.deepEqual(rows, [
    9100543,  // Flour T45
    1180845,  // Caster sugar
    183000,   // Salt
    364764,   // Fresh yeast
    1817636,  // Fresh milk
    2411150,  // Water
    624426,   // Butter
    1817636,  // Croissant scraps
  ]);
  assert.equal(rows.reduce((a, b) => a + b, 0), 17500000); // and they sum EXACTLY
  // And the amount actually intended scales cleanly too.
  assert.equal(scaleCatalogue(CROISSANT, 17500).reduce((a, b) => a + b, 0), 17500);
});

// ── The oven loss, worked out from two weighings ─────────────────────────────
//
// ⚠️ WHY THIS MATTERS MORE THAN IT LOOKS: lossPct is the DIVISOR of the price per
// kilo. A recipe that goes in at 1000 g and comes out at 800 g costs 25% more per kilo
// than its ingredients suggest, and a 0 there makes every baked product look cheaper
// than it is. The field asked for a percentage — a number nobody has — so it stayed 0.

test('two weighings become a percentage', () => {
  assert.equal(weightLoss(1000, 800).pct, 20);
  assert.equal(weightLoss(8380, 7374).pct, 12);      // rounded to a tenth: 12.005 → 12
  assert.equal(weightLoss(1000, 1000).pct, 0);       // nothing lost IS an answer
  assert.equal(weightLoss(1000, 800).problem, null);
});

test('⚠️ the number SHOWN is the number STORED — rounded to a tenth', () => {
  // 12.005% displayed as 12% while 12.005 sits in the database is a screen nobody can
  // reconcile against the figure it is supposed to explain.
  const { pct } = weightLoss(8380, 7373);
  assert.equal(pct, 12.0);
  assert.equal(Math.round(pct * 10) / 10, pct, 'never more than one decimal');
  assert.equal(weightLoss(3000, 2555).pct, 14.8);
});

test('⚠️⚠️ nothing gains weight in an oven, and that is NOT answered with zero', () => {
  // Zero would quietly turn a typo into «this recipe loses nothing» — the exact
  // direction that makes a product look cheaper than it is.
  const out = weightLoss(800, 1000);
  assert.equal(out.pct, null);
  assert.equal(out.problem, 'cookedHeavier');
});

test('⚠️⚠️ a cooked weight of almost nothing is capped at 99, and says so', () => {
  // 100 would divide the price per kilo by zero and make every product built on this
  // recipe cost Infinity. The cap is load-bearing, and the screen has to admit it
  // rather than silently storing something other than what was typed.
  const out = weightLoss(8380, 1);
  assert.equal(out.pct, MAX_LOSS_PCT);
  assert.equal(out.problem, 'capped');
  assert.ok(out.pct < 100);
});

test('⚠️ an unanswered pair is null, which is NOT zero', () => {
  // null means «these two numbers do not answer the question», and the editor must
  // leave the recipe's stored loss alone. Zero would overwrite it with «loses nothing».
  for (const [a, b] of [[0, 0], [1000, 0], [0, 800], ['', ''], [1000, ''], [null, null],
    ['abc', 'def'], [-5, 800], [1000, -5], [undefined, undefined]]) {
    const out = weightLoss(a, b);
    assert.equal(out.pct, null, `weightLoss(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
    assert.equal(out.problem, null, 'an empty pair is not a MISTAKE, it is just unanswered');
  }
});

test('junk in, no throw and no NaN out', () => {
  for (const junk of [NaN, Infinity, -Infinity, {}, [], 'x', null, undefined]) {
    assert.equal(normalizeWeight(junk), 0);
    const out = weightLoss(junk, junk);
    assert.equal(out.pct, null);
  }
  assert.equal(normalizeWeight(1e12), MAX_WEIGHT_G, 'bounded, so a runaway never reaches the database');
  assert.equal(normalizeWeight('850'), 850, 'a string from an input box is a number');
});

test('the cooked weight derived from a stored percentage round-trips', () => {
  // This is what a recipe written before the feature shows: it has a lossPct and no
  // weights, and the box must display what that percentage MEANS — then read back as
  // the same percentage, or opening the editor would appear to change the recipe.
  for (const [total, pct] of [[1000, 20], [8380, 12], [2500, 7.5], [900, 0], [4000, 33.3]]) {
    const cooked = cookedFromLossPct(total, pct);
    assert.equal(weightLoss(total, cooked).pct, pct, `${total} g at ${pct}%`);
  }
});

test('a derived cooked weight is junk-safe too', () => {
  assert.equal(cookedFromLossPct(0, 20), 0);
  assert.equal(cookedFromLossPct('abc', 20), 0);
  assert.equal(cookedFromLossPct(1000, 'abc'), 1000, 'an unreadable loss means none lost');
  assert.equal(cookedFromLossPct(1000, 150), 10, 'capped at 99, so never zero and never negative');
  assert.ok(cookedFromLossPct(1000, 99) > 0, 'the cap keeps the divisor above zero');
});

test('⚠️ the weights are absent, not zero, on a recipe nobody has weighed', () => {
  // Same rule as `steps` and `endNote`: every recipe written before this existed must
  // stay byte-identical until somebody actually puts a scale under the dough.
  const plain = normalizeCatalogueRecipe({ id: 'r', name: 'Bread', ingredients: [], lossPct: 12 });
  assert.ok(!('rawGrams' in plain), 'no rawGrams key at all');
  assert.ok(!('cookedGrams' in plain), 'no cookedGrams key at all');
  assert.equal(plain.lossPct, 12, 'and its stored loss is untouched');

  const weighed = normalizeCatalogueRecipe({
    id: 'r', name: 'Bread', ingredients: [], lossPct: 20, rawGrams: 1000, cookedGrams: 800,
  });
  assert.equal(weighed.rawGrams, 1000);
  assert.equal(weighed.cookedGrams, 800);
});
