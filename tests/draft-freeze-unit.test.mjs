// A format change that replaces the order unit freezes the PREVIOUS unit into the open draft line
// (1 Oct 2026, review defect 5): «Farina: 8» typed in cartoni must not start reading 8 buste.
//
// draft.js freezeUnitInDraft is EXECUTED here with the Firestore layer stubbed (it reads the draft
// once and merges one field). The wiring from the three callers is pinned as text.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

const STUB = new URL('./helpers/firebase-orders-stub.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './firebase-orders.js' && String(context.parentURL).endsWith('/js/orders/draft.js')) {
      return { url: STUB, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { freezeUnitInDraft } = await import('../js/orders/draft.js');

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

beforeEach(() => { globalThis.__draftDoc = null; globalThis.__draftWrites = []; });

const NOW_CARD = { id: 'flour', unit: 'busta', packUnit: 'busta', weight: '2.5kg' };   // after Cartone → Singola

test('a line typed with no unit of its own keeps the OLD card unit', async () => {
  globalThis.__draftDoc = { entries: { flour: { qty: 8, stock: 0 } } };
  assert.equal(await freezeUnitInDraft({ id: 'flour', from: 'cartone', item: NOW_CARD }), true);
  assert.equal(globalThis.__draftWrites.length, 1);
  const { data } = globalThis.__draftWrites[0];
  assert.deepEqual(data.entries, { flour: { unit: 'cartone' } }, 'one field of one line — whatever another phone typed survives');
  assert.ok(data.updatedAt);
});

test('a line that already carries its own unit is left alone', async () => {
  globalThis.__draftDoc = { entries: { flour: { qty: 8, stock: 0, unit: 'busta' } } };
  assert.equal(await freezeUnitInDraft({ id: 'flour', from: 'cartone', item: NOW_CARD }), false);
  assert.deepEqual(globalThis.__draftWrites, []);
});

test('no quantity, no line, no draft: nothing is written', async () => {
  for (const doc of [null, {}, { entries: {} }, { entries: { flour: { qty: 0, stock: 3 } } }, { entries: { other: { qty: 4 } } }]) {
    globalThis.__draftDoc = doc;
    assert.equal(await freezeUnitInDraft({ id: 'flour', from: 'cartone', item: NOW_CARD }), false);
  }
  assert.deepEqual(globalThis.__draftWrites, []);
});

test('the unit the card still has is stored as nothing (Orders\'s own rule), so nothing is written', async () => {
  globalThis.__draftDoc = { entries: { flour: { qty: 8, stock: 0 } } };
  assert.equal(await freezeUnitInDraft({ id: 'flour', from: 'Busta', item: NOW_CARD }), false);
  assert.deepEqual(globalThis.__draftWrites, []);
});

test('the three callers wire it: the card says what it replaced, Fornitori and Orders freeze the draft', () => {
  const card = read('js/ingredient-record-form.js');
  assert.match(card, /replacedUnit \? \{ unitChangedFrom: replacedUnit \} : undefined\)/);
  const registry = read('js/orders/registry-main.js');
  assert.match(registry, /saveIngredient: async \(id, payload, record, writePrice, meta\) => \{/);
  assert.match(registry, /freezeUnitInDraft\(\{ id: savedId, from: meta\.unitChangedFrom, item: payload \}\)/);
  const create = read('js/ingredient-create.js');
  assert.match(create, /actions\.unitChanged\(\{ id: savedId, from: meta\.unitChangedFrom, item: \{ \.\.\.stored, \.\.\.payload \} \}\)/);
  assert.doesNotMatch(create, /from '\.\/orders\//, 'js/ root imports no feature folder');
  assert.match(read('js/orders/orders-main.js'), /unitChanged: freezeUnitInDraft,/);
});

test('a history record that froze no unit being re-read is left alone, and the code says so', () => {
  assert.match(read('js/orders/draft.js'), /a line already recorded in orders-history carries no frozen unit/);
});
