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

test('products: the rules ceiling is PRODUCT_MODEL', () => {
  const m = rules.match(/request\.resource\.data\.model <= (\d+)\)/);
  assert.ok(m, 'the product model ceiling is in firestore.rules');
  assert.equal(Number(m[1]), PRODUCT_MODEL);
});
