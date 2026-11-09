// The summary sheet's lines and money (P15), run against BOTH implementations: the TypeScript port in shared/ and
// js/orders/order-summary.js, which the live app uses today. A FULL port, so parity.spec.ts also compares the exports.
//
// PORTED: every pure test of tests/orders-order-summary.test.mjs (the selection, empty and null entries, the money, a null
// supplier, the lines equal the message's lines, nothing ordered, a line priced in its own unit).
// ADDED: entries that are null or undefined, a quantity written as text or NaN, an inactive-looking ingredient with a quantity, a
// displayed short name that differs from the invoice name, and a later ingredient with the same label winning.
// NOT PORTED: nothing — the original file has no test about wiring.

import { describe, expect, test } from 'vitest';
import * as ported from './order-summary';
import * as legacyJs from '../../js/orders/order-summary.js';
import * as portedText from './order-text';
import * as legacyText from '../../js/orders/order-text.js';

const legacy = legacyJs as unknown as typeof ported;
const legacyTextTyped = legacyText as unknown as typeof portedText;

const SUPPLIER = { id: 's1', name: 'Alba' };

const INGREDIENTS = [
  { id: 'flour', name: 'Flour', weight: '25kg' },
  { id: 'bacon', name: 'Bacon', weight: '2.27kg' },
  { id: 'mozz', name: 'Mozzarella', weight: '1kg' },
  { id: 'zero', name: 'Zero qty', weight: '' },
  { id: 'notyped', name: 'Never typed', weight: '' },
];

const ENTRIES = { flour: { qty: 3 }, bacon: { qty: 5 }, mozz: { qty: 2 }, zero: { qty: 0 } };

const EMPTY = { name: 'Alba', lines: [], costLines: [], totals: { net: 0, vatByRate: {}, gross: 0, missingPrice: 0, missingVat: 0, costed: 0 } };

describe.each([
  ['shared/ (TypeScript)', ported, portedText],
  ['js/ (current app)', legacy, legacyTextTyped],
] as const)('%s', (_name, m, text) => {
  test('only rows with qty > 0 appear, sorted by label — same rule as the message', () => {
    const { name, lines } = m.supplierSummary(SUPPLIER, INGREDIENTS, ENTRIES);
    expect(name).toBe('Alba');
    expect(lines).toStrictEqual([
      { label: 'Bacon 2.27kg', qty: 5 },
      { label: 'Flour 25kg', qty: 3 },
      { label: 'Mozzarella 1kg', qty: 2 },
    ]);
  });

  test('empty, null and undefined entries -> empty lines, never a crash', () => {
    expect(m.supplierSummary(SUPPLIER, INGREDIENTS, {})).toStrictEqual(EMPTY);
    expect(m.supplierSummary(SUPPLIER, INGREDIENTS, null)).toStrictEqual(EMPTY);
    expect(m.supplierSummary(SUPPLIER, INGREDIENTS, undefined)).toStrictEqual(EMPTY);
    expect(m.supplierSummary(SUPPLIER, null, ENTRIES)).toStrictEqual(EMPTY);
    expect(m.supplierSummary(SUPPLIER)).toStrictEqual(EMPTY);
  });

  test('money: a priced, VAT-rated line costs correctly; an unpriced one is flagged, not zero', () => {
    const priced = [
      { id: 'flour', name: 'Flour', weight: '25kg', priceUnit: 'kg', pricePerUnit: 1.8, vatRate: 4 },
      { id: 'bacon', name: 'Bacon', weight: '2.27kg' },
    ];
    const { costLines, totals } = m.supplierSummary(SUPPLIER, priced, { flour: { qty: 2 }, bacon: { qty: 1 } });
    const flourLine = costLines.find(l => l.label.startsWith('Flour'));
    const baconLine = costLines.find(l => l.label.startsWith('Bacon'));
    expect(flourLine?.unitCost).toBe(45);
    expect(flourLine?.vatRate).toBe(4);
    expect(baconLine?.unitCost).toBeNull();
    expect(baconLine?.vatRate).toBeNull();
    expect(totals.net).toBe(90);
    expect(totals.missingPrice).toBe(1);
  });

  test('a null supplier still returns a shape — never throws', () => {
    expect(m.supplierSummary(null, INGREDIENTS, ENTRIES).name).toBe('');
    expect(m.supplierSummary(undefined, INGREDIENTS, ENTRIES).name).toBe('');
  });

  test('the summary lines equal the message section lines — same lines, same order (the message drops the weight)', () => {
    const { lines } = m.supplierSummary(SUPPLIER, INGREDIENTS, ENTRIES);
    const items = text.orderedItems(INGREDIENTS, ENTRIES);
    const message = text.buildOrderMessage([{ supplierName: SUPPLIER.name, items }]);
    const messageLines = (message.split('\n\n')[1] ?? '').split('\n');
    expect(lines.map(({ label, qty }) => `- ${label}: ${qty}`)).toStrictEqual(['- Bacon 2.27kg: 5', '- Flour 25kg: 3', '- Mozzarella 1kg: 2']);
    expect(messageLines).toStrictEqual(['- Bacon: 5', '- Flour: 3', '- Mozzarella: 2']);
  });

  test('a supplier with nothing ordered: the summary is empty and the message carries no section for it', () => {
    expect(m.supplierSummary(SUPPLIER, INGREDIENTS, {}).lines).toStrictEqual([]);
    expect(text.buildOrderMessage([{ supplierName: SUPPLIER.name, items: text.orderedItems(INGREDIENTS, {}) }])).toBe('');
  });

  test('money: a line is priced in its own unit — cartone by default, busta when chosen', () => {
    const flour = {
      id: 'flour', name: 'Flour', weight: '2.5kg', unit: 'cartone', packUnit: 'busta',
      priceUnit: 'kg', pricePerUnit: 2, unitWeightKg: null, vatRate: 4,
      caseCount: 4, caseItemSize: 2.5, caseItemUnit: 'pack', casePrice: 20,
    };
    const asCarton = m.supplierSummary(SUPPLIER, [flour], { flour: { qty: 2 } });
    const asBag = m.supplierSummary(SUPPLIER, [flour], { flour: { qty: 2, unit: 'busta' } });
    expect(asCarton.costLines[0]?.unitCost).toBe(20);
    expect(asBag.costLines[0]?.unitCost).toBe(5);
    expect(asBag.costLines[0]?.unit).toBe('busta');
    expect(asBag.totals.net).toBe(10);
    expect(asCarton.costLines[0]?.unit).toBe('cartone');
  });

  test('a quantity typed as text or NaN is whatever orderedItems makes of it (both ports agree with the message)', () => {
    for (const qty of ['4 ', '4', 'abc', NaN, Infinity, -1, 0.4, '0']) {
      const entries = { flour: { qty }, bacon: { qty: 1 } };
      const s = m.supplierSummary(SUPPLIER, INGREDIENTS, entries);
      const items = text.orderedItems(INGREDIENTS, entries);
      expect(s.lines).toStrictEqual(text.summaryLines(items));
      expect(s.costLines.length).toBe(items.length);
    }
  });

  test('an inactive ingredient with a quantity is still listed: the summary does not read `active`', () => {
    const list = [{ id: 'a', name: 'Old', weight: '', active: false }, { id: 'b', name: 'New', weight: '' }];
    const s = m.supplierSummary(SUPPLIER, list, { a: { qty: 2 }, b: { qty: 1 } });
    expect(s.lines).toStrictEqual([{ label: 'New', qty: 1 }, { label: 'Old', qty: 2 }]);
  });

  test('the sheet shows the short name while the lines keep the invoice name', () => {
    const list = [{ id: 'a', name: 'FARINA TIPO 00 SACCO', shortName: 'Flour', weight: '25kg', vatRate: '4' }];
    const s = m.supplierSummary(SUPPLIER, list, { a: { qty: 2 } });
    expect(s.lines).toStrictEqual([{ label: 'FARINA TIPO 00 SACCO 25kg', qty: 2 }]);
    expect(s.costLines[0]?.label).toBe('Flour 25kg');
    expect(s.costLines[0]?.vatRate).toBe(4);
    expect(s.costLines[0]?.unitCost).toBeNull();
  });

  test('two ingredients with the same label: the later one wins the match, and every field follows it', () => {
    const list = [
      { id: 'a', name: 'Flour', weight: '1kg', vatRate: 4 },
      { id: 'b', name: 'Flour', weight: '1kg', vatRate: 22 },
    ];
    const s = m.supplierSummary(SUPPLIER, list, { a: { qty: 1 }, b: { qty: 1 } });
    expect(s.lines.length).toBe(2);
    expect(s.costLines.map(l => l.vatRate)).toStrictEqual([22, 22]);
  });
});

// Mise 2 only: the package word of a typed card travels on the lines and the cost lines (the current app has no such field).
describe('order-summary: the package word (Mise 2 only)', () => {
  const typed = [{ id: 'p', name: 'Panna', weight: '', unit: 'bottiglia', packUnit: 'bottiglia' }, { id: 'f', name: 'Flour', weight: '25kg' }];

  test('lines and cost lines carry `pack` for the typed card only', () => {
    const s = ported.supplierSummary(SUPPLIER, typed, { p: { qty: 2 }, f: { qty: 1 } });
    expect(s.lines).toStrictEqual([{ label: 'Flour 25kg', qty: 1 }, { label: 'Panna', qty: 2, pack: 'bottiglia' }]);
    expect(s.costLines.map(line => line.pack)).toStrictEqual([undefined, 'bottiglia']);
    expect('pack' in (s.costLines[0] as object)).toBe(false);
  });

  test('a line with its own unit has the unit and no word', () => {
    const s = ported.supplierSummary(SUPPLIER, typed, { p: { qty: 2, unit: 'cartone' } });
    expect(s.costLines[0]).toMatchObject({ label: 'Panna', qty: 2, unit: 'cartone' });
    expect('pack' in (s.costLines[0] as object)).toBe(false);
  });
});
