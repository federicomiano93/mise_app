// A quantity typed on Orders, and the page gone before Firestore's queue had it.
//
// Measured on the lab tablet (1 Nov 2026): a reload up to 4.5 s after typing on a freshly opened page
// lost the number for good. draft.js runs for real, a fresh copy of it stands for the next page
// (nothing in memory), localStorage is a plain fake and the server is the recording stub.
// The other half of every test here is the danger of the cure: a note that outlives the page must
// never put back a quantity somebody has dealt with in the meantime.

import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { stub, reopenDraft } from './helpers/load-draft.mjs';
import { readFileSync } from 'node:fs';
import {
  readJournal, writeJournal, orderedSince, historyLookBackDay, DRAFT_JOURNAL_KEY, DRAFT_JOURNAL_MAX_AGE_MS,
} from '../js/orders/draft-journal.js';
import { keysToClear } from '../js/local-data.js';

const VENUE = 'venue-a';
const DAY = '2026-11-01';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
  };
}

mock.timers.enable({ apis: ['setTimeout'] });
const settle = () => new Promise(resolve => setImmediate(resolve));
const pause = async () => { mock.timers.tick(800); await settle(); };
const sent = () => stub.calls.saveDoc.map(call => call.data);
const note = () => JSON.parse(globalThis.localStorage.getItem(DRAFT_JOURNAL_KEY));

// One open of the page: the page's own maps, as orders-main.js keeps them.
async function openPage(serverDoc) {
  mock.timers.reset();                  // the page before this one is gone, and its pause with it
  mock.timers.enable({ apis: ['setTimeout'] });
  const mod = await reopenDraft();
  const page = { entries: {}, days: {}, shows: 0, mod };
  mod.watchDraft(view => {
    page.entries = view.entries;
    page.days = view.days;
    page.shows += 1;
    page.cameBack = view.cameBack;
  });
  stub.emit(structuredClone(serverDoc));
  return page;
}
function type(page, id, patch, stamp) {
  const entry = page.entries[id] || (page.entries[id] = { qty: 0, stock: 0 });
  Object.assign(entry, patch);
  if (stamp) page.days[stamp] = DAY;
  page.mod.scheduleDraftSave(page.entries, page.days);
}
const server = (entries = {}, days = {}) => ({ entries, days, updatedAt: 'x' });
// The server's first word: draft.js then asks about the orders, and `known` is what it finally reads,
// so the listener's own snapshot comes first, as it does in the SDK.
async function answer(doc) {
  if (doc) stub.emit(structuredClone(doc));
  stub.answerFromServer(doc ? structuredClone(doc) : doc);
  await settle();
}
const placedAt = (when, quantities) => ({ sends: { s1: { at: new Date(when).toISOString(), quantities } } });

beforeEach(() => {
  stub.reset();
  globalThis.localStorage = fakeStorage();
});

test('the number is noted in the same keystroke, before any write', async () => {
  const page = await openPage(server());
  type(page, 'flour', { qty: 5 }, 'sup1');
  assert.deepEqual(sent(), [], 'still in the pause');
  assert.deepEqual(note().entries.flour, {
    row: { qty: 5, unit: '', supplierId: '' }, base: { qty: 0, unit: '', supplierId: '' },
  });
  assert.deepEqual(note().days.sup1, { day: DAY, base: '' });
  assert.equal(note().lid, VENUE);
});

test('page gone after typing: the number comes back and is sent once the server has answered', async () => {
  const first = await openPage(server());
  type(first, 'flour', { qty: 5 }, 'sup1');
  // No pause: the page is gone before anything left it.

  const second = await openPage(server());
  assert.equal(second.entries.flour, undefined, 'not on the word of the local copy');
  await pause();
  assert.deepEqual(sent(), [], 'and nothing is sent on it');
  assert.ok(stub.waitingForServer());
  assert.ok(note().entries.flour, 'still noted while the server has not answered');

  await answer(server());
  assert.equal(second.entries.flour.qty, 5, 'back on screen');
  assert.equal(second.days.sup1, DAY);
  await pause();
  assert.deepEqual(sent().map(({ entries, days }) => ({ entries, days })), [{
    entries: { flour: { qty: 5, unit: '', supplierId: '' } }, days: { sup1: DAY },
  }]);

  // Once saved the note is gone, and a third page brings nothing back.
  assert.equal(globalThis.localStorage.getItem(DRAFT_JOURNAL_KEY), null);
  stub.calls.saveDoc.length = 0;
  await openPage(server({ flour: { qty: 5, stock: 0 } }, { sup1: DAY }));
  assert.equal(stub.waitingForServer(), false, 'nothing to ask the server about');
});

test('offline: the note waits, across as many opens as it takes', async () => {
  const first = await openPage(server());
  type(first, 'flour', { qty: 5 });
  await openPage(server());
  await openPage(server());      // no answer yet, a further reload
  assert.ok(note().entries.flour, 'the unanswered note is not lost by reopening');
  const last = await openPage(server());
  await answer(server());
  assert.equal(last.entries.flour.qty, 5);
});

test('the server already holds it (the write did get through): nothing is sent again', async () => {
  const first = await openPage(server());
  type(first, 'flour', { qty: 5 });
  const second = await openPage(server({ flour: { qty: 5, stock: 0 } }));
  await answer(server({ flour: { qty: 5, stock: 0 } }));
  await pause();
  assert.deepEqual(sent(), []);
  assert.equal(second.entries.flour.qty, 5);
  assert.equal(globalThis.localStorage.getItem(DRAFT_JOURNAL_KEY), null);
});

test('a colleague changed the line meanwhile: their number stays, this one is dropped', async () => {
  const first = await openPage(server({ flour: { qty: 3, stock: 0 } }));
  type(first, 'flour', { qty: 5 });
  const second = await openPage(server({ flour: { qty: 3, stock: 0 } }));   // the old local copy
  await answer(server({ flour: { qty: 7, stock: 0 } }));
  await pause();
  assert.deepEqual(sent(), [], 'never written over the colleague');
  assert.equal(second.entries.flour.qty, 7);
  assert.equal(globalThis.localStorage.getItem(DRAFT_JOURNAL_KEY), null);
});

test('⚠️ a colleague placed the order meanwhile: the old quantity does not come back', async () => {
  // The line held 3 when 5 was typed; placing cleared it. The local copy here still says 3, so only
  // the server's answer can tell: this is the double order the whole check is there to stop.
  const first = await openPage(server({ flour: { qty: 3, stock: 0 } }, { sup1: DAY }));
  type(first, 'flour', { qty: 5 });
  const second = await openPage(server({ flour: { qty: 3, stock: 0 } }, { sup1: DAY }));
  await answer(server());
  await pause();
  assert.deepEqual(sent(), []);
  assert.equal(second.entries.flour, undefined);
});

test('⚠️ the line was empty, a colleague filled it and placed it: it reads as before, and the orders tell', async () => {
  // The hole «still reads like the base» cannot see: placing empties a line, and most lines start empty.
  const first = await openPage(server());
  type(first, 'flour', { qty: 5 }, 'sup1');
  type(first, 'salt', { qty: 2 });
  const second = await openPage(server());
  stub.history.records = [placedAt(Date.now() + 60000, { flour: 6 })];
  await answer(server());
  assert.equal(second.entries.flour, undefined, 'already ordered: it stays out');
  assert.equal(second.entries.salt.qty, 2, 'a line no order has named comes back');
  await pause();
  assert.deepEqual(sent()[0].entries, { salt: { qty: 2, unit: '', supplierId: '' } });
});

test('the note was for a write that did get through and was then placed: not ordered twice', async () => {
  const first = await openPage(server());
  type(first, 'flour', { qty: 5 });
  const second = await openPage(server());
  stub.history.records = [placedAt(Date.now() + 60000, { flour: 5 })];
  await answer(server());
  await pause();
  assert.deepEqual(sent(), []);
  assert.equal(second.entries.flour, undefined);
  assert.equal(globalThis.localStorage.getItem(DRAFT_JOURNAL_KEY), null);
});

test('an order of that line from BEFORE the typing does not stop it coming back', async () => {
  const first = await openPage(server());
  type(first, 'flour', { qty: 5 });
  const second = await openPage(server());
  stub.history.records = [placedAt(Date.now() - 60 * 60 * 1000, { flour: 3 })];
  await answer(server());
  assert.equal(second.entries.flour.qty, 5);
});

test('an order stops the quantity, not the shelf count typed on the same line', async () => {
  const first = await openPage(server());
  type(first, 'flour', { qty: 5, stock: 4 });
  const second = await openPage(server());
  stub.history.records = [placedAt(Date.now() + 60000, { flour: 6 })];
  await answer(server());
  await pause();
  assert.deepEqual(sent()[0].entries, { flour: { stock: 4 } });
  assert.equal(second.entries.flour.stock, 4);
});

test('the orders cannot be read: nothing comes back, the note waits, and it asks again', async () => {
  const errors = mock.method(console, 'error', () => {});
  const first = await openPage(server());
  type(first, 'flour', { qty: 5 });
  const second = await openPage(server());
  stub.history.fail = true;
  await answer(server());
  assert.equal(second.entries.flour, undefined);
  assert.ok(note().entries.flour, 'still noted');
  await pause();
  assert.deepEqual(sent(), []);
  mock.timers.tick(30000);
  await settle();
  assert.equal(stub.history.reads, 2, 'and still refused');
  stub.history.fail = false;
  mock.timers.tick(30000);
  await settle();
  errors.mock.restore();
  assert.equal(second.entries.flour.qty, 5, 'the page stayed open and it came back');
});

test('a note that waited offline past its day does not come back when the server finally answers', async () => {
  const first = await openPage(server());
  type(first, 'flour', { qty: 5 });
  const typedAt = note().at;
  const second = await openPage(server());
  const later = mock.method(Date, 'now', () => typedAt + DRAFT_JOURNAL_MAX_AGE_MS + 1);
  await answer(server());
  later.mock.restore();
  assert.equal(second.entries.flour, undefined);
  assert.equal(globalThis.localStorage.getItem(DRAFT_JOURNAL_KEY), null);
  await pause();
  assert.deepEqual(sent(), []);
});

test('a future day stamp does not outlive its dropped line through another line coming back', async () => {
  const first = await openPage(server());
  type(first, 'flour', { qty: 5 }, 'sup1');
  type(first, 'salt', { qty: 2 }, 'sup2');
  const second = await openPage(server());
  stub.history.records = [placedAt(Date.now() + 60000, { flour: 6 })];
  await answer(server());
  await pause();
  assert.deepEqual(sent()[0].entries, { salt: { qty: 2, unit: '', supplierId: '' } });
  assert.equal(sent()[0].days, undefined);
  assert.deepEqual(second.days, {});
});

test('a shelf count alone does not bring a day stamp back', async () => {
  const first = await openPage(server());
  type(first, 'flour', { qty: 5, stock: 4 }, 'sup1');
  await openPage(server());
  stub.history.records = [placedAt(Date.now() + 60000, { flour: 6 })];
  await answer(server());
  await pause();
  assert.equal(sent()[0].days, undefined);
});

test('the very first keystroke of a page takes that line out of what the last page left', async () => {
  const first = await openPage(server());
  type(first, 'flour', { qty: 5 });
  const mod = await reopenDraft();
  const page = { entries: {}, days: {}, mod };
  mod.watchDraft(view => { page.entries = view.entries; page.days = view.days; });
  type(page, 'flour', { qty: 8 });         // before any snapshot
  page.entries.flour.qty = 0;              // and erased
  mod.scheduleDraftSave(page.entries, page.days);
  await answer(server());
  assert.equal(page.entries.flour, undefined, 'what was erased does not come back');
});

test('nothing to bring back: the orders are not read', async () => {
  const first = await openPage(server());
  type(first, 'flour', { qty: 5 });
  await openPage(server());
  await answer(server({ flour: { qty: 5, stock: 0 } }));
  assert.equal(stub.history.reads, 0);
});

test('the page is told a line came back, so it can ask its «never placed» question again', async () => {
  const first = await openPage(server());
  type(first, 'flour', { qty: 5 });
  const second = await openPage(server());
  assert.equal(second.cameBack, false);
  await answer(server());
  assert.equal(second.cameBack, true);
});

test('a row typed after the line came back is still saved: the screen does not share the baseline', async () => {
  // The defect the comment on detach() describes: typing would edit `known` too, and read as no change.
  const here = server({ salt: { qty: 1, stock: 0 } });
  const first = await openPage(here);
  type(first, 'flour', { qty: 5 });
  const second = await openPage(here);
  await answer(here);
  await pause();
  stub.calls.saveDoc.length = 0;
  type(second, 'salt', { qty: 2 });
  await pause();
  assert.equal(sent()[0].entries.salt.qty, 2);
});

test('typed before the draft has landed: noted too, with its time', async () => {
  const mod = await reopenDraft();
  const page = { entries: {}, days: {}, mod };
  mod.watchDraft(() => {});            // no snapshot yet
  type(page, 'flour', { qty: 5 });
  assert.ok(note().entries.flour);
  assert.ok(note().at > 0, 'a note dated 1970 would be thrown away as expired');
});

test('what the last page left keeps its own age, whatever is typed meanwhile', async () => {
  const first = await openPage(server());
  type(first, 'flour', { qty: 5 });
  const typedAt = note().at;
  const second = await openPage(server());
  const later = mock.method(Date, 'now', () => typedAt + 60 * 60 * 1000);
  type(second, 'salt', { qty: 2 });
  later.mock.restore();
  assert.equal(note().at, typedAt);
});

test('a clear still in the air wins over the server\'s answer', async () => {
  // A weak connection: the first answer arrives between the clear leaving and landing.
  const first = await openPage(server());
  type(first, 'flour', { qty: 5 });
  const second = await openPage(server());
  stub.holdClears();
  const done = second.mod.clearQuantities(['sup1'], [{ id: 'flour', supplierId: 'sup1', active: true }]);
  await answer(server());
  assert.equal(second.entries.flour, undefined, 'it does not come back over the clear');
  stub.heldClears.forEach(release => release());
  await done;
  await pause();
  assert.deepEqual(sent(), []);
});

test('a stock count from a colleague says nothing about the quantity typed here', async () => {
  const first = await openPage(server({ flour: { qty: 0, stock: 1 } }));
  type(first, 'flour', { qty: 5 });
  const second = await openPage(server({ flour: { qty: 0, stock: 1 } }));
  await answer(server({ flour: { qty: 0, stock: 9 } }));
  assert.equal(second.entries.flour.qty, 5);
  await pause();
  assert.deepEqual(sent()[0].entries, { flour: { qty: 5, unit: '', supplierId: '' } }, 'the stock is not sent');
});

test('a day stamp does not come back without its lines', async () => {
  const first = await openPage(server());
  type(first, 'flour', { qty: 5 }, 'sup1');
  await openPage(server());
  await answer(server({ flour: { qty: 7, stock: 0 } }));
  await pause();
  assert.deepEqual(sent(), []);
});

test('typed again on the new page before the server answered: the new number wins', async () => {
  const first = await openPage(server());
  type(first, 'flour', { qty: 5 });
  const second = await openPage(server());
  type(second, 'flour', { qty: 8 });
  assert.equal(note().entries.flour.row.qty, 8);
  // And even corrected back to nothing: what was typed here is the last word on that line.
  second.entries.flour.qty = 0;
  second.mod.scheduleDraftSave(second.entries, second.days);
  await answer(server());
  await pause();
  assert.deepEqual(sent(), []);
  assert.equal(second.entries.flour, undefined);
});

test('another line typed on the new page does not lose the note, and both go', async () => {
  const first = await openPage(server());
  type(first, 'flour', { qty: 5 });
  const second = await openPage(server());
  type(second, 'salt', { qty: 2 });
  assert.ok(note().entries.flour, 'still noted');
  assert.ok(note().entries.salt);
  await answer(server());
  await pause();
  assert.equal(sent().at(-1).entries.flour.qty, 5);
  assert.equal(sent().flatMap(call => Object.keys(call.entries)).includes('salt'), true);
});

test('«clear» on the new page before the server answered wins over the note', async () => {
  const first = await openPage(server());
  type(first, 'flour', { qty: 5 });
  const second = await openPage(server());
  await second.mod.clearQuantities(['sup1'], [{ id: 'flour', supplierId: 'sup1', active: true }]);
  assert.equal(globalThis.localStorage.getItem(DRAFT_JOURNAL_KEY), null);
  await answer(server());
  await pause();
  assert.deepEqual(sent(), []);
});

test('once a snapshot shows the write it is in Firestore\'s queue, and the note lets it go', async () => {
  const page = await openPage(server());
  stub.holdSaves();
  type(page, 'flour', { qty: 5 });
  await pause();
  assert.ok(note().entries.flour, 'sent, but not yet in the queue');
  stub.emit(server({ flour: { qty: 5, stock: 0 } }));   // Firestore shows it, the server has not answered
  assert.equal(globalThis.localStorage.getItem(DRAFT_JOURNAL_KEY), null);
  stub.held[0].resolve();
  await settle();
});

test('a line typed over while a write is in the air notes the new number against what it knows', async () => {
  const page = await openPage(server());
  stub.holdSaves();
  type(page, 'flour', { qty: 5 });
  await pause();
  stub.emit(server({ flour: { qty: 5, stock: 0 } }));
  type(page, 'flour', { qty: 6 });
  assert.deepEqual(note().entries.flour, {
    row: { qty: 6, unit: '', supplierId: '' }, base: { qty: 5, unit: '', supplierId: '' },
  });
  stub.held[0].resolve();
  await settle();
});

test('a write the server refused is not noted: it could never be saved, and would block every later one', async () => {
  const errors = mock.method(console, 'error', () => {});
  const page = await openPage(server());
  stub.holdSaves();
  type(page, 'flour', { qty: 5 });
  await pause();
  stub.held[0].reject(new Error('permission-denied'));
  await settle();
  errors.mock.restore();
  assert.equal(globalThis.localStorage.getItem(DRAFT_JOURNAL_KEY), null, 'not noted');
  assert.equal(page.entries.flour.qty, 5, 'still on screen, as before');

  // A different number is new typing: noted.
  type(page, 'flour', { qty: 6 });
  assert.equal(note().entries.flour.row.qty, 6);
  // The next open has nothing to replay from the refused one.
  const second = await openPage(server());
  await answer(server());
  assert.equal(second.entries.flour.qty, 6);
});

test('Fornitori holds no note: deleting a product leaves the rest of it alone, and takes that line out', async () => {
  const first = await openPage(server());
  type(first, 'flour', { qty: 5 });
  type(first, 'salt', { qty: 2 });
  const before = globalThis.localStorage.getItem(DRAFT_JOURNAL_KEY);
  const fornitori = await reopenDraft();
  await fornitori.clearIngredientFromDraft('yeast');
  assert.equal(globalThis.localStorage.getItem(DRAFT_JOURNAL_KEY), before);
  await fornitori.clearIngredientFromDraft('flour');
  assert.deepEqual(Object.keys(note().entries), ['salt']);
  assert.ok(stub.calls.saveDoc.length === 0);
});

test('the page going out of sight sends what is waiting; going away for good does not', async () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const win = new EventTarget();
  const page = await openPage(server());
  const results = [];
  page.mod.setDraftSaveReporter(ok => results.push(ok));
  page.mod.flushDraftWhenHidden(doc, win);
  const hide = () => {
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
  };

  type(page, 'flour', { qty: 5 });
  hide();
  await settle();
  assert.equal(sent().length, 1, 'sent at once, no need to wait for the pause');
  assert.deepEqual(results, [true], 'and the result is reported');

  // Nothing waiting: nothing to say.
  doc.visibilityState = 'visible';
  hide();
  await settle();
  assert.equal(sent().length, 1);

  // Going away for good: pagehide comes first, and the note is what answers for it.
  doc.visibilityState = 'visible';
  type(page, 'salt', { qty: 2 });
  win.dispatchEvent(new Event('pagehide'));
  hide();
  await settle();
  assert.equal(sent().length, 1);
  assert.ok(note().entries.salt);

  // Back from the browser's page cache, alive after all: the pause still runs out and sends.
  win.dispatchEvent(new Event('pageshow'));
  await pause();
  assert.equal(sent().length, 2);
});

test('the note is one venue\'s: another venue neither reads it nor keeps it', () => {
  const storage = fakeStorage();
  const claims = { at: 1000, entries: { flour: { row: { qty: 5 }, base: { qty: 0 } } }, days: {} };
  writeJournal(VENUE, claims, storage);
  assert.equal(readJournal('venue-b', 1000, storage), null);
  assert.equal(storage.getItem(DRAFT_JOURNAL_KEY), null, 'removed, not left to be read again');
});

test('the note is older than a day: dropped; a day old exactly: kept', () => {
  const storage = fakeStorage();
  const claims = { at: 1000, entries: { flour: { row: { qty: 5 }, base: { qty: 0 } } }, days: {} };
  writeJournal(VENUE, claims, storage);
  assert.ok(readJournal(VENUE, 1000 + DRAFT_JOURNAL_MAX_AGE_MS, storage));
  assert.equal(readJournal(VENUE, 1001 + DRAFT_JOURNAL_MAX_AGE_MS, storage), null);
  assert.equal(storage.getItem(DRAFT_JOURNAL_KEY), null);
});

test('it trusts nothing it reads', () => {
  const storage = fakeStorage();
  const put = value => storage.setItem(DRAFT_JOURNAL_KEY, typeof value === 'string' ? value : JSON.stringify(value));
  const good = { v: 1, lid: VENUE, at: 1000, entries: { flour: { row: { qty: 5 }, base: { qty: 0 } } }, days: {} };

  for (const bad of ['not json', 'null', '[]', { ...good, v: 2 }, { ...good, at: 'yesterday' }, { ...good, entries: 7 }]) {
    put(bad);
    assert.equal(readJournal(VENUE, 1000, storage), null, JSON.stringify(bad));
    assert.equal(storage.getItem(DRAFT_JOURNAL_KEY), null);
  }
  // One bad line does not cost the good ones.
  put({
    ...good,
    entries: {
      ...good.entries,
      a: { row: { qty: -1 }, base: { qty: 0 } },
      b: { row: { qty: 1.5 }, base: { qty: 0 } },
      c: { row: { unit: 3 }, base: { unit: '' } },
      d: { row: { qty: 1 } },
      e: 'nonsense',
    },
    days: { s1: { day: DAY, base: '' }, s2: { day: 4, base: '' }, s3: { day: DAY } },
  });
  const read = readJournal(VENUE, 1000, storage);
  assert.deepEqual(Object.keys(read.entries), ['flour']);
  assert.deepEqual(Object.keys(read.days), ['s1']);
  // A field nobody asked for does not travel.
  put({ ...good, entries: { flour: { row: { qty: 5, hacked: true }, base: { qty: 0 } } } });
  assert.deepEqual(readJournal(VENUE, 1000, storage).entries.flour.row, { qty: 5 });
});

test('storage full: the older note goes rather than stay and say something no longer true', () => {
  const storage = fakeStorage();
  writeJournal(VENUE, { at: 1000, entries: { flour: { row: { qty: 5 }, base: { qty: 0 } } }, days: {} }, storage);
  const full = { ...storage, setItem() { throw new Error('quota'); } };
  writeJournal(VENUE, { at: 1000, entries: { flour: { row: { qty: 6 }, base: { qty: 0 } } }, days: {} }, full);
  assert.equal(storage.getItem(DRAFT_JOURNAL_KEY), null);
});

test('orderedSince reads each send, its time, and only what was really ordered', () => {
  const at = Date.parse('2026-11-01T10:00:00Z');
  const send = (iso, quantities) => ({ at: iso, quantities });
  const ids = orderedSince([
    { sends: { a: send('2026-11-01T09:00:00Z', { old: 3 }), b: send('2026-11-01T11:00:00Z', { late: 3, zero: 0 }) } },
    { sends: { c: send('2026-11-01T09:59:00Z', { skewed: 1 }) } },     // within the clocks' margin
    { sends: { f: { ...send('2026-11-01T15:00:00Z', { corrected: 2 }), kind: 'edit' } } },   // a History correction
    { createdAt: '2026-11-01T12:00:00Z', quantities: { oldShape: 2 } },   // from before `sends`
    { createdAt: '2026-10-01T12:00:00Z', quantities: { oldShapeOld: 2 } },
    { sends: { d: send('not a date', { broken: 1 }), e: {} } },
    null,
  ], at);
  assert.deepEqual([...ids].sort(), ['late', 'oldShape', 'skewed']);
  assert.equal(historyLookBackDay(at), '2026-10-25');
});

test('the lines that stand between the note and a double order are where they must be', () => {
  // The stub skips the real data layer, so nothing else would notice them gone (the same guard as
  // tests/calculator-config-cache-guard.test.mjs).
  const data = readFileSync(new URL('../js/orders/firebase-orders.js', import.meta.url), 'utf8');
  const answerFn = data.slice(data.indexOf('export async function watchServerAnswer'));
  assert.match(answerFn, /includeMetadataChanges: true/);
  assert.match(answerFn, /if \(snap\.metadata\.fromCache\) return;/);
  const ordersFn = data.slice(data.indexOf('export async function getRecentHistoryFromServer'));
  assert.match(ordersFn.slice(0, ordersFn.indexOf('\n}')), /getDocsFromServer/);
  const main = readFileSync(new URL('../js/orders/orders-main.js', import.meta.url), 'utf8');
  assert.match(main, /^ +flushDraftWhenHidden\(\);/m);
  assert.match(main, /if \(draft\.cameBack\) pendingChecked = false;/);
});

test('a blocked or full storage never stops the typing', async () => {
  globalThis.localStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('blocked'); },
  };
  const page = await openPage(server());
  type(page, 'flour', { qty: 5 });
  await pause();
  assert.equal(sent()[0].entries.flour.qty, 5);
});

test('signing out or switching venue wipes the note (local-data.js)', () => {
  assert.deepEqual(keysToClear([DRAFT_JOURNAL_KEY]), [DRAFT_JOURNAL_KEY]);
});
