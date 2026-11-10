// How the Food cost screens print a figure (fcNumber, fcMoney, fcWeight, weighingParams), run against BOTH implementations:
// the adapted port in shared/ (it is handed the money) and js/foodcost/fc-number.js (it reads js/currency.js after
// setCurrency). Every export of the original is covered (item 28 of docs/mise2-port-owed.md, current app 151ea191):
// ported from tests/foodcost-two-decimals.test.mjs, minus its two source-reading tests (they read js/foodcost/ files, not
// this module; app/src/foodcost/twoDecimals.spec.tsx pins the Mise 2 screens instead).

import { afterEach, describe, expect, test } from 'vitest';
import { moneyOf } from './currency';
import type { MoneyLayout } from './currency';
import * as ported from './fc-number';
import * as legacyFcNumber from '../../js/foodcost/fc-number.js';
import * as legacyCurrency from '../../js/currency.js';
import * as legacyPrice from '../../js/price-model.js';
import * as portedPrice from './price-model';

type Params = Readonly<Record<string, string>> | null | undefined;
const legacy = legacyFcNumber as unknown as {
  fcNumber: (value: unknown) => string;
  fcMoney: (value: unknown) => string;
  fcWeight: (kg: unknown) => string;
  weighingParams: (params: Params) => Record<string, string>;
};
const setCurrency = (legacyCurrency as unknown as { setCurrency: (symbol: unknown, layout: unknown) => void }).setCurrency;

const NB = ' ';
const ITALY: MoneyLayout = { decimal: ',', group: '.', symbolAfter: true };
const BRITAIN: MoneyLayout = { decimal: '.', group: ',', symbolAfter: false };
// The layout the original's own test uses for Britain: no grouping at all.
const BRITAIN_PLAIN: MoneyLayout = { decimal: '.', group: '', symbolAfter: false };

afterEach(() => { setCurrency('£', null); });

// Both files, in the same layout: the js/ one after setCurrency, the TypeScript one with the money handed in.
function both(layout: MoneyLayout, symbol = layout.symbolAfter ? '€' : '£') {
  setCurrency(symbol, layout);
  const money = moneyOf(symbol, layout);
  return [
    {
      name: 'shared/ (TypeScript)',
      fcNumber: (v: unknown) => ported.fcNumber(v, money),
      fcMoney: (v: unknown) => ported.fcMoney(v, money),
      fcWeight: (v: unknown) => ported.fcWeight(v, money),
      weighingParams: (p: Params) => ported.weighingParams(p, money),
    },
    { name: 'js/ (current app)', ...legacy },
  ];
}

describe('fcWeight: under 1 kg in grams, from 1 kg in kilos, two decimals', () => {
  test('in Italy', () => {
    for (const m of both(ITALY)) {
      expect(m.fcWeight(0.5), m.name).toBe('500,00 g');
      expect(m.fcWeight(0.0125), m.name).toBe('12,50 g');
      expect(m.fcWeight(1.25), m.name).toBe('1,25 kg');
      expect(m.fcWeight(1), m.name).toBe('1,00 kg');
      expect(m.fcWeight(10), m.name).toBe('10,00 kg');
      expect(m.fcWeight(0.522), m.name).toBe('522,00 g');
      expect(m.fcWeight(522), m.name).toBe('522,00 kg');
      expect(m.fcWeight(1234.5), `${m.name}: grouped like the money`).toBe('1.234,50 kg');
      expect(m.fcWeight(0.999996), `${m.name}: decided on the ROUNDED grams`).toBe('1,00 kg');
      expect(m.fcWeight(0.99999), m.name).toBe('999,99 g');
      expect(m.fcWeight(0), m.name).toBe('0,00 g');
      expect(m.fcWeight(0.000001), `${m.name}: a real amount never reads as nothing`).toBe('< 0,01 g');
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

describe('fcNumber: always two decimals in the venue layout', () => {
  test('grouped, text numbers read, tiny amounts never read as nothing', () => {
    for (const m of both(ITALY)) {
      expect(m.fcNumber(0), m.name).toBe('0,00');
      expect(m.fcNumber(12.5), m.name).toBe('12,50');
      expect(m.fcNumber(32.5), m.name).toBe('32,50');
      expect(m.fcNumber(3), m.name).toBe('3,00');
      expect(m.fcNumber(0.01), m.name).toBe('0,01');
      expect(m.fcNumber(0.014), m.name).toBe('0,01');
      expect(m.fcNumber(1234.5), m.name).toBe('1.234,50');
      expect(m.fcNumber('7.5'), `${m.name}: a number stored as text still reads`).toBe('7,50');
      expect(m.fcNumber(0.004), m.name).toBe(`<${NB}0,01`);
      expect(m.fcNumber(0.0000001), m.name).toBe(`<${NB}0,01`);
      expect(m.fcNumber(0.005), `${m.name}: whatever toFixed says wins`).toBe((0.005).toFixed(2) === '0.01' ? '0,01' : `<${NB}0,01`);
    }
    for (const m of both(BRITAIN_PLAIN)) {
      expect(m.fcNumber(12.5), m.name).toBe('12.50');
      expect(m.fcNumber(1234.5), m.name).toBe('1234.50');
      expect(m.fcNumber(0.004), m.name).toBe(`<${NB}0.01`);
    }
  });

  test('a negative is rounded normally, but never shows minus zero', () => {
    for (const m of both(ITALY)) {
      expect(m.fcNumber(-1.5), m.name).toBe('-1,50');
      expect(m.fcNumber(-0.001), m.name).toBe('0,00');
      expect(m.fcNumber(-0.003), m.name).toBe('0,00');
      expect(m.fcNumber(-0), m.name).toBe('0,00');
      expect(m.fcNumber(null), m.name).toBe('');
    }
  });

  test('pieces and percentages go through it', () => {
    for (const m of both(ITALY)) {
      expect(`${m.fcNumber(3)} pz`, m.name).toBe('3,00 pz');
      expect(`${m.fcNumber(0.004)} pz`, m.name).toBe(`<${NB}0,01 pz`);
      expect(`${m.fcNumber(32.5)}%`, m.name).toBe('32,50%');
    }
  });
});

describe('fcMoney: two decimals in the currency layout', () => {
  test('in Italy a tiny real cost reads «< 0,01 €»', () => {
    for (const m of both(ITALY)) {
      expect(m.fcMoney(0), m.name).toBe(`0,00${NB}€`);
      expect(m.fcMoney(0.035), m.name).toBe(`0,04${NB}€`);
      expect(m.fcMoney(6.5), m.name).toBe(`6,50${NB}€`);
      expect(m.fcMoney(1234.5), m.name).toBe(`1.234,50${NB}€`);
      expect(m.fcMoney(0.003), `${m.name}: a 2 g pinch of salt`).toBe(`<${NB}0,01${NB}€`);
      expect(m.fcMoney(0.01), m.name).toBe(`0,01${NB}€`);
      expect(m.fcMoney(0.014), m.name).toBe(`0,01${NB}€`);
      expect(m.fcMoney(-1.5), `${m.name}: a negative margin is real`).toBe(`-1,50${NB}€`);
      expect(m.fcMoney(-0.003), `${m.name}: no minus zero`).toBe(`0,00${NB}€`);
    }
  });

  test('in Britain, and rounding follows the platform', () => {
    for (const m of both(BRITAIN_PLAIN, '£')) {
      expect(m.fcMoney(0.003), m.name).toBe(`<${NB}£0.01`);
      expect(m.fcMoney(6.5), m.name).toBe('£6.50');
      expect(m.fcMoney(0), m.name).toBe('£0.00');
      expect(m.fcMoney(-1.5), m.name).toBe('£-1.50');
    }
    for (const m of both(ITALY)) {
      expect(m.fcMoney(1.005), m.name).toBe(`${(1.005).toFixed(2).replace('.', ',')}${NB}€`);
      expect(m.fcMoney(2.675), m.name).toBe(`${(2.675).toFixed(2).replace('.', ',')}${NB}€`);
    }
  });
});

test('unknown values give an empty text, for the caller to replace with a dash', () => {
  for (const m of both(ITALY)) {
    for (const bad of [null, undefined, '', Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 'abc']) {
      expect(m.fcNumber(bad), `${m.name}: ${String(bad)}`).toBe('');
      expect(m.fcMoney(bad), `${m.name}: ${String(bad)}`).toBe('');
      expect(m.fcWeight(bad), `${m.name}: ${String(bad)}`).toBe('');
    }
    expect(m.fcMoney(0), `${m.name}: a real zero is still zero`).toBe(`0,00${NB}€`);
  }
});

test('weighingParams: the percentages of a weighing sentence in two decimals, nothing else touched', () => {
  for (const m of both(ITALY)) {
    expect(m.weighingParams({ pct: '12' }), m.name).toStrictEqual({ pct: '12,00' });
    expect(m.weighingParams({ max: '99' }), m.name).toStrictEqual({ max: '99,00' });
    expect(m.weighingParams({}), m.name).toStrictEqual({});
    expect(m.weighingParams(null), m.name).toStrictEqual({});
    expect(m.weighingParams(undefined), m.name).toStrictEqual({});
    expect(m.weighingParams({ pct: '12.5', name: 'Focaccia' }), m.name).toStrictEqual({ pct: '12,50', name: 'Focaccia' });
  }
  for (const m of both(BRITAIN)) {
    expect(m.weighingParams({ pct: '12' }), m.name).toStrictEqual({ pct: '12.00' });
  }
});

test('price-model is untouched: formatRate keeps its six decimals for the Suppliers and the Stocktake', () => {
  setCurrency('£', BRITAIN_PLAIN);
  const money = moneyOf('£', BRITAIN_PLAIN);
  const legacyRate = (legacyPrice as unknown as { formatRate: (v: number) => string }).formatRate;
  for (const [value, text] of [[0.035, '£0.035'], [0.001745, '£0.001745'], [7.2, '£7.20']] as const) {
    expect(legacyRate(value), `js/ ${value}`).toBe(text);
    expect(portedPrice.formatRate(value, money), `shared/ ${value}`).toBe(text);
  }
});
