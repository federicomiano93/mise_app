// The draft WRITER and the per-line supplier override (js/orders/line-supplier.js). draft.js runs
// for real here; only its data layer is replaced by tests/helpers/firebase-orders-recording-stub.mjs, which
// records every write. What must hold: the override is written with the line, and EVERY path
// that takes the quantity away takes the key away in the same write.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { draft, stub } from './helpers/load-draft.mjs';
import { resolveSuppliers } from '../js/orders/no-supplier.js';

const ALDO = { id: 'aldo', name: 'Aldo' };
const BRUNO = { id: 'bruno', name: 'Bruno' };
const SUPPLIERS = [ALDO, BRUNO];

beforeEach(() => stub.reset());

// Each test uses its own ingredient id: draft.js keeps what it last agreed with the server in
// module state, exactly as the page does.
const ing = id => ({ id, name: id, supplierId: 'aldo' });

test('a line sent to another supplier is saved with its supplier, in the one merge write', async () => {
  const entries = { w1: { qty: 4, stock: 0, supplierId: 'bruno' } };
  await draft.saveDraftNow(entries, { bruno: '2026-10-02' });
  assert.equal(stub.calls.saveDoc.length, 1);
  const { name, id, data } = stub.calls.saveDoc[0];
  assert.equal(name, 'drafts');
  assert.equal(id, 'current');
  assert.deepEqual(data.entries, { w1: { qty: 4, stock: 0, supplierId: 'bruno' } });
  assert.deepEqual(data.days, { bruno: '2026-10-02' });
});

test('the line taken to zero writes the key away in the same write', async () => {
  const entries = { w2: { qty: 4, stock: 0, supplierId: 'bruno' } };
  await draft.saveDraftNow(entries, {});
  stub.reset();

  entries.w2.qty = 0;                       // memory may still hold the key
  await draft.saveDraftNow(entries, {});
  assert.deepEqual(stub.calls.saveDoc[0].data.entries.w2, { qty: 0, stock: 0, supplierId: '' });
});

test('typing a quantity on the usual supplier\'s row moves the line back and writes the key away', async () => {
  const entries = { w3: { qty: 4, stock: 0, supplierId: 'bruno' } };
  await draft.saveDraftNow(entries, {});
  stub.reset();

  entries.w3.qty = 2;
  entries.w3.supplierId = '';
  await draft.saveDraftNow(entries, {});
  assert.deepEqual(stub.calls.saveDoc[0].data.entries.w3, { qty: 2, stock: 0, supplierId: '' });
});

test('«start again» for the other supplier deletes the override with the quantity', async () => {
  const lens = resolveSuppliers([ing('w4'), ing('w4b')], SUPPLIERS, true, { w4: { qty: 3, supplierId: 'bruno' } });
  await draft.clearQuantities(['bruno'], lens);
  assert.equal(stub.calls.clearFields.length, 1);
  const { paths } = stub.calls.clearFields[0];
  assert.ok(paths.includes('entries.w4.qty'));
  assert.ok(paths.includes('entries.w4.supplierId'));
  assert.ok(paths.includes('days.bruno'));
  assert.ok(!paths.includes('entries.w4b.qty'), 'the other supplier\'s own rows are not in Bruno\'s clear');
});

test('«start again» for the usual supplier leaves the other supplier\'s line alone', async () => {
  const lens = resolveSuppliers([ing('w5'), ing('w5b')], SUPPLIERS, true, { w5: { qty: 3, supplierId: 'bruno' } });
  await draft.clearQuantities(['aldo'], lens);
  const { paths } = stub.calls.clearFields[0];
  assert.ok(!paths.some(p => p.startsWith('entries.w5.')), 'w5 belongs to Bruno\'s order now');
  assert.ok(paths.includes('entries.w5b.supplierId'));
});

test('placing the order clears the whole entry of every line in it — the override included', async () => {
  const lens = resolveSuppliers([ing('w6')], SUPPLIERS, true, { w6: { qty: 3, supplierId: 'bruno' } });
  await draft.clearSupplier('bruno', lens);
  assert.deepEqual(stub.calls.clearFields[0].paths, ['entries.w6', 'days.bruno']);

  stub.reset();
  await draft.clearSupplier('aldo', lens);
  assert.deepEqual(stub.calls.clearFields[0].paths, ['days.aldo'], 'Aldo\'s clear does not take Bruno\'s line');
});

test('a line that was cleared and typed again is sent afresh, not mistaken for «unchanged»', async () => {
  const entries = { w7: { qty: 4, stock: 0, supplierId: 'bruno' } };
  await draft.saveDraftNow(entries, {});
  await draft.clearSupplier('bruno', resolveSuppliers([ing('w7')], SUPPLIERS, true, entries));
  stub.reset();

  await draft.saveDraftNow({ w7: { qty: 4, stock: 0, supplierId: 'bruno' } }, {});
  assert.equal(stub.calls.saveDoc.length, 1, 'known was forgotten by the clear, so the same line is written again');
});
