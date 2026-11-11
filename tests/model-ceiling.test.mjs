// The rules' ceiling on a saved shape number must equal the app's own number. A looser
// ceiling let one member save a higher number by hand and lock every phone out of the
// document for ever (7 Oct 2026 security audit); a tighter one would refuse the app itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONFIG_MODEL } from '../js/calculator-config.js';
import { PRODUCT_MODEL } from '../js/foodcost/foodcost-model.js';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

test('config/calculator: the rules ceiling is CONFIG_MODEL', () => {
  const m = rules.match(/request\.resource\.data\.configModel <= (\d+)\)/);
  assert.ok(m, 'the configModel ceiling is in firestore.rules');
  assert.equal(Number(m[1]), CONFIG_MODEL);
});

// ⚠️ PRODUCTS, SINCE 10 Nov 2026: Mise 2 writes model 3 (its recipe lines are RAW kilos, the product owns its
// oven loss) and the current app still writes 2. ONE firestore.rules serves both, so the ceiling is Mise 2's
// number exactly — read from its source, as node:test cannot import TypeScript — and the current app's must
// sit at or under it, or the rules would refuse the app itself.
test('products: the rules ceiling is Mise 2\'s PRODUCT_MODEL, and the current app writes no more', () => {
  const m = rules.match(/request\.resource\.data\.model <= (\d+)\)/);
  assert.ok(m, 'the product model ceiling is in firestore.rules');
  const source = readFileSync(new URL('../shared/src/foodcost-model.ts', import.meta.url), 'utf8');
  const mise2 = source.match(/^export const PRODUCT_MODEL = (\d+);$/m);
  assert.ok(mise2, 'PRODUCT_MODEL is declared in shared/src/foodcost-model.ts');
  assert.equal(Number(m[1]), Number(mise2[1]));
  assert.ok(PRODUCT_MODEL <= Number(m[1]), 'the current app\'s products stay saveable');
});
