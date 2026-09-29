import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planBatches, categoryPatch, INGREDIENT_WRITES_PER_BATCH } from '../js/orders/category-batches.js';
import { INGREDIENT_DRAINED_FIELDS } from '../js/price-model.js';

const ids = (n) => Array.from({ length: n }, (_, i) => `i${i}`);
const slots = (plan) => plan.map(step => step.ids.length + (step.config ? 1 : 0));

test('no more than six writes in a batch, the config write counting as one', () => {
  assert.equal(INGREDIENT_WRITES_PER_BATCH, 6);
  const plan = planBatches(ids(20), 6, true);
  assert.ok(slots(plan).every(n => n <= 6));
  assert.equal(plan[0].config, true);
  assert.deepEqual(plan.slice(1).map(s => s.config), plan.slice(1).map(() => false));
  assert.deepEqual(plan.flatMap(s => s.ids), ids(20));
});

test('the list goes alone when nobody used the category; nothing at all without either', () => {
  assert.deepEqual(planBatches([], 6, true), [{ config: true, ids: [] }]);
  assert.deepEqual(planBatches([], 6, false), []);
  assert.deepEqual(planBatches(null, 6, false), []);
});

test('without the config write the batches are full', () => {
  assert.deepEqual(planBatches(ids(13), 6, false).map(s => s.ids.length), [6, 6, 1]);
  assert.deepEqual(slots(planBatches(ids(6), 6, true)), [6, 1]);
});

test('empty ids are dropped and a bad batch size falls back to the default', () => {
  assert.deepEqual(planBatches(['a', '', null, 'b'], 6, false), [{ config: false, ids: ['a', 'b'] }]);
  assert.deepEqual(planBatches(ids(7), 0, false).map(s => s.ids.length), [6, 1]);
});

test('an ingredient write carries the category and every legacy price key as null', () => {
  const patch = categoryPatch('Other');
  assert.equal(patch.category, 'Other');
  assert.ok(INGREDIENT_DRAINED_FIELDS.length > 0);
  for (const key of INGREDIENT_DRAINED_FIELDS) assert.equal(patch[key], null, key);
  assert.equal(patch.vatRate, undefined);
  assert.deepEqual(Object.keys(patch).length, INGREDIENT_DRAINED_FIELDS.length + 1);
});

test('the data layer uses update() (never re-creating a deleted ingredient) through the planner', () => {
  const src = readFileSync(new URL('../js/orders/firebase-orders.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export async function setCategoryOnMany'));
  assert.match(body, /planBatches\(ids, INGREDIENT_WRITES_PER_BATCH, !!alsoWrite\)/);
  assert.match(body, /batch\.update\(doc\(db, pathFor\(COLLECTIONS\.ingredients\), id\), withBakery\(categoryPatch\(value\)\)\)/);
  assert.doesNotMatch(body.slice(0, body.indexOf('// Delete a document')), /batch\.set\(doc\(db, pathFor\(COLLECTIONS\.ingredients\)/);
});
