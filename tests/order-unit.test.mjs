// js/order-unit.js — «which unit does this order line mean?». Pure helpers used by
// Orders now and by Inventory later, so each one is pinned on its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanUnit, sameUnit, hasUnitChoice, unitChoices, entryUnit, isDefaultUnit, lineUnit,
  recordUnit, qtyWithUnit, storedUnitFor,
} from '../js/order-unit.js';

const CASE = { unit: 'cartone', packUnit: 'busta' };
const PLAIN = { unit: 'cartone' };

test('cleanUnit trims, caps at 100 and answers "" for anything that is not a string', () => {
  assert.equal(cleanUnit('  busta '), 'busta');
  assert.equal(cleanUnit('x'.repeat(150)).length, 100);
  [null, undefined, 4, {}, [], true].forEach(v => assert.equal(cleanUnit(v), ''));
});

test('sameUnit ignores case and surrounding or repeated spaces', () => {
  assert.ok(sameUnit('Busta', 'busta'));
  assert.ok(sameUnit('  busta ', 'busta'));
  assert.ok(sameUnit('mezza  busta', 'MEZZA busta'));
  assert.ok(!sameUnit('busta', 'cartone'));
  assert.ok(sameUnit('', null), 'two nothings are the same nothing');
  assert.ok(!sameUnit('busta', ''));
});

test('a choice exists only when the card names both a unit and a different package', () => {
  assert.ok(hasUnitChoice(CASE));
  assert.ok(!hasUnitChoice(PLAIN));
  assert.ok(!hasUnitChoice({ packUnit: 'busta' }), 'a package with no unit has nothing to choose');
  assert.ok(!hasUnitChoice({ unit: 'busta', packUnit: ' Busta ' }), 'the same word twice');
  assert.ok(!hasUnitChoice(null));
  assert.ok(!hasUnitChoice({ unit: 5, packUnit: {} }));
});

test('unitChoices offers the card unit first, then the package', () => {
  assert.deepEqual(unitChoices(CASE), ['cartone', 'busta']);
  assert.deepEqual(unitChoices(PLAIN), ['cartone']);
  assert.deepEqual(unitChoices({}), []);
  assert.deepEqual(unitChoices(null), []);
});

test('a stored choice the card no longer offers is appended, never dropped', () => {
  assert.deepEqual(unitChoices(CASE, 'Busta'), ['cartone', 'busta'], 'a known one is not doubled');
  assert.deepEqual(unitChoices(CASE, 'sacco'), ['cartone', 'busta', 'sacco']);
  assert.deepEqual(unitChoices(PLAIN, 'busta'), ['cartone', 'busta']);
  assert.deepEqual(unitChoices({}, 'busta'), ['busta']);
  assert.deepEqual(unitChoices(CASE, '   '), ['cartone', 'busta']);
});

test('entryUnit: the entry own unit, else the card', () => {
  assert.equal(entryUnit({ unit: 'busta' }, CASE), 'busta');
  assert.equal(entryUnit({ qty: 2 }, CASE), 'cartone');
  assert.equal(entryUnit(undefined, CASE), 'cartone');
  assert.equal(entryUnit({}, undefined), '');
});

test('isDefaultUnit: no unit, or the card unit in any spelling, is the default', () => {
  assert.ok(isDefaultUnit({ qty: 1 }, CASE));
  assert.ok(isDefaultUnit({ unit: '' }, CASE));
  assert.ok(isDefaultUnit({ unit: 'CARTONE' }, CASE));
  assert.ok(isDefaultUnit(undefined, CASE));
  assert.ok(!isDefaultUnit({ unit: 'busta' }, CASE));
});

test('lineUnit: shown for a card with a choice (default too) and for a non-default entry only', () => {
  assert.equal(lineUnit(CASE, { qty: 1 }), 'cartone');
  assert.equal(lineUnit(CASE, { unit: 'busta' }), 'busta');
  assert.equal(lineUnit(PLAIN, { qty: 1 }), '', 'an ordinary line shows no unit');
  assert.equal(lineUnit(PLAIN, { unit: 'cartone' }), '');
  assert.equal(lineUnit(PLAIN, { unit: 'busta' }), 'busta', 'a stale non-default unit is kept');
  assert.equal(lineUnit({}, {}), '');
});

test('recordUnit: what the record froze, else the card unit', () => {
  assert.equal(recordUnit({ units: { a: 'busta' } }, 'a', CASE), 'busta');
  assert.equal(recordUnit({ units: {} }, 'a', CASE), 'cartone');
  assert.equal(recordUnit({}, 'a', CASE), 'cartone');
  assert.equal(recordUnit(null, 'a', null), '');
});

test('qtyWithUnit writes «2 × busta», and only the number without a unit', () => {
  assert.equal(qtyWithUnit(2, 'busta'), '2 × busta');
  assert.equal(qtyWithUnit(2, ' busta '), '2 × busta');
  assert.equal(qtyWithUnit(2, ''), '2');
  assert.equal(qtyWithUnit(0, undefined), '0');
});

test('storedUnitFor: the draft keeps only a NON-default choice', () => {
  assert.equal(storedUnitFor('busta', CASE), 'busta');
  assert.equal(storedUnitFor('Cartone', CASE), '');
  assert.equal(storedUnitFor('', CASE), '');
  assert.equal(storedUnitFor(null, CASE), '');
  assert.equal(storedUnitFor(' busta ', CASE), 'busta');
});
