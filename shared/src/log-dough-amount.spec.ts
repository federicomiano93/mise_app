// The amount line of a Dough history card (item 39 of docs/mise2-port-owed.md; current app b00983dc,
// tests/log-view-typed-total.test.mjs), run against BOTH files: the TypeScript port in shared/ and js/log-model.js.

import { describe, expect, test } from 'vitest';
import * as ported from './log-model';
import * as legacyJs from '../../js/log-model.js';

const legacy = legacyJs as unknown as typeof ported;

type Loose = any;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s — doughAmountLine', (_name, m) => {
  const doughAmountLine = m.doughAmountLine as (version: unknown) => Loose;
  const sheet = (over: Loose = {}): Loose => ({ total_g: 1650, extra_g: 0, ...over });

  test('⚠️ a «from a total» dough (no product) says its total, never «no products entered»', () => {
    expect(doughAmountLine({ items: [], occasional: [], sheet: sheet() })).toEqual({ kind: 'total', g: 1650 });
    // A sheet saved before typed_g existed still has its total.
    expect(doughAmountLine({ items: [{ qty: 0 }], sheet: sheet({ total_g: 1649.6 }) })).toEqual({ kind: 'total', g: 1650 });
  });

  test('an «orders + total» dough shows the grams typed on top of its products', () => {
    const products = [{ qty: 2, weightG: 100 }];
    expect(doughAmountLine({ items: products, sheet: sheet({ typed_g: 400.4 }) })).toEqual({ kind: 'typed', g: 400 });
    expect(doughAmountLine({ items: products, sheet: sheet({ typed_g: 0 }) })).toBeNull();
    expect(doughAmountLine({ occasional: [{ products }], sheet: sheet({ typed_g: 50 }) })).toEqual({ kind: 'typed', g: 50 });
  });

  test('extra dough alone has its own line, so it is not the total', () => {
    expect(doughAmountLine({ items: [], sheet: sheet({ total_g: 300, extra_g: 300 }) })).toBeNull();
    expect(doughAmountLine({ items: [], sheet: sheet({ total_g: 500, extra_g: 300 }) })).toEqual({ kind: 'total', g: 500 });
  });

  test('trays carry their own line; a log with no sheet, or an empty total, has none', () => {
    expect(doughAmountLine({ items: [], sheet: sheet({ trays: 3 }) })).toBeNull();
    expect(doughAmountLine({ items: [], sheet: null })).toBeNull();
    expect(doughAmountLine(null)).toBeNull();
    expect(doughAmountLine(undefined)).toBeNull();
    expect(doughAmountLine({ items: [], sheet: sheet({ total_g: 0 }) })).toBeNull();
    expect(doughAmountLine({ items: [], sheet: sheet({ total_g: 'abc' }) })).toBeNull();
  });
});
