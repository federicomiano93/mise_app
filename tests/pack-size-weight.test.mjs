import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitWeight, joinWeight, parsePackSize, isUnusableWeight } from '../js/pack-size.js';

test('splitWeight opens a readable value into number and unit', () => {
  assert.deepEqual(splitWeight('25kg'), { amount: '25', unit: 'kg' });
  assert.deepEqual(splitWeight('kg 5'), { amount: '5', unit: 'kg' });
  assert.deepEqual(splitWeight('2,27 kg'), { amount: '2.27', unit: 'kg' });
  assert.deepEqual(splitWeight('500 G'), { amount: '500', unit: 'g' });
  assert.deepEqual(splitWeight('750ml'), { amount: '750', unit: 'ml' });
  assert.deepEqual(splitWeight('1 lt'), { amount: '1', unit: 'l' });
});

test('splitWeight keeps unreadable text as legacy, untouched', () => {
  assert.deepEqual(splitWeight('6x1kg'), { amount: '', unit: 'kg', legacy: '6x1kg' });
  assert.deepEqual(splitWeight(' sacco '), { amount: '', unit: 'kg', legacy: 'sacco' });
  assert.equal(splitWeight('50 cl').legacy, '50 cl');
  assert.equal(splitWeight('0 kg').legacy, '0 kg');
});

test('splitWeight on nothing offers kilos', () => {
  assert.deepEqual(splitWeight(''), { amount: '', unit: 'kg' });
  assert.deepEqual(splitWeight(undefined), { amount: '', unit: 'kg' });
  assert.deepEqual(splitWeight('   '), { amount: '', unit: 'kg' });
});

test('joinWeight builds the stored text', () => {
  assert.equal(joinWeight('2.5', 'kg'), '2.5 kg');
  assert.equal(joinWeight('2,5', 'kg'), '2.5 kg');
  assert.equal(joinWeight('25', 'g'), '25 g');
});

test('joinWeight answers empty for nothing usable', () => {
  assert.equal(joinWeight('', 'kg'), '');
  assert.equal(joinWeight('abc', 'kg'), '');
  assert.equal(joinWeight('0', 'kg'), '');
  assert.equal(joinWeight('-3', 'kg'), '');
  assert.equal(joinWeight('3', 'stone'), '');
  assert.equal(joinWeight(null, 'kg'), '');
});

test('joinWeight output round-trips through parsePackSize and splitWeight', () => {
  for (const [amount, unit, kilos] of [['2.5', 'kg', 2.5], ['500', 'g', 0.5], ['750', 'ml', 0.75], ['1', 'l', 1]]) {
    const text = joinWeight(amount, unit);
    assert.equal(parsePackSize(text), kilos);
    assert.deepEqual(splitWeight(text), { amount, unit });
  }
});

test('isUnusableWeight: only a typed, unusable number counts (an empty box is «no weight»)', () => {
  assert.equal(isUnusableWeight('', 'kg'), false);
  assert.equal(isUnusableWeight('   ', 'kg'), false);
  assert.equal(isUnusableWeight(undefined, 'kg'), false);
  assert.equal(isUnusableWeight('2.5', 'kg'), false);
  assert.equal(isUnusableWeight('2,5', 'g'), false);
  assert.equal(isUnusableWeight('2.27kg', 'kg'), true);
  assert.equal(isUnusableWeight('abc', 'kg'), true);
  assert.equal(isUnusableWeight('0', 'kg'), true);
  assert.equal(isUnusableWeight('-3', 'kg'), true);
  assert.equal(isUnusableWeight('2', 'bogus'), true);
});
