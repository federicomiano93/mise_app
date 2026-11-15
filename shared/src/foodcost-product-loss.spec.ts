// The oven loss belongs to the PRODUCT (Mise 2, post-switch). PURE, so every rule is run under Node (P15).
//
// Federico, 10 Nov 2026: «il calo è del prodotto». The lines of «Made of» are what goes INTO the dough, weighed RAW; the
// product owns its raw and cooked weights; a product the current app saved is converted on read, never rewritten in bulk
// (~/.claude/plans/inherited-twirling-platypus.md §3, §6–§9, step 2). What this file proves:
//
//   1. THE PROMISE OF THE CONVERSION, over thousands of random products saved the old way and run through BOTH this port
//      and js/foodcost/foodcost-model.js as it is: a batch costs exactly what the current app says it costs (for a recipe
//      under about 10 cents a raw kilo the weight wins, and a line may move by about a hundredth of a cent a kilo — section
//      4); and a product
//      whose every line has a price shows every figure the current app shows — per piece, per kilo, per pack, the food
//      cost, the margin, the labour, the cost of one kilo. Only a PARTIAL product may move: Mise 2 counts the weight of
//      every line, priced or not, which makes a partial cost per kilo usually too low («più di»); a row with no price INSIDE a
//      recipe adds neither weight nor cost, so it can be too high as well.
//   2. The new rules on their own: the loss with two decimals from two weights, a raw weight typed apart from the total (a
//      dough made double), no cooked weight = no loss, a cooked weight heavier than the raw one blocks every figure that
//      divides by kilos, pieces with no known weight count nothing.
//   3. Conversions worked by hand, and that a converted product is never converted twice.
//   4. The edges the code review of 11 Nov 2026 found: cheap recipes, prices that round to nothing, batches past the rules'
//      ten tonnes, a cooked weight that rounds to nothing.

import { beforeEach, describe, expect, test } from 'vitest';
import * as ported from './foodcost-model';
import * as perKg from './per-kg-model';
import { productFromRecipe } from './from-recipes';
import { costRecipe } from './recipe-cost-model';
import { roundTo } from './price-model';
import * as legacyJs from '../../js/foodcost/foodcost-model.js';
import * as legacyPerKgJs from '../../js/foodcost/per-kg-model.js';
import { setLanguage, t } from '../../js/i18n.js';

const legacy = legacyJs as unknown as typeof ported;
const legacyPerKg = legacyPerKgJs as unknown as typeof perKg;
const legacyPreview = legacyJs.productPreview as unknown as (raw: unknown, tables: ported.CostTables) => ported.ProductPreview;
const legacyUnpriced = legacyJs.unpricedParts as unknown as (raw: unknown, tables: ported.CostTables) => ported.UnpricedPart[];

type Doc = Record<string, unknown>;

beforeEach(() => { setLanguage('en'); });

// ── 1. The promise of the conversion ─────────────────────────────────────────

// A small seeded generator (mulberry32), so a failure names a product that can be built again.
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Real-looking losses, the recipe's own: none, the usual ones, and a few odd ones.
const LOSSES = [0, 0, 5, 8, 10, 12, 12.66, 15, 20, 25, 33.3, 40];

interface World { tables: ported.CostTables; recipeIds: string[]; ingredientIds: string[] }

// Ingredients priced every way the app knows (per kilo, per piece with and without a piece weight, not at all) and recipes
// of linked rows, an unlinked «water», pieces, kilo rows and recipes inside recipes — each with its own loss.
function makeWorld(r: () => number): World {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;
  const perKilo = (): number => Math.round((0.5 + r() * 29.5) * 100) / 100;
  const ingredients: Record<string, Doc> = { BOX: { id: 'BOX', name: 'Box', priceUnit: 'pcs', pricePerUnit: 0.12 } };
  const ingredientIds: string[] = [];
  for (let i = 0; i < 14; i++) {
    const id = `I${i}`;
    const kind = i % 7;
    ingredients[id] = kind <= 2 ? { id, name: `Ingredient ${i}`, priceUnit: 'kg', pricePerUnit: perKilo() }
      : kind === 3 ? { id, name: `Piece ${i}`, priceUnit: 'pcs', pricePerUnit: Math.round(1 + r() * 99) / 100, unitWeightKg: Math.round(1 + r() * 99) / 1000 }
        : kind === 4 ? { id, name: `Loose piece ${i}`, priceUnit: 'pcs', pricePerUnit: Math.round(1 + r() * 99) / 100 }
          : kind === 5 ? { id, name: `Weighed piece ${i}`, priceUnit: 'kg', pricePerUnit: perKilo(), unitWeightKg: 0.05 }
            : { id, name: `Unpriced ${i}` };
    ingredientIds.push(id);
  }
  const recipes: Record<string, Doc> = {};
  const recipeIds: string[] = [];
  for (let k = 0; k < 10; k++) {
    const id = `R${k}`;
    const rows: Doc[] = [];
    const count = 1 + Math.floor(r() * 5);
    for (let j = 0; j < count; j++) {
      const roll = r();
      const grams = Math.round(1 + r() * 1500);
      if (roll < 0.6) rows.push({ label: `Row ${j}`, grams, unit: 'g', kind: 'ingredient', refId: pick(ingredientIds) });
      else if (roll < 0.7) rows.push({ label: 'Water', grams, unit: 'g' });
      else if (roll < 0.8 && k > 0) rows.push({ label: 'Inside', grams, unit: 'g', kind: 'recipe', refId: `R${Math.floor(r() * k)}` });
      else if (roll < 0.9) rows.push({ label: 'Eggs', grams: 2, unit: 'pcs', kind: 'ingredient', refId: pick(ingredientIds) });
      else rows.push({ label: `Kilo row ${j}`, grams: Math.round(r() * 3000) / 1000, unit: 'kg', kind: 'ingredient', refId: pick(ingredientIds) });
    }
    recipes[id] = { id, name: `Recipe ${k}`, lossPct: pick(LOSSES), ingredients: rows };
    recipeIds.push(id);
  }
  return { tables: { ingredients, recipes, labourCostPerHour: 14 }, recipeIds, ingredientIds };
}

// A product as the current app saves it (model 1 or 2, or none at all): recipe lines in FINISHED kilos — to the gram or to
// the milligram as its editor stores them, or (`anyKilos`) any number at all — ingredients in grams, kilos or pieces, every
// way of selling, packaging, labour, and «no weight loss» now and then. A line points at a gone recipe or ingredient now
// and then too.
function makeProduct(r: () => number, w: World, n: number, anyKilos: boolean): Doc {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;
  const components: Doc[] = [];
  const lines = 1 + Math.floor(r() * 4);
  for (let j = 0; j < lines; j++) {
    if (r() < 0.65) {
      const places = pick([3, 6]);
      const qtyKg = anyKilos ? r() * 12 : Math.round(r() * 12 * 10 ** places) / 10 ** places;
      components.push({ recipeId: r() < 0.05 ? 'GONE' : pick(w.recipeIds), qtyKg });
    } else {
      const unit = pick(['g', 'g', 'kg', 'pcs'] as const);
      const qty = unit === 'g' ? Math.round(1 + r() * 800) : unit === 'kg' ? Math.round(r() * 3000) / 1000 : Math.round(1 + r() * 40);
      components.push({ kind: 'ingredient', ingredientId: r() < 0.05 ? 'GONE' : pick(w.ingredientIds), qty, unit });
    }
  }
  const mode = pick(['piece', 'weight', 'weight', 'pack-g', 'pack-pcs', null] as const);
  const product: Doc = {
    id: `P${n}`, name: `Product ${n}`, components,
    packaging: r() < 0.3 ? [{ ingredientId: 'BOX', qtyPcs: 1 + Math.floor(r() * 3) }] : [],
    sellingMode: mode === 'pack-g' || mode === 'pack-pcs' ? 'pack' : mode,
    piecesPerBatch: 1 + Math.floor(r() * 120),
    packSize: mode === 'pack-g' ? pick([250, 500, 1000]) : mode === 'pack-pcs' ? pick([2, 4, 6]) : null,
    packUnit: mode === 'pack-g' ? 'g' : mode === 'pack-pcs' ? 'pcs' : null,
    sellingPrice: Math.round((0.5 + r() * 40) * 100) / 100,
    vatRate: pick([0, 4, 10, 20, 22]),
    foodCostTarget: pick([null, 25, 30, 35]),
    labourMinutes: r() < 0.5 ? Math.round(1 + r() * 240) : null,
    labourPeople: r() < 0.5 ? 1 + Math.floor(r() * 3) : null,
    noWeightLoss: r() < 0.2,
  };
  if (r() < 0.7) product.model = pick([1, 2]);
  return product;
}

// The figures of an answer without its explained lines: a recipe row now names its RAW kilos.
const figuresOf = (batch: ported.BatchTotals): Doc => ({ cost: batch.cost, kg: batch.kg, partial: batch.partial });

// Every line of the product has a price in the current app: its weight then counts the same in both.
function complete(product: Doc, tables: ported.CostTables): boolean {
  return legacy.batchTotals(product, tables).rows.every(row => row.cost !== null);
}

function compareProduct(product: Doc, tables: ported.CostTables, out: string[]): boolean {
  const differ = (what: string, mine: unknown, theirs: unknown): void => {
    try { expect(mine).toStrictEqual(theirs); } catch { out.push(`${String(product.id)} ${what}: Mise 2 ${JSON.stringify(mine)} / current ${JSON.stringify(theirs)}`); }
  };
  const mine = ported.batchTotals(product, tables);
  const theirs = legacy.batchTotals(product, tables);
  // ⚠️ THE PROMISE: the money of a batch never moves, whatever the product.
  differ('batch cost', mine.cost, theirs.cost);
  differ('rows priced', mine.rows.map(row => row.cost), theirs.rows.map(row => row.cost));
  if (!complete(product, tables)) return false;

  differ('batch', figuresOf(mine), figuresOf(theirs));
  const myCost = ported.productionCost(product, tables);
  const theirCost = legacy.productionCost(product, tables);
  differ('production cost', { ...myCost, batch: figuresOf(myCost.batch) }, { ...theirCost, batch: figuresOf(theirCost.batch) });
  const myResult = ported.costProduct(product, tables);
  const theirResult = legacy.costProduct(product, tables);
  differ('food cost', { ...myResult, batch: figuresOf(myResult.batch) }, { ...theirResult, batch: figuresOf(theirResult.batch) });
  differ('preview', ported.productPreview(product, tables, t), legacyPreview(product, tables));
  differ('what has no price', ported.unpricedParts(product, tables, t), legacyUnpriced(product, tables));
  const myKilo = perKg.costPerKg(product, tables);
  const theirKilo = legacyPerKg.costPerKg(product, tables);
  differ('one kilo', [myKilo.kg, myKilo.total, myKilo.partial, myKilo.packagingLeftOut],
    [theirKilo.kg, theirKilo.total, theirKilo.partial, theirKilo.packagingLeftOut]);
  return true;
}

describe('a product saved before the switch costs what it always cost', () => {
  test('4000 random products, kilos as the editor stores them: the batch to the cent, every figure of a complete product', () => {
    const r = seeded(20261110);
    const world = makeWorld(r);
    const out: string[] = [];
    let checked = 0;
    let completeOnes = 0;
    let losing = 0;
    for (let n = 0; n < 4000; n++) {
      const product = makeProduct(r, world, n, false);
      if (compareProduct(product, world.tables, out)) completeOnes += 1;
      if ((ported.productCooking(product, world.tables).lossPct || 0) > 0) losing += 1;
      // A converted line opens in the gram box: it must be a weight a person could have typed (six decimals of a kilo).
      const converted = ported.fromLegacyProduct(product, world.tables);
      for (const line of converted ? converted.components : []) {
        if (line.kind === 'ingredient') continue;
        const millionths = line.qtyKg * 1e6;
        if (Math.abs(millionths - Math.round(millionths)) > 1e-6) out.push(`${String(product.id)} raw kilos not typable: ${line.qtyKg}`);
      }
      checked += 1;
    }
    expect(out.slice(0, 10)).toStrictEqual([]);
    // The sample must hold enough of what it is meant to prove.
    expect(checked).toBe(4000);
    expect(completeOnes).toBeGreaterThan(800);
    expect(losing).toBeGreaterThan(800);
  }, 120_000);

  test('1000 random products with kilos of any length: the batch still costs the same, to the last stored decimal', () => {
    const r = seeded(7);
    const world = makeWorld(r);
    const out: string[] = [];
    for (let n = 0; n < 1000; n++) {
      const product = makeProduct(r, world, n, true);
      const mine = ported.batchTotals(product, world.tables);
      const theirs = legacy.batchTotals(product, world.tables);
      if (mine.cost !== theirs.cost) out.push(`${n}: Mise 2 ${mine.cost} / current ${theirs.cost}`);
      if (product.sellingMode === 'piece') {
        const a = ported.costProduct(product, world.tables).unitCost;
        const b = legacy.costProduct(product, world.tables).unitCost;
        if (a !== b) out.push(`${n} per piece: Mise 2 ${a} / current ${b}`);
      }
    }
    expect(out.slice(0, 10)).toStrictEqual([]);
  }, 120_000);
});

// ── 2. The new rules ─────────────────────────────────────────────────────────

const ING: Record<string, Doc> = {
  FLOUR: { id: 'FLOUR', name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 },
  BUTTER: { id: 'BUTTER', name: 'Butter', priceUnit: 'kg', pricePerUnit: 8 },
  ALMOND: { id: 'ALMOND', name: 'Almonds', priceUnit: 'kg', pricePerUnit: 12 },
  ICING: { id: 'ICING', name: 'Icing sugar', priceUnit: 'kg', pricePerUnit: 1.5 },
  EGG: { id: 'EGG', name: 'Egg', priceUnit: 'pcs', pricePerUnit: 0.25, unitWeightKg: 0.06 },
  SPRINKLE: { id: 'SPRINKLE', name: 'Sprinkle', priceUnit: 'pcs', pricePerUnit: 0.02 },
  RIBBON: { id: 'RIBBON', name: 'Ribbon' },
};
const flour = (grams: number): Doc => ({ label: 'Flour', grams, unit: 'g', kind: 'ingredient', refId: 'FLOUR' });
// 300 g flour + 200 g butter = 2.20 for 500 g raw: 4.40 a raw kilo. Its own loss (10%) is the recipe's label; the product
// that uses it has a loss of its own.
const ZULLE: Doc = { id: 'ZULLE', name: 'Zulle', lossPct: 10, ingredients: [flour(300), { label: 'Butter', grams: 200, unit: 'g', kind: 'ingredient', refId: 'BUTTER' }] };
// 1000 g flour at 2/kg, 10% lost: 2.00 a raw kilo, 2.2222 a kilo out of the oven.
const DOUGH10: Doc = { id: 'DOUGH10', name: 'Dough', lossPct: 10, ingredients: [flour(1000)] };
const TABLES: ported.CostTables = { ingredients: ING, recipes: { ZULLE, DOUGH10 } };

// His Zulle (10 Nov 2026): the Zulle recipe + almonds + icing sugar, 790 g raw, 690 g out of the oven, sold by the kilo.
const zulle = (over: Doc = {}): Doc => ({
  id: 'Z', name: 'Zulle', model: 3,
  components: [
    { recipeId: 'ZULLE', qtyKg: 0.5 },
    { kind: 'ingredient', ingredientId: 'ALMOND', qty: 200, unit: 'g' },
    { kind: 'ingredient', ingredientId: 'ICING', qty: 90, unit: 'g' },
  ],
  packaging: [], sellingMode: 'weight', sellingPrice: 30, vatRate: 10, foodCostTarget: 30, cookedGrams: 690, ...over,
});

describe('the product owns its loss', () => {
  test('the loss has two real decimals: 790 g down to 690 g is 12.66%', () => {
    expect(ported.productLossPct(790, 690)).toBe(12.66);
    expect(ported.productLossPct(1000, 880)).toBe(12);
    expect(ported.productLossPct(500, 500), 'weighed, and it lost nothing').toBe(0);
    expect(ported.productLossPct('790', '690')).toBe(12.66);
    expect(ported.productLossPct(690, 790), 'heavier is not a loss').toBeNull();
    for (const junk of [null, undefined, 0, -5, NaN, Infinity, '', 'abc', {}]) {
      expect(ported.productLossPct(junk, 690), String(junk)).toBeNull();
      expect(ported.productLossPct(790, junk), String(junk)).toBeNull();
    }
  });

  test('the raw weight is the total of «Made of»; the batch weighs what came out; a kilo costs the batch ÷ that', () => {
    const cooking = ported.productCooking(zulle(), TABLES);
    expect(cooking.rawTotalKg).toBeCloseTo(0.79, 12);
    expect([cooking.rawTyped, cooking.cookedKg, cooking.heavier, cooking.lossPct, cooking.outputKg]).toStrictEqual([false, 0.69, false, 12.66, 0.69]);
    // 0.5 kg × 4.40 (the RAW price: the recipe's own 10% laid aside) + 0.2 kg × 12 + 0.09 kg × 1.5 = 2.20 + 2.40 + 0.135.
    const batch = ported.batchTotals(zulle(), TABLES);
    expect([batch.cost, batch.kg, batch.partial]).toStrictEqual([4.735, 0.69, false]);
    expect(ported.componentLineCost({ recipeId: 'ZULLE', qtyKg: 0.5 }, TABLES).rate).toBe(4.4);
    // 4.735 ÷ 0.69 = 6.8623 a kilo out of the oven.
    expect(ported.costProduct(zulle(), TABLES).unitCost).toBe(6.8623);
    const kilo = perKg.costPerKg(zulle(), TABLES);
    expect([kilo.kg, kilo.total, kilo.lossy]).toStrictEqual([0.69, 6.8623, true]);
  });

  test('a raw weight typed apart from the total (a dough made double) counts through the ratio', () => {
    const doubled = zulle({ rawGrams: 1580, cookedGrams: 1380 });
    const cooking = ported.productCooking(doubled, TABLES);
    expect([cooking.rawKg, cooking.rawTyped, cooking.lossPct, cooking.outputKg]).toStrictEqual([1.58, true, 12.66, 0.69]);
    expect(ported.costProduct(doubled, TABLES).unitCost, 'the same dough, the same kilo').toBe(6.8623);
  });

  test('no cooked weight is «no loss»: the batch weighs the total of «Made of»', () => {
    const cooking = ported.productCooking(zulle({ cookedGrams: null }), TABLES);
    expect([cooking.cookedKg, cooking.lossPct, cooking.heavier]).toStrictEqual([null, null, false]);
    expect(cooking.outputKg).toBeCloseTo(0.79, 12);
    // 4.735 ÷ 0.79 = 5.9937.
    expect(ported.costProduct(zulle({ cookedGrams: null }), TABLES).unitCost).toBe(5.9937);
  });

  test('⚠️ a cooked weight heavier than the raw one: kept, and every figure that divides by kilos waits for it', () => {
    const heavier = zulle({ cookedGrams: 800 });
    const cooking = ported.productCooking(heavier, TABLES);
    expect([cooking.heavier, cooking.lossPct, cooking.outputKg, cooking.cookedKg]).toStrictEqual([true, null, null, 0.8]);
    expect(ported.batchTotals(heavier, TABLES).kg).toBe(0);
    const byWeight = ported.costProduct(heavier, TABLES);
    expect(byWeight.unitCost).toBeNull();
    expect(byWeight.blockers).toContain('cooked-heavier');
    expect(byWeight.blockers, 'the thing to fix is the weight, named once').not.toContain('no-weight');
    expect(ported.BLOCKER_TEXT['cooked-heavier']).toBe('fc.cooking.blockHeavier');
    expect(perKg.costPerKg(heavier, TABLES).total).toBeNull();
    // Sold by the piece the kilos do not matter: 4.735 ÷ 10 pieces.
    const byPiece = ported.costProduct({ ...heavier, sellingMode: 'piece', piecesPerBatch: 10 }, TABLES);
    expect([byPiece.unitCost, byPiece.blockers]).toStrictEqual([0.4735, []]);
    // Heavier than a raw weight typed apart from the total, too.
    expect(ported.productCooking(zulle({ rawGrams: 1580, cookedGrams: 1600 }), TABLES).heavier).toBe(true);
    // Equal is not heavier — a total added up from several lines may carry floating-point dust.
    expect(ported.productCooking(zulle({ cookedGrams: 790 }), TABLES)).toMatchObject({ heavier: false, lossPct: 0 });
  });

  test('every line with a known weight counts in the raw total, priced or not; pieces with no weight count nothing', () => {
    const lines = (zulle().components as Doc[]);
    const withSprinkles = zulle({ cookedGrams: null, components: [...lines, { kind: 'ingredient', ingredientId: 'SPRINKLE', qty: 10, unit: 'pcs' }] });
    expect(ported.productCooking(withSprinkles, TABLES).rawTotalKg, 'pieces nobody weighed').toBeCloseTo(0.79, 12);
    expect(ported.batchTotals(withSprinkles, TABLES).cost, '…still cost 10 × 0.02').toBe(4.935);
    const withRibbon = zulle({ cookedGrams: null, components: [...lines, { kind: 'ingredient', ingredientId: 'RIBBON', qty: 100, unit: 'g' }] });
    const batch = ported.batchTotals(withRibbon, TABLES);
    expect([batch.cost, batch.kg, batch.partial], 'an unpriced line weighs: the kilo reads too LOW').toStrictEqual([4.735, 0.89, true]);
    expect(ported.lineRawKg({ kind: 'ingredient', ingredientId: 'EGG', qty: 4, unit: 'pcs' }, TABLES)).toBe(0.24);
    expect(ported.lineRawKg({ kind: 'ingredient', ingredientId: 'SPRINKLE', qty: 4, unit: 'pcs' }, TABLES)).toBeNull();
    expect(ported.lineRawKg({ kind: 'ingredient', ingredientId: 'GONE', qty: 4, unit: 'pcs' }, TABLES)).toBeNull();
    expect(ported.lineRawKg({ kind: 'ingredient', ingredientId: 'GONE', qty: 100, unit: 'g' }, TABLES), 'grams are a weight whatever is gone').toBe(0.1);
    expect(ported.lineRawKg({ kind: 'ingredient', ingredientId: 'FLOUR', qty: 2, unit: 'kg' }, TABLES)).toBe(2);
    expect(ported.lineRawKg({ recipeId: 'ZULLE', qtyKg: 1.5 }, TABLES)).toBe(1.5);
    expect(ported.lineRawKg({ recipeId: 'ZULLE', qtyKg: -1 }, TABLES)).toBe(0);
    for (const junk of [null, undefined, 5, 'x', [], {}]) expect(() => ported.lineRawKg(junk, TABLES)).not.toThrow();
  });

  test('a change of either weight is worth a point on the margin history; the first save of a converted product is not', () => {
    expect(ported.snapshotWorthTaking(zulle(), zulle({ cookedGrams: 700 }), TABLES)).toBe(true);
    expect(ported.snapshotWorthTaking(zulle(), zulle({ rawGrams: 1580 }), TABLES)).toBe(true);
    expect(ported.snapshotWorthTaking(zulle(), zulle(), TABLES)).toBe(false);
    const old: Doc = { id: 'O', name: 'Old', model: 2, components: [{ recipeId: 'DOUGH10', qtyKg: 0.9 }], sellingMode: 'weight', sellingPrice: 10, vatRate: 0 };
    expect(ported.snapshotWorthTaking(old, ported.currentProduct(old, TABLES), TABLES)).toBe(false);
  });
});

// ── 3. Conversions by hand ───────────────────────────────────────────────────

describe('a product the current app saved, converted on read', () => {
  const old = (over: Doc = {}): Doc => ({
    id: 'O', name: 'Focaccia', model: 2, components: [{ recipeId: 'DOUGH10', qtyKg: 0.9 }],
    packaging: [], sellingMode: 'weight', sellingPrice: 10, vatRate: 0, ...over,
  });

  test('0.9 kg out of a recipe that loses 10% is 1 kg of raw dough, and the batch still weighs 0.9 kg', () => {
    const p = ported.fromLegacyProduct(old(), TABLES) as ported.Product;
    expect(p.components[0]).toMatchObject({ recipeId: 'DOUGH10' });
    // Exactly 1 kg, the plan's own example: the exact cost-keeping weight is 0.99999 kg (the recipe's price per kilo is
    // rounded), which the gram box would show as «999.99»; 1 kg costs the same to the fourth decimal.
    expect((p.components[0] as ported.RecipeLine).qtyKg).toBe(1);
    expect([p.cookedGrams, p.rawGrams, p.model, p.noWeightLoss]).toStrictEqual([900, null, 3, false]);
    expect(ported.productCooking(p, TABLES).lossPct).toBe(10);
    // The money is the current app's: 0.9 kg × 2.2222 = 2.0000, and 2.0000 ÷ 0.9 kg a kilo.
    expect(ported.costProduct(old(), TABLES).unitCost).toBe(legacy.costProduct(old(), TABLES).unitCost);
    expect(ported.batchTotals(old(), TABLES).cost).toBe(2);
  });

  test('«no weight loss»: the lines were already raw, so nothing is weighed and the flag goes', () => {
    const p = ported.fromLegacyProduct(old({ noWeightLoss: true, components: [{ recipeId: 'DOUGH10', qtyKg: 1 }] }), TABLES) as ported.Product;
    expect([(p.components[0] as ported.RecipeLine).qtyKg, p.cookedGrams, p.noWeightLoss]).toStrictEqual([1, null, false]);
    expect(ported.batchTotals(p, TABLES)).toMatchObject({ cost: 2, kg: 1 });
  });

  test('an ingredient line never lost weight; a gone recipe keeps its kilos; a product with no model is converted too', () => {
    const withIcing = ported.fromLegacyProduct(old({ components: [{ recipeId: 'DOUGH10', qtyKg: 0.9 }, { kind: 'ingredient', ingredientId: 'ICING', qty: 100, unit: 'g' }] }), TABLES) as ported.Product;
    expect(withIcing.components[1]).toStrictEqual({ kind: 'ingredient', ingredientId: 'ICING', qty: 100, unit: 'g' });
    expect(withIcing.cookedGrams).toBe(1000);
    const gone = ported.fromLegacyProduct(old({ components: [{ recipeId: 'GONE', qtyKg: 2 }] }), TABLES) as ported.Product;
    expect([(gone.components[0] as ported.RecipeLine).qtyKg, gone.cookedGrams]).toStrictEqual([2, null]);
    const unnumbered = { ...old() };
    delete unnumbered.model;
    expect(ported.isLegacyProduct(unnumbered)).toBe(true);
    expect((ported.currentProduct(unnumbered, TABLES) as ported.Product).cookedGrams).toBe(900);
  });

  test('⚠️ never converted twice: a model-3 product is read as it is', () => {
    const once = ported.currentProduct(old(), TABLES);
    expect(ported.currentProduct(once, TABLES)).toStrictEqual(once);
    expect(ported.currentProduct(zulle(), TABLES)).toStrictEqual(ported.normalizeProduct(zulle()));
    expect([ported.isLegacyProduct(old()), ported.isLegacyProduct(zulle()), ported.isLegacyProduct({ ...zulle(), model: 4 })]).toStrictEqual([true, false, false]);
    for (const junk of [null, undefined, 5, 'x', true]) {
      expect(ported.isLegacyProduct(junk), String(junk)).toBe(false);
      expect(ported.fromLegacyProduct(junk, TABLES), String(junk)).toBeNull();
      expect(ported.currentProduct(junk, TABLES), String(junk)).toBeNull();
    }
    // An object with nothing in it (an array included, as normalizeProduct reads one) weighs nothing either way.
    for (const junk of [null, undefined, 5, 'x', true, [], {}]) {
      expect(ported.productCooking(junk, TABLES), JSON.stringify(junk) ?? String(junk)).toStrictEqual({
        rawTotalKg: 0, rawKg: 0, rawTyped: false, cookedKg: null, heavier: false, lossPct: null, outputKg: 0,
      });
    }
  });

  test('a product made from a recipe starts with the whole recipe raw and the recipe\'s loss as its own', () => {
    const recipe: Doc = { id: 'PANE', name: 'Pane', lossPct: 12, ingredients: [flour(1000)] };
    const made = productFromRecipe(recipe);
    expect(made).toMatchObject({ components: [{ recipeId: 'PANE', qtyKg: 1 }], rawGrams: null, cookedGrams: 880, model: 3 });
    // A kilo of it costs what a kilo out of the recipe's oven cost before the switch: 2.00 ÷ 0.88 kg.
    const asProduct = { ...(made as object), sellingMode: 'weight' };
    expect(ported.productionCost(asProduct, { ingredients: ING, recipes: { PANE: recipe } }).unitCost)
      .toBe(costRecipe(recipe, { ingredients: ING }).pricePerKg);
    expect(productFromRecipe({ ...recipe, lossPct: 0 })?.cookedGrams, 'a recipe that loses nothing').toBeNull();
  });
});

// ── 4. The edges the code reviews found (11 Nov 2026) ────────────────────────

describe('⚠️ the edges of the conversion', () => {
  // One recipe of one ingredient at `rate` a kilo, `grams` of it, losing `loss`%; a product of `qtyKg` finished kilos of it.
  const recipeOf = (rate: number | null, loss: number, grams: number): ported.CostTables => ({
    ingredients: { I: rate === null ? { id: 'I', name: 'I' } : { id: 'I', name: 'I', priceUnit: 'kg', pricePerUnit: rate } },
    recipes: { R: { id: 'R', name: 'R', lossPct: loss, ingredients: [{ label: 'x', grams, unit: 'g', kind: 'ingredient', refId: 'I' }] } },
  });
  const line = (qtyKg: number, over: Doc = {}): Doc => ({
    id: 'P', name: 'P', model: 2, components: [{ recipeId: 'R', qtyKg }], packaging: [], sellingMode: 'weight', sellingPrice: 10, vatRate: 0,
    ...over,
  });
  const rawOf = (p: unknown): number => ((p as ported.Product).components[0] as ported.RecipeLine).qtyKg;
  // The two promises every converted line keeps whatever its price: never lighter than the kilos it held, and within 0.1% of the
  // plain q ÷ (1 − loss) — a milligram either side at most past it — so the loss «Cottura» shows is the recipe's to within a
  // tenth of a point (its two decimals add half a hundredth).
  const weighs = (out: string[], tables: ported.CostTables, q: number, loss: number): number => {
    const product = ported.fromLegacyProduct(line(q), tables) as ported.Product;
    const raw = rawOf(product);
    const plain = q / (1 - loss / 100);
    const tag = `${JSON.stringify(tables.ingredients)} ${loss}% ${q} kg`;
    if (raw < q) out.push(`${tag}: became ${raw} kg, lighter`);
    if (Math.abs(raw - plain) > plain * 1e-3 + 2e-6) out.push(`${tag}: became ${raw} kg, the plain weight is ${plain}`);
    // «No oven loss» (no cooked weight) is a loss of 0 — what a recipe losing under 0.1% may show.
    const shown = ported.productCooking(product, tables).lossPct ?? 0;
    if (q >= 0.001 && Math.abs(shown - loss) > 0.105) out.push(`${tag}: «Cottura» shows ${shown}%`);
    return raw;
  };

  test('from 10 cents a raw kilo up: every line keeps its cost, its weight and its loss, and is a weight a person types', () => {
    const r = seeded(20261111);
    const out: string[] = [];
    for (let n = 0; n < 6000; n++) {
      // Leaning towards the cheap end, where four decimals of a price are coarsest.
      const rate = Math.round((0.1 + r() ** 3 * 99.9) * 10000) / 10000;
      const loss = Math.round((0.01 + r() * 39.99) * 100) / 100;
      const tables = recipeOf(rate, loss, Math.round(1 + r() * 3000));
      const q = Math.max(0.001, Math.round(r() * 12 * 1000) / 1000);
      const raw = weighs(out, tables, q, loss);
      if (Math.abs(raw * 1e6 - Math.round(raw * 1e6)) > 1e-6) out.push(`${rate}/kg ${loss}%: ${raw} kg is no typed weight`);
      const mine = ported.batchTotals(line(q), tables).cost;
      const theirs = legacy.batchTotals(line(q), tables).cost;
      if (mine !== theirs) out.push(`${rate}/kg ${loss}% ${q} kg: Mise 2 ${mine} / current ${theirs}`);
    }
    expect(out.slice(0, 10)).toStrictEqual([]);
  }, 60_000);

  test('under 10 cents a raw kilo (mostly water) the weight is the dough\u2019s, and a line moves by about a hundredth of a cent a kilo', () => {
    const r = seeded(11);
    const out: string[] = [];
    for (let n = 0; n < 3000; n++) {
      const rate = Math.max(0.001, Math.round(r() * 0.1 * 10000) / 10000);
      const loss = Math.round((0.01 + r() * 39.99) * 100) / 100;
      const tables = recipeOf(rate, loss, Math.round(1 + r() * 3000));
      const q = Math.max(0.001, Math.round(r() * 12 * 1000) / 1000);
      weighs(out, tables, q, loss);
      // Each price per kilo is rounded to four decimals, half a hundredth of a cent at most, and each total to its own: a kilo
      // on the line moves by 0.00005 × (1 ÷ (1 − loss) + 1) at most — 0.013 cents at a 40% loss.
      const moved = Math.abs((ported.batchTotals(line(q), tables).cost ?? 0) - (legacy.batchTotals(line(q), tables).cost ?? 0));
      const bound = q * 0.00005 * (1 / (1 - loss / 100) + 1) + 0.0001;
      if (moved > bound + 1e-6) out.push(`${rate}/kg ${loss}% ${q} kg: moved ${moved}, more than ${bound}`);
    }
    expect(out.slice(0, 10)).toStrictEqual([]);
  }, 60_000);

  test('a small line of a cheap recipe: the weight the dough had, never the roundest one on its cost (5 g never 6 g)', () => {
    // The second review measured, before this rule: at 0.3 cents a kilo and a 10% loss, 5 g → 6 g raw («Cottura» 16.67%),
    // 50 g → 56 g, 100 g → 111 g; at 20 cents, 5 g → 5.6 g (10.71%). The cost was the same every time.
    const out: string[] = [];
    for (const rate of [0.003, 0.2, 2]) {
      for (const grams of [1, 5, 50, 100, 450]) weighs(out, recipeOf(rate, 10, 1000), grams / 1000, 10);
    }
    expect(out).toStrictEqual([]);
    expect(rawOf(ported.fromLegacyProduct(line(0.005), recipeOf(0.003, 10, 1000)))).toBe(0.00556);
  });

  test('a loss of a few hundredths of a percent: the raw weight is never lighter than what came out of the oven, and keeps its cost', () => {
    // The first review's sweep: with a 0.05–0.1% loss the roundest weight on the line's cost fell under the finished kilos even
    // at 0.10–1.50 a kilo, and the product lost its loss — on a line saved with more decimals than whole grams.
    const r = seeded(5);
    const out: string[] = [];
    for (let n = 0; n < 4000; n++) {
      const rate = Math.round((0.1 + r() * 1.4) * 10000) / 10000;
      const loss = Math.round((0.01 + r() * 0.09) * 100) / 100;
      const tables = recipeOf(rate, loss, Math.round(1 + r() * 3000));
      const q = Math.max(0.000001, Math.round(r() * 12 * 1e6) / 1e6);
      const raw = rawOf(ported.fromLegacyProduct(line(q), tables));
      if (raw < q) out.push(`${rate}/kg ${loss}%: ${q} kg became ${raw} kg`);
      const mine = ported.batchTotals(line(q), tables).cost;
      const theirs = legacy.batchTotals(line(q), tables).cost;
      if (mine !== theirs) out.push(`${rate}/kg ${loss}% ${q} kg: Mise 2 ${mine} / current ${theirs}`);
    }
    expect(out.slice(0, 10)).toStrictEqual([]);
  }, 60_000);

  test('no price at all, on a line saved with more decimals than a milligram: the plain weight is never under it', () => {
    // 1.2341 g of an unpriced recipe that loses 0.01%: the plain weight to the milligram, 1.234 g, would be lighter.
    expect(rawOf(ported.fromLegacyProduct(line(0.0012341), recipeOf(null, 0.01, 1000)))).toBeGreaterThanOrEqual(0.0012341);
  });

  test('a recipe whose prices round to nothing: 5 kg out of a 20% loss is 6.25 kg raw, never one gram', () => {
    // Twenty grams of water at a fifth of a cent a kilo: both prices per kilo round to 0, and every weight «keeps» a cost of 0.
    const tables = recipeOf(0.002, 20, 20);
    expect(costRecipe((tables.recipes as Record<string, Doc>)['R'], tables).pricePerKg, 'the premise').toBe(0);
    const p = ported.fromLegacyProduct(line(5), tables) as ported.Product;
    expect([rawOf(p), p.cookedGrams]).toStrictEqual([6.25, 5000]);
  });

  describe('⚠️ a batch past ten tonnes (grams typed into the old kilo box)', () => {
    // 12000 «kilos» of a dough at 0.90 a raw kilo that loses 12%: what was meant is 12 kg.
    const tables = recipeOf(0.9, 12, 1000);

    test('keeps its loss as the same ratio inside the rules, and reads the same twice', () => {
      const once = ported.currentProduct(line(12000), tables) as ported.Product;
      expect(once.cookedGrams).toBe(12000);
      expect(once.rawGrams).toBeCloseTo(rawOf(once), 6);
      expect(rawOf(once)).toBeGreaterThan(12000);
      expect(ported.productCooking(once, tables).lossPct).toBe(12);
      expect(ported.currentProduct(once, tables)).toStrictEqual(once);
    });

    test('every figure is the current app\u2019s, sold by the kilo, by a pack in grams or by the piece', () => {
      const ways: Doc[] = [
        { sellingMode: 'weight', sellingPrice: 10 },
        { sellingMode: 'pack', packSize: 250, packUnit: 'g', sellingPrice: 3 },
        { sellingMode: 'piece', piecesPerBatch: 40, sellingPrice: 2 },
      ];
      // Every figure but the line's own quantity, which is raw kilos now and finished kilos there — by design.
      const figures = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, v: unknown) => (key === 'qty' ? undefined : v)));
      for (const way of ways) {
        const product = line(12000, way);
        expect(figures(ported.batchTotals(product, tables)), JSON.stringify(way)).toStrictEqual(figures(legacy.batchTotals(product, tables)));
        expect(figures(ported.costProduct(product, tables)), JSON.stringify(way)).toStrictEqual(figures(legacy.costProduct(product, tables)));
      }
    });

    test('once the line is corrected, the two weights are the ones that were meant', () => {
      const once = ported.currentProduct(line(12000), tables) as ported.Product;
      const corrected = { ...once, components: [{ recipeId: 'R', qtyKg: roundTo(rawOf(once) / 1000, 6) }] };
      const cooking = ported.productCooking(corrected, tables);
      expect([cooking.lossPct, roundTo(cooking.outputKg ?? 0, 3)]).toStrictEqual([12, 12]);
    });

    test('many lines past ten tonnes: every line cost is the current app\u2019s, the batch weight to its fourth decimal', () => {
      // The pair is fitted a thousand times lighter and the batch is the lines' total × cooked ÷ raw, rounded to six decimals,
      // then four: a total sitting on a half of the fourth decimal can come out a tenth of a gram off, on tens of tonnes (third
      // code review: 13 in 9,862 such products). Below ten tonnes nothing is fitted, and the weight is the current app's exactly.
      const r = seeded(30);
      const out: string[] = [];
      let fitted = 0;
      for (let n = 0; n < 3000; n++) {
        const recipes: Record<string, Doc> = {};
        const components: Doc[] = [];
        const count = 1 + Math.floor(r() * 3);
        for (let i = 0; i < count; i++) {
          const id = `R${i}`;
          const loss = r() < 0.3 ? 0 : Math.round(r() * 30 * 100) / 100;
          recipes[id] = { id, name: id, lossPct: loss, ingredients: [{ label: 'x', grams: Math.round(1 + r() * 3000), unit: 'g', kind: 'ingredient', refId: 'I' }] };
          components.push({ recipeId: id, qtyKg: Math.round(r() * 40000 * 1e5) / 1e5 });
        }
        const many: ported.CostTables = {
          ingredients: { I: { id: 'I', name: 'I', priceUnit: 'kg', pricePerUnit: Math.round((0.1 + r() * 20) * 10000) / 10000 } }, recipes,
        };
        const p = line(0, { components });
        const tag = JSON.stringify(components);
        const isFitted = (ported.currentProduct(p, many) as ported.Product).rawGrams !== null;
        if (isFitted) fitted += 1;
        const mine = ported.batchTotals(p, many);
        const theirs = legacy.batchTotals(p, many);
        if (JSON.stringify(mine.rows.map(row => row.cost)) !== JSON.stringify(theirs.rows.map(row => row.cost))) out.push(`line costs ${tag}`);
        if (mine.cost !== theirs.cost) out.push(`cost ${mine.cost} / ${theirs.cost} ${tag}`);
        const gap = mine.kg === null || theirs.kg === null ? (mine.kg === theirs.kg ? 0 : Infinity) : Math.abs(mine.kg - theirs.kg);
        if (gap > (isFitted ? 1e-4 + 1e-9 : 0)) out.push(`kg ${mine.kg} / ${theirs.kg} ${tag}`);
      }
      expect(out.slice(0, 10)).toStrictEqual([]);
      expect(fitted, 'the sweep reaches past ten tonnes').toBeGreaterThan(1000);
    }, 60_000);

    test('a product made from a recipe past ten tonnes keeps the recipe\u2019s loss the same way', () => {
      // Two rows of six tonnes: 12 t raw, 10.56 t cooked — past what the rules keep.
      const made = productFromRecipe({ id: 'B', name: 'Big', lossPct: 12, ingredients: [flour(6000000), flour(6000000)] });
      expect([made?.rawGrams, made?.cookedGrams]).toStrictEqual([12000, 10560]);
    });
  });

  test('a gram of dough that loses 97%: the product made from it has no cooked weight (0 g is refused by the rules)', () => {
    expect(productFromRecipe({ id: 'T', name: 'Tiny', lossPct: 97, ingredients: [flour(1)] })?.cookedGrams).toBeNull();
  });
});
