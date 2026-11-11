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
import { PRODUCT_MODEL } from './foodcost-model';
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
