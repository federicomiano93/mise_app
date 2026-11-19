// The 30-day deletion of customer bookings (18 Nov 2026): the decisions, run against a fake Firestore, and the wiring of the
// scheduled function, read from source.
//
// ⚠️ It tests functions/booking-cleanup-model.js, never functions/index.js: the shell imports firebase-functions, which CI
// installs only in the deploy job (tests/recipe-photo-handler.test.mjs says why that matters).
// ⚠️ FAKE CUSTOMERS ONLY: no real name or phone in a fixture.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  KEEP_DAYS, BATCH_SIZE, MAX_ROUNDS, cutoffDate, todayIn, isVenueBooking, deleteOldBookings,
} from '../functions/booking-cleanup-model.js';

const read = n => readFileSync(new URL(n, new URL('../', import.meta.url)), 'utf8');
const codeOf = name => read(name).replace(/^\s*\/\/.*$/gm, '');

// 18 Nov 2026, 03:17 in Rome.
const NOW = new Date('2026-11-18T02:17:00Z');

// A stand-in for Firestore: bookings by path, the same query the shell makes (date < cutoff, limit), and a record of every batch.
function fakeDb(bookings) {
  const docs = new Map(bookings.map(b => [b.path, b]));
  const batches = [];
  return {
    docs,
    batches,
    async oldBookings(cutoff, limit) {
      return [...docs.values()].filter(b => b.date < cutoff).slice(0, limit).map(b => ({ path: b.path, date: b.date }));
    },
    async deleteAll(items) {
      batches.push(items.length);
      for (const item of items) docs.delete(item.path);
    },
  };
}

const booking = (lid, id, date) => ({ path: `locations/${lid}/bookings/${id}`, date, customerName: 'Mario Prova', phone: '+39 333 000 0000' });

test('the owner\'s retention is 30 days, and the cut-off is the first day kept', () => {
  assert.equal(KEEP_DAYS, 30);
  assert.equal(todayIn(NOW), '2026-11-18');
  assert.equal(cutoffDate(NOW), '2026-10-19');
});

test('the day is read in Rome: just after midnight there is already the next day', () => {
  // 23:30 UTC on 18 Nov is 00:30 on 19 Nov in Rome.
  assert.equal(todayIn(new Date('2026-11-18T23:30:00Z')), '2026-11-19');
  assert.equal(cutoffDate(new Date('2026-11-18T23:30:00Z')), '2026-10-20');
});

test('the cut-off crosses months, years and a clock change without slipping a day', () => {
  assert.equal(cutoffDate(new Date('2027-01-10T10:00:00Z')), '2026-12-11');
  assert.equal(cutoffDate(new Date('2026-03-30T10:00:00Z')), '2026-02-28');
  // The clocks went back on 25 Oct 2026 in Rome.
  assert.equal(cutoffDate(new Date('2026-11-24T10:00:00Z')), '2026-10-25');
});

test('a booking more than 30 days old goes; one 30 days old or newer stays', async () => {
  const db = fakeDb([
    booking('miano', 'old1', '2026-10-01'),
    booking('miano', 'old2', '2026-10-18'),
    booking('miano', 'edge', '2026-10-19'),
    booking('miano', 'recent', '2026-11-10'),
    booking('miano', 'future', '2026-12-24'),
  ]);
  const result = await deleteOldBookings(db, { now: NOW });
  assert.deepEqual([...db.docs.keys()].sort(), [
    'locations/miano/bookings/edge', 'locations/miano/bookings/future', 'locations/miano/bookings/recent',
  ]);
  assert.equal(result.deleted, 2);
  assert.equal(result.cutoff, '2026-10-19');
});

test('every venue is cleaned, in one run', async () => {
  const db = fakeDb([
    booking('miano', 'a', '2026-09-01'),
    booking('the-club', 'b', '2026-09-02'),
    booking('trattoria-x', 'c', '2026-11-17'),
  ]);
  const result = await deleteOldBookings(db, { now: NOW });
  assert.equal(result.deleted, 2);
  assert.deepEqual([...db.docs.keys()], ['locations/trattoria-x/bookings/c']);
});

test('pages of BATCH_SIZE, one batch each, until a short page', async () => {
  const many = Array.from({ length: BATCH_SIZE * 2 + 7 }, (_, i) => booking('miano', `b${i}`, '2026-09-15'));
  const db = fakeDb(many);
  const result = await deleteOldBookings(db, { now: NOW });
  assert.equal(result.deleted, many.length);
  assert.deepEqual(db.batches, [BATCH_SIZE, BATCH_SIZE, 7]);
  assert.ok(BATCH_SIZE <= 500, 'a Firestore batch holds at most 500 writes');
  assert.equal(result.more, false);
});

test('a run stops after MAX_ROUNDS pages and says there is more for tomorrow', async () => {
  const db = fakeDb(Array.from({ length: 35 }, (_, i) => booking('miano', `b${i}`, '2026-09-15')));
  const result = await deleteOldBookings(db, { now: NOW, batchSize: 10, maxRounds: 2 });
  assert.equal(result.deleted, 20);
  assert.equal(result.more, true);
  assert.equal(db.docs.size, 15);
  assert.ok(MAX_ROUNDS * BATCH_SIZE >= 10000);
});

test('⚠️ a wrong answer from the query never deletes a booking still inside its 30 days, nor anything outside a venue', async () => {
  const lying = {
    deleted: [],
    async oldBookings() {
      return [
        { path: 'locations/miano/bookings/recent', date: '2026-11-17' },
        { path: 'bookings/stray', date: '2026-01-01' },
        { path: 'locations/miano/other/bookings/x', date: '2026-01-01' },
        { path: 'locations/miano/bookings/nodate' },
        { path: 'locations/miano/bookings/old', date: '2026-09-01' },
      ];
    },
    async deleteAll(items) { this.deleted.push(...items.map(i => i.path)); },
  };
  const result = await deleteOldBookings(lying, { now: NOW, batchSize: 10 });
  assert.deepEqual(lying.deleted, ['locations/miano/bookings/old']);
  assert.equal(result.skipped, 4);
});

test('a page with nothing deletable ends the run instead of looping', async () => {
  let asked = 0;
  const store = {
    async oldBookings() { asked += 1; return Array.from({ length: 5 }, (_, i) => ({ path: `bookings/x${i}`, date: '2026-01-01' })); },
    async deleteAll() { throw new Error('must not be called'); },
  };
  const result = await deleteOldBookings(store, { now: NOW, batchSize: 5 });
  assert.equal(asked, 1);
  assert.equal(result.deleted, 0);
});

test('nothing old: nothing deleted, no batch', async () => {
  const db = fakeDb([booking('miano', 'a', '2026-11-18')]);
  const result = await deleteOldBookings(db, { now: NOW });
  assert.equal(result.deleted, 0);
  assert.deepEqual(db.batches, []);
});

test('only a venue\'s booking path counts', () => {
  assert.equal(isVenueBooking('locations/miano/bookings/abc'), true);
  for (const path of ['bookings/abc', 'locations/miano/bookings', 'locations/miano/x/bookings/abc', '', null, 7]) {
    assert.equal(isVenueBooking(path), false, String(path));
  }
});

test('the result holds counts only — nothing personal could reach the log', async () => {
  const db = fakeDb([booking('miano', 'a', '2026-09-01')]);
  const result = await deleteOldBookings(db, { now: NOW });
  assert.deepEqual(Object.keys(result).sort(), ['cutoff', 'deleted', 'more', 'rounds', 'skipped']);
  assert.doesNotMatch(JSON.stringify(result), /Mario|333|locations\//);
});

// ── The shell, read from source ──────────────────────────────────────────────

const INDEX = codeOf('functions/index.js');

test('the scheduled function is exported, daily, in the one REGION, with the venues\' time zone', () => {
  const at = INDEX.indexOf('export const deleteOldBookings = onSchedule(');
  assert.ok(at > 0, 'functions/index.js must export deleteOldBookings through onSchedule');
  const shell = INDEX.slice(at, INDEX.indexOf('\n);', at));
  assert.match(INDEX, /import \{ onSchedule \} from 'firebase-functions\/v2\/scheduler';/);
  assert.match(shell, /region: REGION/);
  assert.match(shell, /schedule: '\d{1,2} \d{1,2} \* \* \*'/, 'once a day');
  assert.match(shell, /timeZone: BOOKINGS_TIME_ZONE/);
  assert.match(shell, /collectionGroup\('bookings'\)\.where\('date', '<', cutoff\)\.limit\(limit\)/);
  assert.match(shell, /db\.batch\(\)/);
  // Counts only: the one log line is handed the model's result, nothing read from a document.
  assert.match(shell, /logger\.info\('Old bookings deleted', result\)/);
  assert.doesNotMatch(shell, /customerName|phone|address/);
  assert.equal((INDEX.match(/onSchedule\(/g) || []).length, 1, 'the project\'s one scheduled function (Cloud Scheduler: 3 jobs free)');
});

test('⚠️ the collection-group index the query needs is declared, and firebase.json points at it', () => {
  const indexes = JSON.parse(read('firestore.indexes.json'));
  const override = indexes.fieldOverrides.find(o => o.collectionGroup === 'bookings' && o.fieldPath === 'date');
  assert.ok(override, 'a field override for bookings.date');
  assert.ok(override.indexes.some(i => i.queryScope === 'COLLECTION_GROUP' && i.order === 'ASCENDING'), 'collection group, ascending');
  // ⚠️ An override REPLACES the automatic indexes of the field: the app's own query (date >=, ordered descending) needs both.
  assert.ok(override.indexes.some(i => i.queryScope === 'COLLECTION' && i.order === 'ASCENDING'));
  assert.ok(override.indexes.some(i => i.queryScope === 'COLLECTION' && i.order === 'DESCENDING'));
  assert.equal(JSON.parse(read('firebase.json')).firestore.indexes, 'firestore.indexes.json');
});
