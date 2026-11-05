// Unit tests for what a finished product costs to make and what share of its price that is (P15 — the
// owner cannot read code, so these tests are the safety net), run against BOTH implementations: the
// TypeScript port in shared/ and js/foodcost/foodcost-model.js, which the live app uses today. Ported from
// tests/foodcost-model.test.mjs, tests/foodcost-lines-and-packs.test.mjs,
// tests/foodcost-production-cost.test.mjs, tests/foodcost-labour.test.mjs, tests/foodcost-suggested-price.test.mjs,
// tests/foodcost-vat-country.test.mjs and tests/foodcost-from-recipe.test.mjs; the two must stay equal
// until the switch to Mise 2.
//
// The failure they exist to stop is a margin that reads BETTER than it is: VAT left in the price, packaging
// counted as weight, an unpriced recipe silently costing nothing.
//
// foodcost-model.ts is a PARTIAL port, so parity.spec.ts does not pair it: the original also exports
// `blockerText`, which looks a word up in the interface dictionary (`t()`); in Mise 2 the app resolves the
// BLOCKER_TEXT keys through its own typed i18n. The last block of this file stands in for what pairing
// would have checked: the same names, the same constants, the same frozen-ness, the same function shapes.
//
// PORTED, every test that runs the model: tests/foodcost-model.test.mjs (all 37), the model half of
// tests/foodcost-lines-and-packs.test.mjs (14 of 18), tests/foodcost-production-cost.test.mjs (10 of 12),
// tests/foodcost-labour.test.mjs (5 of 8), tests/foodcost-suggested-price.test.mjs (5 of 8),
// tests/foodcost-vat-country.test.mjs (6 of 8) and tests/foodcost-from-recipe.test.mjs (4 of 18).
//
// NOT PORTED, because they read a screen, firestore.rules, the store or the dictionary rather than run the
// model: from lines-and-packs '⚠️⚠️ every save carries the product model…' (rules and store source),
// '«Composto da» is one card…', 'the name suggests recipes only while…', '⚠️ ingredients offered to a
// product are never packaging…'; from production-cost 'the product screen draws it…' and '⚠️ the product
// list no longer writes «cost» and «margin» in English'; from labour '⚠️⚠️ the rate is watched…', 'the
// product screen draws labour money only…' and 'the bottom bar is the page ground…'; from suggested-price
// '⚠️ the editor draws the suggestion…', '⚠️⚠️ no money under a recipe line…' and 'every new word exists in
// both languages…'; from vat-country 'every choice has words in both languages…' and '⚠️ the editor asks
// the venue's country…'; from from-recipe the address, who-is-shown-the-button and wiring tests (recipe-link.js
// and the screens, not this model).

import { describe, expect, test } from 'vitest';
import * as ported from './foodcost-model';
import { COUNTRIES } from './market';
import * as legacyJs from '../../js/foodcost/foodcost-model.js';

const legacy = legacyJs as unknown as typeof ported;

type Doc = Record<string, unknown>;

const AT = '2026-08-10T09:00:00.000Z';
const AT_PACKS = '2026-09-13T09:00:00.000Z';

// £2/kg flour, £8/kg butter, a box at 12p each, and a bag priced by WEIGHT (which cannot be counted in
// pieces).
const INGREDIENTS: Record<string, Doc> = {
  FLOUR: { id: 'FLOUR', name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 },
  BUTTER: { id: 'BUTTER', name: 'Butter', priceUnit: 'kg', pricePerUnit: 8 },
  BOX: { id: 'BOX', name: 'Cake box', priceUnit: 'pcs', pricePerUnit: 0.12 },
  BAGS: { id: 'BAGS', name: 'Paper bags', priceUnit: 'kg', pricePerUnit: 3 },
  UNPRICED: { id: 'UNPRICED', name: 'Ribbon' },
  // Used by the ingredient-line tests: icing sugar £1.50/kg; chocolate buttons by the piece at 5p
  // weighing 2 g; eggs by the piece with no weight said; a tray at 20p.
  ICING: { id: 'ICING', name: 'Icing sugar', priceUnit: 'kg', pricePerUnit: 1.5 },
  BUTTON: { id: 'BUTTON', name: 'Chocolate button', priceUnit: 'pcs', pricePerUnit: 0.05, unitWeightKg: 0.002 },
  EGG: { id: 'EGG', name: 'Egg', priceUnit: 'pcs', pricePerUnit: 0.3 },
  NOPRICE: { id: 'NOPRICE', name: 'Sprinkles' },
  TRAY: { id: 'TRAY', name: 'Tray', priceUnit: 'pcs', pricePerUnit: 0.2, kind: 'packaging' },
};

// £3.20 per 1000 g → £3.20/kg. No weight lost.
const DOUGH: Doc = {
  id: 'DOUGH', name: 'Dough', lossPct: 0,
  ingredients: [
    { label: 'Flour', grams: 800, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Butter', grams: 200, unit: 'g', kind: 'ingredient', refId: 'BUTTER' },
  ],
};
const UNPRICED_RECIPE: Doc = {
  id: 'MYSTERY', name: 'Mystery', lossPct: 0,
  ingredients: [{ label: 'Something', grams: 500, unit: 'g' }],
};
const HALF: Doc = {
  id: 'HALF', name: 'Half', lossPct: 0,
  ingredients: [
    { label: 'Flour', grams: 500, unit: 'g', kind: 'ingredient', refId: 'FLOUR' },
    { label: 'Mystery', grams: 500, unit: 'g' },
  ],
};
const TABLES: ported.CostTables = { ingredients: INGREDIENTS, recipes: { DOUGH, MYSTERY: UNPRICED_RECIPE, HALF } };

const product = (over: Doc = {}): Doc => ({
  id: 'P1', name: 'Test product',
  components: [{ recipeId: 'DOUGH', qtyKg: 10 }],
  packaging: [],
  sellingMode: 'piece', piecesPerBatch: 100,
  sellingPrice: 1.20, vatRate: 20, foodCostTarget: 30,
  ...over,
});

// The labour tests' product and tables.
const labourProduct = (over: Doc = {}): Doc => product({ name: 'Cornetto', labourMinutes: 90, labourPeople: 2, ...over });
const withRate = (rate: number | null): ported.CostTables => ({ ingredients: INGREDIENTS, recipes: { DOUGH }, labourCostPerHour: rate });

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const rates = (country: unknown): number[] => m.vatRatesFor(country).map(choice => choice.rate);

  // ── VAT ────────────────────────────────────────────────────────────────────

  test('the food cost is worked out on the price WITHOUT VAT', () => {
    // £1.20 at 20% is £1.00 net. Leaving the VAT in would make every margin look better than it is, by
    // exactly the VAT rate.
    expect(m.netPrice(1.2, 20)).toBe(1);
    expect(m.netPrice(1.05, 5)).toBe(1);
  });

  test('zero-rated is a real answer, and leaves the price alone', () => {
    // Most takeaway bakery in the UK is zero-rated. Anything treating 0 as "not filled in" would refuse to
    // cost the bakery's main line.
    expect(m.netPrice(1.2, 0)).toBe(1.2);
    expect(m.zeroOrMore(0)).toBe(0);
    expect(m.zeroOrMore('')).toBe(null);
    expect(m.zeroOrMore(null)).toBe(null);
    expect(m.zeroOrMore(-1)).toBe(null);
    expect(rates('GB')).toStrictEqual([20, 5, 0]);
  });

  test('a missing price or rate produces no net price at all', () => {
    expect(m.netPrice(null, 20)).toBe(null);
    expect(m.netPrice(1.2, null)).toBe(null);
    expect(m.netPrice(0, 20)).toBe(null);
    expect(m.netPrice('nonsense', 20)).toBe(null);
  });

  // ── The batch ──────────────────────────────────────────────────────────────

  test('a batch costs the sum of its recipes, and weighs what they weigh', () => {
    const out = m.batchTotals(product(), TABLES);
    expect(out.cost).toBe(32);   // 10 kg of £3.20/kg dough
    expect(out.kg).toBe(10);
    expect(out.partial).toBe(false);
  });

  test('⚠️ packaging is counted PER UNIT SOLD: it adds to each piece, not to the batch', () => {
    // Federico, 13 Sep 2026: «per pezzo o confezione ma togli infornata non ha senso». One box per piece:
    // £0.32 of dough + £0.12 of box. The batch itself is untouched.
    const boxed = product({ packaging: [{ ingredientId: 'BOX', qtyPcs: 1 }] });
    expect(m.batchTotals(boxed, TABLES).cost, 'the batch holds recipes and ingredients only').toBe(32);
    expect(m.packagingPerUnit(boxed, TABLES).cost).toBe(0.12);
    expect(m.costProduct(boxed, TABLES).unitCost).toBe(0.44);
  });

  test('packaging adds cost but NOT weight', () => {
    // A box is not part of what is sold by the kilo. Counting it would make the product look heavier and
    // cheaper per kilo than it is.
    const out = m.batchTotals(product({ packaging: [{ ingredientId: 'BOX', qtyPcs: 100 }] }), TABLES);
    expect(out.kg, 'the boxes must not add weight').toBe(10);
    const byWeight = m.costProduct(product({
      sellingMode: 'weight', sellingPrice: 12, piecesPerBatch: null, packaging: [{ ingredientId: 'BOX', qtyPcs: 1 }],
    }), TABLES);
    expect(byWeight.unitCost, '£3.20 a kilo of dough, plus one box for every kilo sold').toBe(3.32);
  });

  test('packaging priced by weight cannot be counted in pieces', () => {
    // "3 bags" of something bought per kilo means nothing, so it is left out and named rather than
    // guessed at.
    const out = m.packagingPerUnit(product({ packaging: [{ ingredientId: 'BAGS', qtyPcs: 1 }] }), TABLES);
    expect(out.cost).toBe(0);
    expect(out.partial).toBe(true);
    expect(out.rows.at(-1)?.reason).toBe('no-piece-price');
    expect(m.costProduct(product({ packaging: [{ ingredientId: 'BAGS', qtyPcs: 1 }] }), TABLES).partial,
      'and the answer says it is too low').toBe(true);
  });

  test('an unpriced recipe is left out of the cost and named', () => {
    const out = m.batchTotals(product({
      components: [{ recipeId: 'DOUGH', qtyKg: 10 }, { recipeId: 'MYSTERY', qtyKg: 5 }],
    }), TABLES);
    expect(out.cost).toBe(32);
    expect(out.kg, 'an uncosted recipe must not add weight either').toBe(10);
    expect(out.partial).toBe(true);
    expect(out.rows[1]?.reason).toBe('no-recipe-cost');
  });

  test('a recipe that no longer exists is named, not skipped silently', () => {
    const out = m.batchTotals(product({ components: [{ recipeId: 'GONE', qtyKg: 1 }] }), TABLES);
    expect(out.partial).toBe(true);
    expect(out.rows[0]?.reason).toBe('missing-recipe');
  });

  test('a PARTLY priced recipe makes the product partly priced too', () => {
    const out = m.batchTotals(product({ components: [{ recipeId: 'HALF', qtyKg: 1 }] }),
      { ingredients: INGREDIENTS, recipes: { HALF } });
    expect(out.cost).toBeGreaterThan(0);
    expect(out.partial, 'the doubt must not vanish one level up').toBe(true);
  });

  // ── Sold by the piece ──────────────────────────────────────────────────────

  test('sold by the piece: the batch is divided by what comes out of it', () => {
    // £32 over 100 pieces = £0.32 each, against £1.00 net → 32%.
    const out = m.costProduct(product(), TABLES);
    expect(out.unitCost).toBe(0.32);
    expect(out.netUnitPrice).toBe(1);
    expect(out.foodCostPct).toBe(32);
    expect(out.margin).toBe(0.68);
    expect(out.blockers).toStrictEqual([]);
  });

  test('sold by the piece, zero-rated: the gross price IS the net price', () => {
    const out = m.costProduct(product({ vatRate: 0 }), TABLES);
    expect(out.netUnitPrice).toBe(1.2);
    expect(out.foodCostPct).toBe(26.67);
  });

  // ── Sold by weight ─────────────────────────────────────────────────────────

  test('sold by weight: the answer is the cost per kilo against the price per kilo', () => {
    // £32 over 10 kg = £3.20/kg, against £12.00 gross at 20% = £10.00 net → 32%.
    const out = m.costProduct(product({ sellingMode: 'weight', sellingPrice: 12, piecesPerBatch: null }), TABLES);
    expect(out.unitCost).toBe(3.2);
    expect(out.netUnitPrice).toBe(10);
    expect(out.foodCostPct).toBe(32);
  });

  test('sold by weight, the pieces-per-batch field is irrelevant and not required', () => {
    const out = m.costProduct(product({ sellingMode: 'weight', sellingPrice: 12, piecesPerBatch: null }), TABLES);
    expect(out.blockers.includes('no-pieces')).toBe(false);
  });

  test('the weight lost by a recipe is already inside the price it contributes', () => {
    // A dough at 25% loss costs 4/3 as much per kilo of finished product, and the product must inherit
    // that without doing the arithmetic a second time.
    const baked = { ...DOUGH, id: 'BAKED', lossPct: 25 };
    const out = m.costProduct(product({ components: [{ recipeId: 'BAKED', qtyKg: 10 }] }),
      { ingredients: INGREDIENTS, recipes: { BAKED: baked } });
    expect(out.unitCost).toBe(0.4267);   // £3.20/0.75 = £4.2667/kg × 10 kg / 100
  });

  // ── What is missing ────────────────────────────────────────────────────────

  test('a product that cannot be costed says what to fill in, and shows no number', () => {
    const bare = m.costProduct({ id: 'P', name: 'New product' }, TABLES);
    expect(bare.foodCostPct, 'never 0 — that reads as costing nothing').toBe(null);
    expect(bare.blockers).toContain('no-components');
    expect(bare.blockers).toContain('no-selling-mode');
    expect(bare.blockers).toContain('no-vat');
    expect(bare.blockers).toContain('no-price');
  });

  test('each blocker names one thing to go and do', () => {
    const cases: [Doc, string][] = [
      [{ components: [] }, 'no-components'],
      [{ sellingMode: null }, 'no-selling-mode'],
      [{ sellingMode: 'piece', piecesPerBatch: null }, 'no-pieces'],
      [{ sellingMode: 'pack', packSize: null, packUnit: null }, 'no-pack-size'],
      [{ vatRate: null }, 'no-vat'],
      [{ sellingPrice: null }, 'no-price'],
    ];
    cases.forEach(([over, expected]) => {
      const out = m.costProduct(product(over), TABLES);
      expect(out.blockers, `${expected} not raised for ${JSON.stringify(over)}`).toContain(expected);
    });
    (Object.keys(m.BLOCKER_TEXT) as (keyof typeof m.BLOCKER_TEXT)[]).forEach(key => {
      expect(m.BLOCKER_TEXT[key].length, key).toBeGreaterThan(10);
    });
  });

  test('components that exist but cost nothing is its own reason', () => {
    // Not "no components" — they are there, they are simply unpriced, and telling someone to add
    // components they can see would be nonsense.
    const out = m.costProduct(product({ components: [{ recipeId: 'MYSTERY', qtyKg: 5 }] }), TABLES);
    expect(out.blockers.includes('no-components')).toBe(false);
    expect(out.blockers).toContain('no-recipe-cost');
  });

  test('sold by weight with no weight cannot be divided', () => {
    const out = m.costProduct(product({
      sellingMode: 'weight', sellingPrice: 12,
      components: [{ recipeId: 'DOUGH', qtyKg: 0 }],
      packaging: [{ ingredientId: 'BOX', qtyPcs: 10 }],
    }), TABLES);
    expect(out.blockers).toContain('no-weight');
    expect(out.foodCostPct).toBe(null);
  });

  // ── The traffic light ──────────────────────────────────────────────────────

  test('green at or under the target, amber just over, red beyond', () => {
    expect(m.statusFor(28, 30)).toBe('green');
    expect(m.statusFor(30, 30)).toBe('green');
    expect(m.statusFor(32, 30)).toBe('amber');
    expect(m.statusFor(33, 30)).toBe('amber');       // exactly 30 × 1.1
    expect(m.statusFor(33.01, 30)).toBe('red');
    expect(m.AMBER_MULTIPLIER).toBe(1.1);
  });

  test('the amber band is proportional, so a low target is not stricter by accident', () => {
    expect(m.statusFor(12.5, 12)).toBe('amber');     // 12 → amber up to 13.2
    expect(m.statusFor(36, 35)).toBe('amber');       // 35 → amber up to 38.5
  });

  test('a product with no target has no colour, because nobody set a standard', () => {
    expect(m.statusFor(32, null)).toBe(null);
    expect(m.statusFor(32, 0)).toBe(null);
    expect(m.costProduct(product({ foodCostTarget: null }), TABLES).status).toBe(null);
  });

  // ── The list ───────────────────────────────────────────────────────────────

  test('the worst margin comes first — that is why the screen is opened', () => {
    const products = [
      product({ id: 'A', name: 'Cheap', sellingPrice: 2.4 }),      // 16%
      product({ id: 'B', name: 'Dear', sellingPrice: 0.6 }),       // 64%
      product({ id: 'C', name: 'Middle', sellingPrice: 1.2 }),     // 32%
    ];
    const order = m.sortByMargin(products, TABLES).map(r => r.product['id']);
    expect(order).toStrictEqual(['B', 'C', 'A']);
  });

  test('products that cannot be costed sort LAST, not first', () => {
    // They are a data-entry job, not a margin problem. At the top they would bury the answer the screen
    // exists to give.
    const products = [
      { id: 'X', name: 'Half filled in' },
      product({ id: 'B', name: 'Dear', sellingPrice: 0.6 }),
    ];
    expect(m.sortByMargin(products, TABLES).map(r => r.product['id'])).toStrictEqual(['B', 'X']);
  });

  test('sorting never throws on junk', () => {
    expect(m.sortByMargin(null)).toStrictEqual([]);
    expect(m.sortByMargin([null, undefined], TABLES).length).toBe(2);
  });

  // ── Normalisation ──────────────────────────────────────────────────────────

  test('missing values stay missing, never become zero', () => {
    // "No VAT rate chosen" and "zero-rated" are different answers, and only one of them can be costed.
    const out = m.normalizeProduct({ id: 'P', name: ' Cake ' }) as ported.Product;
    expect(out.name).toBe('Cake');
    expect(out.vatRate).toBe(null);
    expect(out.sellingPrice).toBe(null);
    expect(out.sellingMode).toBe(null);
    expect(out.packSize).toBe(null);
    expect(out.packUnit).toBe(null);
    expect(out.model).toBe(null);
    expect(out.components).toStrictEqual([]);
  });

  test('a stored zero VAT rate survives normalisation', () => {
    expect(m.normalizeProduct({ vatRate: 0 })?.vatRate).toBe(0);
  });

  test('junk rows are dropped rather than producing NaN', () => {
    const out = m.normalizeProduct({
      components: [{ recipeId: 'A', qtyKg: 'x' }, { qtyKg: 1 }, null, 'nonsense'],
      packaging: [{ ingredientId: 'B', qtyPcs: -3 }],
      sellingMode: 'nonsense',
    }) as ported.Product;
    expect(out.components).toStrictEqual([{ recipeId: 'A', qtyKg: 0 }]);
    expect(out.packaging).toStrictEqual([{ ingredientId: 'B', qtyPcs: 0 }]);
    expect(out.sellingMode).toBe(null);
    expect([...m.SELLING_MODES]).toStrictEqual(['piece', 'weight', 'pack']);
    expect(m.isSellingMode('piece')).toBe(true);
    expect(m.isSellingMode('pack')).toBe(true);
    expect(m.isSellingMode('pezzo')).toBe(false);
  });

  test('normalising a list drops what is not an object', () => {
    expect(m.normalizeProducts([{ id: 'A' }, null, 5]).length).toBe(1);
    expect(m.normalizeProducts('nonsense')).toStrictEqual([]);
  });

  test('costing never throws on missing tables', () => {
    expect(m.costProduct(product()).foodCostPct).toBe(null);
    expect(m.costProduct(null).foodCostPct).toBe(null);
    expect(m.costProduct(product(), {}).foodCostPct).toBe(null);
  });

  // ── Snapshots ──────────────────────────────────────────────────────────────

  test('the first save is a point on the series', () => {
    expect(m.snapshotWorthTaking(null, product())).toBe(true);
  });

  test('a price change, a VAT change and a composition change are all recorded', () => {
    const before = product();
    expect(m.snapshotWorthTaking(before, product({ sellingPrice: 1.4 }))).toBe(true);
    expect(m.snapshotWorthTaking(before, product({ vatRate: 0 }))).toBe(true);
    expect(m.snapshotWorthTaking(before, product({ piecesPerBatch: 90 }))).toBe(true);
    expect(m.snapshotWorthTaking(before, product({ sellingMode: 'weight' }))).toBe(true);
    expect(m.snapshotWorthTaking(before, product({
      components: [{ recipeId: 'DOUGH', qtyKg: 12 }],
    }))).toBe(true);
    expect(m.snapshotWorthTaking(before, product({
      packaging: [{ ingredientId: 'BOX', qtyPcs: 100 }],
    }))).toBe(true);
  });

  test('renaming a product records nothing', () => {
    // A history full of non-events cannot answer "when did this change?".
    expect(m.snapshotWorthTaking(product(), product({ name: 'Renamed' }))).toBe(false);
    expect(m.snapshotWorthTaking(product(), product({ foodCostTarget: 25 }))).toBe(false);
  });

  test('reordering the same components is not a change', () => {
    const a = product({ components: [{ recipeId: 'A', qtyKg: 1 }, { recipeId: 'B', qtyKg: 2 }] });
    const b = product({ components: [{ recipeId: 'B', qtyKg: 2 }, { recipeId: 'A', qtyKg: 1 }] });
    expect(m.snapshotWorthTaking(a, b)).toBe(false);
  });

  test('a snapshot freezes the VAT rate as well as the answer', () => {
    // Rates change by law. Without freezing it, every past margin would silently be recomputed against
    // today's rate and the series would stop being comparable.
    const result = m.costProduct(product(), TABLES);
    const snap = m.productSnapshot(product(), result, AT, TABLES);
    expect(snap.vatRate).toBe(20);
    expect(snap.sellingPrice).toBe(1.2);
    expect(snap.foodCostPct).toBe(32);
    expect(snap.unitCost).toBe(0.32);
    expect(snap.recordedAt).toBe(AT);
  });

  test('a snapshot freezes the ingredient prices behind the answer, through the recipes', () => {
    // Two levels down: the product names a recipe, the recipe names the ingredients. Without walking it, a
    // change that came from inside a recipe could not be explained six months later.
    const snap = m.productSnapshot(product({ packaging: [{ ingredientId: 'BOX', qtyPcs: 1 }] }),
      m.costProduct(product(), TABLES), AT, TABLES);
    expect(snap.frozenPrices['FLOUR']).toBe(2);
    expect(snap.frozenPrices['BUTTER']).toBe(8);
    expect(snap.frozenPrices['BOX']).toBe(0.12);
  });

  test('freezing prices survives a recipe that contains itself', () => {
    const loop = {
      id: 'LOOP', name: 'Loop', lossPct: 0,
      ingredients: [{ label: 'Itself', grams: 100, unit: 'g', kind: 'recipe', refId: 'LOOP' }],
    };
    const snap = m.productSnapshot(product({ components: [{ recipeId: 'LOOP', qtyKg: 1 }] }),
      { unitCost: null, foodCostPct: null }, AT, { ingredients: INGREDIENTS, recipes: { LOOP: loop } });
    expect(snap.frozenPrices).toStrictEqual({});
  });

  // ── Ingredients added straight to a product ───────────────────────────────

  test('an ingredient line in grams adds its cost AND its weight to the batch', () => {
    const out = m.batchTotals(product({ components: [
      { recipeId: 'DOUGH', qtyKg: 10 },
      { kind: 'ingredient', ingredientId: 'ICING', qty: 200, unit: 'g' },
    ] }), TABLES);
    expect(out.cost, '£32 of dough + 0.2 kg of £1.50/kg icing sugar').toBe(32.3);
    expect(out.kg).toBe(10.2);
    expect(out.partial).toBe(false);
    expect(out.rows[1]?.kind).toBe('ingredient');
  });

  test('…in kilos, the same', () => {
    const line = m.ingredientLineCost({ qty: 0.2, unit: 'kg' }, INGREDIENTS['ICING']);
    expect(line).toStrictEqual({ cost: 0.3, kg: 0.2, reason: null });
  });

  test('…in pieces, bought by the piece: the price each, and the weight if it is known', () => {
    expect(m.ingredientLineCost({ qty: 100, unit: 'pcs' }, INGREDIENTS['BUTTON'])).toStrictEqual({ cost: 5, kg: 0.2, reason: null });
    expect(m.ingredientLineCost({ qty: 10, unit: 'pcs' }, INGREDIENTS['EGG']),
      'an egg with no weight said still costs what it costs; it only adds no weight').toStrictEqual({ cost: 3, kg: 0, reason: null });
  });

  test('⚠️ a line that cannot be costed adds no weight, marks the batch partial, and says why', () => {
    expect(m.ingredientLineCost({ qty: 50, unit: 'g' }, INGREDIENTS['NOPRICE']).reason).toBe('no-ingredient-price');
    expect(m.ingredientLineCost({ qty: 50, unit: 'g' }, INGREDIENTS['EGG']).reason,
      'grams of something bought by the piece need what one piece weighs').toBe('no-piece-weight');
    expect(m.ingredientLineCost({ qty: 5, unit: 'pcs' }, INGREDIENTS['ICING']).reason,
      'pieces of something bought by weight need what one piece weighs').toBe('no-piece-price');
    const out = m.batchTotals(product({ components: [
      { recipeId: 'DOUGH', qtyKg: 10 },
      { kind: 'ingredient', ingredientId: 'NOPRICE', qty: 50, unit: 'g' },
      { kind: 'ingredient', ingredientId: 'GONE', qty: 50, unit: 'g' },
    ] }), TABLES);
    expect(out.cost).toBe(32);
    expect(out.kg, 'the unpriced sprinkles weigh nothing here').toBe(10);
    expect(out.partial).toBe(true);
    expect(out.rows.slice(1).map(r => r.reason)).toStrictEqual(['no-ingredient-price', 'missing-ingredient']);
  });

  test('a product can be made of ingredients alone, and is costed', () => {
    const p = product({ components: [{ kind: 'ingredient', ingredientId: 'BUTTON', qty: 1000, unit: 'pcs' }] });
    expect(m.costProduct(p, TABLES).unitCost, '1000 buttons at 5p over 100 pieces').toBe(0.5);
  });

  test('⚠️ the recipe line keeps its old shape exactly, so a product saved before is read — and written — unchanged', () => {
    const out = m.normalizeProduct({ components: [
      { recipeId: 'DOUGH', qtyKg: 10 },
      { kind: 'ingredient', ingredientId: 'ICING', qty: '200', unit: 'g' },
      { kind: 'ingredient', ingredientId: 'ICING', qty: -1, unit: 'lb' },
      { kind: 'ingredient', qty: 5 },
    ] }) as ported.Product;
    expect(out.components, 'junk is safe, a line with no ingredient is dropped, and the recipe line has no `kind`').toStrictEqual([
      { recipeId: 'DOUGH', qtyKg: 10 },
      { kind: 'ingredient', ingredientId: 'ICING', qty: 200, unit: 'g' },
      { kind: 'ingredient', ingredientId: 'ICING', qty: 0, unit: 'g' },
    ]);
    expect([...m.LINE_UNITS]).toStrictEqual(['g', 'kg', 'pcs']);
  });

  // ── Sold by the pack ───────────────────────────────────────────────────────

  test('a pack that holds a WEIGHT: the batch cost per kilo, times what one pack holds', () => {
    // 10 kg at £3.20/kg; a 250 g pack costs £0.80, plus its tray.
    const p = product({
      sellingMode: 'pack', packSize: 250, packUnit: 'g', piecesPerBatch: null, sellingPrice: 3,
      packaging: [{ ingredientId: 'TRAY', qtyPcs: 1 }],
    });
    expect(m.unitsPerBatch(m.normalizeProduct(p), m.batchTotals(p, TABLES))).toBe(40);
    const out = m.costProduct(p, TABLES);
    expect(out.unitCost, '£0.80 of dough + £0.20 tray').toBe(1);
    expect(m.productionCost(p, TABLES).unit).toBe('pack');
    expect(m.productionCost(p, TABLES).batchCost, '£32 of dough + 40 trays').toBe(40);
    expect(m.costProduct(product({ sellingMode: 'pack', packSize: 0.25, packUnit: 'kg', piecesPerBatch: null }), TABLES).unitCost,
      'the same pack said in kilos').toBe(0.8);
  });

  test('a pack that holds PIECES: the cost of a piece, times how many are in the pack', () => {
    const p = product({ sellingMode: 'pack', packSize: 6, packUnit: 'pcs', piecesPerBatch: 100 });
    expect(m.costProduct(p, TABLES).unitCost, '£0.32 a piece × 6').toBe(1.92);
  });

  test('⚠️ a pack says what is missing: its size, or — in pieces — how many pieces a batch makes', () => {
    expect(m.costProduct(product({ sellingMode: 'pack', packSize: null, packUnit: 'g' }), TABLES).blockers).toContain('no-pack-size');
    expect(m.costProduct(product({ sellingMode: 'pack', packSize: 250, packUnit: null }), TABLES).blockers).toContain('no-pack-size');
    expect(m.costProduct(product({ sellingMode: 'pack', packSize: 6, packUnit: 'pcs', piecesPerBatch: null }), TABLES).blockers).toContain('no-pieces');
    const noWeight = m.costProduct(product({ sellingMode: 'pack', packSize: 250, packUnit: 'g', components: [{ recipeId: 'DOUGH', qtyKg: 0 }] }), TABLES);
    expect(noWeight.blockers, 'a weight pack of a batch that weighs nothing cannot be divided').toContain('no-weight');
    expect(m.productionCost(product({ sellingMode: 'pack', packSize: null, packUnit: null }), TABLES).unitCost).toBe(null);
    expect([...m.PACK_UNITS]).toStrictEqual(['g', 'kg', 'pcs']);
  });

  test('junk in a pack is not a pack', () => {
    const out = m.normalizeProduct({ sellingMode: 'pack', packSize: '-3', packUnit: 'box' }) as ported.Product;
    expect(out.packSize).toBe(null);
    expect(out.packUnit).toBe(null);
  });

  test('⚠️⚠️ the production cost and the food cost divide by the SAME number, in every way of selling', () => {
    const cases = [
      product({
        components: [{ recipeId: 'DOUGH', qtyKg: 10 }, { kind: 'ingredient', ingredientId: 'ICING', qty: 150, unit: 'g' }],
        packaging: [{ ingredientId: 'TRAY', qtyPcs: 2 }],
      }),
      product({ sellingMode: 'weight', sellingPrice: 12, piecesPerBatch: null, packaging: [{ ingredientId: 'TRAY', qtyPcs: 1 }] }),
      product({ sellingMode: 'pack', packSize: 300, packUnit: 'g', sellingPrice: 4, packaging: [{ ingredientId: 'TRAY', qtyPcs: 1 }] }),
      product({ sellingMode: 'pack', packSize: 4, packUnit: 'pcs', sellingPrice: 4 }),
    ];
    for (const p of cases) {
      const full = m.costProduct(p, TABLES);
      expect(full.unitCost, JSON.stringify(full.blockers)).not.toBe(null);
      expect(m.productionCost(p, TABLES).unitCost).toBe(full.unitCost);
    }
  });

  test('changing an ingredient line, or the pack, is a change worth a margin point', () => {
    const before = product({ components: [{ recipeId: 'DOUGH', qtyKg: 10 }, { kind: 'ingredient', ingredientId: 'ICING', qty: 200, unit: 'g' }] });
    const [first, second] = before['components'] as Doc[];
    expect(m.snapshotWorthTaking(before, { ...before, components: [first, { ...second, qty: 250 }] })).toBe(true);
    expect(m.snapshotWorthTaking(before, { ...before, components: [first, { ...second, unit: 'kg' }] })).toBe(true);
    const pack = product({ sellingMode: 'pack', packSize: 250, packUnit: 'g' });
    expect(m.snapshotWorthTaking(pack, { ...pack, packSize: 300 })).toBe(true);
    expect(m.snapshotWorthTaking(pack, { ...pack, packUnit: 'kg' })).toBe(true);
    expect(m.snapshotWorthTaking(pack, { ...pack })).toBe(false);
  });

  test('a snapshot freezes the price of an ingredient added straight to the product', () => {
    const p = product({
      components: [{ recipeId: 'DOUGH', qtyKg: 10 }, { kind: 'ingredient', ingredientId: 'ICING', qty: 200, unit: 'g' },
        { kind: 'ingredient', ingredientId: 'EGG', qty: 2, unit: 'pcs' }],
    });
    const snap = m.productSnapshot(p, m.costProduct(p, TABLES), AT_PACKS, TABLES);
    expect(snap.frozenPrices['ICING']).toBe(1.5);
    expect(snap.frozenPrices['EGG'], 'bought by the piece and weight unknown: the price of one').toBe(0.3);
    expect(snap.frozenPrices['FLOUR'], 'and the recipe is still walked').toBe(2);
  });

  test('an ingredient line is never taken for a recipe', () => {
    const products = [product({ id: 'A', components: [{ kind: 'ingredient', ingredientId: 'DOUGH', qty: 1, unit: 'kg' }] })];
    expect(m.productsUsingRecipe(products, 'DOUGH'), 'an ingredient that shares an id is not the recipe').toStrictEqual([]);
    const draft = m.draftFromRecipe({ id: 'DOUGH', name: 'Dough' }) as ported.ProductDraft;
    expect(draft.packSize).toBe(null);
    expect(draft.packUnit).toBe(null);
  });

  test('the product model is 2, and the units are the closed lists the rules know', () => {
    expect(m.PRODUCT_MODEL).toBe(2);
    expect(Object.isFrozen(m.SELLING_MODES) && Object.isFrozen(m.PACK_UNITS) && Object.isFrozen(m.LINE_UNITS)).toBe(true);
  });

  // ── The production cost on its own ─────────────────────────────────────────

  test('sold by the piece: what one piece costs, and what the whole batch costs', () => {
    const out = m.productionCost(product(), TABLES);
    expect(out.batchCost).toBe(32);      // 10 kg of £3.20/kg dough
    expect(out.unitCost).toBe(0.32);     // over 100 pieces
    expect(out.unit).toBe('piece');
    expect(out.partial).toBe(false);
  });

  test('⚠️ it answers with NO selling price and NO VAT — the whole point of it', () => {
    // A product being built has neither yet, and that is exactly when somebody wants to know what it
    // costs. The food cost % rightly still refuses.
    const bare = product({ sellingPrice: null, vatRate: null, foodCostTarget: null });
    const out = m.productionCost(bare, TABLES);
    expect(out.unitCost).toBe(0.32);
    expect(out.batchCost).toBe(32);
    expect(m.costProduct(bare, TABLES).foodCostPct, 'the food cost still needs a price').toBe(null);
  });

  test('sold by weight: what a kilo costs', () => {
    const out = m.productionCost(product({ sellingMode: 'weight', piecesPerBatch: null }), TABLES);
    expect(out.unitCost).toBe(3.2);
    expect(out.unit).toBe('kg');
    expect(out.batchCost).toBe(32);
  });

  test('packaging adds to the cost of each unit SOLD, and to the whole batch once the units are known', () => {
    // One box per piece (Federico, 13 Sep 2026: packaging is per piece or per pack, never per batch):
    // £0.32 + £0.12 a piece, and 100 boxes on the whole batch.
    const boxed = m.productionCost(product({ packaging: [{ ingredientId: 'BOX', qtyPcs: 1 }] }), TABLES);
    expect(boxed.unitCost).toBe(0.44);
    expect(boxed.batchCost).toBe(44);
    const byWeight = m.productionCost(product({
      sellingMode: 'weight', piecesPerBatch: null, packaging: [{ ingredientId: 'BOX', qtyPcs: 1 }],
    }), TABLES);
    expect(byWeight.unitCost, 'one box per kilo sold — and the boxes weigh nothing here').toBe(3.32);
    expect(byWeight.batchCost, '£32 of dough and 10 boxes for its 10 kilos').toBe(33.2);
  });

  test('⚠️ packaging that cannot be multiplied out yet leaves the batch figure too LOW, and says so', () => {
    const out = m.productionCost(product({ sellingMode: null, packaging: [{ ingredientId: 'BOX', qtyPcs: 1 }] }), TABLES);
    expect(out.batchCost, 'the dough alone').toBe(32);
    expect(out.partial, 'nobody has said how many units there are to box').toBe(true);
  });

  test('no way of selling chosen, or no pieces said: the batch alone, and no unit', () => {
    for (const over of [{ sellingMode: null }, { sellingMode: 'piece', piecesPerBatch: null }]) {
      const out = m.productionCost(product(over), TABLES);
      expect(out.batchCost).toBe(32);
      expect(out.unitCost, 'a division by nothing is not a cost').toBe(null);
      expect(out.unit, 'and a unit without its number would mislabel the batch').toBe(null);
    }
  });

  test('⚠️ nothing priced, or nothing in it: NO cost, never a cost of zero', () => {
    // «€0.00» reads as a product that costs nothing to make.
    for (const over of [{ components: [{ recipeId: 'MYSTERY', qtyKg: 5 }] }, { components: [] }, { components: [{ recipeId: 'GONE', qtyKg: 1 }] }]) {
      const out = m.productionCost(product(over), TABLES);
      expect(out.batchCost).toBe(null);
      expect(out.unitCost).toBe(null);
    }
    expect(m.productionCost(null, TABLES).batchCost).toBe(null);
  });

  test('⚠️ a partly priced product says so, because its cost is too LOW', () => {
    const out = m.productionCost(product({ components: [{ recipeId: 'HALF', qtyKg: 1 }] }), TABLES);
    expect(out.batchCost as number).toBeGreaterThan(0);
    expect(out.partial).toBe(true);
  });

  test('the oven loss is already inside it, exactly as in the food cost', () => {
    const baked = { ...DOUGH, id: 'BAKED', lossPct: 25 };
    const tables = { ingredients: INGREDIENTS, recipes: { BAKED: baked } };
    const p = product({ components: [{ recipeId: 'BAKED', qtyKg: 10 }] });
    expect(m.productionCost(p, tables).unitCost).toBe(0.4267);
  });

  test('⚠️⚠️ it is the SAME number the food cost % is built from', () => {
    // Two divisions that drift would put one cost on top of the screen and another inside the percentage
    // under it, with nothing to say which is right.
    const cases = [
      product(),
      product({ sellingMode: 'weight', sellingPrice: 12, piecesPerBatch: null }),
      product({ packaging: [{ ingredientId: 'BOX', qtyPcs: 37 }], piecesPerBatch: 7 }),
      product({ components: [{ recipeId: 'HALF', qtyKg: 3 }, { recipeId: 'DOUGH', qtyKg: 1.7 }] }),
    ];
    for (const p of cases) {
      const full = m.costProduct(p, TABLES);
      expect(full.unitCost, 'every case here is fully filled in').not.toBe(null);
      expect(m.productionCost(p, TABLES).unitCost).toBe(full.unitCost);
    }
  });

  // ── The work on a product (labour) ─────────────────────────────────────────

  test('the work on a batch: minutes × people × the hourly cost', () => {
    expect(m.labourBatchCost(labourProduct(), withRate(14)), '90 minutes, 2 people, £14 an hour').toBe(42);
    expect(m.labourBatchCost(labourProduct({ labourPeople: null }), withRate(14)), 'nobody said how many: one person').toBe(21);
  });

  test('⚠️ no time, or no rate, is NO labour cost — never a cost of zero', () => {
    expect(m.labourBatchCost(labourProduct({ labourMinutes: null }), withRate(14))).toBe(null);
    expect(m.labourBatchCost(labourProduct(), withRate(null)), 'an employee has no rate, so no labour figure at all').toBe(null);
    expect(m.labourBatchCost(labourProduct(), { ingredients: INGREDIENTS, recipes: { DOUGH } })).toBe(null);
    expect(m.productionCost(labourProduct(), withRate(null)).labourUnitCost).toBe(null);
    expect(m.costProduct(labourProduct(), withRate(null)).labourPct).toBe(null);
  });

  test('one unit’s labour is divided by the same number as its materials', () => {
    const piece = m.productionCost(labourProduct(), withRate(14));
    expect(piece.unitCost).toBe(0.32);
    expect(piece.labourUnitCost, '£42 over 100 pieces').toBe(0.42);
    expect(piece.totalUnitCost).toBe(0.74);
    const kilo = m.productionCost(labourProduct({ sellingMode: 'weight', piecesPerBatch: null }), withRate(14));
    expect(kilo.labourUnitCost, '£42 over 10 kg').toBe(4.2);
    const pack = m.productionCost(labourProduct({ sellingMode: 'pack', packSize: 500, packUnit: 'g', piecesPerBatch: null }), withRate(14));
    expect(pack.labourUnitCost, '£42 over 20 packs of 500 g').toBe(2.1);
  });

  test('⚠️⚠️ labour never moves the food cost %: it is shown beside it', () => {
    const without = m.costProduct(labourProduct({ labourMinutes: null }), withRate(14));
    const withIt = m.costProduct(labourProduct(), withRate(14));
    expect(withIt.foodCostPct, 'the food cost is what the ingredients take, and nothing else').toBe(without.foodCostPct);
    expect(withIt.status, 'and so is the traffic light').toBe(without.status);
    expect(withIt.labourPct, '£0.42 of labour on £1.00 net').toBe(42);
    expect(withIt.totalCostPct, 'everything together').toBe(74);
    expect(withIt.totalUnitCost).toBe(0.74);
  });

  test('the two fields are kept, and junk is not a time', () => {
    const out = m.normalizeProduct({ labourMinutes: '45', labourPeople: 'x' }) as ported.Product;
    expect(out.labourMinutes).toBe(45);
    expect(out.labourPeople).toBe(null);
    expect(m.normalizeProduct({})?.labourMinutes).toBe(null);
  });

  // ── «What do I sell it at?» ────────────────────────────────────────────────

  test('the suggested price puts the food cost exactly at its target, VAT added back', () => {
    // 0.60 to make, 30% target → 2.00 net; with 10% VAT → 2.20 on the label.
    expect(m.suggestedGrossPrice({ unitCost: 0.6, vatRate: 10, targetPct: 30 })).toBe(2.2);
    expect(m.suggestedGrossPrice({ unitCost: 0.6, vatRate: 22, targetPct: 30 })).toBe(2.44);
    expect(m.suggestedGrossPrice({ unitCost: 1.25, vatRate: 20, targetPct: 25 })).toBe(6);
  });

  test('⚠️ a VAT rate of 0 is a real rate (UK takeaway bread), not a missing one', () => {
    expect(m.suggestedGrossPrice({ unitCost: 0.6, vatRate: 0, targetPct: 30 })).toBe(2);
  });

  test('⚠️⚠️ ROUNDED UP to the cent, so the real food cost is never above the target', () => {
    // 0.50 / 0.30 × 1.10 = 1.8333… → 1.84, never 1.83.
    const price = m.suggestedGrossPrice({ unitCost: 0.5, vatRate: 10, targetPct: 30 });
    expect(price).toBe(1.84);
    const p = {
      name: 'p', components: [{ recipeId: 'R', qtyKg: 1 }], packaging: [],
      sellingMode: 'weight', piecesPerBatch: null, sellingPrice: price, vatRate: 10, foodCostTarget: 30,
    };
    const tables = {
      recipes: { R: { id: 'R', name: 'R', ingredients: [{ label: 'x', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'I' }] } },
      ingredients: { I: { id: 'I', priceUnit: 'kg', pricePerUnit: 0.5 } },
    };
    const result = m.costProduct(p, tables);
    expect(result.unitCost, 'the fixture really costs 0.50 a kilo').toBe(0.5);
    expect(result.foodCostPct as number, `at the suggested price the food cost is ${result.foodCostPct}%, not above 30%`).toBeLessThanOrEqual(30);
  });

  test('a price that is already a whole number of cents is not pushed up by floating-point dust', () => {
    // 0.72 / 0.30 = 2.4000000000000004 in binary floating point.
    expect(m.suggestedGrossPrice({ unitCost: 0.72, vatRate: 0, targetPct: 30 })).toBe(2.4);
  });

  test('nothing is suggested without the cost, the VAT rate and a target', () => {
    for (const input of [
      {}, { unitCost: 0.6, vatRate: 10 }, { unitCost: 0.6, targetPct: 30 }, { vatRate: 10, targetPct: 30 },
      { unitCost: 0, vatRate: 10, targetPct: 30 }, { unitCost: 0.6, vatRate: -1, targetPct: 30 },
      { unitCost: 0.6, vatRate: 10, targetPct: 0 }, { unitCost: 0.6, vatRate: 10, targetPct: 120 },
      { unitCost: 'abc', vatRate: 10, targetPct: 30 },
    ]) {
      expect(m.suggestedGrossPrice(input), JSON.stringify(input)).toBe(null);
    }
    expect(m.suggestedGrossPrice()).toBe(null);
  });

  // ── The VAT menu follows the venue’s country ──────────────────────────────

  test('⚠️ an Italian venue is offered the Italian rates', () => {
    expect(rates('IT')).toStrictEqual([22, 10, 4]);
  });

  test('a UK venue keeps the UK rates, zero-rated included', () => {
    expect(rates('GB')).toStrictEqual([20, 5, 0]);
  });

  test('a country the app does not know gets the UK’s choices, never an empty menu', () => {
    for (const unknown of [null, undefined, '', 'FR', 'it', '__proto__', 'constructor']) {
      expect(rates(unknown), String(unknown)).toStrictEqual([20, 5, 0]);
    }
  });

  test('⚠️ every country the app knows has its own list — a new one cannot quietly get the UK’s', () => {
    for (const country of COUNTRIES) {
      expect(Object.prototype.hasOwnProperty.call(m.VAT_RATES_BY_COUNTRY, country),
        `${country} is a country the app sells in, so it needs its own VAT choices`).toBe(true);
    }
  });

  test('⚠️⚠️ a stored rate the country does not list opens in the free field, unchanged', () => {
    // The products Panificio Miano saved before it had Italian choices.
    expect(m.vatSelection(20, 'IT')).toStrictEqual({ select: 'other', other: '20' });
    expect(m.vatSelection(0, 'IT'), '⚠️ 0 is a real rate, not «nothing chosen»').toStrictEqual({ select: 'other', other: '0' });
    expect(m.vatSelection(22, 'GB')).toStrictEqual({ select: 'other', other: '22' });
    expect(m.vatSelection(17.5, 'GB')).toStrictEqual({ select: 'other', other: '17.5' });
  });

  test('a listed rate selects its menu entry, and nothing chosen selects nothing', () => {
    expect(m.vatSelection(22, 'IT')).toStrictEqual({ select: '22', other: '' });
    expect(m.vatSelection(4, 'IT')).toStrictEqual({ select: '4', other: '' });
    expect(m.vatSelection(0, 'GB')).toStrictEqual({ select: '0', other: '' });
    expect(m.vatSelection(20, null), 'an unknown country reads the UK list').toStrictEqual({ select: '20', other: '' });
    for (const none of [null, undefined, '', -1, 'abc']) {
      expect(m.vatSelection(none, 'IT'), String(none)).toStrictEqual({ select: '', other: '' });
    }
  });

  test('the VAT menu is re-exported from vat-rates, unchanged', () => {
    expect(m.vatRatesFor('IT')).toBe(m.VAT_RATES_BY_COUNTRY.IT);
  });

  // ── Opened from a recipe ───────────────────────────────────────────────────

  const P = (id: string, ...recipeIds: string[]): Doc => ({ id, name: id, components: recipeIds.map(r => ({ recipeId: r, qtyKg: 1 })) });

  test('the products using a recipe are found on any of their lines, and handed back as given', () => {
    const brioche = P('Brioche', 'DOUGH');
    const filled = P('Filled brioche', 'CREAM', 'DOUGH');
    const bread = P('Bread', 'BREAD');
    const all = [brioche, filled, bread];
    const found = m.productsUsingRecipe(all, 'DOUGH');
    expect(found.map(p => p['id'])).toStrictEqual(['Brioche', 'Filled brioche']);
    expect(found[0], 'the very object the store holds, so it opens that product').toBe(brioche);
    expect(m.productsUsingRecipe(all, 'NOTHING')).toStrictEqual([]);
  });

  test('junk finds nothing and throws nothing', () => {
    expect(m.productsUsingRecipe(null, 'DOUGH')).toStrictEqual([]);
    expect(m.productsUsingRecipe([null, 7, {}, P('x', 'DOUGH')], '')).toStrictEqual([]);
    expect(m.productsUsingRecipe([null, 7, {}, P('x', 'DOUGH')], 'DOUGH').length).toBe(1);
  });

  test('⚠️ a new product from a recipe carries its name and its line — and no invented number', () => {
    const draft = m.draftFromRecipe({ id: 'DOUGH', name: '  Brioche dough ', ingredients: [] }) as ported.ProductDraft;
    expect(draft.id, 'not saved: it has no id').toBe(null);
    expect(draft.name).toBe('Brioche dough');
    expect(draft.components).toStrictEqual([{ recipeId: 'DOUGH', qtyKg: 0 }]);
    expect(draft.packaging).toStrictEqual([]);
    for (const key of ['sellingMode', 'piecesPerBatch', 'sellingPrice', 'vatRate', 'foodCostTarget'] as const) {
      expect(draft[key], `${key} must be left for a person to say`).toBe(null);
    }
    // The editor normalises what it is handed; the recipe line must survive that with no kilos.
    expect(m.normalizeProduct(draft)?.components).toStrictEqual([{ recipeId: 'DOUGH', qtyKg: 0 }]);
  });

  test('no recipe, no new product', () => {
    for (const junk of [null, undefined, {}, { name: 'no id' }, { id: '  ' }]) {
      expect(m.draftFromRecipe(junk)).toBe(null);
    }
  });

  // ── Added ──────────────────────────────────────────────────────────────────
  // Not in the original tests: the shapes the rest of Mise 2 relies on.

  test('the blockers’ dictionary keys are the current app’s, frozen', () => {
    expect({ ...m.BLOCKER_TEXT }).toStrictEqual({
      'no-components': 'fc.addAtLeastOne',
      'no-selling-mode': 'fc.chooseWhetherThisIs',
      'no-pieces': 'fc.sayHowManyPieces',
      'no-pack-size': 'fc.sayWhatAPackHolds',
      'no-vat': 'fc.chooseTheVatRate',
      'no-price': 'fc.enterTheSellingPrice',
      'no-recipe-cost': 'fc.theRecipesInThis',
      'no-weight': 'fc.theRecipesInThis2',
    });
    expect(Object.isFrozen(m.BLOCKER_TEXT)).toBe(true);
  });

  test('a result keeps the fields a screen reads, the labour ones null without a rate', () => {
    const out = m.costProduct(product(), TABLES);
    expect(Object.keys(out).sort()).toStrictEqual([
      'batch', 'blockers', 'foodCostPct', 'labourPct', 'labourUnitCost', 'margin', 'netUnitPrice', 'packaging', 'partial',
      'status', 'totalCostPct', 'totalUnitCost', 'unitCost']);
    expect(Object.keys(m.productionCost(product(), TABLES)).sort()).toStrictEqual([
      'batch', 'batchCost', 'labourBatchCost', 'labourUnitCost', 'packaging', 'partial', 'totalUnitCost', 'unit', 'unitCost']);
  });

  test('a row of a batch tells a recipe from an ingredient by its kind, and a recipe row has no unit', () => {
    const out = m.batchTotals(product({ components: [
      { recipeId: 'DOUGH', qtyKg: 1 }, { kind: 'ingredient', ingredientId: 'ICING', qty: 5, unit: 'g' },
    ] }), TABLES);
    expect(out.rows.map(r => Object.keys(r).sort())).toStrictEqual([
      ['cost', 'id', 'kind', 'name', 'qty', 'reason'],
      ['cost', 'id', 'kind', 'name', 'qty', 'reason', 'unit'],
    ]);
  });

  test('QUIRK COPIED: a product that already carries its components is used as it is, normalised or not', () => {
    // unitsPerBatch trusts a truthy `components` (the original’s shortcut for a product it normalised
    // itself); labourBatchCost does the same when `labourMinutes` is there. No real input reaches it.
    expect(m.unitsPerBatch({ components: [1], sellingMode: 'piece', piecesPerBatch: '12' }, {})).toBe('12');
    expect(m.unitsPerBatch({ sellingMode: 'piece', piecesPerBatch: '12' }, {})).toBe(12);
    expect(m.labourBatchCost({ components: [], labourMinutes: '60', labourPeople: null }, { labourCostPerHour: 10 })).toBe(10);
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port against the original', () => {
  // The one function that looks a word up in the interface dictionary.
  const LEFT_OUT = ['blockerText'];
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
