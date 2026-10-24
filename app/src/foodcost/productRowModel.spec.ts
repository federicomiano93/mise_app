import { describe, expect, it } from 'vitest';
import { costProduct } from '@mise/shared/foodcost-model';
import { moneyOf } from '@mise/shared/currency';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { format } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { figureText, percentText, statusWord, subLine } from './productRowModel';

const english = (key: MessageKey, params?: MessageParams) => format('en', en[key], params);
const italiano = (key: MessageKey, params?: MessageParams) => format('it', italian[key], params);
const pounds = moneyOf('£', { decimal: '.', group: '', symbolAfter: false });
const euros = moneyOf('€', { decimal: ',', group: '.', symbolAfter: true });

const tables = {
  ingredients: { flour: { id: 'flour', name: 'Flour', active: true, priceUnit: 'kg', pricePerUnit: 2 } },
};
const made = (fields: Record<string, unknown>) => costProduct({
  id: 'p',
  name: 'P',
  components: [{ kind: 'ingredient', ingredientId: 'flour', qty: 1000, unit: 'g' }],
  sellingMode: 'piece',
  piecesPerBatch: 10,
  sellingPrice: 1.2,
  vatRate: 20,
  ...fields,
}, tables);

describe('the traffic light\'s words', () => {
  it.each([
    ['green', 'On target'],
    ['amber', 'Slightly over'],
    ['red', 'Over target'],
    [null, 'No target set'],
  ] as const)('%s → %s', (status, word) => {
    expect(statusWord(english, status)).toBe(word);
  });

  it('speaks Italian when it is asked to', () => {
    expect(statusWord(italiano, 'red')).toBe('Sopra l’obiettivo');
  });
});

describe('the figure', () => {
  it('is the food cost, in the interface language\'s numbers', () => {
    expect(figureText(made({ sellingPrice: 1.2 }), 'en-GB')).toBe('20%');
    expect(figureText(made({ sellingPrice: 0.7692, vatRate: 0 }), 'en-GB')).toBe('26%');
    expect(percentText(31.5, 'en-GB')).toBe('31.5%');
    expect(percentText(31.5, 'it-IT')).toBe('31,5%');
  });

  it('is a dash while the product cannot be costed, never 0%', () => {
    expect(figureText(made({ sellingPrice: null }), 'en-GB')).toBe('—');
  });
});

describe('the line under the name', () => {
  it('says the status, the cost and the margin of a costed product, in the venue\'s money', () => {
    expect(subLine(english, made({ foodCostTarget: 25 }), pounds)).toBe('On target  ·  £0.20 cost  ·  £0.80 margin');
    expect(subLine(italiano, made({ foodCostTarget: 25 }), euros).replaceAll(' ', ' ')).toBe('In linea con l’obiettivo  ·  0,20 € di costo  ·  0,80 € di margine');
  });

  it('says there is no target when none is set', () => {
    expect(subLine(english, made({ foodCostTarget: null }), pounds)).toMatch(/^No target set {2}·/);
  });

  it('says the first thing still missing, in the order a person fills it in', () => {
    expect(subLine(english, made({ components: [] }), pounds)).toBe('Add at least one recipe or ingredient to this product');
    expect(subLine(english, made({ sellingMode: null }), pounds)).toBe('Choose whether this is sold by the piece, by weight or by the pack');
    expect(subLine(english, made({ piecesPerBatch: null }), pounds)).toBe('Say how many pieces come out of one batch');
    expect(subLine(english, made({ vatRate: null }), pounds)).toBe('Choose the VAT rate');
    expect(subLine(english, made({ sellingPrice: null }), pounds)).toBe('Enter the selling price');
    expect(subLine(english, made({ components: [{ kind: 'ingredient', ingredientId: 'nope', qty: 1, unit: 'kg' }] }), pounds)).toBe('The recipes in this product are not priced yet');
  });
});
