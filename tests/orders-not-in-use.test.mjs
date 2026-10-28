// An ingredient switched off while it holds a quantity stays in the order flow (P15).
// The pure module, the filters that read it, the row word, and source pins for the wiring
// in orders-main.js / ingredients.js (neither loads under node: they need a DOM).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLanguage, DEFAULT_LANGUAGE } from '../js/i18n.js';
import {
  inOrderFlow, noteHeld, markHeld, releaseHeld, lineNoteText,
} from '../js/orders/not-in-use.js';
import { ingredientsOf } from '../js/orders/archive.js';
import { flatRows, orderSummary } from '../js/orders/ingredient-search.js';
import { orderSuppliers, NO_SUPPLIER_ID } from '../js/orders/no-supplier.js';

const src = file => readFileSync(new URL(`../js/orders/${file}`, import.meta.url), 'utf8');
const ing = (id, extra = {}) => ({ id, name: id, supplierId: 's1', ...extra });

test('inOrderFlow: active, or marked not in use; a plain inactive one is out', () => {
  assert.equal(inOrderFlow(ing('a')), true);
  assert.equal(inOrderFlow(ing('a', { active: true })), true);
  assert.equal(inOrderFlow(ing('a', { active: false })), false);
  assert.equal(inOrderFlow(ing('a', { active: false, notInUse: true })), true);
});

test('noteHeld: an inactive item with a positive quantity is held, and stays held at 0', () => {
  const held = new Set();
  const list = [ing('a', { active: false }), ing('b', { active: false }), ing('c')];
  const entries = { a: { qty: 3 }, b: { qty: 0 }, c: { qty: 5 } };
  const sig = noteHeld(list, entries, held);
  assert.deepEqual([...held], ['a']);
  assert.equal(sig, 'a');
  entries.a.qty = 0;                      // deleting «3» to type «4»
  assert.equal(noteHeld(list, entries, held), 'a');
  assert.ok(held.has('a'));
});

test('noteHeld: a corrupt quantity holds nothing (never NaN)', () => {
  const held = new Set();
  noteHeld([ing('a', { active: false })], { a: { qty: 'x' } }, held);
  noteHeld([ing('b', { active: false })], { b: { qty: NaN } }, held);
  assert.equal(held.size, 0);
});

test('noteHeld: the signature changes when a held item is switched on or off', () => {
  const held = new Set();
  const entries = { a: { qty: 2 } };
  const off = [ing('a', { active: false })];
  const on = [ing('a', { active: true })];
  const s1 = noteHeld(off, entries, held);
  const s2 = noteHeld(on, entries, held);
  const s3 = noteHeld(off, entries, held);
  assert.notEqual(s1, s2);
  assert.equal(s2, '');
  assert.equal(s1, s3);
});

test('noteHeld: the signature is sorted, so order does not matter', () => {
  const held = new Set();
  const entries = { a: { qty: 1 }, b: { qty: 1 } };
  const s = noteHeld([ing('b', { active: false }), ing('a', { active: false })], entries, held);
  assert.equal(s, 'a\nb');
});

test('markHeld: marks only held inactive items, returns a new array, never touches active', () => {
  const a = ing('a', { active: false });
  const b = ing('b', { active: false });
  const c = ing('c');
  const input = [a, b, c];
  const out = markHeld(input, new Set(['a']));
  assert.notEqual(out, input);
  assert.equal(out[0].notInUse, true);
  assert.equal(out[0].active, false);
  assert.equal(out[1], b);
  assert.equal(out[2], c);
  assert.equal(a.notInUse, undefined);
});

test('releaseHeld: drops only the ids whose quantity is gone', () => {
  const held = new Set(['a', 'b', 'c']);
  releaseHeld(held, ['a', 'b'], { a: { qty: 0 }, b: { qty: 2 } });
  assert.deepEqual([...held].sort(), ['b', 'c']);
});

test('ingredientsOf keeps a notInUse item and still drops a plain inactive one', () => {
  const list = [ing('a', { active: false, notInUse: true }), ing('b', { active: false }), ing('c')];
  assert.deepEqual(ingredientsOf('s1', list).map(i => i.id), ['a', 'c']);
  assert.deepEqual(ingredientsOf('s1', list, { activeOnly: false }).map(i => i.id), ['a', 'b', 'c']);
});

test('flatRows keeps a notInUse item and still drops a plain inactive one', () => {
  const list = [ing('a', { active: false, notInUse: true }), ing('b', { active: false })];
  const { rows, total } = flatRows({ ingredients: list, suppliers: [{ id: 's1', name: 'S' }], query: '' });
  assert.deepEqual(rows.map(r => r.ingredient.id), ['a']);
  assert.equal(total, 1);
});

test('orderSummary counts a held line and not a plain inactive one', () => {
  const list = [ing('a', { active: false, notInUse: true }), ing('b', { active: false })];
  const sum = orderSummary({
    ingredients: list, suppliers: [{ id: 's1' }], entries: { a: { qty: 2 }, b: { qty: 4 } },
  });
  assert.deepEqual(sum.ids, ['a']);
});

test('orderSuppliers lists No supplier for a held line only', () => {
  const held = ing('a', { supplierId: NO_SUPPLIER_ID, active: false, notInUse: true });
  const plain = ing('b', { supplierId: NO_SUPPLIER_ID, active: false });
  assert.equal(orderSuppliers([], [held]).length, 1);
  assert.equal(orderSuppliers([], [plain]).length, 0);
});

test('lineNoteText: «Not in use» in English and «Non in uso» in Italian, joined with the other note', () => {
  const held = ing('a', { active: false, notInUse: true });
  try {
    setLanguage('en');
    assert.equal(lineNoteText(held), 'Not in use');
    assert.equal(lineNoteText(held, 'usually from X'), 'Not in use · usually from X');
    assert.equal(lineNoteText(ing('b'), 'usually from X'), 'usually from X');
    assert.equal(lineNoteText(ing('b')), '');
    setLanguage('it');
    assert.equal(lineNoteText(held), 'Non in uso');
    assert.equal(lineNoteText(held, 'di solito da X'), 'Non in uso · di solito da X');
  } finally {
    setLanguage(DEFAULT_LANGUAGE);
  }
});

test('pin: buildRow draws the note through lineNoteText; the flat list uses buildRow', () => {
  assert.match(src('ingredients.js'), /const text = lineNoteText\(ing,/);
  assert.match(src('ingredient-list.js'), /buildRow\(/);
});

test('pin: both lenses read markedIngredients(); send and clear release the held lines', () => {
  const main = src('orders-main.js');
  assert.match(main, /resolveLens\(markedIngredients\(\)/);
  assert.match(main, /resolveCatalogue\(markedIngredients\(\)/);
  assert.match(main, /markLens\(state\.ingredients, noteHeld\(/);
  const clear = main.slice(main.indexOf('async function clearQuantitiesFor'));
  assert.match(clear.slice(0, clear.indexOf('\n}\n')), /releaseHeldFor\(ids\)/);
  assert.match(main, /function releaseHeldFor[\s\S]*?releaseHeld\(heldNotInUse/);
  const place = main.slice(main.indexOf('async function placeOrder'));
  const placeBody = place.slice(0, place.indexOf('\n}\n'));
  assert.ok(placeBody.indexOf('await clearSupplier') < placeBody.indexOf('releaseHeldFor([supplierId])'),
    'release comes AFTER clearSupplier');
  assert.doesNotMatch(main, /i\.active !== false\), 'supplierId'/);
});
