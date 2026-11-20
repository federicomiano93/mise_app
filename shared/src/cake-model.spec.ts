// Unit tests for the cakes' model (Mise 2, 20 Nov 2026, the cakes plan step 2): the grams rule, the product a cake is turned
// into, and the figures read from the Food cost engine. NEW IN MISE 2: no original in js/. Fake data only (P15).
//
// Federico's rules under test: a cake's money comes from the ONE Food cost engine (the specs compare every figure with
// costProduct / productionCost / costPerKg run on the derived product); the cake itself is grams only; the reference grams
// scale by area; a hand-typed figure always wins over the rule.

import { describe, expect, test } from 'vitest';
import rules from '../../firestore.rules?raw';
import {
  CAKE_MODEL, CAKE_PARTS, REFERENCE_KEYS, cakeGeometry, cakeIdOfProduct, cakeLineCosts, cakeNeeds, cakeProduct, cakeProductId,
  cakeTotals, isCakeProductId, maxTiersFor, minDiameterFor, normalizeCake, normalizeReference, resolveLines, ruleGrams,
  sameReference, tierDiameters, toCakeDocument,
} from './cake-model';
import type { Cake, CakeLine, CakePart, ReferenceGrams } from './cake-model';
import { PRODUCT_MODEL, costProduct, labourBatchCost, normalizeProduct, productionCost } from './foodcost-model';
import type { CostTables } from './foodcost-model';
import { costPerKg } from './per-kg-model';

type Doc = Record<string, unknown>;

const REF: ReferenceGrams = { diameterCm: 22, discs: 3, discHeightCm: 3, baseG: 300, soakG: 90, fillingG: 280, coatingG: 450, decorationG: 200 };

const INGREDIENTS: Record<string, Doc> = {
  FLOUR: { id: 'FLOUR', name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 },
  BUTTER: { id: 'BUTTER', name: 'Butter', priceUnit: 'kg', pricePerUnit: 8 },
  SUGAR: { id: 'SUGAR', name: 'Sugar', priceUnit: 'kg', pricePerUnit: 3 },
  VANILLA: { id: 'VANILLA', name: 'Vanilla' },
  BOX: { id: 'BOX', name: 'Cake box', priceUnit: 'pcs', pricePerUnit: 1.5 },
};
const gram = (ingredientId: string, qty: number): Doc => ({ kind: 'ingredient', ingredientId, qty, unit: 'g' });
const semi = (productId: string, qtyKg: number): Doc => ({ kind: 'semi', productId, qtyKg });

// Cards: SPONGE 2.50 a kilo, no labour; GANACHE 5.50 a kilo with 30 minutes of work per kilo batch; BREAD 2.00 a kilo of flour
// (so flour appears in two cards); CREAM has no price at all; LOSSY loses 200 g of its 1 kg batch in the oven.
const SPONGE: Doc = { id: 'SPONGE', name: 'Sponge', kind: 'semi', model: 4, components: [gram('FLOUR', 500), gram('SUGAR', 500)] };
const GANACHE: Doc = { id: 'GANACHE', name: 'Ganache', kind: 'semi', model: 4, labourMinutes: 30, components: [gram('BUTTER', 500), gram('SUGAR', 500)] };
const BREAD: Doc = { id: 'BREAD', name: 'Bread', kind: 'semi', model: 4, components: [gram('FLOUR', 1000)] };
const CREAM: Doc = { id: 'CREAM', name: 'Cream', kind: 'semi', model: 4, components: [gram('VANILLA', 10)] };
const LOSSY: Doc = { ...GANACHE, id: 'LOSSY', name: 'Lossy ganache', cookedGrams: 800 };
// A card inside a card: its own flour plus the sponge.
const NESTED: Doc = { id: 'NESTED', name: 'Nested', kind: 'semi', model: 4, components: [gram('FLOUR', 500), semi('SPONGE', 0.5)] };

const tablesOf = (rate: number | null = 12): CostTables => ({
  ingredients: INGREDIENTS,
  products: new Map([SPONGE, GANACHE, BREAD, CREAM, LOSSY, NESTED].map(card => [card['id'] as string, card])),
  labourCostPerHour: rate,
});
const TABLES = tablesOf();

const line = (tier: number, part: CakePart, productId: string, grams: number | null = null): CakeLine => ({ tier, part, productId, grams });

function cakeOf(overrides: Partial<Cake> = {}): Cake {
  return {
    id: 'c1', name: 'Wedding', diameterCm: 22, tiers: 1, discs: 3, slices: 20,
    lines: [line(0, 'base', 'SPONGE'), line(0, 'filling', 'GANACHE'), line(0, 'coating', 'GANACHE')],
    packaging: [{ ingredientId: 'BOX', qtyPcs: 1 }],
    assemblyMinutes: 60, sellingPrice: 60, vatRate: 0, foodCostTarget: 30, categoryId: null, ref: REF, model: CAKE_MODEL,
    ...overrides,
  };
}

describe('measures', () => {
  test('tier diameters step down by 6 cm', () => {
    expect(tierDiameters(24, 3)).toEqual([24, 18, 12]);
    expect(tierDiameters(24, 1)).toEqual([24]);
  });
  test('the smallest bottom diameter and the most tiers a diameter carries', () => {
    expect([1, 2, 3].map(minDiameterFor)).toEqual([10, 16, 22]);
    expect([22, 20, 16, 15, 9].map(maxTiersFor)).toEqual([3, 2, 2, 1, 0]);
  });
});

describe('the grams rule', () => {
  test('the reference cake gets its own grams back', () => {
    const grams = (part: CakePart) => ruleGrams(REF, part, 22, 3);
    expect(CAKE_PARTS.map(grams)).toEqual([200, 450, 560, 270, 900].map(n => expect.closeTo(n, 6)));
  });
  test('a 26 cm cake of 3 discs scales by area (the coating by surface)', () => {
    const at = (part: CakePart) => ruleGrams(REF, part, 26, 3) as number;
    expect(at('base')).toBeCloseTo(1257.0, 1);
    expect(at('soak')).toBeCloseTo(377.1, 1);
    expect(at('filling')).toBeCloseTo(782.1, 1);
    expect(at('coating')).toBeCloseTo(568.5, 1);
    expect(at('decoration')).toBeCloseTo(279.3, 1);
  });
  test('one disc has no layer between two discs, and no reference gives no rule', () => {
    expect(ruleGrams(REF, 'filling', 22, 1)).toBe(0);
    expect(ruleGrams(null, 'base', 22, 3)).toBeNull();
  });
});

describe('resolveLines', () => {
  test('two cards in a part share the rule, whole grams', () => {
    const cake = cakeOf({ diameterCm: 24, lines: [line(0, 'filling', 'GANACHE'), line(0, 'filling', 'CREAM')] });
    const rows = resolveLines(cake);
    // 280 × (24/22)² × 2 gaps = 666.4 g, shared 333 + 333.
    expect(rows.map(r => r.grams)).toEqual([333, 333]);
    expect(rows[0]?.ruleG).toBeCloseTo(666.4, 1);
    expect(rows.every(r => !r.manual && !r.missing)).toBe(true);
  });
  test('a typed figure wins and keeps the rule beside it', () => {
    const [row] = resolveLines(cakeOf({ lines: [line(0, 'base', 'SPONGE', 850)] }));
    expect(row).toMatchObject({ grams: 850, manual: true, ruleG: expect.closeTo(900, 6), missing: false });
  });
  test('lines of a tier the cake no longer has are left out', () => {
    const cake = cakeOf({ tiers: 1, lines: [line(0, 'base', 'SPONGE'), line(1, 'base', 'SPONGE')] });
    expect(resolveLines(cake)).toHaveLength(1);
    expect(resolveLines({ ...cake, tiers: 2 })).toHaveLength(2);
  });
  test('upper tiers use their own, narrower diameter', () => {
    const rows = resolveLines(cakeOf({ diameterCm: 28, tiers: 2, lines: [line(0, 'base', 'SPONGE'), line(1, 'base', 'SPONGE')] }));
    expect(rows.map(r => r.diameterCm)).toEqual([28, 22]);
    expect(rows[1]?.grams).toBe(900);
  });
  test('without reference grams a line is missing and counts 0 g until a figure is typed', () => {
    const [bare, typed] = resolveLines(cakeOf({ ref: null, lines: [line(0, 'base', 'SPONGE'), line(0, 'soak', 'SPONGE', 40)] }));
    expect(bare).toMatchObject({ ruleG: null, share: null, grams: 0, missing: true });
    expect(typed).toMatchObject({ grams: 40, manual: true, missing: false });
  });
});

describe('cakeProduct', () => {
  test('one semi line per card, in order of first appearance, grams added up over tiers and parts', () => {
    const cake = cakeOf({
      lines: [line(0, 'base', 'SPONGE'), line(0, 'filling', 'GANACHE'), line(0, 'coating', 'GANACHE'), line(0, 'soak', 'SPONGE', 100)],
    });
    expect(cakeProduct(cake).components).toEqual([
      { kind: 'semi', productId: 'SPONGE', qtyKg: 1 },
      { kind: 'semi', productId: 'GANACHE', qtyKg: 1.01 },
    ]);
  });
  test('a card at 0 g is dropped', () => {
    const cake = cakeOf({ discs: 1, lines: [line(0, 'filling', 'GANACHE'), line(0, 'base', 'SPONGE')] });
    expect(cakeProduct(cake).components.map(c => (c as { productId: string }).productId)).toEqual(['SPONGE']);
  });
  test('it is sold as one piece, carries the cake\'s money fields and is model 4 finished', () => {
    const product = cakeProduct(cakeOf({ categoryId: 'CAT' }));
    expect(product).toMatchObject({
      id: 'cake-c1', name: 'Wedding', sellingMode: 'piece', piecesPerBatch: 1, sellingPrice: 60, vatRate: 0, foodCostTarget: 30,
      labourMinutes: 60, labourPeople: null, rawGrams: null, cookedGrams: null, model: PRODUCT_MODEL, kind: 'finished', categoryId: 'CAT',
      packaging: [{ ingredientId: 'BOX', qtyPcs: 1 }],
    });
  });
  test('normalizeProduct leaves it as it is', () => {
    const product = cakeProduct(cakeOf());
    expect(normalizeProduct(product)).toEqual(product);
  });
});

describe('ids', () => {
  test('a cake\'s product id and back', () => {
    expect(cakeProductId('abc')).toBe('cake-abc');
    expect(cakeIdOfProduct('cake-abc')).toBe('abc');
    expect(cakeIdOfProduct('cake-')).toBeNull();
    expect(cakeIdOfProduct('SPONGE')).toBeNull();
    expect(cakeIdOfProduct(5)).toBeNull();
    expect(isCakeProductId('cake-x')).toBe(true);
    expect(isCakeProductId(undefined)).toBe(false);
  });
});

describe('toCakeDocument', () => {
  const documentKeys = (): string[] => {
    const block = /match \/cakes\/\{cakeId\} \{[\s\S]*?hasOnly\(\[([\s\S]*?)\]\)/.exec(rules);
    expect(block, 'the cakes block is in firestore.rules').not.toBeNull();
    return [...(block as RegExpExecArray)[1]!.matchAll(/'(\w+)'/g)].map(m => m[1]!);
  };
  test('its keys are the cakes rule\'s, minus the one the data layer stamps', () => {
    const keys = Object.keys(toCakeDocument(cakeOf(), 'now')).sort();
    expect(keys).toEqual(documentKeys().filter(k => k !== 'bakery').sort());
    expect(keys).not.toContain('id');
  });
  test('model, time, and lines of tiers beyond the cake are written correctly', () => {
    const doc = toCakeDocument(cakeOf({ tiers: 1, model: null, lines: [line(0, 'base', 'SPONGE', 5), line(1, 'base', 'SPONGE')] }), '2026-11-20T10:00:00Z');
    expect(doc).toMatchObject({ model: CAKE_MODEL, updatedAt: '2026-11-20T10:00:00Z' });
    expect(doc['lines']).toEqual([{ tier: 0, part: 'base', productId: 'SPONGE', grams: 5 }]);
  });
  test('the reference is copied (not shared) and may be null', () => {
    const doc = toCakeDocument(cakeOf(), 'now');
    expect(doc['ref']).toEqual(REF);
    expect(doc['ref']).not.toBe(REF);
    expect(toCakeDocument(cakeOf({ ref: null }), 'now')['ref']).toBeNull();
  });
  test('a saved document reads back to the same cake', () => {
    const cake = cakeOf();
    expect(normalizeCake({ ...toCakeDocument(cake, 'now'), id: cake.id })).toEqual(cake);
  });
});

describe('costs come from the Food cost engine', () => {
  const cake = cakeOf();
  const product = cakeProduct(cake);

  test('the totals are the engine\'s own figures for the derived product', () => {
    const totals = cakeTotals(cake, TABLES);
    const pc = productionCost(product, TABLES);
    const result = costProduct(product, TABLES);
    expect(totals.materials).toBe(pc.unitCost);
    expect(totals.labour).toBe(pc.labourUnitCost);
    expect(totals.total).toBe(pc.totalUnitCost);
    expect(totals.foodCostPct).toBe(result.foodCostPct);
    expect(totals.status).toBe(result.status);
    expect(totals.materials).toBeGreaterThan(0);
    expect(totals.foodCostPct).not.toBeNull();
    expect(totals.suggestedGross).not.toBeNull();
  });
  test('the lines\' materials add up to the batch cost to the cent', () => {
    const sum = cakeLineCosts(cake, TABLES).reduce((s, l) => s + (l.materials as number), 0);
    expect(sum).toBeCloseTo(productionCost(product, TABLES).batch.cost, 2);
  });
  test('assembly plus the semis\' work is the labour per unit', () => {
    const totals = cakeTotals(cake, TABLES);
    expect(totals.labourAssembly).toBe(labourBatchCost(product, TABLES));
    expect((totals.labourAssembly as number) + (totals.labourSemis as number)).toBeCloseTo(totals.labour as number, 4);
    expect(totals.labourSemis).toBeGreaterThan(0);
  });
  test('without a labour rate there is no labour and no total, and the slice keeps its materials figure', () => {
    const totals = cakeTotals(cake, tablesOf(null));
    expect(totals).toMatchObject({ labour: null, labourAssembly: null, labourSemis: null, total: null });
    expect(totals.perSlice.cost).toBeCloseTo((totals.materials as number) / 20, 4);
    expect(totals.perSlice.total).toBeNull();
  });
  test('per slice: the figure alone is ALWAYS the materials (whoever looks); materials + labour apart', () => {
    const totals = cakeTotals(cake, TABLES);
    expect(totals.perSlice.price).toBe(3);
    // Rounded to 4 decimals, so only the third is certain.
    expect(totals.perSlice.cost).toBeCloseTo((totals.materials as number) / 20, 3);
    expect(totals.perSlice.total).toBeCloseTo((totals.total as number) / 20, 3);
    expect(totals.perSlice.cost).toBe(cakeTotals(cake, tablesOf(null)).perSlice.cost);
  });
  test('a card with no price makes the cost partial and is named', () => {
    const totals = cakeTotals(cakeOf({ lines: [line(0, 'base', 'SPONGE'), line(0, 'decoration', 'CREAM')] }), TABLES);
    expect(totals.partial).toBe(true);
    expect(totals.unpricedIds).toEqual(['CREAM']);
    expect(cakeLineCosts(cakeOf({ lines: [line(0, 'decoration', 'CREAM')] }), TABLES)[0]).toMatchObject({ materials: null, reason: 'card-no-price' });
  });
  test('no VAT or no price leaves the food cost % empty', () => {
    expect(cakeTotals(cakeOf({ vatRate: null }), TABLES).foodCostPct).toBeNull();
    expect(cakeTotals(cakeOf({ sellingPrice: null }), TABLES).foodCostPct).toBeNull();
    expect(cakeTotals(cakeOf({ sellingPrice: null }), TABLES).perSlice.price).toBeNull();
  });
});

describe('cakeNeeds', () => {
  const need = (cake: Cake, count = 1, tables = TABLES) => cakeNeeds(cakeProduct(cake), tables, count);

  test('a card with no loss: ready = prepare', () => {
    const [sponge] = need(cakeOf()).semis;
    expect(sponge).toMatchObject({ productId: 'SPONGE', readyKg: 0.9, lossPct: null });
    expect(sponge?.prepareKg).toBeCloseTo(0.9, 9);
  });
  test('a card with a cooked weight: prepare = ready × raw ÷ cooked', () => {
    const cake = cakeOf({ lines: [line(0, 'filling', 'LOSSY', 800)] });
    const [lossy] = need(cake).semis;
    expect(lossy).toMatchObject({ readyKg: 0.8, lossPct: 20 });
    expect(lossy?.prepareKg).toBeCloseTo(1, 9);
  });
  test('the ingredients are the cake product\'s own cost-per-kilo rows × the batch kilos × the count', () => {
    const cake = cakeOf({ lines: [line(0, 'base', 'SPONGE'), line(0, 'filling', 'GANACHE'), line(0, 'decoration', 'BREAD', 300)] });
    const count = 3;
    const rows = costPerKg(cakeProduct(cake), TABLES, { packaging: false });
    const { ingredients } = need(cake, count);
    expect(ingredients).toHaveLength(rows.rows.length);
    for (const row of rows.rows) {
      const found = ingredients.find(i => i.key === row.key);
      expect(found?.kg).toBeCloseTo((row.kg as number) * (rows.kg as number) * count, 4);
    }
  });
  test('flour from two cards is one row naming both', () => {
    const cake = cakeOf({ lines: [line(0, 'base', 'SPONGE', 500), line(0, 'decoration', 'BREAD', 500)] });
    const flour = need(cake).ingredients.filter(i => i.key === 'ing:FLOUR');
    expect(flour).toHaveLength(1);
    expect(flour[0]?.from).toEqual(['Sponge', 'Bread']);
    expect(flour[0]?.kg).toBeCloseTo(0.25 + 0.5, 5);
  });
  test('rows are sorted by kilos, biggest first', () => {
    const kg = need(cakeOf()).ingredients.map(i => i.kg as number);
    expect([...kg].sort((a, b) => b - a)).toEqual(kg);
  });
  test('a card with no price is not opened', () => {
    const cake = cakeOf({ lines: [line(0, 'base', 'SPONGE'), line(0, 'decoration', 'CREAM', 100)] });
    expect(need(cake).notOpened).toEqual([{ productId: 'CREAM', name: 'Cream' }]);
  });
  test('the count is clamped from 1 to 99', () => {
    const one = need(cakeOf(), 1).semis[0]?.readyKg as number;
    expect(need(cakeOf(), 0).semis[0]?.readyKg).toBe(one);
    expect(need(cakeOf(), Number.NaN).semis[0]?.readyKg).toBe(one);
    expect(need(cakeOf(), 500).semis[0]?.readyKg).toBeCloseTo(one * 99, 9);
  });
  test('a card inside a card is opened down to its own ingredients', () => {
    const cake = cakeOf({ lines: [line(0, 'base', 'NESTED', 1000)] });
    const { ingredients } = need(cake);
    expect(ingredients.map(i => i.key).sort()).toEqual(['ing:FLOUR', 'ing:SUGAR']);
    // 1 kg of NESTED: its 500 g of flour + 0.5 kg of sponge (250 g flour, 250 g sugar) out of a 1 kg batch of 1.0 kg.
    expect(ingredients.find(i => i.key === 'ing:FLOUR')?.kg).toBeCloseTo(0.75, 5);
  });
});

describe('cakeGeometry', () => {
  test('one entry per tier, with its parts', () => {
    const geometry = cakeGeometry(cakeOf({ diameterCm: 28, tiers: 2, lines: [line(0, 'base', 'SPONGE'), line(1, 'base', 'SPONGE', 100), line(1, 'filling', 'GANACHE')] }));
    expect(geometry.tiers.map(t => t.diameterCm)).toEqual([28, 22]);
    expect(geometry.tiers[1]?.parts.base).toEqual({ productIds: ['SPONGE'], grams: 100 });
    expect(geometry.tiers[0]?.parts.soak).toEqual({ productIds: [], grams: 0 });
    expect(geometry.tiers[0]?.discHeightCm).toBe(3);
  });
});

describe('references', () => {
  test('all eight valid, or nothing', () => {
    expect(normalizeReference(REF)).toEqual(REF);
    expect(normalizeReference({ ...REF, extra: 1 })).toEqual(REF);
    for (const key of REFERENCE_KEYS) expect(normalizeReference({ ...REF, [key]: undefined })).toBeNull();
    expect(normalizeReference({ ...REF, discs: 2.5 })).toBeNull();
    expect(normalizeReference({ ...REF, diameterCm: 9 })).toBeNull();
    expect(normalizeReference({ ...REF, baseG: -1 })).toBeNull();
    expect(normalizeReference({ ...REF, discHeightCm: 0 })).toBeNull();
    expect(normalizeReference('x')).toBeNull();
  });
  test('sameReference', () => {
    expect(sameReference(REF, { ...REF })).toBe(true);
    expect(sameReference(REF, { ...REF, soakG: 91 })).toBe(false);
    expect(sameReference(null, null)).toBe(true);
    expect(sameReference(REF, null)).toBe(false);
  });
  test('REFERENCE_KEYS are the keys the rules\' isCakeReference lists', () => {
    const block = /function isCakeReference\(m\) \{[\s\S]*?hasOnly\(\[([\s\S]*?)\]\)/.exec(rules);
    expect(block).not.toBeNull();
    const listed = [...(block as RegExpExecArray)[1]!.matchAll(/'(\w+)'/g)].map(m => m[1]);
    expect([...REFERENCE_KEYS].sort()).toEqual([...listed].sort());
  });
});

describe('normalizeCake', () => {
  const good = { id: 'c', name: ' Torta ', diameterCm: 22, tiers: 1, discs: 3, slices: 12 };

  test('junk in, nothing thrown, never NaN', () => {
    for (const raw of [null, undefined, 5, 'x', [], true]) expect(normalizeCake(raw)).toBeNull();
    const cake = normalizeCake({ id: 3, name: 7, diameterCm: Number.NaN, tiers: 'two', discs: '3', slices: Infinity, lines: 'no', packaging: {}, sellingPrice: '9', vatRate: -1 });
    expect(cake).toMatchObject({ id: '', name: '', diameterCm: 20, tiers: 1, discs: 3, slices: 12, lines: [], packaging: [], sellingPrice: null, vatRate: null, ref: null, model: null });
  });
  test('numbers are clamped to the rules\' bounds', () => {
    expect(normalizeCake({ ...good, diameterCm: 90, discs: 9, slices: 999 })).toMatchObject({ diameterCm: 60, discs: 5, slices: 200 });
    expect(normalizeCake({ ...good, diameterCm: 3, discs: 0, slices: 0 })).toMatchObject({ diameterCm: 10, discs: 1, slices: 1 });
    expect(normalizeCake({ ...good, name: 'x'.repeat(300) })?.name).toHaveLength(200);
  });
  test('tiers are cut to what the diameter carries', () => {
    expect(normalizeCake({ ...good, diameterCm: 20, tiers: 3 })?.tiers).toBe(2);
    expect(normalizeCake({ ...good, diameterCm: 10, tiers: 3 })?.tiers).toBe(1);
  });
  test('bad lines are dropped: a 4th tier, a bad part, junk grams kept as «from the rule»', () => {
    const cake = normalizeCake({
      ...good,
      lines: [
        { tier: 3, part: 'base', productId: 'A', grams: 1 },
        { tier: 0, part: 'icing', productId: 'A', grams: 1 },
        { tier: 0, part: 'base', productId: '', grams: 1 },
        { tier: 0.5, part: 'base', productId: 'A', grams: 1 },
        { tier: 0, part: 'soak', productId: 'A', grams: Number.NaN },
        { tier: 0, part: 'soak', productId: 'B', grams: '5' },
        { tier: 0, part: 'soak', productId: 'C', grams: -3 },
        { tier: 0, part: 'soak', productId: 'D', grams: 12.6 },
        { tier: 0, part: 'soak', productId: 'E', grams: 9e9 },
        'junk',
      ],
    }) as Cake;
    expect(cake.lines.map(l => [l.productId, l.grams])).toEqual([['A', null], ['B', null], ['C', null], ['D', 13], ['E', 100000]]);
  });
  test('the same card twice in one tier and part is dropped; in another part it stays', () => {
    const cake = normalizeCake({ ...good, lines: [line(0, 'base', 'A', 5), line(0, 'base', 'A', 9), line(0, 'soak', 'A'), line(1, 'base', 'A')] }) as Cake;
    expect(cake.lines).toHaveLength(3);
    expect(cake.lines[0]?.grams).toBe(5);
  });
  test('a 7th card in a part is dropped', () => {
    const lines = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(id => line(0, 'base', id));
    expect((normalizeCake({ ...good, lines }) as Cake).lines.map(l => l.productId)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });
  test('packaging: bad rows dropped, at most 20, pieces clamped', () => {
    const packaging = [{ ingredientId: 'BOX', qtyPcs: 5000 }, { ingredientId: '', qtyPcs: 1 }, { ingredientId: 'X', qtyPcs: 0 }, { ingredientId: 'Y', qtyPcs: 'a' }];
    expect((normalizeCake({ ...good, packaging }) as Cake).packaging).toEqual([{ ingredientId: 'BOX', qtyPcs: 1000 }]);
    const many = Array.from({ length: 30 }, (_, i) => ({ ingredientId: `I${i}`, qtyPcs: 1 }));
    expect((normalizeCake({ ...good, packaging: many }) as Cake).packaging).toHaveLength(20);
  });
  test('optional numbers: only what the rules accept survives', () => {
    const cake = normalizeCake({ ...good, assemblyMinutes: 0, sellingPrice: 200000, vatRate: 150, foodCostTarget: 250, categoryId: '', model: 1.5 }) as Cake;
    expect(cake).toMatchObject({ assemblyMinutes: null, sellingPrice: 100000, vatRate: 100, foodCostTarget: 100, categoryId: null, model: null });
    expect(normalizeCake({ ...good, vatRate: 0 })?.vatRate).toBe(0);
  });
});
