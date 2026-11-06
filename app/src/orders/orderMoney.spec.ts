// The order's money (orderMoney.ts, step 3f-8c, parity L19/L20): the summary has the lines of the message and nothing else, the
// prices are laid over them only when readable, and a cost line says what is missing instead of a guess.

import { describe, expect, it } from 'vitest';
import { moneyOf } from '@mise/shared/currency';
import { orderedItems } from '@mise/shared/order-text';
import { en } from '../i18n/en';
import { it as itWords } from '../i18n/it';
import { format } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { buildOrdersLens } from './ordersLens';
import { lineCostText, summaryFor } from './orderMoney';
import type { StoredDoc } from './ordersSource';
import { draftSendRows } from './sendFlow';

const tEn = (key: MessageKey, params?: MessageParams) => format('en', en[key], params);
const tIt = (key: MessageKey, params?: MessageParams) => format('it', itWords[key], params);
const pounds = moneyOf('£', { decimal: '.', group: ',', symbolAfter: false });
const euros = moneyOf('€', { decimal: ',', group: '.', symbolAfter: true });

const mill: StoredDoc = { id: 'mill', name: 'Mill' };
const dairy: StoredDoc = { id: 'dairy', name: 'Dairy' };

function lensOf(entries: Record<string, unknown>) {
  return buildOrdersLens({
    suppliers: [mill, dairy],
    suppliersLoaded: true,
    ingredients: [
      { id: 'flour', name: 'Flour', weight: '25kg', supplierId: 'mill', unit: 'kg' },
      { id: 'semola', name: 'Semola', supplierId: 'mill', active: false },
      { id: 'milk', name: 'Milk', supplierId: 'dairy' },
      // Sold by the dairy, sent to the mill this time.
      { id: 'cream', name: 'Cream', supplierId: 'dairy' },
    ],
    entries: entries as never,
    supplierOrder: [],
    noSupplierName: 'No supplier',
  });
}

const PRICES = {
  flour: { priceUnit: 'kg', pricePerUnit: 2, vatRate: 4 },
  milk: { priceUnit: 'pcs', pricePerUnit: 1.5 },
};
const draftOf = (entries: Record<string, unknown>) => ({ entries: entries as never, days: {}, updatedAt: '', exists: true });

describe('summaryFor', () => {
  it('has exactly the lines of the message for that supplier, switched-off lines with a quantity included', () => {
    const entries = { flour: { qty: 3 }, semola: { qty: 2 }, milk: { qty: 4 } };
    const lens = lensOf(entries);
    const draft = draftOf(entries);
    for (const id of ['mill', 'dairy']) {
      const message = draftSendRows(lens, draft).find(row => row.id === id)?.items ?? [];
      const summary = summaryFor(lens, id, draft, PRICES, true);
      expect(summary.lines.length).toBe(message.length);
      expect(summary.lines.length).toBeGreaterThan(0);
      expect(orderedItems(lens.linesOf(id), entries).length).toBe(message.length);
    }
    expect(summaryFor(lens, 'mill', draft, PRICES, true).lines.map(line => line.qty).sort()).toEqual([2, 3]);
  });

  it('prices the lines when readable: net, the VAT of each rate, and what has no price', () => {
    const entries = { flour: { qty: 3 }, milk: { qty: 4 } };
    const lens = lensOf(entries);
    const mine = summaryFor(lens, 'mill', draftOf(entries), PRICES, true).totals;
    // Flour is priced 2 a kilo and ordered in kilos: three kilos.
    expect(mine.net).toBe(6);
    expect(mine.vatByRate[4]).toBeCloseTo(0.24);
    expect(mine.gross).toBeCloseTo(6.24);
    const dairyTotals = summaryFor(lens, 'dairy', draftOf(entries), PRICES, true).totals;
    expect(dairyTotals).toMatchObject({ net: 6, missingVat: 1, costed: 1, missingPrice: 0 });
  });

  it('⚠️ lays NO price over the lines when the prices are not readable, whatever the map holds', () => {
    const entries = { flour: { qty: 3 } };
    const summary = summaryFor(lensOf(entries), 'mill', draftOf(entries), PRICES, false);
    expect(summary.costLines.map(line => line.unitCost)).toEqual([null]);
    expect(summary.lines).toHaveLength(1);
  });

  it('is empty for a supplier with nothing typed', () => {
    const lens = lensOf({});
    const summary = summaryFor(lens, 'mill', draftOf({}), PRICES, true);
    expect(summary.lines).toEqual([]);
    expect(summary.totals.net).toBe(0);
  });

  it('is empty for a supplier that is not there', () => {
    expect(summaryFor(lensOf({}), 'nobody', draftOf({}), PRICES, true).lines).toEqual([]);
  });
});

describe('lineCostText', () => {
  it('writes quantity × rate = total · VAT, in the venue’s money', () => {
    expect(lineCostText(tEn, pounds, { qty: 4, unitCost: 45, vatRate: 4 })).toEqual({ text: '4 × £45.00 = £180.00 · VAT 4%', warn: false });
    // The space before the symbol may be a no-break one: compare the words, not the kind of space.
    const italian = lineCostText(tIt, euros, { qty: 2.5, unitCost: 6.5, vatRate: 22 });
    expect(italian.text.replace(/\s/g, ' ')).toBe('2,5 × 6,50 € = 16,25 € · IVA 22%');
    expect(italian.warn).toBe(false);
  });

  it('says «no price», as a warning, when the unit cost is missing', () => {
    expect(lineCostText(tEn, pounds, { qty: 4, unitCost: null, vatRate: 4 })).toEqual({ text: 'no price', warn: true });
    expect(lineCostText(tIt, euros, { qty: 4, unitCost: null, vatRate: null })).toEqual({ text: 'senza prezzo', warn: true });
  });

  it('says the VAT is not stated, as a warning, when only the rate is missing', () => {
    expect(lineCostText(tEn, pounds, { qty: 10, unitCost: 12.5, vatRate: null })).toEqual({ text: '10 × £12.50 = £125.00 · VAT not stated', warn: true });
  });

  it('keeps a stated rate of 0 as a rate', () => {
    expect(lineCostText(tEn, pounds, { qty: 1, unitCost: 3, vatRate: 0 }).warn).toBe(false);
  });
});
