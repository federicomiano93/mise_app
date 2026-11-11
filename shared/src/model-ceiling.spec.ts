// The rules' ceiling on a saved shape number must equal the app's own number (P15). A looser ceiling let one
// member save a higher number by hand and lock every phone out of the document for ever (7 Oct 2026 security
// audit); a tighter one would refuse the app itself. Ported from tests/model-ceiling.test.mjs (both tests),
// run against the TypeScript ports AND the js/ originals: whichever app writes the document, the rules must
// accept exactly its number.
//
// ⚠️ Mise 2 and the current app share ONE firestore.rules, so the number must be the same in all four places
// (rules, js/, shared/). The editor and save parts of the original file (the config write itself) belong to
// step 3c-2.
// ⚠️ POST-SWITCH, PRODUCTS ONLY (10 Nov 2026): Mise 2's PRODUCT_MODEL is 3 — its recipe lines are RAW kilos and
// the product owns its oven loss — while the current app still writes 2. The ceiling is Mise 2's number exactly;
// the current app's must only sit at or under it, so the rules keep accepting its saves.

import { describe, expect, test } from 'vitest';
import rules from '../../firestore.rules?raw';
import { CONFIG_MODEL } from './calculator-config';
import { PRODUCT_MODEL, weighingAllowed } from './foodcost-model';
import { CONFIG_MODEL as legacyConfigModel } from '../../js/calculator-config.js';
import { PRODUCT_MODEL as legacyProductModel } from '../../js/foodcost/foodcost-model.js';

describe.each([
  ['shared/ (TypeScript)', { configModel: CONFIG_MODEL, productModel: PRODUCT_MODEL, productCeiling: true }],
  ['js/ (current app)', { configModel: legacyConfigModel as number, productModel: legacyProductModel as number, productCeiling: false }],
] as const)('%s', (_name, m) => {
  test('config/calculator: the rules ceiling is CONFIG_MODEL', () => {
    const found = rules.match(/request\.resource\.data\.configModel <= (\d+)\)/);
    expect(found, 'the configModel ceiling is in firestore.rules').not.toBeNull();
    expect(Number((found as RegExpMatchArray)[1])).toBe(m.configModel);
  });

  test('products: the rules ceiling is PRODUCT_MODEL (post-switch: the current app sits under it)', () => {
    const found = rules.match(/request\.resource\.data\.model <= (\d+)\)/);
    expect(found, 'the product model ceiling is in firestore.rules').not.toBeNull();
    const ceiling = Number((found as RegExpMatchArray)[1]);
    if (m.productCeiling) expect(ceiling).toBe(m.productModel);
    else expect(m.productModel).toBeLessThanOrEqual(ceiling);
  });
});

// POST-SWITCH (11 Nov 2026, step 2b): the product form refuses a weight the PRODUCTS rules would, while the work is on screen. The
// check's bound is the rules' own number, read from firestore.rules here so the two cannot drift apart.
describe('products: the weights the form lets through are the ones the rules keep', () => {
  // The `rawGrams` and `cookedGrams` lines of the products block (`match /products/{id}`), not the recipes' own (`>= 0`).
  const bound = (field: 'rawGrams' | 'cookedGrams'): { ceiling: number } => {
    const found = new RegExp(String.raw`request\.resource\.data\.${field} > 0\s*&&\s*request\.resource\.data\.${field} <= (\d+)\)`).exec(rules);
    expect(found, `${field} is bounded in the products rules`).not.toBeNull();
    return { ceiling: Number((found as RegExpMatchArray)[1]) };
  };

  test.each(['rawGrams', 'cookedGrams'] as const)('%s: allowed up to the rules ceiling, refused above it and at 0', field => {
    const { ceiling } = bound(field);
    expect(weighingAllowed(ceiling)).toBe(true);
    expect(weighingAllowed(ceiling + 1)).toBe(false);
    expect(weighingAllowed(0)).toBe(false);
  });

  test('nothing, and a small weight, are allowed; negatives and text that is not a number are not', () => {
    expect(weighingAllowed(null)).toBe(true);
    expect(weighingAllowed(0.1)).toBe(true);
    expect(weighingAllowed(-5)).toBe(false);
    expect(weighingAllowed(Number.NaN)).toBe(false);
    expect(weighingAllowed(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
