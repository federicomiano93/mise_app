// Unit tests for the VAT menu a venue's country offers (P15), run against BOTH implementations: the
// TypeScript port in shared/ and js/vat-rates.js, which the live app uses today. The original has no
// test file of its own; its behaviour is pinned through tests/foodcost-vat-country.test.mjs (the
// vatRatesFor lines, ported here) and tests/foodcost-model.test.mjs (the re-export). The module is a
// FULL port, so parity.spec.ts also compares its exports name by name.

import { describe, expect, test } from 'vitest';
import * as ported from './vat-rates';
import * as legacyJs from '../../js/vat-rates.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('Italy offers 22, 10 and 4; the UK offers 20, 5 and 0 — highest first', () => {
    expect(m.vatRatesFor('IT').map(r => r.rate)).toStrictEqual([22, 10, 4]);
    expect(m.vatRatesFor('GB').map(r => r.rate)).toStrictEqual([20, 5, 0]);
  });

  test('⚠️ zero is a real choice in the UK, not a missing one', () => {
    expect(m.vatRatesFor('GB').some(r => r.rate === 0)).toBe(true);
  });

  test('an unknown country gets the UK menu, never an empty one', () => {
    for (const unknown of [null, undefined, '', 'FR', '__proto__', 'constructor', 'toString', 5, {}]) {
      expect(m.vatRatesFor(unknown), String(unknown)).toBe(m.VAT_RATES_BY_COUNTRY.GB);
    }
  });

  test('each choice names its label by a dictionary key', () => {
    expect(m.vatRatesFor('IT').map(r => r.key)).toStrictEqual(['fc.vat.standard', 'fc.vat.reduced', 'fc.vat.minimum']);
    expect(m.vatRatesFor('GB').map(r => r.key)).toStrictEqual(['fc.vat.standard', 'fc.vat.reduced', 'fc.vat.zero']);
  });

  test('the menu cannot be changed by a caller: frozen all the way down', () => {
    expect(Object.isFrozen(m.VAT_RATES_BY_COUNTRY)).toBe(true);
    for (const list of Object.values(m.VAT_RATES_BY_COUNTRY)) {
      expect(Object.isFrozen(list)).toBe(true);
      for (const choice of list) expect(Object.isFrozen(choice)).toBe(true);
    }
  });
});
