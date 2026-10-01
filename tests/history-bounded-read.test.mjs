// Source-shape pins for the bounded History read: the Orders screen must never go back to
// listening to the whole orders-history collection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

test('orders-main reads the live window, not the whole collection', () => {
  const main = read('js/orders/orders-main.js');
  assert.ok(!main.includes('watchCollection(COLLECTIONS.history'), 'the unbounded history listener is back');
  assert.ok(main.includes('watchRecentHistory('));
});

test('the data layer bounds the history read by the date field', () => {
  const src = read('js/orders/firebase-orders.js');
  const body = name => {
    const start = src.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, `${name} is missing`);
    const next = src.indexOf('\nexport ', start + 10);
    return src.slice(start, next < 0 ? undefined : next);
  };
  assert.ok(body('watchRecentHistory').includes("where('date', '>='"));
  assert.ok(body('getOlderHistory').includes("orderBy('date', 'desc')"));
  assert.ok(body('getOlderHistory').includes('limit('));
  assert.ok(body('getOlderHistory').includes('startAfter('));
  assert.ok(body('getLegacyHistory').includes("orderBy('weekStart')"));
});

test('the on-demand reads go to the SERVER, never the offline cache', () => {
  // Offline, getDocs answers from the local cache; a short page would then read as "done"
  // and the Load button would vanish for good. getDocsFromServer rejects instead.
  const src = read('js/orders/firebase-orders.js');
  for (const name of ['getOlderHistory', 'getLegacyHistory']) {
    const start = src.indexOf(`export async function ${name}(`);
    const next = src.indexOf('\nexport ', start + 10);
    const body = src.slice(start, next < 0 ? undefined : next);
    assert.ok(body.includes('getDocsFromServer('), `${name} must call getDocsFromServer`);
    assert.ok(!/\bgetDocs\(/.test(body), `${name} must not call getDocs`);
  }
});

test('the History view and the settings text use the shared window', () => {
  assert.ok(read('js/orders/history.js').includes('HISTORY_LIVE_MONTHS'));
  assert.ok(read('js/orders/management.js').includes('HISTORY_LIVE_MONTHS'));
});
