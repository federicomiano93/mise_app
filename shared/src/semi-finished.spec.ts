// Unit tests for the SEMI-FINISHED cards of Food cost (Mise 2, product model 4, 20 Nov 2026 — the cakes plan, step 1): a card that
// is used inside other cards, priced per kilo, and the line that holds it. NEW IN MISE 2, no original in the current app, so these
// run against the port only; every input without a semi-finished line is proved unchanged by the paired specs (foodcost-model,
// per-kg-model, odd-inputs). Fake data only (P15 — the owner cannot read code, so these tests are the safety net).
//
// The rules under test, in Federico's words of 20 Nov 2026:
//   - one engine: a semi line costs qtyKg × the card's cost per kilo, the same figure costPerKg gives (no second sum);
//   - the kilo is a kilo of what comes out of THAT card's oven, its own loss included;
//   - labour stays beside the materials, never inside the food cost %, and a card's labour includes its semi cards' (recursively);
//   - no labour rate → every labour figure is null, never 0;
//   - a missing card, a loop, or a card with no price is never a cost of 0.

import { describe, expect, test } from 'vitest';
import {
  MAX_SEMI_DEPTH, PRODUCT_MODEL, batchTotals, cardsUsing, componentLineCost, costProduct, currentProduct, normalizeProduct, productSnapshot,
  productionCost, semiCardCost, semiReachable, snapshotWorthTaking, totalLabourBatchCost, unpricedParts, wouldBeTooDeep, wouldLoop,
} from './foodcost-model';
import type { CostTables } from './foodcost-model';
import { costPerKg } from './per-kg-model';
import { priceItemOf } from './price-list';

type Doc = Record<string, unknown>;

const INGREDIENTS: Record<string, Doc> = {
  FLOUR: { id: 'FLOUR', name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 },
  BUTTER: { id: 'BUTTER', name: 'Butter', priceUnit: 'kg', pricePerUnit: 8 },
  SUGAR: { id: 'SUGAR', name: 'Sugar', priceUnit: 'kg', pricePerUnit: 3 },
  VANILLA: { id: 'VANILLA', name: 'Vanilla' },
};

const gram = (ingredientId: string, qty: number): Doc => ({ kind: 'ingredient', ingredientId, qty, unit: 'g' });
const semi = (productId: string, qtyKg: number): Doc => ({ kind: 'semi', productId, qtyKg });

// 5.50 a kilo of materials, 6.00 of labour at 12 an hour (30 minutes, one person), nothing lost.
const GANACHE: Doc = {
  id: 'GANACHE', name: 'Ganache', kind: 'semi', model: 4, labourMinutes: 30,
  components: [gram('BUTTER', 500), gram('SUGAR', 500)],
};
// The same, but 200 g of the 1 kg batch is lost in the oven: a kilo of what comes out costs 5.50 ÷ 0.8.
const LOSSY: Doc = { ...GANACHE, id: 'LOSSY', name: 'Lossy ganache', cookedGrams: 800 };
// 1 kg of flour and 400 g of ganache, sold in 10 pieces, an hour of work.
const CAKE: Doc = {
  id: 'CAKE', name: 'Cake', kind: 'finished', model: 4, labourMinutes: 60,
  sellingMode: 'piece', piecesPerBatch: 10, sellingPrice: 6, vatRate: 0, foodCostTarget: 30,
  components: [gram('FLOUR', 1000), semi('GANACHE', 0.4)],
};

const tablesOf = (...cards: Doc[]): CostTables => ({
  ingredients: INGREDIENTS,
  products: new Map(cards.map(card => [card['id'] as string, card])),
  labourCostPerHour: 12,
});
const TABLES = tablesOf(GANACHE, LOSSY, CAKE);
const NO_RATE: CostTables = { ...TABLES, labourCostPerHour: null };

describe('a semi-finished line costs qtyKg × the card\'s cost per kilo', () => {
  test('the line, its weight and the batch it sits in', () => {
    const line = componentLineCost(semi('GANACHE', 0.4), TABLES);
    expect(line).toMatchObject({ name: 'Ganache', rate: 5.5, rateUnit: 'kg', cost: 2.2, kg: 0.4, partial: false, reason: null });
    const batch = batchTotals(CAKE, TABLES);
    // 1 kg of flour (2.00) + 0.4 kg of ganache (2.20); the batch weighs both.
    expect(batch.cost).toBe(4.2);
    expect(batch.kg).toBe(1.4);
    expect(batch.partial).toBe(false);
    expect(batch.rows[1]).toMatchObject({ kind: 'semi', id: 'GANACHE', name: 'Ganache', qty: 0.4, cost: 2.2, reason: null });
  });

  test('it is the very figure costPerKg gives for the card (one engine, no second sum)', () => {
    const perKg = costPerKg(GANACHE, TABLES, { packaging: false }).total;
    expect(perKg).toBe(5.5);
    expect(componentLineCost(semi('GANACHE', 1), TABLES).cost).toBe(perKg);
    const lossy = costPerKg(LOSSY, TABLES, { packaging: false }).total;
    expect(lossy).toBe(6.875);
    expect(componentLineCost(semi('LOSSY', 1), TABLES).cost).toBe(lossy);
  });

  test('the card\'s own oven loss is inside its kilo: 0.4 kg of a card that loses 20% costs 0.4 × 6.875', () => {
    expect(componentLineCost(semi('LOSSY', 0.4), TABLES)).toMatchObject({ cost: 2.75, materialsPerKg: 6.875, labourPerKg: 7.5 });
  });

  test('a kilo of the card goes through the food cost: the cake\'s cost per piece and food cost % include the ganache', () => {
    const result = costProduct(CAKE, TABLES);
    expect(result.unitCost).toBe(0.42);
    expect(result.foodCostPct).toBe(7);
  });

  test('the semi-finished card\'s own figures per kilo, for the list and the editor', () => {
    expect(semiCardCost(GANACHE, TABLES)).toStrictEqual({
      materialsPerKg: 5.5, labourPerKg: 6, totalPerKg: 11.5, partial: false, reason: null,
    });
    expect(semiCardCost(LOSSY, TABLES)).toMatchObject({ materialsPerKg: 6.875, labourPerKg: 7.5, totalPerKg: 14.375 });
    // A draft being edited is costed from what it holds now, not from its stored copy.
    expect(semiCardCost({ ...GANACHE, components: [gram('BUTTER', 1000)] }, TABLES).materialsPerKg).toBe(8);
  });
});

describe('labour stays beside the materials and includes the semi-finished cards\' work', () => {
  test('a semi line carries its labour: 0.4 kg × 6.00 a kilo', () => {
    expect(componentLineCost(semi('GANACHE', 0.4), TABLES)).toMatchObject({ labourPerKg: 6, labour: 2.4 });
    expect(batchTotals(CAKE, TABLES).rows[1]).toMatchObject({ labour: 2.4 });
  });

  test('the card\'s labour is its own hour (12.00) plus the ganache\'s 2.40 — and never enters the unit cost', () => {
    const cost = productionCost(CAKE, TABLES);
    expect(cost.labourBatchCost).toBe(14.4);
    expect(totalLabourBatchCost(CAKE, TABLES)).toBe(14.4);
    expect(cost.labourUnitCost).toBe(1.44);
    // The materials alone: 4.20 over 10 pieces.
    expect(cost.unitCost).toBe(0.42);
    expect(cost.totalUnitCost).toBe(1.86);
  });

  test('labour nests: a card inside a card inside a card adds its work at each step', () => {
    const FILLING: Doc = { id: 'FILLING', name: 'Filling', kind: 'semi', model: 4, labourMinutes: 60, components: [gram('SUGAR', 1000), semi('GANACHE', 1)] };
    const tables = tablesOf(GANACHE, FILLING);
    // Filling: 12.00 of its own hour + 1 kg of ganache (6.00) = 18.00 over 2 kg; a kilo of it carries 9.00.
    expect(totalLabourBatchCost(FILLING, tables)).toBe(18);
    expect(semiCardCost(FILLING, tables)).toMatchObject({ materialsPerKg: 4.25, labourPerKg: 9 });
  });

  test('no labour rate: every labour figure is null, never 0 — and the materials are untouched', () => {
    expect(componentLineCost(semi('GANACHE', 0.4), NO_RATE)).toMatchObject({ cost: 2.2, labourPerKg: null, labour: null });
    const cost = productionCost(CAKE, NO_RATE);
    expect(cost.labourBatchCost).toBeNull();
    expect(cost.labourUnitCost).toBeNull();
    expect(cost.totalUnitCost).toBeNull();
    expect(cost.unitCost).toBe(0.42);
    expect(semiCardCost(GANACHE, NO_RATE)).toMatchObject({ materialsPerKg: 5.5, labourPerKg: null, totalPerKg: 5.5 });
  });

  test('a card with no minutes of its own still carries its semi-finished cards\' labour; with none anywhere it is null', () => {
    const plain: Doc = { ...CAKE, labourMinutes: null };
    expect(productionCost(plain, TABLES).labourBatchCost).toBe(2.4);
    const none = tablesOf({ ...GANACHE, labourMinutes: null });
    expect(productionCost(plain, none).labourBatchCost).toBeNull();
  });
});

describe('what cannot be costed is said, never a cost of 0', () => {
  test('a card that is gone', () => {
    const line = componentLineCost(semi('NOPE', 1), TABLES);
    expect(line).toMatchObject({ cost: null, partial: true, reason: 'no-card' });
    expect(batchTotals({ ...CAKE, components: [semi('NOPE', 1)] }, TABLES)).toMatchObject({ cost: 0, partial: true });
  });

  test('a card with no price at all', () => {
    const empty: Doc = { id: 'EMPTY', name: 'Empty', kind: 'semi', model: 4, components: [gram('VANILLA', 10)] };
    const tables = tablesOf(empty);
    expect(componentLineCost(semi('EMPTY', 1), tables)).toMatchObject({ cost: null, partial: true, reason: 'card-no-price', name: 'Empty' });
    expect(semiCardCost(empty, tables)).toMatchObject({ materialsPerKg: null, totalPerKg: null, reason: 'card-no-price' });
  });

  test('a card priced in part costs what it can and makes the card partial, as an unpriced ingredient does', () => {
    const half: Doc = { id: 'HALF', name: 'Half', kind: 'semi', model: 4, components: [gram('SUGAR', 1000), gram('VANILLA', 10)] };
    const line = componentLineCost(semi('HALF', 1), tablesOf(half));
    // The unpriced vanilla weighs 10 g and costs nothing: the kilo reads too LOW, and the line says it is partial.
    expect(line).toMatchObject({ cost: 2.9703, partial: true });
    const holder: Doc = { id: 'HOLDER', name: 'Holder', model: 4, components: [semi('HALF', 1)] };
    expect(batchTotals(holder, tablesOf(half, holder)).partial).toBe(true);
  });

  test('a card that holds itself, or holds a card that holds it', () => {
    const self: Doc = { id: 'SELF', name: 'Self', kind: 'semi', model: 4, components: [gram('SUGAR', 1000), semi('SELF', 1)] };
    expect(componentLineCost(semi('SELF', 1), tablesOf(self))).toMatchObject({ cost: null, reason: 'card-loop' });
    const a: Doc = { id: 'A', name: 'A', kind: 'semi', model: 4, components: [gram('SUGAR', 1000), semi('B', 1)] };
    const b: Doc = { id: 'B', name: 'B', kind: 'semi', model: 4, components: [gram('SUGAR', 1000), semi('A', 1)] };
    const tables = tablesOf(a, b);
    expect(componentLineCost(semi('B', 1), tables)).toMatchObject({ cost: null, reason: 'card-loop' });
    expect(batchTotals(a, tables).rows[1]).toMatchObject({ kind: 'semi', cost: null, reason: 'card-loop' });
    expect(semiCardCost(a, tables)).toMatchObject({ materialsPerKg: null, reason: 'card-loop', partial: true });
    expect(costPerKg(a, tables, { packaging: false }).rows.some(row => row.reason === 'no-recipe')).toBe(true);
  });

  test(`a chain deeper than ${MAX_SEMI_DEPTH} cards is "too deep", not a loop; exactly ${MAX_SEMI_DEPTH} deep is costed`, () => {
    const chain = (length: number): CostTables => {
      const cards: Doc[] = [];
      for (let i = 0; i < length; i++) {
        cards.push({ id: `L${i}`, name: `L${i}`, kind: 'semi', model: 4, components: i === length - 1 ? [gram('SUGAR', 1000)] : [semi(`L${i + 1}`, 1)] });
      }
      return tablesOf(...cards);
    };
    // L0 → L1 → L2 → L3 → L4: the line from L1 reaches four cards.
    expect(componentLineCost(semi('L1', 1), chain(5)).cost).toBe(3);
    expect(componentLineCost(semi('L0', 1), chain(6))).toMatchObject({ cost: null, reason: 'card-too-deep' });
    // A real loop stays a loop, even a long one.
    const ring: Doc[] = [0, 1, 2, 3, 4].map(i => ({ id: `R${i}`, name: `R${i}`, kind: 'semi', model: 4, components: [semi(`R${(i + 1) % 5}`, 1)] }));
    expect(componentLineCost(semi('R0', 1), tablesOf(...ring))).toMatchObject({ cost: null, reason: 'card-loop' });
  });

  test('the card’s own «Cost per kg» and its «Made of» total count depth the same way', () => {
    // S holds four cards inside each other (D1 → D2 → D3 → D4): batchTotals(S) and semiCardCost(S) must both cost it, or both refuse.
    const deep = (levels: number): { tables: CostTables; top: Doc } => {
      const cards: Doc[] = [];
      for (let i = 1; i <= levels; i++) {
        cards.push({ id: `D${i}`, name: `D${i}`, kind: 'semi', model: 4, components: i === levels ? [gram('SUGAR', 1000)] : [semi(`D${i + 1}`, 1)] });
      }
      const top: Doc = { id: 'S', name: 'S', kind: 'semi', model: 4, components: [semi('D1', 1)] };
      return { tables: tablesOf(top, ...cards), top };
    };
    const four = deep(4);
    expect(batchTotals(four.top, four.tables).cost).toBe(3);
    expect(semiCardCost(four.top, four.tables)).toMatchObject({ materialsPerKg: 3, reason: null });
    const five = deep(5);
    expect(batchTotals(five.top, five.tables).rows[0]).toMatchObject({ cost: null, reason: 'card-too-deep' });
    expect(semiCardCost(five.top, five.tables)).toMatchObject({ materialsPerKg: null, reason: 'card-too-deep' });
  });

  test('wouldBeTooDeep: the choice that would pile up more than the limit, for the card and for the cards above it', () => {
    const mk = (id: string, ...inside: string[]): Doc => ({ id, name: id, kind: 'semi', components: inside.map(x => semi(x, 1)) });
    // C0 holds C1 holds C2 holds C3 holds C4: C0 is already four levels deep. X is free-standing.
    const base: [string, unknown][] = [['C0', mk('C0', 'C1')], ['C1', mk('C1', 'C2')], ['C2', mk('C2', 'C3')], ['C3', mk('C3', 'C4')], ['C4', mk('C4')], ['X', mk('X')]];
    const table = new Map<string, unknown>(base);
    // One more under C4 would make C0's chain five: refused, though C4 itself would only be one deep.
    expect(wouldBeTooDeep(table, 'C4', 'X')).toBe(true);
    expect(wouldBeTooDeep(table, 'C0', 'X')).toBe(false); // one more branch beside C1
    expect(wouldBeTooDeep(table, 'X', 'C1')).toBe(false); // X → C1 → C2 → C3 → C4 is four
    expect(wouldBeTooDeep(table, 'X', 'C0')).toBe(true); // X → C0 → … → C4 is five
    // A loop is wouldLoop's business, not this one's.
    expect(wouldBeTooDeep(table, 'C4', 'C0')).toBe(false);
    expect(wouldLoop(table, 'C4', 'C0')).toBe(true);
    // A new card (no id) is measured by what it would hold only.
    expect(wouldBeTooDeep(table, '', 'C0')).toBe(true);
    expect(wouldBeTooDeep(table, '', 'C1')).toBe(false);
    expect(wouldBeTooDeep(table, '', 'X')).toBe(false);
  });

  test('«Which?» names the card inside that has no price, and the one that is gone', () => {
    const empty: Doc = { id: 'EMPTY', name: 'Empty', kind: 'semi', model: 4, components: [gram('VANILLA', 10)] };
    const holder: Doc = { id: 'H', name: 'H', model: 4, components: [semi('EMPTY', 1), semi('NOPE', 1)] };
    const t = (key: string): string => key;
    const parts = unpricedParts(holder, tablesOf(empty, holder), t);
    expect(parts).toContainEqual({ name: 'Empty', inRecipe: '', reason: 'card-no-price' });
    expect(parts).toContainEqual({ name: 'fc.thisCardNoLonger', inRecipe: '', reason: 'gone' });
  });
});

describe('loops are found before they are made', () => {
  const a: Doc = { id: 'A', name: 'A', kind: 'semi', components: [semi('B', 1)] };
  const b: Doc = { id: 'B', name: 'B', kind: 'semi', components: [semi('C', 1)] };
  const c: Doc = { id: 'C', name: 'C', kind: 'semi', components: [gram('SUGAR', 10)] };
  const table = new Map<string, unknown>([['A', a], ['B', b], ['C', c]]);

  test('semiReachable lists every card below one, however deep, and ends on a loop in the data', () => {
    expect([...semiReachable(table, 'A')].sort()).toStrictEqual(['B', 'C']);
    expect([...semiReachable(table, 'C')]).toStrictEqual([]);
    const looped = new Map<string, unknown>([['X', { id: 'X', components: [semi('Y', 1)] }], ['Y', { id: 'Y', components: [semi('X', 1)] }]]);
    expect([...semiReachable(looped, 'X')].sort()).toStrictEqual(['X', 'Y']);
    expect([...semiReachable(null, 'A')]).toStrictEqual([]);
  });

  test('wouldLoop: the card itself, and any card that already holds it', () => {
    expect(wouldLoop(table, 'A', 'A')).toBe(true);
    expect(wouldLoop(table, 'C', 'A')).toBe(true);
    expect(wouldLoop(table, 'B', 'A')).toBe(true);
    expect(wouldLoop(table, 'A', 'C')).toBe(false);
    expect(wouldLoop(table, 'A', 'B')).toBe(false);
    // A card not saved yet (no id) can only loop on nothing.
    expect(wouldLoop(table, '', 'A')).toBe(false);
  });

  test('cardsUsing: the cards that hold one, with the kilos each', () => {
    const list = [a, b, c, { id: 'D', name: 'D', components: [semi('C', 0.25), semi('C', 0.5), gram('SUGAR', 5)] }];
    expect(cardsUsing(list, 'C').map(use => [use.product['id'], use.qtyKg])).toStrictEqual([['B', 1], ['D', 0.75]]);
    expect(cardsUsing(list, 'A')).toStrictEqual([]);
    expect(cardsUsing(list, '')).toStrictEqual([]);
  });
});

describe('cost per kilo opens a semi-finished line into the card\'s own rows', () => {
  test('one row per ingredient, merged with the same ingredient elsewhere, scaled by the kilos', () => {
    const cake: Doc = { ...CAKE, components: [gram('BUTTER', 600), semi('GANACHE', 0.4)] };
    const tables = tablesOf(GANACHE, cake);
    const result = costPerKg(cake, tables, { packaging: false });
    // The batch weighs 1.0 kg: 0.6 kg of butter and 0.4 kg of ganache (half butter, half sugar).
    expect(result.kg).toBe(1);
    const butter = result.rows.find(row => row.name === 'Butter');
    const sugar = result.rows.find(row => row.name === 'Sugar');
    expect(butter).toMatchObject({ kg: 0.8, cost: 6.4, reason: null });
    expect(sugar).toMatchObject({ kg: 0.2, cost: 0.6 });
    expect(result.rows.length).toBe(2);
    // The total is the card's own cost, and the rows are its parts.
    expect(result.total).toBe(7);
    expect(result.rows.reduce((sum, row) => sum + (row.cost ?? 0), 0)).toBeCloseTo(7, 3);
  });

  test('the card\'s own loss: 0.4 kg of a card that loses 20% needs 0.5 kg of its materials', () => {
    const cake: Doc = { ...CAKE, components: [semi('LOSSY', 0.4)] };
    const result = costPerKg(cake, tablesOf(LOSSY, cake), { packaging: false });
    expect(result.lossy).toBe(true);
    expect(result.rows.find(row => row.name === 'Butter')?.kg).toBeCloseTo(0.625, 6);
    expect(result.total).toBe(6.875);
  });

  test('a card inside a card is opened all the way down', () => {
    const filling: Doc = { id: 'FILLING', name: 'Filling', kind: 'semi', model: 4, components: [semi('GANACHE', 1)] };
    const cake: Doc = { ...CAKE, components: [semi('FILLING', 1)] };
    const result = costPerKg(cake, tablesOf(GANACHE, filling, cake), { packaging: false });
    expect(result.rows.map(row => row.name).sort()).toStrictEqual(['Butter', 'Sugar']);
    expect(result.total).toBe(5.5);
  });
});

describe('the margin history can explain a change from inside a semi-finished card', () => {
  const nowIso = '2026-11-20T10:00:00.000Z';

  test('frozen prices walk into the card\'s ingredients, with a guard for loops', () => {
    const snapshot = productSnapshot(CAKE, { unitCost: 0.42, foodCostPct: 7 }, nowIso, TABLES);
    expect(snapshot.frozenPrices).toStrictEqual({ FLOUR: 2, BUTTER: 8, SUGAR: 3 });
    const a: Doc = { id: 'A', name: 'A', model: 4, components: [semi('B', 1)] };
    const b: Doc = { id: 'B', name: 'B', model: 4, components: [gram('SUGAR', 1000), semi('A', 1)] };
    const looped = productSnapshot(a, { unitCost: null, foodCostPct: null }, nowIso, tablesOf(a, b));
    expect(looped.frozenPrices).toStrictEqual({ SUGAR: 3 });
  });

  test('a change of semi-finished lines is a change of composition; kind and category alone are not', () => {
    expect(snapshotWorthTaking(CAKE, { ...CAKE, components: [gram('FLOUR', 1000), semi('GANACHE', 0.5)] }, TABLES)).toBe(true);
    expect(snapshotWorthTaking(CAKE, { ...CAKE, components: [gram('FLOUR', 1000), semi('LOSSY', 0.4)] }, TABLES)).toBe(true);
    expect(snapshotWorthTaking(CAKE, { ...CAKE, kind: 'semi' }, TABLES)).toBe(false);
    expect(snapshotWorthTaking(CAKE, { ...CAKE, categoryId: 'cat-1' }, TABLES)).toBe(false);
    expect(snapshotWorthTaking(CAKE, { ...CAKE, categoryId: null }, TABLES)).toBe(false);
    // Semi → finished starts the margin history; finished → semi (above) takes none.
    expect(snapshotWorthTaking({ ...CAKE, kind: 'semi' }, CAKE, TABLES)).toBe(true);
  });
});

describe('a card as stored: kind, category, semi lines and the model', () => {
  test('the product model is 4', () => {
    expect(PRODUCT_MODEL).toBe(4);
  });

  test('normalizeProduct keeps kind, categoryId and semi lines, and drops what is not one', () => {
    const p = normalizeProduct({
      id: 'S', name: 'S', kind: 'semi', categoryId: 'cat-1',
      components: [semi('G', 0.3), { kind: 'semi', productId: '', qtyKg: 1 }, { kind: 'semi', productId: 'H', qtyKg: 'x' }, semi('I', -2)],
    });
    expect(p).toMatchObject({ kind: 'semi', categoryId: 'cat-1' });
    expect(p?.components).toStrictEqual([semi('G', 0.3), semi('H', 0), semi('I', 0)]);
  });

  test('absent, or anything else, is a finished card in no category', () => {
    expect(normalizeProduct({ name: 'A' })).toMatchObject({ kind: 'finished', categoryId: null });
    for (const kind of ['other', null, 5, 'SEMI']) expect(normalizeProduct({ name: 'A', kind })?.kind, String(kind)).toBe('finished');
    for (const categoryId of [null, '', '   ', 7, 'x'.repeat(65)]) expect(normalizeProduct({ name: 'A', categoryId })?.categoryId, String(categoryId)).toBeNull();
    expect(normalizeProduct({ name: 'A', categoryId: 'x'.repeat(64) })?.categoryId).toHaveLength(64);
  });

  test('a card read at model 3 is the same as model 4: nothing is converted a second time', () => {
    const recipes = { DOUGH: { id: 'DOUGH', name: 'Dough', lossPct: 10, ingredients: [{ label: 'Flour', grams: 1000, unit: 'g', kind: 'ingredient', refId: 'FLOUR' }] } };
    const tables: CostTables = { ingredients: INGREDIENTS, recipes };
    const three = { id: 'P', name: 'P', model: 3, components: [{ recipeId: 'DOUGH', qtyKg: 1 }] };
    expect(currentProduct(three, tables)?.components).toStrictEqual([{ recipeId: 'DOUGH', qtyKg: 1 }]);
    expect(currentProduct({ ...three, model: 4 }, tables)?.components).toStrictEqual([{ recipeId: 'DOUGH', qtyKg: 1 }]);
    // Below 3 it is still converted (raw kilos): 0.9 finished kilos of a recipe that loses 10% is 1 raw kilo.
    expect(currentProduct({ ...three, model: 2, components: [{ recipeId: 'DOUGH', qtyKg: 0.9 }] }, tables)?.components).toStrictEqual([{ recipeId: 'DOUGH', qtyKg: 1 }]);
  });
});

describe('a semi-finished card is never bookable', () => {
  const fields = { id: 'S', name: 'Ganache', sellingMode: 'weight', sellingPrice: 20, packSize: null, packUnit: null };

  test('priceItemOf gives no line for it, whatever price it still holds', () => {
    expect(priceItemOf(fields)).toMatchObject({ productId: 'S', per: 'kg' });
    expect(priceItemOf({ ...fields, kind: 'finished' })).not.toBeNull();
    expect(priceItemOf({ ...fields, kind: 'semi' })).toBeNull();
  });
});
