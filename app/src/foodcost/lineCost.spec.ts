import { describe, expect, it } from 'vitest';
import { moneyOf } from '@mise/shared/currency';
import type { CostTables } from '@mise/shared/foodcost-model';
import { en } from '../i18n/en';
import type { MessageKey, Messages } from '../i18n/en';
import { format } from '../i18n/i18n';
import type { Language, MessageParams } from '../i18n/i18n';
import { it as italian } from '../i18n/it';
import { lineCostView } from './lineCost';
import type { LineCost, LineCostKind } from './lineCost';

// The words under a «Made of» and a packaging line (the current app's line-cost.js, PR #485, after PR #490's two decimals;
// tests/foodcost-line-costs.test.mjs). The figures come from the shared model, which foodcost-line-costs.spec.ts runs against
// both files; this pins what is SAID.

const BRITAIN = moneyOf('£', { decimal: '.', group: '', symbolAfter: false });
const ITALY = moneyOf('€', { decimal: ',', group: '.', symbolAfter: true });
const say = (lang: Language, messages: Messages) => (key: MessageKey, params?: MessageParams) => format(lang, messages[key], params);
const english = say('en', en);
const italiano = say('it', italian);

const ING = {
  FLOUR: { id: 'FLOUR', name: 'Flour', priceUnit: 'kg', pricePerUnit: 2 },
  SALT: { id: 'SALT', name: 'Salt', priceUnit: 'kg', pricePerUnit: 1.5 },
  SPRINKLE: { id: 'SPRINKLE', name: 'Sprinkle', priceUnit: 'pcs', pricePerUnit: 0.02 },
  ICING: { id: 'ICING', name: 'Icing', priceUnit: 'kg', pricePerUnit: 4 },
  RIBBON: { id: 'RIBBON', name: 'Ribbon' },
  BOX: { id: 'BOX', name: 'Box', priceUnit: 'pcs', pricePerUnit: 0.12 },
  FILM: { id: 'FILM', name: 'Film', priceUnit: 'kg', pricePerUnit: 3 },
};
const flourRow = (grams: number) => ({ label: 'Flour', grams, unit: 'g', kind: 'ingredient', refId: 'FLOUR' });
const TABLES: CostTables = {
  ingredients: ING,
  recipes: {
    // 1000 g of flour at 2/kg, 20% lost in the oven → 2.50 a kilo out.
    DOUGH: { id: 'DOUGH', name: 'Dough', lossPct: 20, ingredients: [flourRow(1000)] },
    // One linked row and one labelled, unlinked row: priced, but only in part.
    CREAM: { id: 'CREAM', name: 'Cream', lossPct: 0, ingredients: [flourRow(500), { label: 'Water', grams: 100, unit: 'g' }] },
    MYSTERY: { id: 'MYSTERY', name: 'Mystery', lossPct: 0, ingredients: [{ label: 'Something', grams: 500, unit: 'g' }] },
  },
};

const ingLine = (ingredientId: string, qty: number, unit: string) => ({ kind: 'ingredient', ingredientId, qty, unit });
const recLine = (recipeId: string, qtyKg: number) => ({ recipeId, qtyKg });
const pack = (ingredientId: string, qtyPcs: number) => ({ ingredientId, qtyPcs });

// The money layout puts a no-break space before «€»: compared as a plain space.
const plain = (view: LineCost): LineCost => ({ ...view, text: view.text.replace(/ /g, ' ') });
const uk = (entry: object, kind: LineCostKind, options?: { noWeightLoss?: boolean }) =>
  plain(lineCostView(english, BRITAIN, entry as Record<string, unknown>, kind, TABLES, options));
const ita = (entry: object, kind: LineCostKind) =>
  plain(lineCostView(italiano, ITALY, entry as Record<string, unknown>, kind, TABLES));

describe('lineCostView', () => {
  it('a weighed line with a price: the rate per kilo and this amount; with no quantity only the rate', () => {
    expect(uk(ingLine('FLOUR', 500, 'g'), 'ingredient')).toEqual({ text: '£2.00/kg · this amount £1.00', noPrice: false });
    expect(uk(ingLine('FLOUR', 0, 'g'), 'ingredient').text).toBe('£2.00/kg');
    expect(uk(recLine('DOUGH', 2), 'recipe').text).toBe('£2.50/kg · this amount £5.00');
    expect(uk(recLine('DOUGH', 2), 'recipe', { noWeightLoss: true }).text).toBe('£2.00/kg · this amount £4.00');
    expect(ita(ingLine('FLOUR', 500, 'g'), 'ingredient').text).toBe('2,00 €/kg · questa quantità 1,00 €');
  });

  it('a 2 g pinch of salt costing under a cent reads «< £0.01», never 0.00', () => {
    expect(uk(ingLine('SALT', 2, 'g'), 'ingredient').text).toBe('£1.50/kg · this amount < £0.01');
    expect(uk(ingLine('SALT', 2, 'g'), 'ingredient').text).not.toContain('0.00');
  });

  it('a line priced by the piece reads «each», in both languages', () => {
    expect(uk(ingLine('SPRINKLE', 10, 'pcs'), 'ingredient').text).toBe('£0.02 each · this amount £0.20');
    expect(uk(ingLine('SPRINKLE', 0, 'pcs'), 'ingredient').text).toBe('£0.02 each');
    expect(ita(ingLine('SPRINKLE', 10, 'pcs'), 'ingredient').text).toBe('0,02 € al pezzo · questa quantità 0,20 €');
  });

  it('a partly priced recipe says «not exact yet» after the numbers — and only a recipe does', () => {
    expect(uk(recLine('CREAM', 1), 'recipe').text).toBe('£2.00/kg · this amount £2.00 · not exact yet');
    expect(ita(recLine('CREAM', 1), 'recipe').text).toBe('2,00 €/kg · questa quantità 2,00 € · non ancora esatto');
    expect(uk(ingLine('FLOUR', 500, 'g'), 'ingredient').text).not.toContain('not exact');
  });

  it('no price at all reads «— No price» and says so (so the note is left out) — never 0', () => {
    for (const [entry, kind] of [[recLine('MYSTERY', 1), 'recipe'], [ingLine('RIBBON', 5, 'g'), 'ingredient'], [pack('RIBBON', 2), 'packaging']] as const) {
      expect(uk(entry, kind)).toEqual({ text: '— No price', noPrice: true });
    }
    expect(ita(recLine('MYSTERY', 1), 'recipe').text).toBe('— Nessun prezzo');
  });

  it('a price that cannot be used shows the known rate only; a gone recipe or item shows nothing', () => {
    expect(uk(ingLine('SPRINKLE', 5, 'g'), 'ingredient')).toEqual({ text: '£0.02 each', noPrice: false });
    expect(uk(ingLine('ICING', 5, 'pcs'), 'ingredient')).toEqual({ text: '£4.00/kg', noPrice: false });
    expect(uk(pack('FILM', 2), 'packaging')).toEqual({ text: '£3.00/kg', noPrice: false });
    expect(uk(recLine('GONE', 1), 'recipe').text).toBe('');
    expect(uk(ingLine('GONE', 1, 'g'), 'ingredient').text).toBe('');
    expect(uk(pack('GONE', 1), 'packaging').text).toBe('');
  });

  it('packaging priced each reads the rate and the amount', () => {
    expect(uk(pack('BOX', 3), 'packaging').text).toBe('£0.12 each · this amount £0.36');
    expect(uk(pack('BOX', 0), 'packaging').text).toBe('£0.12 each');
  });

  it('reads a Map of ingredients as well as a plain object', () => {
    const tables: CostTables = { ingredients: new Map(Object.entries(ING)), recipes: {} };
    expect(lineCostView(english, BRITAIN, pack('BOX', 3), 'packaging', tables).text).toBe('£0.12 each · this amount £0.36');
  });
});
