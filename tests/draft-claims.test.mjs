// Two phones on one order: what this phone CLAIMS as its own typing, and what its autosave sends.
//
// draft.js runs for real; its data layer is the recording stub (tests/helpers/load-draft.mjs), whose
// `emit` plays a snapshot of drafts/current and `holdSaves` keeps a write in the air. The page is
// reduced to what orders-main.js does with the draft: the entries map keeps its reference and its
// rows are the snapshot's own objects (setEntries), the days map is REPLACED on every snapshot, and
// a keystroke mutates a row in place and calls scheduleDraftSave.
//
// Each hole below put back quantities of an order another phone had just placed or cleared (found
// building Mise 2's Orders, step 3f-1 — app/src/orders/draftSync.ts is the reviewed port).

import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { draft, stub } from './helpers/load-draft.mjs';

const DAY = '2026-10-28';
const page = { entries: {}, days: {} };
const results = [];

draft.setDraftSaveReporter(ok => results.push(ok));
draft.watchDraft(view => {
  Object.keys(page.entries).forEach(k => delete page.entries[k]);
  Object.assign(page.entries, view.entries);
  page.days = view.days || {};
});

mock.timers.enable({ apis: ['setTimeout'] });

// The server's document; each call hands over fresh objects, as Firestore does.
const snapshot = (entries, days = {}) => stub.emit(structuredClone({ entries, days, updatedAt: 'x' }));

function type(id, patch, stamp) {
  const entry = page.entries[id] || (page.entries[id] = { qty: 0, stock: 0 });
  Object.assign(entry, patch);
  if (stamp) page.days[stamp] = DAY;
  draft.scheduleDraftSave(page.entries, page.days);
}

const settle = () => new Promise(resolve => setImmediate(resolve));
async function pause() {
  mock.timers.tick(800);
  await settle();
}
const sent = () => stub.calls.saveDoc.map(call => call.data);

beforeEach(() => {
  stub.reset();
  results.length = 0;
});

test('a line put back to the server\'s value inside the pause is released, not sent later', async () => {
  snapshot({ c1: { qty: 3, stock: 0 } });
  type('c1', { qty: 4 });
  type('c1', { qty: 3 });
  await pause();
  assert.deepEqual(sent(), [], 'nothing differs from the server');

  // Any later snapshot must not bring the 4 back on screen…
  snapshot({ c1: { qty: 3, stock: 0 }, other: { qty: 1, stock: 0 } });
  assert.equal(page.entries.c1.qty, 3);
  // …and the next keystroke on another line must not write it.
  type('c1b', { qty: 2 });
  await pause();
  assert.equal(sent().length, 1);
  assert.equal(sent()[0].entries.c1, undefined);
});

test('a line typed to the value another phone just wrote is released, so placing that order clears it', async () => {
  snapshot({ c2: { qty: 3, stock: 0 } });
  type('c2', { qty: 5 });
  snapshot({ c2: { qty: 5, stock: 0 } });          // the other phone wrote 5 in the same second
  await pause();
  snapshot({});                                    // …and placed the order
  assert.equal(page.entries.c2, undefined, 'the placed line does not come back');
  type('c2b', { qty: 1 });
  await pause();
  assert.equal(sent().at(-1).entries.c2, undefined, 'and is never written back');
});

test('a stock count sends only the stock, never this phone\'s copy of the quantity', async () => {
  snapshot({ c3: { qty: 3, stock: 1 } });
  type('c3', { stock: 2 });
  await pause();
  assert.deepEqual(sent()[0].entries, { c3: { stock: 2 } });
});

test('a stock count during the pause does not bring back the quantity of an order just placed', async () => {
  snapshot({ c4: { qty: 3, stock: 1 } });
  type('c4', { stock: 2 });
  snapshot({});                                    // the other phone placed the order
  assert.ok(!page.entries.c4?.qty, 'no quantity on screen');
  await pause();
  assert.deepEqual(sent()[0].entries, { c4: { stock: 2 } });
});

test('a quantity travels with its unit and its «this time» supplier, \'\' included', async () => {
  snapshot({ c5: { qty: 3, stock: 1, unit: 'busta' } });
  type('c5', { qty: 5 });
  await pause();
  assert.deepEqual(sent()[0].entries, { c5: { qty: 5, unit: 'busta', supplierId: '' } });

  snapshot({ c6: { qty: 3, stock: 0, unit: 'busta', supplierId: 'bruno' } });
  type('c6', { unit: '' });
  await pause();
  assert.deepEqual(sent()[1].entries, { c6: { qty: 3, unit: '', supplierId: 'bruno' } });
});

test('a new line carries only what is in it — no stock 0 over a colleague\'s count', async () => {
  snapshot({});
  type('c7', { qty: 2 }, 'aldo');
  await pause();
  assert.deepEqual(sent()[0].entries, { c7: { qty: 2, unit: '', supplierId: '' } });
  assert.deepEqual(sent()[0].days, { aldo: DAY });
});

test('the waiting save does not put back a day stamp another phone\'s placing removed', async () => {
  snapshot({ c8: { qty: 3, stock: 0 } }, { aldo: DAY });
  type('c8b', { qty: 1 }, 'bruno');                // this phone types for Bruno…
  snapshot({}, {});                                // …while the other one places Aldo's order
  await pause();
  assert.equal(sent().length, 1);
  assert.deepEqual(sent()[0].days, { bruno: DAY }, 'Aldo\'s stamp stays gone');
  assert.deepEqual(Object.keys(sent()[0].entries), ['c8b']);
});

test('a refused write keeps the typing, even when Firestore showed it and took it back', async () => {
  stub.holdSaves();
  snapshot({ c9: { qty: 3, stock: 0 } });
  type('c9', { qty: 5 });
  await pause();
  assert.equal(stub.held.length, 1, 'the write is in the air');
  snapshot({ c9: { qty: 5, stock: 0 } });          // Firestore shows it at once…
  type('c9b', { qty: 1 });                         // …and another line is typed meanwhile
  stub.held[0].reject(new Error('permission-denied'));
  await settle();
  assert.deepEqual(results, [false]);
  snapshot({ c9: { qty: 3, stock: 0 } });          // …then takes it back
  assert.equal(page.entries.c9.qty, 5, 'the typing is still on screen');

  await pause();
  const retry = stub.held.at(-1).data;
  assert.deepEqual(retry.entries.c9, { qty: 5, unit: '', supplierId: '' }, 'and goes out again');
  stub.held.at(-1).resolve();
  await settle();
});

test('a refused direct save the page undoes does not come back on the next snapshot', async () => {
  // «Ordina da un altro fornitore»: orders-main saves at once, and on a refusal puts the line back
  // and re-queues the autosave from the undone state.
  stub.holdSaves();
  snapshot({ c11: { qty: 3, stock: 1 } });
  const previous = page.entries.c11;
  page.entries.c11 = { ...previous, supplierId: 'bruno' };
  const saving = draft.saveDraftNow(page.entries, page.days);
  stub.held[0].reject(new Error('permission-denied'));
  await assert.rejects(saving);
  page.entries.c11 = previous;
  draft.scheduleDraftSave(page.entries, page.days);
  snapshot({ c11: { qty: 3, stock: 1 } });         // Firestore takes the write back
  assert.equal(page.entries.c11.supplierId, undefined, 'the line stays with its usual supplier');
  await pause();
  assert.equal(stub.held.length, 1, 'and nothing is written');
});

// «Azzera le quantità» and placing an order release every claim on the lines they clear. A stock
// count typed while that clear is in the air is new typing, and must still go out.
test('a stock count typed while «clear the quantities» is in the air is still sent', async () => {
  snapshot({ c12: { qty: 3, stock: 2 } }, { aldo: DAY });
  delete page.entries.c12.qty;                     // orders-main forgets the quantity locally…
  delete page.days.aldo;
  const clearing = draft.clearQuantities(['aldo'], [{ id: 'c12', name: 'c12', supplierId: 'aldo' }]);
  type('c12', { stock: 4 });                       // …and the count is typed before the clear lands
  await clearing;
  await pause();
  assert.deepEqual(sent().at(-1).entries, { c12: { stock: 4 } }, 'the count, and only the count');
  assert.equal(sent().at(-1).days, undefined);
});

test('a stock count typed while a placed order is being cleared is sent once the page claims again', async () => {
  snapshot({ c13: { qty: 3, stock: 2 } }, { aldo: DAY });
  delete page.entries.c13;                         // orders-main forgets the placed rows…
  delete page.days.aldo;
  const clearing = draft.clearSupplier('aldo', [{ id: 'c13', name: 'c13', supplierId: 'aldo' }]);
  type('c13', { stock: 4 });                       // …the count is typed in the clear's flight…
  await clearing;
  draft.scheduleDraftSave(page.entries, page.days); // …and placeOrder claims again after it lands
  await pause();
  assert.deepEqual(sent().at(-1).entries, { c13: { stock: 4 } }, 'never the placed quantity');
});

test('a value a write in the air already carries is not sent a second time', async () => {
  stub.holdSaves();
  snapshot({});
  type('c10', { qty: 5 });
  await pause();
  type('c10b', { qty: 2 });
  const flushing = draft.flushDraftSave();         // leaving the section a moment later
  assert.equal(stub.held.length, 2);
  assert.deepEqual(Object.keys(stub.held[1].data.entries), ['c10b'], 'c10 is already on its way');
  stub.held.forEach(write => write.resolve());
  await flushing;
});

// A correction made while the write it corrects is still in the air. The screen then matches
// `known` (no snapshot has shown the write yet: about 5 s on the lab tablet on a freshly opened
// page), so measuring against `known` alone said «nothing to send», and the write in the air then
// landed and put the old number back, on screen and on the server.
test('a quantity corrected to the server\'s value while the write is in the air goes out, and stays', async () => {
  stub.holdSaves();
  snapshot({});
  type('d1', { qty: 5 });
  await pause();
  assert.equal(stub.held.length, 1, 'the 5 is in the air');

  type('d1', { qty: 0 });
  await pause();
  assert.equal(stub.held.length, 2, 'the correction has a write of its own');
  assert.deepEqual(stub.held[1].data.entries, { d1: { qty: 0, unit: '', supplierId: '' } });

  stub.held[0].resolve();
  await settle();
  snapshot({ d1: { qty: 5, stock: 0, unit: '', supplierId: '' } }); // the 5 reaches the server first…
  assert.equal(page.entries.d1.qty, 0, 'and does not come back on screen');

  stub.held[1].resolve();
  await settle();
  snapshot({ d1: { qty: 0, stock: 0, unit: '', supplierId: '' } }); // …then the correction does
  assert.equal(page.entries.d1.qty, 0);
  type('d1b', { qty: 1 });
  await pause();
  assert.deepEqual(Object.keys(stub.held[2].data.entries), ['d1b'], 'the claim on d1 is over');
  stub.held[2].resolve();
  await settle();
});

test('a quantity put back to the one the server already had, while the write is in the air, goes out', async () => {
  stub.holdSaves();
  snapshot({ d2: { qty: 3, stock: 0 } });
  type('d2', { qty: 5 });
  await pause();
  type('d2', { qty: 3 });
  await pause();
  assert.deepEqual(stub.held[1]?.data.entries, { d2: { qty: 3, unit: '', supplierId: '' } });
  stub.held.forEach(write => write.resolve());
  await settle();
});

test('a correction still in its pause when the earlier write lands goes out after it', async () => {
  stub.holdSaves();
  snapshot({});
  type('d3', { qty: 5 });
  await pause();
  type('d3', { qty: 0 });                          // the pause has started…
  stub.held[0].resolve();                          // …and the 5 lands inside it
  await settle();
  await pause();
  assert.deepEqual(stub.held[1]?.data.entries, { d3: { qty: 0, unit: '', supplierId: '' } });
  stub.held[1].resolve();
  await settle();
});

test('the correction goes out when leaving the section too', async () => {
  stub.holdSaves();
  snapshot({});
  type('d4', { qty: 5 });
  await pause();
  type('d4', { qty: 0 });
  const flushing = draft.flushDraftSave();
  assert.deepEqual(stub.held[1]?.data.entries, { d4: { qty: 0, unit: '', supplierId: '' } });
  stub.held.forEach(write => write.resolve());
  await flushing;
});

test('a stock count corrected while its write is in the air goes out, and only the stock', async () => {
  stub.holdSaves();
  snapshot({ d5: { qty: 3, stock: 1 } });
  type('d5', { stock: 2 });
  await pause();
  type('d5', { stock: 1 });
  await pause();
  assert.deepEqual(stub.held[1]?.data.entries, { d5: { stock: 1 } });
  stub.held.forEach(write => write.resolve());
  await settle();
});

test('a unit corrected while the write is in the air goes out with its quantity', async () => {
  stub.holdSaves();
  snapshot({ d6: { qty: 2, stock: 0 } });
  type('d6', { unit: 'busta' });
  await pause();
  type('d6', { unit: '' });
  await pause();
  assert.deepEqual(stub.held[1]?.data.entries, { d6: { qty: 2, unit: '', supplierId: '' } });
  stub.held.forEach(write => write.resolve());
  await settle();
});

test('a day stamp put back while the write is in the air goes out', async () => {
  stub.holdSaves();
  snapshot({ d7: { qty: 2, stock: 0 } }, { aldo: '2026-10-27' });
  page.days.aldo = DAY;
  const moving = draft.saveDraftNow(page.entries, page.days);
  page.days.aldo = '2026-10-27';
  draft.scheduleDraftSave(page.entries, page.days);
  await pause();
  assert.deepEqual(stub.held[1]?.data.days, { aldo: '2026-10-27' });
  stub.held.forEach(write => write.resolve());
  await moving;
  await settle();
});

// What the fix must NOT do: speak about a line it has no correction for.
test('retyping the value in the air sends nothing more, after a correction inside the pause', async () => {
  stub.holdSaves();
  snapshot({});
  type('d8', { qty: 5 });
  await pause();
  type('d8', { qty: 0 });
  type('d8', { qty: 5 });
  await pause();
  assert.equal(stub.held.length, 1, 'the 5 is already on its way');
  stub.held[0].resolve();
  await settle();
});

test('a line placed while its write is in the air is not written again', async () => {
  stub.holdSaves();
  snapshot({ d9: { qty: 3, stock: 0 } }, { aldo: DAY });
  type('d9', { qty: 5 });
  page.days.aldo = '2026-10-29';
  draft.scheduleDraftSave(page.entries, page.days);
  await pause();
  delete page.entries.d9;                          // orders-main forgets the placed rows…
  delete page.days.aldo;
  type('d9b', { qty: 1 });                         // …and another line is typed
  await pause();
  assert.deepEqual(Object.keys(stub.held[1].data.entries), ['d9b'], 'never a blank row for the placed line');
  assert.equal(stub.held[1].data.days, undefined, 'and never its day stamp');
  stub.held.forEach(write => write.resolve());
  await settle();
});

test('a field the write in the air does not carry is not claimed: a colleague\'s count is not re-asserted', async () => {
  stub.holdSaves();
  snapshot({ d10: { qty: 3, stock: 1 } });
  type('d10', { qty: 5 });
  await pause();
  // Firestore shows this phone's 5 with a colleague's new shelf count on the same line.
  snapshot({ d10: { qty: 5, stock: 7, unit: '', supplierId: '' } });
  type('d10b', { qty: 1 });
  await pause();
  assert.deepEqual(Object.keys(stub.held[1].data.entries), ['d10b']);
  stub.held.forEach(write => write.resolve());
  await settle();
});

test('a correction outlives the refusal of the write it corrects', async () => {
  stub.holdSaves();
  snapshot({ d11: { qty: 3, stock: 0 } });
  type('d11', { qty: 5 });
  await pause();
  type('d11', { qty: 3 });
  stub.held[0].reject(new Error('permission-denied'));
  await settle();
  assert.equal(page.entries.d11.qty, 3, 'the refused 5 does not come back');
  snapshot({ d11: { qty: 3, stock: 0 } });         // Firestore takes the write back
  assert.equal(page.entries.d11.qty, 3);
  await pause();
  // Nothing is owed: the server never took the 5. A second write of the 3 would be harmless too.
  stub.held.slice(1).forEach(write => write.resolve());
  await settle();
  snapshot({ d11: { qty: 3, stock: 0 } });
  assert.equal(page.entries.d11.qty, 3);
});
