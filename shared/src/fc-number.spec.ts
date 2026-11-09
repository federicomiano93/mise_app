// How the Food cost screens print a weight (fcNumber, fcWeight), run against BOTH implementations: the partial, adapted port
// in shared/ (it is handed the money) and js/foodcost/fc-number.js (it reads js/currency.js after setCurrency). Only what
// fc-number.ts ports: the «too much of a recipe» warning's weights (8 Nov 2026). The rest of the original is item 28.

import { afterEach, describe, expect, test } from 'vitest';
import { moneyOf } from './currency';
import type { MoneyLayout } from './currency';
import * as ported from './fc-number';
import * as legacyFcNumber from '../../js/foodcost/fc-number.js';
import * as legacyCurrency from '../../js/currency.js';

const legacy = legacyFcNumber as unknown as { fcNumber: (value: unknown) => string; fcWeight: (kg: unknown) => string };
const setCurrency = (legacyCurrency as unknown as { setCurrency: (symbol: unknown, layout: unknown) => void }).setCurrency;

const ITALY: MoneyLayout = { decimal: ',', group: '.', symbolAfter: true };
const BRITAIN: MoneyLayout = { decimal: '.', group: ',', symbolAfter: false };

afterEach(() => { setCurrency('£', null); });

// Both files, in the same layout: the js/ one after setCurrency, the TypeScript one with the money handed in.
function both(layout: MoneyLayout) {
  setCurrency('€', layout);
  const money = moneyOf('€', layout);
  return [
    { name: 'shared/ (TypeScript)', fcNumber: (v: unknown) => ported.fcNumber(v, money), fcWeight: (v: unknown) => ported.fcWeight(v, money) },
    { name: 'js/ (current app)', fcNumber: legacy.fcNumber, fcWeight: legacy.fcWeight },
  ];
}

describe('fcWeight: under 1 kg in grams, from 1 kg in kilos, two decimals', () => {
  test('in Italy', () => {
    for (const m of both(ITALY)) {
      expect(m.fcWeight(0.0125), m.name).toBe('12,50 g');
      expect(m.fcWeight(1.25), m.name).toBe('1,25 kg');
      expect(m.fcWeight(0.522), m.name).toBe('522,00 g');
      expect(m.fcWeight(522), m.name).toBe('522,00 kg');
      expect(m.fcWeight(1234.5), `${m.name}: grouped like the money`).toBe('1.234,50 kg');
      expect(m.fcWeight(0.999996), `${m.name}: decided on the ROUNDED grams`).toBe('1,00 kg');
      expect(m.fcWeight(0), m.name).toBe('0,00 g');
      expect(m.fcWeight(0.000001), `${m.name}: a real amount never reads as nothing`).toBe('<\u00a00,01 g');
    }
  });

  test('in Britain, and nothing for what is not a number', () => {
    for (const m of both(BRITAIN)) {
      expect(m.fcWeight(0.0125), m.name).toBe('12.50 g');
      expect(m.fcWeight(2500), m.name).toBe('2,500.00 kg');
      for (const unknown of [null, undefined, '', 'abc', Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(m.fcWeight(unknown), `${m.name}: ${String(unknown)}`).toBe('');
      }
    }
  });
});

test('fcNumber: two decimals, no minus zero, a real negative keeps its sign', () => {
  for (const m of both(ITALY)) {
    expect(m.fcNumber(32.5), m.name).toBe('32,50');
    expect(m.fcNumber(-0.001), m.name).toBe('0,00');
    expect(m.fcNumber(-1.5), m.name).toBe('-1,50');
    expect(m.fcNumber(0.004), m.name).toBe('<\u00a00,01');
    expect(m.fcNumber(null), m.name).toBe('');
  }
});
