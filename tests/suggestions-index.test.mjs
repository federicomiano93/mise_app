// indexHistoryByIngredient cuts the history once so the suggestion engine does not filter and
// sort four months of orders for every row. The cut must change NOTHING about the answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSuggestion, indexHistoryByIngredient } from '../js/orders/suggestions.js';

const order = (date, id, qty, stock) => ({
  date, supplierId: 'alba', quantities: { [id]: qty }, stock: { [id]: stock },
});
const legacyWeek = (weekStart, id, qty, stock) => ({
  weekStart, quantities: { [id]: qty }, stock: { [id]: stock },
});

test('computeSuggestion gives the same answer from the per-ingredient index as from the whole history', () => {
  const history = [
    order('2026-07-06', 'flour', 10, 2),
    order('2026-07-07', 'flour', 12, 1),
    order('2026-07-07', 'sugar', 3, 1),
    order('2026-07-08', 'flour', 9, 4),
    order('2026-07-09', 'flour', 11, 0),
    order('2026-07-10', 'flour', 10, 2),
    order('2026-07-10', 'butter', 5, 0),
    legacyWeek('2026-06-29', 'flour', 20, 5),
    legacyWeek('2026-06-22', 'sugar', 4, 0),
    { date: '2026-07-11', supplierId: 'alba', quantities: { flour: 8 } },
    { date: '2026-07-12', supplierId: 'alba', quantities: { flour: '7', sugar: 'abc' }, stock: { flour: '2' } },
    { date: '2026-07-13', supplierId: 'alba', units: { flour: 'busta' }, quantities: { flour: 2 }, stock: { flour: 1 } },
    { date: '2026-07-14', supplierId: 'alba', stock: { flour: 3 } },
    { date: '2026-07-15', supplierId: 'alba', quantities: { flour: 6 }, stock: { flour: 1 } },
    { date: '2026-07-15', supplierId: 'borgo', quantities: { flour: 14 }, stock: { flour: 1 } },
    { date: '2026-07-16', supplierId: 'alba', quantities: { flour: 6 }, stock: { flour: 1 } },
    { date: '2026-07-17', supplierId: 'alba', quantities: { flour: 6 }, stock: { flour: 1 } },
    {},
    { date: '2026-07-18', supplierId: 'alba' },
  ];
  const cards = [
    null,
    { id: 'flour', unit: 'cartone' },
    { id: 'flour', unit: 'busta' },
    { id: 'flour', unit: 'kg' },
    { id: 'sugar', unit: 'cartone' },
  ];
  const index = indexHistoryByIngredient(history);
  for (const id of ['flour', 'sugar', 'butter', 'nothing-ever-ordered']) {
    for (const ing of cards) {
      for (const stock of [undefined, 0, 3, '5', 'x', -2, 1e9]) {
        assert.deepEqual(
          computeSuggestion(id, stock, index.get(id) || [], ing),
          computeSuggestion(id, stock, history, ing),
          `${id} / ${JSON.stringify(ing)} / ${stock}`,
        );
      }
    }
  }
});

test('indexHistoryByIngredient lists each ingredient newest first and survives odd input', () => {
  const index = indexHistoryByIngredient([
    order('2026-07-06', 'flour', 1, 0),
    legacyWeek('2026-07-09', 'flour', 2, 0),
    order('2026-07-07', 'flour', 3, 0),
    null,
    { date: '2026-07-01' },
  ]);
  assert.deepEqual(index.get('flour').map(r => r.date || r.weekStart), ['2026-07-09', '2026-07-07', '2026-07-06']);
  assert.equal(index.has('sugar'), false);
  assert.equal(indexHistoryByIngredient(undefined).size, 0);
});
