// Unit tests for the whole-cake label's model (Mise 2, 23 Nov 2026, Torte step 2b). NEW IN MISE 2: no original in js/. Fake data only (P15).
//
// What is under test is the CAKE's part only: which raw amounts the synthetic recipe holds, and that every refusal the label law makes
// (one unchecked ingredient anywhere) reaches the cake with the right card named. The law itself is recipe-label-model's.

import { describe, expect, test } from 'vitest';
import { CAKE_MODEL } from './cake-model';
import type { Cake, CakeLine, CakePart } from './cake-model';
import type { CostTables } from './foodcost-model';
import { cakeLabel, cakeLabelDiameters, cakeLabelRecipe } from './cake-label-model';

type Doc = Record<string, unknown>;

const NUTRITION = { kj: 1000, kcal: 240, fat: 10, saturates: 5, carbs: 30, sugars: 20, protein: 5, salt: 0.1 };
const checked = (allergens: string[], extra: Doc = {}): Doc => ({ allergens, allergensCheckedAt: '2026-01-01', nutrition: NUTRITION, ...extra });

const INGREDIENTS: Record<string, Doc> = {
  FLOUR: { id: 'FLOUR', name: 'Flour', ...checked(['gluten-wheat']) },
  SUGAR: { id: 'SUGAR', name: 'Sugar', ...checked([]) },
  BUTTER: { id: 'BUTTER', name: 'Butter', ...checked(['milk'], { mayContain: ['nuts-hazelnut'] }) },
  EGG: { id: 'EGG', name: 'Egg', unitWeightKg: 0.06, ...checked(['eggs']) },
  RUM: { id: 'RUM', name: 'Rum', allergens: [], nutrition: NUTRITION },
  BOX: { id: 'BOX', name: 'Cake box', packaging: true, ...checked([]) },
};
const gram = (ingredientId: string, qty: number): Doc => ({ kind: 'ingredient', ingredientId, qty, unit: 'g' });
const pieces = (ingredientId: string, qty: number): Doc => ({ kind: 'ingredient', ingredientId, qty, unit: 'pcs' });
const semi = (productId: string, qtyKg: number): Doc => ({ kind: 'semi', productId, qtyKg });
const card = (id: string, components: Doc[], extra: Doc = {}): Doc => ({ id, name: id.toLowerCase(), kind: 'semi', model: 4, components, ...extra });

const RECIPES: Record<string, Doc> = {
  DOUGH: {
    id: 'DOUGH', name: 'Dough',
    ingredients: [
      { label: 'Flour', refId: 'FLOUR', kind: 'ingredient', grams: 600, unit: 'g' },
      { label: 'Sugar', refId: 'SUGAR', kind: 'ingredient', grams: 400, unit: 'g' },
    ],
  },
};

const SPONGE = card('SPONGE', [gram('FLOUR', 500), gram('SUGAR', 500)]);
const LOSSY = card('LOSSY', [gram('FLOUR', 500), gram('SUGAR', 500)], { cookedGrams: 800 });
const NESTED = card('NESTED', [gram('FLOUR', 500), semi('SPONGE', 0.5)]);
const WITH_DOUGH = card('WITH_DOUGH', [{ recipeId: 'DOUGH', qtyKg: 1 }]);
const WITH_EGGS = card('WITH_EGGS', [gram('FLOUR', 500), pieces('EGG', 4)]);
const EMPTY = card('EMPTY', []);
const RUMMY = card('RUMMY', [gram('RUM', 100), gram('SUGAR', 400)]);
const LOOP_A = card('LOOP_A', [gram('SUGAR', 500), semi('LOOP_B', 0.5)]);
const LOOP_B = card('LOOP_B', [gram('SUGAR', 500), semi('LOOP_A', 0.5)]);
const DEEP = ['D0', 'D1', 'D2', 'D3', 'D4'].map((id, index, all) => card(id, [gram('SUGAR', 500), ...(index < all.length - 1 ? [semi(`D${index + 1}`, 0.5)] : [])]));

const tables: CostTables = {
  ingredients: INGREDIENTS,
  recipes: RECIPES,
  products: new Map([SPONGE, LOSSY, NESTED, WITH_DOUGH, WITH_EGGS, EMPTY, RUMMY, LOOP_A, LOOP_B, ...DEEP].map(c => [c['id'] as string, c])),
};

const line = (tier: number, part: CakePart, productId: string, grams: number | null): CakeLine => ({ tier, part, productId, grams });

function cakeOf(lines: CakeLine[], overrides: Partial<Cake> = {}): Cake {
  return {
    id: 'c1', name: ' Black forest ', diameterCm: 24, tiers: 2, discs: 3, slices: 20, lines,
    packaging: [{ ingredientId: 'BOX', qtyPcs: 1 }],
    assemblyMinutes: null, sellingPrice: null, vatRate: null, foodCostTarget: null, categoryId: null, discHeightCm: null, ref: null, model: CAKE_MODEL,
    ...overrides,
  };
}

const rowsOf = (cake: Cake) => cakeLabelRecipe(cake, tables).recipe.ingredients;

describe('the synthetic recipe', () => {
  test('two tiers sharing a card are one line, its grams summed', () => {
    const build = cakeLabelRecipe(cakeOf([line(0, 'base', 'SPONGE', 900), line(1, 'base', 'SPONGE', 400)]), tables);
    expect(build.cards).toEqual([{ productId: 'SPONGE', name: 'sponge', where: [{ part: 'base', tier: 0 }, { part: 'base', tier: 1 }], grams: 1300 }]);
    expect(build.totalGrams).toBe(1300);
    // 1300 g of a card that makes 1 kg from 500 g + 500 g: 650 g of each.
    expect(build.recipe.ingredients.map(r => [r.refId, r.grams])).toEqual([['FLOUR', 650], ['SUGAR', 650]]);
  });

  test('a card with a baking loss is scaled to its raw amounts', () => {
    const build = cakeLabelRecipe(cakeOf([line(0, 'base', 'LOSSY', 400)]), tables);
    // 400 g ready out of a batch of 800 g → half of each raw line, and the cake lost 20% on the way.
    expect(build.recipe.ingredients.map(r => [r.refId, r.grams])).toEqual([['FLOUR', 250], ['SUGAR', 250]]);
    expect(build.recipe.lossPct).toBeCloseTo(20, 6);
  });

  test('a card inside a card is walked one level down, at the grams that go in', () => {
    const build = cakeLabelRecipe(cakeOf([line(0, 'base', 'NESTED', 1000)]), tables);
    expect(build.recipe.ingredients.map(r => [r.refId, r.grams])).toEqual([['FLOUR', 500], ['FLOUR', 250], ['SUGAR', 250]]);
    // Each row belongs to the innermost card that holds it.
    expect([...build.rowCard.values()]).toEqual(['NESTED', 'SPONGE', 'SPONGE']);
  });

  test('a recipe line is a recipe row, opened by the label code', () => {
    const build = cakeLabelRecipe(cakeOf([line(0, 'base', 'WITH_DOUGH', 500)]), tables);
    expect(build.recipe.ingredients).toEqual([{ label: 'Dough', grams: 500, unit: 'g', kind: 'recipe', refId: 'DOUGH' }]);
    const answer = cakeLabel(cakeOf([line(0, 'base', 'WITH_DOUGH', 500)]), tables);
    expect(answer.state).toBe('ready');
    expect(answer.label?.ok && answer.label.ingredients.map(i => [i.name, i.grams])).toEqual([['Flour', 300], ['Sugar', 200]]);
  });

  test('an ingredient in pieces keeps its unit and ends the list without a weight', () => {
    const cake = cakeOf([line(0, 'base', 'WITH_EGGS', 740)]);
    expect(rowsOf(cake).map(r => [r.refId, r.unit])).toEqual([['FLOUR', 'g'], ['EGG', 'pcs']]);
    const answer = cakeLabel(cake, tables);
    expect(answer.state).toBe('ready');
    const list = answer.label?.ok ? answer.label.ingredients : [];
    expect(list.map(i => [i.name, i.grams])).toEqual([['Flour', 500], ['Egg', 0]]);
    // The eggs' known weight is not baked loss: nothing was lost here.
    expect(cakeLabelRecipe(cake, tables).recipe.lossPct).toBeCloseTo(0, 6);
  });

  test('packaging is never on the label', () => {
    const build = cakeLabelRecipe(cakeOf([line(0, 'base', 'SPONGE', 500)]), tables);
    expect(build.recipe.ingredients.some(r => r.refId === 'BOX')).toBe(false);
  });

  test('a line with no grams at all is left out, like the cake product leaves it out', () => {
    const build = cakeLabelRecipe(cakeOf([line(0, 'base', 'SPONGE', 500), line(0, 'filling', 'LOSSY', null)]), tables);
    expect(build.cards.map(c => c.productId)).toEqual(['SPONGE']);
  });

  test('a line of a tier the cake no longer has is not part of it', () => {
    const build = cakeLabelRecipe(cakeOf([line(0, 'base', 'SPONGE', 500), line(1, 'base', 'LOSSY', 500)], { tiers: 1 }), tables);
    expect(build.cards.map(c => c.productId)).toEqual(['SPONGE']);
  });

  test('the diameters are the tiers\', bottom first', () => {
    expect(cakeLabelDiameters({ diameterCm: 24, tiers: 2 })).toEqual([24, 18]);
  });
});

describe('what stops the label', () => {
  test('a cake with no card is empty, not refused', () => {
    expect(cakeLabel(cakeOf([]), tables).state).toBe('empty');
    expect(cakeLabel(cakeOf([line(0, 'base', 'SPONGE', null)]), tables).state).toBe('empty');
  });

  test('a card that does not exist is a problem and the label is refused', () => {
    const answer = cakeLabel(cakeOf([line(0, 'base', 'SPONGE', 500), line(0, 'filling', 'GHOST', 300)]), tables);
    expect(answer.state).toBe('blocked');
    expect(answer.blocks).toEqual([{ kind: 'card', productId: 'GHOST', name: '', reason: 'card-gone' }]);
    expect(answer.blockedCards).toBe(1);
  });

  test('a card with no weights is a problem naming the card', () => {
    const answer = cakeLabel(cakeOf([line(0, 'base', 'EMPTY', 300)]), tables);
    expect(answer.state).toBe('blocked');
    expect(answer.blocks[0]).toEqual({ kind: 'card', productId: 'EMPTY', name: 'empty', reason: 'card-no-weights' });
  });

  test('cards that hold each other are a loop, never followed for ever', () => {
    const answer = cakeLabel(cakeOf([line(0, 'base', 'LOOP_A', 500)]), tables);
    expect(answer.state).toBe('blocked');
    expect(answer.blocks.some(b => b.kind === 'card' && b.reason === 'loop')).toBe(true);
  });

  test('cards stacked deeper than the cost engine allows are refused as too deep', () => {
    const answer = cakeLabel(cakeOf([line(0, 'base', 'D0', 500)]), tables);
    expect(answer.state).toBe('blocked');
    expect(answer.blocks.some(b => b.kind === 'card' && b.reason === 'too-deep')).toBe(true);
  });

  test('one unchecked ingredient anywhere refuses the label and names its card', () => {
    const answer = cakeLabel(cakeOf([line(0, 'base', 'SPONGE', 500), line(0, 'soak', 'RUMMY', 300), line(1, 'soak', 'RUMMY', 100)]), tables);
    expect(answer.state).toBe('blocked');
    // One block, although the card sits on two tiers.
    expect(answer.blocks).toEqual([{ kind: 'ingredient', productId: 'RUMMY', cardName: 'rummy', refId: 'RUM', name: 'Rum', reason: 'not-declared' }]);
    expect(answer.blockedCards).toBe(1);
  });

  test('an unchecked ingredient inside a nested card names the inner card', () => {
    const answer = cakeLabel(cakeOf([line(0, 'base', 'SPONGE', 500), line(0, 'soak', 'RUMMY', 300)]), tables);
    expect(answer.blocks.map(b => b.kind === 'ingredient' && b.cardName)).toEqual(['rummy']);
  });

  test('an ingredient that no longer exists blocks too', () => {
    const lonely: CostTables = { ...tables, ingredients: { ...INGREDIENTS, SUGAR: undefined as unknown as Doc } };
    const answer = cakeLabel(cakeOf([line(0, 'base', 'SPONGE', 500)]), lonely);
    expect(answer.state).toBe('blocked');
    expect(answer.blocks).toEqual([{ kind: 'ingredient', productId: 'SPONGE', cardName: 'sponge', refId: 'SUGAR', name: 'SUGAR', reason: 'missing-ingredient' }]);
  });

  test('a recipe that is gone blocks as a recipe row', () => {
    const bare: CostTables = { ...tables, recipes: {} };
    const answer = cakeLabel(cakeOf([line(0, 'base', 'WITH_DOUGH', 500)]), bare);
    expect(answer.state).toBe('blocked');
    expect(answer.blocks).toEqual([{ kind: 'recipe', productId: 'WITH_DOUGH', cardName: 'with_dough', refId: 'DOUGH', name: 'DOUGH', reason: 'missing-recipe' }]);
  });
});

describe('the label of a ready cake', () => {
  const answer = cakeLabel(cakeOf([line(0, 'base', 'LOSSY', 800), line(0, 'filling', 'SPONGE', 0)]), { ...tables, products: new Map([['LOSSY', LOSSY]]) });

  test('contains and may contain are kept apart, from the label code', () => {
    const butter = card('BUTTERY', [gram('BUTTER', 500), gram('FLOUR', 500)]);
    const buttery = cakeLabel(cakeOf([line(0, 'base', 'BUTTERY', 1000)]), { ...tables, products: new Map([['BUTTERY', butter]]) });
    expect(buttery.state).toBe('ready');
    expect(buttery.label?.ok && buttery.label.allergens).toEqual(['gluten-wheat', 'milk']);
    expect(buttery.label?.ok && buttery.label.mayContain).toEqual(['nuts-hazelnut']);
  });

  test('the nutrition is per 100 g of the FINISHED cake, from the cards\' own loss', () => {
    expect(answer.state).toBe('ready');
    const nutrition = answer.label?.ok ? answer.label.nutrition : null;
    // 1000 g of raw at 240 kcal per 100 g = 2400 kcal, in 800 g: 300 per 100 g.
    expect(nutrition?.kcal).toBe(300);
    expect(nutrition?.yieldGrams).toBe(800);
    expect(nutrition?.lossPct).toBeCloseTo(20, 6);
  });

  test('the name is the cake\'s, trimmed', () => {
    expect(answer.label?.ok && answer.label.name).toBe('Black forest');
  });

  test('asking for allergens only works no nutrition out', () => {
    const only = cakeLabel(cakeOf([line(0, 'base', 'LOSSY', 800)]), { ...tables, products: new Map([['LOSSY', LOSSY]]) }, 'allergens');
    expect(only.label?.ok && only.label.nutrition).toBeNull();
  });
});
