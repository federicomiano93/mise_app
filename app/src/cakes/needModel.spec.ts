import { describe, expect, it } from 'vitest';
import { CAKE_MODEL, cakeNeeds, cakeProduct } from '@mise/shared/cake-model';
import type { Cake, CakeLine, CakePart } from '@mise/shared/cake-model';
import { moneyOf } from '@mise/shared/currency';
import type { CostTables } from '@mise/shared/foodcost-model';
import { exportRow, printedTotalGrams, rowTextOf } from '@mise/shared/recipe-export';
import { en } from '../i18n/en';
import { format } from '../i18n/i18n';
import { it as itMessages } from '../i18n/it';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import {
  gramsText, ingredientTable, kgText, needExportModel, needTitle, notOpenedText, semiTable, totalLabelText, totalNoteText,
} from './needModel';

// «What you need» as text: the rows the dialog, the printed sheet and the PDF all read. Invented cards and amounts only.

type Doc = Record<string, unknown>;
const ITALY = moneyOf('€', { decimal: ',', group: '.', symbolAfter: true });
const tEn = (key: MessageKey, params?: MessageParams) => format('en', en[key], params);
const tIt = (key: MessageKey, params?: MessageParams) => format('it', itMessages[key], params);

const gram = (ingredientId: string, qty: number): Doc => ({ kind: 'ingredient', ingredientId, qty, unit: 'g' });
const INGREDIENTS: Record<string, Doc> = {
  FLOUR: { id: 'FLOUR', name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 },
  SUGAR: { id: 'SUGAR', name: 'Sugar', priceUnit: 'kg', pricePerUnit: 3 },
  BUTTER: { id: 'BUTTER', name: 'Butter', priceUnit: 'kg', pricePerUnit: 8 },
  VANILLA: { id: 'VANILLA', name: 'Vanilla' },
};
const SPONGE: Doc = { id: 'SPONGE', name: 'Sponge', kind: 'semi', model: 4, components: [gram('FLOUR', 500), gram('SUGAR', 500)] };
const GANACHE: Doc = { id: 'GANACHE', name: 'Ganache', kind: 'semi', model: 4, components: [gram('BUTTER', 500), gram('SUGAR', 500)], cookedGrams: 800 };
const CREAM: Doc = { id: 'CREAM', name: 'Cream', kind: 'semi', model: 4, components: [gram('VANILLA', 10)] };
const EMPTY: Doc = { id: 'EMPTY', name: 'Empty card', kind: 'semi', model: 4, components: [] };
const TABLES: CostTables = {
  ingredients: INGREDIENTS,
  products: new Map([SPONGE, GANACHE, CREAM, EMPTY].map(card => [card['id'] as string, card])),
  labourCostPerHour: null,
};

const line = (tier: number, part: CakePart, productId: string, grams: number): CakeLine => ({ tier, part, productId, grams });
const cakeOf = (lines: CakeLine[], overrides: Partial<Cake> = {}): Cake => ({
  id: 'c1', name: 'Torta di prova', diameterCm: 22, tiers: 2, discs: 3, slices: 20, lines, packaging: [], assemblyMinutes: null,
  sellingPrice: null, vatRate: null, foodCostTarget: null, categoryId: null, discHeightCm: null, ref: null, model: CAKE_MODEL, ...overrides,
});
// Sponge on both tiers (800 + 400 g), ganache with a 20% loss (1 kg ready).
const CAKE = cakeOf([line(0, 'base', 'SPONGE', 800), line(1, 'base', 'SPONGE', 400), line(0, 'filling', 'GANACHE', 1000)]);
const needs = (cake: Cake, count = 1) => cakeNeeds(cakeProduct(cake), TABLES, count);

describe('the semi-finished table', () => {
  it('sums a card over every tier and says the loss and what to prepare', () => {
    const table = semiTable(needs(CAKE), ITALY);
    expect(table.rows).toEqual([
      { key: 'SPONGE', name: 'Sponge', ready: '1.200 g', loss: '—', prepare: '1.200 g' },
      { key: 'GANACHE', name: 'Ganache', ready: '1.000 g', loss: '20%', prepare: '1.250 g' },
    ]);
    expect(table.totalReady).toBe('2.200 g');
    expect(table.totalPrepare).toBe('2.450 g');
  });
  it('multiplies by the number of cakes', () => {
    const table = semiTable(needs(CAKE, 3), ITALY);
    expect(table.rows.map(row => row.ready)).toEqual(['3.600 g', '3.000 g']);
    expect(table.rows.map(row => row.prepare)).toEqual(['3.600 g', '3.750 g']);
  });
});

describe('a row with no weight', () => {
  const cake = cakeOf([line(0, 'base', 'SPONGE', 500), line(0, 'decoration', 'EMPTY', 100)]);
  it('shows «—», is left out of the total, and the screen, the sheet and the PDF all say so', () => {
    const table = semiTable(needs(cake), ITALY);
    expect(table.rows.map(row => row.prepare)).toEqual(['500 g', '—']);
    expect(table.totalPrepare).toBe('500 g');
    expect(totalNoteText('semi', needs(cake), tEn)).toBe('The total leaves out the rows with no weight.');
    expect(totalNoteText('semi', needs(cake), tIt)).toBe('Il totale non conta le righe senza peso.');
    expect(totalNoteText('ingredients', needs(cake), tEn)).toBeNull();
    expect(totalLabelText('semi', needs(cake), tEn)).toBe('Total · The total leaves out the rows with no weight.');
    const model = needExportModel('semi', needs(cake), tEn, ITALY, 'Torta di prova', 1);
    expect(model.rows.map(row => rowTextOf(row).trim())).toEqual(['500 g', '—']);
    expect(printedTotalGrams(model.rows)).toBe(500);
  });
  it('says nothing when every row has a weight', () => {
    expect(totalNoteText('semi', needs(CAKE), tEn)).toBeNull();
    expect(totalLabelText('semi', needs(CAKE), tEn)).toBe('Total');
  });
});

describe('the ingredient table', () => {
  it('has one row per ingredient, summed over every part, with the cards it comes from', () => {
    const rows = ingredientTable(needs(CAKE), tEn, ITALY);
    const sugar = rows.filter(row => row.name === 'Sugar');
    expect(sugar).toHaveLength(1);
    expect(sugar[0]?.from).toBe('Sponge · Ganache');
    expect(rows.find(row => row.name === 'Flour')?.amount).toBe('600 g');
  });
  it('marks an ingredient with a part that has no price', () => {
    const base = needs(CAKE);
    const marked = { ...base, ingredients: base.ingredients.map((row, index) => (index === 0 ? { ...row, unpriced: true } : row)) };
    const rows = ingredientTable(marked, tIt, ITALY);
    expect(rows[0]?.from.endsWith(' · senza prezzo')).toBe(true);
    expect(rows[1]?.from).not.toContain('senza prezzo');
  });
  it('writes a kilo or more in kilos and a speck as «< 1 g»', () => {
    expect(kgText(1.25, ITALY)).toBe('1,25 kg');
    expect(kgText(0.75, ITALY)).toBe('750 g');
    expect(kgText(0.0004, ITALY)).toBe('< 1 g');
    expect(gramsText(0.5, ITALY)).toBe('500 g');
  });
});

describe('the cards that could not be opened', () => {
  const cake = cakeOf([line(0, 'base', 'SPONGE', 500), line(0, 'decoration', 'CREAM', 100)]);
  it('are named, in the singular and the plural, in both languages', () => {
    expect(notOpenedText(needs(cake), tIt)).toBe('Non aperte: Cream — la sua scheda non ha ancora un prezzo');
    expect(notOpenedText(needs(cake), tEn)).toBe('Not opened: Cream — its card has no price yet');
    const two = cakeOf([line(0, 'base', 'CREAM', 100), line(0, 'filling', 'CREAM', 100)]);
    expect(notOpenedText(needs(two), tEn)).toBe('Not opened: Cream — its card has no price yet');
    const both = { ...needs(cake), notOpened: [{ productId: 'A', name: 'A' }, { productId: 'B', name: 'B' }] };
    expect(notOpenedText(both, tEn)).toBe('Not opened: A, B — their cards have no price yet');
  });
  it('are not mentioned when there are none', () => {
    expect(notOpenedText(needs(CAKE), tEn)).toBeNull();
  });
});

describe('the title and the PDF model', () => {
  it('is named «What you need · cake × N»', () => {
    expect(needTitle(tIt, 'Torta di prova', 2)).toBe('Cosa serve · Torta di prova × 2');
    expect(needTitle(tEn, '  ', 1)).toBe('What you need × 1');
    expect(needExportModel('semi', needs(CAKE, 2), tIt, ITALY, 'Torta di prova', 2).name).toBe('Cosa serve · Torta di prova × 2');
  });
  it('lists the semi-finished cards with what to prepare, and the Total adds those up', () => {
    const model = needExportModel('semi', needs(CAKE, 2), tIt, ITALY, 'Torta di prova', 2);
    expect(model.rows.map(row => [row.name, rowTextOf(row)])).toEqual([
      ['Sponge · pronto 2.400 g', '2400 g'],
      ['Ganache · pronto 2.000 g', '2500 g'],
    ]);
    expect(printedTotalGrams(model.rows)).toBe(4900);
  });
  it('lists the ingredients: kilos from a kilo, whole grams under it, biggest first', () => {
    const model = needExportModel('ingredients', needs(CAKE, 2), tIt, ITALY, 'Torta di prova', 2);
    const printed = model.rows.map(row => [exportRow(row).name, rowTextOf(row)]);
    expect(printed).toEqual([['Sugar', '2,45 kg'], ['Butter', '1,25 kg'], ['Flour', '1,20 kg']]);
    expect(printedTotalGrams(model.rows)).toBe(4900);
    const one = needExportModel('ingredients', needs(CAKE), tIt, ITALY, 'Torta di prova', 1);
    expect(one.rows.map(row => rowTextOf(row))).toEqual(['1,23 kg', '625 g', '600 g']);
  });
});
