// Unit tests for what a recipe costs per kilo (P15 — the owner cannot read code, so these tests are the
// safety net), run against BOTH implementations: the TypeScript port in shared/ and
// js/catalogue/recipe-cost-model.js, which the live app uses today. Ported from
// tests/recipe-cost-model.test.mjs; the two must stay equal until the switch to Mise 2.
//
// The thing they are really guarding is a cost that is wrong in the direction of "we are making money": a
// partial recipe divided by its FULL weight, a gram/kilo slip, a row silently counted as free.
//
// recipe-cost-model.ts is a PARTIAL port, so parity.spec.ts does not pair it: the original also exports
// `costReasonLabel` and `partialCostText`, which look a word up in the interface dictionary (`t()`); in
// Mise 2 the app resolves the COST_REASON_TEXT keys through its own typed i18n. The last block of this
// file stands in for what pairing would have checked.
//
// PORTED from tests/recipe-cost-model.test.mjs: 27 of its 32 tests here; 'a nonsense loss is treated as
// none' and 'a junk link is treated as no link…' are in catalogue-model.spec.ts (they test
// normalizeLossPct and linkOf), and the normalizeLossPct half of 'a loss of 100%…' is there too. Added:
// the dictionary keys of the reasons.
//
// NOT PORTED: 'normalising a recipe keeps its ingredient links' and 'a row with no link stays exactly the
// shape it has always had' (they test normalizeCatalogueRecipe, which Food cost does not read), and 'a
// complete cost says nothing; a partial one says how much is missing' (partialCostText speaks through
// `t()`).

import { describe, expect, test } from 'vitest';
import * as ported from './recipe-cost-model';
import * as legacyJs from '../../js/catalogue/recipe-cost-model.js';

const legacy = legacyJs as unknown as typeof ported;

// £2.00/kg flour and £8.00/kg butter, priced the way Orders stores them.
const INGREDIENTS: Record<string, Record<string, unknown>> = {
  FLOUR: { name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 },
  BUTTER: { name: 'Butter', priceUnit: 'kg', pricePerUnit: 8 },
  MILK: { name: 'Milk', priceUnit: 'l', pricePerUnit: 1.2 },
  EGG: { name: 'Egg', priceUnit: 'pcs', pricePerUnit: 0.3, unitWeightKg: 0.055 },
  SALT: { name: 'Salt' },                       // in Orders, but never priced
};

const row = (label: string, grams: number, over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ label, grams, unit: 'g', kind: 'ingredient', ...over });

const recipe = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ id: 'R1', name: 'Test', ingredients: [], lossPct: 0, ...over });

// Round the way the model does, so an expected value written by hand here does not fail on the fifteenth
// decimal.
const roundish = (n: number): number => Math.round((n + Number.EPSILON) * 1e4) / 1e4;

const CREAM = {
  id: 'CREAM', name: 'Pastry cream', lossPct: 0,
  ingredients: [row('Milk', 500, { refId: 'MILK', unit: 'ml' }), row('Egg', 500, { refId: 'EGG' })],
};

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  // ── The basic sum ──────────────────────────────────────────────────────────

  test('a fully linked recipe costs the sum of its rows, per kilo of dough', () => {
    // 800 g flour at £2/kg = £1.60; 200 g butter at £8/kg = £1.60. £3.20 for 1000 g.
    const r = recipe({ ingredients: [row('Flour', 800, { refId: 'FLOUR' }), row('Butter', 200, { refId: 'BUTTER' })] });
    const out = m.costRecipe(r, { ingredients: INGREDIENTS });

    expect(out.totalCost).toBe(3.2);
    expect(out.costedGrams).toBe(1000);
    expect(out.yieldGrams).toBe(1000);
    expect(out.pricePerKg).toBe(3.2);
    expect(out.partial).toBe(false);
  });

  test('grams and kilos are not confused — a thousandfold error is the classic one', () => {
    const r = recipe({ ingredients: [row('Flour', 1, { refId: 'FLOUR' })] });
    const out = m.costRecipe(r, { ingredients: INGREDIENTS });
    expect(out.totalCost).toBe(0.002);       // one gram of £2/kg flour
    expect(out.pricePerKg).toBe(2);          // …and a kilo of it still costs £2
  });

  test('a row written in kilos weighs the same as the equivalent in grams', () => {
    const inG = m.costRecipe(recipe({ ingredients: [row('Flour', 2000, { refId: 'FLOUR' })] }), { ingredients: INGREDIENTS });
    const inKg = m.costRecipe(recipe({ ingredients: [row('Flour', 2, { refId: 'FLOUR', unit: 'kg' })] }), { ingredients: INGREDIENTS });
    expect([inKg.totalCost, inKg.costedGrams]).toStrictEqual([inG.totalCost, inG.costedGrams]);
  });

  test('a row in millilitres is costed as the same number of grams', () => {
    // The declared 1:1 volume approximation, and the SAME one the price model uses for an ingredient
    // bought by the litre. The two have to agree or a litre of milk costs one thing on the shelf and
    // another in the recipe.
    const r = recipe({ ingredients: [row('Milk', 500, { refId: 'MILK', unit: 'ml' })] });
    const out = m.costRecipe(r, { ingredients: INGREDIENTS });
    expect(out.costedGrams).toBe(500);
    expect(out.totalCost).toBe(0.6);
  });

  test('an ingredient bought by the piece is costed through its piece weight', () => {
    // 165 g of egg, from eggs at £0.30 each weighing 55 g → £5.4545/kg.
    const r = recipe({ ingredients: [row('Egg', 165, { refId: 'EGG' })] });
    const out = m.costRecipe(r, { ingredients: INGREDIENTS });
    expect(out.totalCost).toBe(0.9);
    expect(out.partial).toBe(false);
  });

  // ── Weight loss ────────────────────────────────────────────────────────────

  test('weight lost in the oven raises the price per kilo of what comes out', () => {
    // £3.20 of ingredients, 1000 g in, 20% lost → 800 g out → £4.00/kg.
    const r = recipe({
      lossPct: 20,
      ingredients: [row('Flour', 800, { refId: 'FLOUR' }), row('Butter', 200, { refId: 'BUTTER' })],
    });
    const out = m.costRecipe(r, { ingredients: INGREDIENTS });
    expect(out.yieldGrams).toBe(800);
    expect(out.pricePerKg).toBe(4);
    expect(out.totalCost).toBe(3.2);         // the money spent does not change
  });

  test('no loss is the default, so every recipe written before this field is unaffected', () => {
    const r = { id: 'R1', name: 'Old', ingredients: [row('Flour', 1000, { refId: 'FLOUR' })] };
    const out = m.costRecipe(r, { ingredients: INGREDIENTS });
    expect(out.lossPct).toBe(0);
    expect(out.pricePerKg).toBe(2);
  });

  test('a loss of 100% cannot divide the price by zero', () => {
    // Capped at 99, so the worst case is an expensive kilo, never Infinity — which would be shown on
    // screen and carried into every product built on this recipe.
    const out = m.costRecipe(recipe({ lossPct: 100, ingredients: [row('Flour', 1000, { refId: 'FLOUR' })] }),
      { ingredients: INGREDIENTS });
    expect(Number.isFinite(out.pricePerKg), `got ${out.pricePerKg}`).toBe(true);
    expect(out.pricePerKg).toBe(200);
  });

  // ── Partial cost: flagged, never blocked ───────────────────────────────────

  test('an unlinked row is left out of BOTH the cost and the weight', () => {
    // The heart of it. 800 g of linked flour plus 200 g of unlinked "Sugar" is £1.60 over 800 g =
    // £2.00/kg — not £1.60 over 1000 g = £1.60/kg, which would look complete and be 20% too cheap.
    const r = recipe({ ingredients: [row('Flour', 800, { refId: 'FLOUR' }), row('Sugar', 200)] });
    const out = m.costRecipe(r, { ingredients: INGREDIENTS });

    expect(out.costedGrams).toBe(800);
    expect(out.pricePerKg).toBe(2);
    expect(out.partial).toBe(true);
    expect(out.unpriced.length).toBe(1);
    expect(out.unpriced[0]?.label).toBe('Sugar');
    expect(out.unpriced[0]?.reason).toBe('not-linked');
  });

  test('a linked ingredient with no price yet is left out and named', () => {
    const r = recipe({ ingredients: [row('Flour', 900, { refId: 'FLOUR' }), row('Salt', 100, { refId: 'SALT' })] });
    const out = m.costRecipe(r, { ingredients: INGREDIENTS });
    expect(out.costedGrams).toBe(900);
    expect(out.partial).toBe(true);
    expect(out.unpriced[0]?.reason).toBe('no-price');
  });

  test('a link to an ingredient that has been deleted is named as such', () => {
    const r = recipe({ ingredients: [row('Flour', 900, { refId: 'FLOUR' }), row('Gone', 100, { refId: 'NOPE' })] });
    const out = m.costRecipe(r, { ingredients: INGREDIENTS });
    expect(out.unpriced[0]?.reason).toBe('missing-ingredient');
  });

  test('rows that are not weighed are excluded from cost AND weight, and are not a job', () => {
    // Pieces, spoons and to-taste rows carry no weight, so they cannot be costed and there is nothing to
    // fix about them — they stay out of the to-do list, but the recipe is still honest that the cost is
    // partial.
    const r = recipe({
      ingredients: [
        row('Flour', 1000, { refId: 'FLOUR' }),
        row('Salt', 1, { unit: 'pinch' }),
        row('Vanilla', 1, { unit: 'pcs' }),
        row('Pepper', 0, { unit: 'to taste' }),
      ],
    });
    const out = m.costRecipe(r, { ingredients: INGREDIENTS });
    expect(out.costedGrams).toBe(1000);
    expect(out.pricePerKg).toBe(2);
    expect(out.partial).toBe(true);
    expect(out.unpriced.length, 'a pinch of salt is not something to go and fix').toBe(0);
  });

  test('nothing costable at all gives NO price, not a price of zero', () => {
    // £0.00/kg reads as "this is free". It has to read as "nobody has priced it".
    const out = m.costRecipe(recipe({ ingredients: [row('Sugar', 500), row('Salt', 10)] }), { ingredients: INGREDIENTS });
    expect(out.pricePerKg).toBe(null);
    expect(out.totalCost).toBe(0);
    expect(out.partial).toBe(true);
  });

  test('an empty recipe has no price and nothing to complain about', () => {
    const out = m.costRecipe(recipe(), { ingredients: INGREDIENTS });
    expect(out.pricePerKg).toBe(null);
    expect(out.partial).toBe(false);
    expect(out.unpriced).toStrictEqual([]);
  });

  test('a named row with no amount is unfinished, not free', () => {
    const out = m.costRecipe(recipe({ ingredients: [row('Flour', 0, { refId: 'FLOUR' })] }), { ingredients: INGREDIENTS });
    expect(out.pricePerKg).toBe(null);
    expect(out.rows[0]?.reason).toBe('no-amount');
  });

  test('a blank row is not reported as a job', () => {
    const out = m.costRecipe(recipe({ ingredients: [row('Flour', 1000, { refId: 'FLOUR' }), row('', 0)] }),
      { ingredients: INGREDIENTS });
    expect(out.unpriced.length).toBe(0);
    expect(out.partial).toBe(false);
  });

  // ── Recipes inside recipes ─────────────────────────────────────────────────

  test('a recipe used inside another is costed at its own price per kilo', () => {
    // Cream: £0.60 of milk + £2.7273 of egg over 1000 g → £3.3273/kg.
    const cream = m.costRecipe(CREAM, { ingredients: INGREDIENTS });
    expect(cream.pricePerKg).toBe(3.3273);

    // A cake using 500 g of that cream plus 500 g of flour.
    const cake = recipe({ id: 'CAKE', ingredients: [
      row('Pastry cream', 500, { kind: 'recipe', refId: 'CREAM' }),
      row('Flour', 500, { refId: 'FLOUR' }),
    ] });
    const out = m.costRecipe(cake, { ingredients: INGREDIENTS, recipes: { CREAM } });

    expect(out.totalCost).toBe(roundish(500 / 1000 * 3.3273 + 1));
    expect(out.costedGrams).toBe(1000);
    expect(out.partial).toBe(false);
  });

  test("a sub-recipe's own weight loss is already inside the price it contributes", () => {
    const reduced = { ...CREAM, id: 'REDUCED', lossPct: 50 };
    const sub = m.costRecipe(reduced, { ingredients: INGREDIENTS });
    expect(sub.pricePerKg).toBe(6.6546);   // same money, half the yield

    const cake = recipe({ id: 'CAKE', ingredients: [row('Reduction', 100, { kind: 'recipe', refId: 'REDUCED' })] });
    const out = m.costRecipe(cake, { ingredients: INGREDIENTS, recipes: { REDUCED: reduced } });
    expect(out.totalCost).toBe(0.6655);
  });

  test('a partly priced sub-recipe makes the parent partly priced too', () => {
    // Otherwise the doubt vanishes one level up and a half-known number looks complete — the same failure
    // as dividing by the full weight, one layer deeper.
    const half = {
      id: 'HALF', name: 'Half', lossPct: 0,
      ingredients: [row('Flour', 500, { refId: 'FLOUR' }), row('Mystery', 500)],
    };
    const cake = recipe({ id: 'CAKE', ingredients: [row('Half', 100, { kind: 'recipe', refId: 'HALF' })] });
    const out = m.costRecipe(cake, { ingredients: INGREDIENTS, recipes: { HALF: half } });

    expect(out.pricePerKg as number).toBeGreaterThan(0);
    expect(out.partial, 'the parent must inherit the doubt').toBe(true);
  });

  test('two rows may use the same sub-recipe without the second looking like a cycle', () => {
    const cake = recipe({ id: 'CAKE', ingredients: [
      row('Cream', 200, { kind: 'recipe', refId: 'CREAM' }),
      row('More cream', 300, { kind: 'recipe', refId: 'CREAM' }),
    ] });
    const out = m.costRecipe(cake, { ingredients: INGREDIENTS, recipes: { CREAM } });
    expect(out.partial).toBe(false);
    expect(out.costedGrams).toBe(500);
  });

  test('a recipe that contains itself is caught, not followed', () => {
    const loop = {
      id: 'LOOP', name: 'Loop', lossPct: 0,
      ingredients: [row('Itself', 100, { kind: 'recipe', refId: 'LOOP' })],
    };
    const out = m.costRecipe(loop, { ingredients: INGREDIENTS, recipes: { LOOP: loop } });
    expect(out.rows[0]?.reason).toBe('cycle');
    expect(out.pricePerKg).toBe(null);
    expect(out.partial).toBe(true);
  });

  test('a cycle two recipes long is caught as well', () => {
    const a = { id: 'A', name: 'A', lossPct: 0, ingredients: [row('B', 100, { kind: 'recipe', refId: 'B' })] };
    const b = { id: 'B', name: 'B', lossPct: 0, ingredients: [row('A', 100, { kind: 'recipe', refId: 'A' })] };
    const out = m.costRecipe(a, { ingredients: INGREDIENTS, recipes: { A: a, B: b } });
    expect(out.pricePerKg).toBe(null);
    expect(out.partial).toBe(true);
  });

  test('nesting stops at the depth limit instead of running away', () => {
    // A chain longer than the limit: each recipe uses the next one.
    const recipes: Record<string, Record<string, unknown>> = {};
    const depth = m.MAX_RECIPE_DEPTH + 3;
    for (let i = 0; i < depth; i += 1) {
      recipes[`L${i}`] = {
        id: `L${i}`, name: `L${i}`, lossPct: 0,
        ingredients: i === depth - 1
          ? [row('Flour', 1000, { refId: 'FLOUR' })]
          : [row(`L${i + 1}`, 1000, { kind: 'recipe', refId: `L${i + 1}` })],
      };
    }
    const out = m.costRecipe(recipes['L0'], { ingredients: INGREDIENTS, recipes });
    expect(out.pricePerKg).toBe(null);
    expect(out.partial).toBe(true);
    // The chain is refused, and nothing hangs or overflows getting there.
    expect(['too-deep', 'sub-not-costable']).toContain(out.rows[0]?.reason);
  });

  test('a link to a recipe that has been deleted is named as such', () => {
    const cake = recipe({ ingredients: [row('Gone', 100, { kind: 'recipe', refId: 'NOPE' })] });
    const out = m.costRecipe(cake, { ingredients: INGREDIENTS, recipes: {} });
    expect(out.rows[0]?.reason).toBe('missing-recipe');
  });

  // ── The reasons, and the lookups ───────────────────────────────────────────

  test('every reason a row can fail has a dictionary key to show for it', () => {
    const reasons = new Set<string>();
    const collect = (out: ported.RecipeCost): void => out.rows.forEach(r => { if (r.reason) reasons.add(r.reason); });

    collect(m.costRecipe(recipe({ ingredients: [
      row('Pinch', 1, { unit: 'pinch' }),
      row('Empty', 0, { refId: 'FLOUR' }),
      row('Free text', 100),
      row('Deleted', 100, { refId: 'NOPE' }),
      row('Unpriced', 100, { refId: 'SALT' }),
      row('Gone recipe', 100, { kind: 'recipe', refId: 'NOPE' }),
    ] }), { ingredients: INGREDIENTS, recipes: {} }));

    const loop = { id: 'LOOP', name: 'Loop', lossPct: 0, ingredients: [row('Itself', 100, { kind: 'recipe', refId: 'LOOP' })] };
    collect(m.costRecipe(loop, { ingredients: INGREDIENTS, recipes: { LOOP: loop } }));

    expect(reasons.size, `only saw ${[...reasons].join(', ')}`).toBeGreaterThanOrEqual(7);
    reasons.forEach(reason => {
      expect((m.COST_REASON_TEXT as Record<string, string>)[reason], `no wording for "${reason}"`).toBeTruthy();
    });
  });

  test('the dictionary keys of the reasons are the current app’s, in the order they are tested', () => {
    expect(Object.entries(m.COST_REASON_TEXT)).toStrictEqual([
      ['not-weighable', 'cat.notWeighedPiecesSpoons'],
      ['no-amount', 'cat.cost.noAmount'],
      ['not-linked', 'cat.cost.notLinked'],
      ['missing-ingredient', 'cat.cost.missingIngredient'],
      ['missing-recipe', 'cat.cost.missingRecipe'],
      ['no-price', 'cat.cost.noPrice'],
      ['sub-not-costable', 'cat.cost.subNotCostable'],
      ['cycle', 'cat.cost.cycle'],
      ['too-deep', 'cat.cost.tooDeep'],
    ]);
    expect(Object.isFrozen(m.COST_REASON_TEXT)).toBe(true);
    expect(m.MAX_RECIPE_DEPTH).toBe(4);
  });

  test('the lookup tables may be Maps as well as plain objects', () => {
    const r = recipe({ ingredients: [row('Flour', 1000, { refId: 'FLOUR' })] });
    const asMap = m.costRecipe(r, { ingredients: new Map([['FLOUR', INGREDIENTS['FLOUR']]]) });
    expect(asMap.pricePerKg).toBe(2);
  });

  test('missing tables do not throw — a screen that has not loaded yet is normal', () => {
    const r = recipe({ ingredients: [row('Flour', 1000, { refId: 'FLOUR' })] });
    expect(m.costRecipe(r).pricePerKg).toBe(null);
    expect(m.costRecipe(r, {}).pricePerKg).toBe(null);
    expect(m.costRecipe(null).pricePerKg).toBe(null);
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port against the original', () => {
  // The two functions that look a word up in the interface dictionary.
  const LEFT_OUT = ['costReasonLabel', 'partialCostText'];
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;
  const shared = Object.keys(original).filter(name => !LEFT_OUT.includes(name)).sort();

  test('the original still exports everything this port leaves out', () => {
    for (const name of LEFT_OUT) expect(typeof original[name], name).toBe('function');
  });

  test('exports exactly the same names, except those', () => {
    expect(Object.keys(port).sort()).toStrictEqual(shared);
  });

  test('every non-function export is strictly equal and frozen the same way', () => {
    for (const name of shared) {
      if (typeof original[name] === 'function') continue;
      expect(port[name], name).toStrictEqual(original[name]);
      expect(Object.isFrozen(port[name]), `${name}: frozen`).toBe(Object.isFrozen(original[name]));
    }
  });

  test('every function has the same name and the same number of required parameters', () => {
    for (const name of shared) {
      const mine = port[name];
      const theirs = original[name];
      if (typeof mine !== 'function' || typeof theirs !== 'function') continue;
      expect(mine.name, name).toBe(theirs.name);
      expect(mine.length, `${name}: arity`).toBe(theirs.length);
    }
  });
});
