// retention-check.mjs — run the nightly clean-up (functions/retention.js) against the Firestore
// emulator and check, document by document, what is gone and what stays.
//
// Run it, emulator and all, with:
//   npm run test:retention:emulated
// or, against an emulator already running under the same project id:
//   npm run test:retention
//
// It runs in CI on every push, in the `rules` job beside the rules suite (.github/workflows/test.yml).
// It needs the server's own packages (functions/node_modules, `npm ci --ignore-scripts` there),
// because it runs the real handler with the real Admin SDK: the point is to prove the QUERIES —
// the range filters on four different field types, the pages, the batches, the preconditions —
// not only the model, which tests/retention-model.test.mjs pins on its own.
//
// ⚠️ THE EMULATOR, ALWAYS. The Admin SDK bypasses the security rules and, with no emulator
// variable, would talk to a real project with full power. The variable is set HERE, before the
// SDK is loaded, to the local emulator only, and a project id that is not a `demo-` one stops
// the run (firebase-tools treats `demo-` as offline-only; the rules suite uses the same id).
//
// Deliberately NOT named *.test.mjs: `node --test` would pick it up in the `test` job, which has
// no emulator (the same reason as firestore-rules-check.mjs).

// Set, not defaulted: whatever the shell holds, the SDK below talks to the same local emulator
// seed-emulator.mjs wipes (127.0.0.1:8080, hardcoded there too).
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';

import { createRequire } from 'node:module';
import { PROJECT, requireEmulators, wipe } from './seed-emulator.mjs';

if (!PROJECT.startsWith('demo-')) {
  console.error(`Refusing to run: project ${PROJECT} is not a demo- project.`);
  process.exit(1);
}
await requireEmulators();

// The SDK the functions use, from the functions' own folder (the root package has none).
const requireFromFunctions = createRequire(new URL('../../functions/package.json', import.meta.url));
const { initializeApp } = requireFromFunctions('firebase-admin/app');
const { getFirestore, Timestamp } = requireFromFunctions('firebase-admin/firestore');
const { runRetention } = await import('../../functions/retention.js');
const { KINDS, ENABLED, DAY_MS } = await import('../../functions/retention-model.js');

initializeApp({ projectId: PROJECT });
const db = getFirestore();

// 18 Nov 2026, 03:30 London: the night the function would really run.
const NOW = Date.UTC(2026, 10, 18, 3, 30);
const ALL_ON = Object.fromEntries(KINDS.map(k => [k.kind, true]));
const ALL_OFF = Object.fromEntries(KINDS.map(k => [k.kind, false]));
const VENUES = ['venue-a', 'venue-b'];

let passed = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✖ ${name} ${detail}`); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A logger that keeps what it is told, so the test can read the lines production would print.
function recordingLog() {
  const lines = [];
  const at = level => (message, data) => lines.push({ level, message, data });
  return { lines, info: at('info'), warn: at('warn'), error: at('error') };
}

// ── The world ────────────────────────────────────────────────────────────────
//
// For every kind, in each venue: an OLD record (must go), a NEW one (must stay), one with NO
// date, one with a MALFORMED date (the query returns it: it compares below the cutoff), one with
// a date of the WRONG TYPE (the query never returns it) and one from BEFORE 2020. Print jobs add
// an old job still queued and one claimed: never deleted, however old.
const old = days => NOW - days * DAY_MS;
const iso = ms => new Date(ms).toISOString();
const base = (lid, extra) => ({ bakery: lid, uid: 'u-somebody', ...extra });

// Per kind: id → [data, expected after an all-on run ('gone' | 'stays')]. Dates in the London
// calendar of NOW (still 18 Nov in London at 03:30).
function world(lid) {
  return {
    'client-orders': {
      old: [base(lid, { date: '2024-11-17', clientName: 'A client' }), 'gone'],
      edge: [base(lid, { date: '2024-11-18' }), 'stays'],
      fresh: [base(lid, { date: '2026-11-17' }), 'stays'],
      nodate: [base(lid, {}), 'stays'],
      malformed: [base(lid, { date: '17/11/2023' }), 'stays'],
      badday: [base(lid, { date: '2023-02-30' }), 'stays'],
      wrongtype: [base(lid, { date: old(1000) }), 'stays'],
      ancient: [base(lid, { date: '2019-12-31' }), 'stays'],
    },
    'order-requests': {
      old: [base(lid, { date: '2025-10-17', fromName: 'Sam' }), 'gone'],
      edge: [base(lid, { date: '2025-10-18' }), 'stays'],
      fresh: [base(lid, { date: '2026-11-01' }), 'stays'],
      nodate: [base(lid, {}), 'stays'],
      malformed: [base(lid, { date: '' }), 'stays'],
      wrongtype: [base(lid, { date: Timestamp.fromMillis(old(1000)) }), 'stays'],
      ancient: [base(lid, { date: '2001-01-01' }), 'stays'],
    },
    'push-timers': {
      old: [base(lid, { fireAt: old(8), active: true }), 'gone'],
      cancelled: [base(lid, { fireAt: old(30), active: false }), 'gone'],
      edge: [base(lid, { fireAt: old(7) }), 'stays'],
      fresh: [base(lid, { fireAt: old(6) }), 'stays'],
      nodate: [base(lid, {}), 'stays'],
      nan: [base(lid, { fireAt: NaN }), 'stays'],
      wrongtype: [base(lid, { fireAt: iso(old(30)) }), 'stays'],
      ancient: [base(lid, { fireAt: 1000 }), 'stays'],
    },
    'print-jobs': {
      done: [base(lid, { createdAt: iso(old(31)), status: 'done' }), 'gone'],
      failed: [base(lid, { createdAt: iso(old(31)), status: 'failed' }), 'gone'],
      queued: [base(lid, { createdAt: iso(old(300)), status: 'queued' }), 'stays'],
      claimed: [base(lid, { createdAt: iso(old(300)), status: 'claimed' }), 'stays'],
      fresh: [base(lid, { createdAt: iso(old(29)), status: 'done' }), 'stays'],
      nodate: [base(lid, { status: 'done' }), 'stays'],
      malformed: [base(lid, { createdAt: '2025-01-01', status: 'done' }), 'stays'],
      wrongtype: [base(lid, { createdAt: old(300), status: 'done' }), 'stays'],
      ancient: [base(lid, { createdAt: '2019-06-01T00:00:00.000Z', status: 'done' }), 'stays'],
    },
    'fcm-tokens': {
      'tok-old': [base(lid, { updatedAt: old(61) }), 'gone'],
      'tok-fresh': [base(lid, { updatedAt: old(59) }), 'stays'],
      'tok-nodate': [base(lid, {}), 'stays'],
      'tok-wrongtype': [base(lid, { updatedAt: Timestamp.fromMillis(old(300)) }), 'stays'],
      'tok-minus': [base(lid, { updatedAt: -Infinity }), 'stays'],
    },
    devices: {
      old: [base(lid, { lastSeen: Timestamp.fromMillis(old(91)) }), 'gone'],
      fresh: [base(lid, { lastSeen: Timestamp.fromMillis(old(89)) }), 'stays'],
      nodate: [base(lid, {}), 'stays'],
      wrongtype: [base(lid, { lastSeen: old(300) }), 'stays'],
      ancient: [base(lid, { lastSeen: Timestamp.fromMillis(Date.UTC(2019, 0, 1)) }), 'stays'],
    },
    errors: {
      old: [base(lid, { createdAt: Timestamp.fromMillis(old(31)), message: 'boom' }), 'gone'],
      fresh: [base(lid, { createdAt: Timestamp.fromMillis(old(29)) }), 'stays'],
      nodate: [base(lid, {}), 'stays'],
      wrongtype: [base(lid, { createdAt: iso(old(300)) }), 'stays'],
    },
    usage: {
      old: [base(lid, { updatedAt: Timestamp.fromMillis(old(401)) }), 'gone'],
      fresh: [base(lid, { updatedAt: Timestamp.fromMillis(old(399)) }), 'stays'],
      nodate: [base(lid, {}), 'stays'],
      wrongtype: [base(lid, { updatedAt: old(500) }), 'stays'],
    },
  };
}

// What an all-on run must count per kind and venue: `gone` deleted; `skipped` = the records the
// query RETURNS whose date the model refuses (malformed, non-finite, before 2020). Missing and
// wrong-typed dates are never returned by a range filter, so they are in neither count.
const EXPECTED = {
  clientOrders: { wouldDelete: 1, skipped: 3, kept: 0 },
  orderRequests: { wouldDelete: 1, skipped: 2, kept: 0 },
  // NaN is a number, but no range filter ever matches it (measured on the emulator): unseen, uncounted.
  pushTimers: { wouldDelete: 2, skipped: 1, kept: 0 },
  printJobs: { wouldDelete: 2, skipped: 2, kept: 2 },
  fcmTokens: { wouldDelete: 1, skipped: 1, kept: 0 },
  devices: { wouldDelete: 1, skipped: 1, kept: 0 },
  errors: { wouldDelete: 1, skipped: 0, kept: 0 },
  usage: { wouldDelete: 1, skipped: 0, kept: 0 },
};

async function seed() {
  await wipe();
  for (const lid of VENUES) {
    // The venue document itself, as production has it.
    await db.doc(`locations/${lid}`).set({ name: `Venue ${lid}` });
    for (const [collection, docs] of Object.entries(world(lid))) {
      const batch = db.batch();
      for (const [id, [data]] of Object.entries(docs)) batch.set(db.doc(`locations/${lid}/${collection}/${id}`), data);
      await batch.commit();
    }
  }
}

async function exists(path) {
  return (await db.doc(path).get()).exists;
}

const byKind = results => Object.fromEntries(results.map(r => [r.kind, r]));

// ── 1. Report-only (the shipped switch): nothing is deleted, the counts are right ──
console.log('\nReport-only: every kind off');
await seed();
{
  check('the shipped switch has every kind off', same(ENABLED, ALL_OFF));
  const log = recordingLog();
  const results = byKind(await runRetention({ db, now: NOW, enabled: ENABLED, log }));
  for (const spec of KINDS) {
    const r = results[spec.kind];
    const want = EXPECTED[spec.kind];
    check(`${spec.kind}: report-only, would delete ${want.wouldDelete * 2}, skipped ${want.skipped * 2}`,
      r.mode === 'report-only' && r.deleted === 0 && r.wouldDelete === want.wouldDelete * 2
        && r.skipped === want.skipped * 2 && r.kept === want.kept * 2 && r.capped === false,
      JSON.stringify(r));
    check(`${spec.kind}: counted per venue`, VENUES.every(lid =>
      same(r.byVenue[lid], { wouldDelete: want.wouldDelete, skipped: want.skipped })), JSON.stringify(r.byVenue));
  }
  let all = true;
  for (const lid of VENUES) {
    for (const [collection, docs] of Object.entries(world(lid))) {
      for (const id of Object.keys(docs)) {
        if (!(await exists(`locations/${lid}/${collection}/${id}`))) { all = false; check(`still there: ${lid}/${collection}/${id}`, false); }
      }
    }
  }
  check('report-only deleted nothing at all', all);
  check('one info line per kind, no error', log.lines.filter(l => l.level === 'info').length === KINDS.length
    && !log.lines.some(l => l.level === 'error'));
}

// ── 2. Every kind on: exactly the old records go ──
console.log('\nEvery kind on');
await seed();
{
  const log = recordingLog();
  const results = byKind(await runRetention({ db, now: NOW, enabled: ALL_ON, log }));
  for (const spec of KINDS) {
    const r = results[spec.kind];
    const want = EXPECTED[spec.kind];
    check(`${spec.kind}: deleted ${want.wouldDelete * 2}, skipped ${want.skipped * 2}`,
      r.mode === 'delete' && r.deleted === want.wouldDelete * 2 && r.wouldDelete === want.wouldDelete * 2
        && r.skipped === want.skipped * 2 && r.failedVenues.length === 0, JSON.stringify(r));
  }
  for (const lid of VENUES) {
    for (const [collection, docs] of Object.entries(world(lid))) {
      for (const [id, [, expected]] of Object.entries(docs)) {
        const there = await exists(`locations/${lid}/${collection}/${id}`);
        check(`${lid}/${collection}/${id} ${expected}`, there === (expected === 'stays'));
      }
    }
  }
  check('the venue documents themselves stay', (await exists('locations/venue-a')) && (await exists('locations/venue-b')));

  // ⚠️ THE LOGS CARRY COUNTS AND VENUE IDS ONLY: nothing from inside a record, no uid, no token.
  const text = JSON.stringify(log.lines);
  check('the logs carry no uid, name, message or token',
    !/u-somebody|A client|Sam|boom|tok-/.test(text), text.slice(0, 300));

  // A second night finds nothing more to delete.
  const again = byKind(await runRetention({ db, now: NOW, enabled: ALL_ON, log: recordingLog() }));
  check('a second run deletes nothing more', KINDS.every(spec => again[spec.kind].deleted === 0));
}

// ── 3. The cap: a kind stops for the night at the cap, and the others go on ──
console.log('\nThe cap');
await wipe();
{
  for (const lid of VENUES) {
    const batch = db.batch();
    for (let i = 0; i < 4; i += 1) batch.set(db.doc(`locations/${lid}/errors/e${i}`), base(lid, { createdAt: Timestamp.fromMillis(old(40 + i)) }));
    batch.set(db.doc(`locations/${lid}/usage/u1`), base(lid, { updatedAt: Timestamp.fromMillis(old(500)) }));
    await batch.commit();
  }
  const log = recordingLog();
  const results = byKind(await runRetention({ db, now: NOW, enabled: ALL_ON, cap: 5, log }));
  const errors = results.errors;
  check('errors: stopped at the cap of 5 across both venues', errors.deleted === 5 && errors.wouldDelete === 5 && errors.capped === true,
    JSON.stringify(errors));
  const left = (await db.collection('locations/venue-a/errors').get()).size + (await db.collection('locations/venue-b/errors').get()).size;
  check('errors: 3 of 8 left for the next night', left === 3, String(left));
  check('the oldest went first', !(await exists('locations/venue-a/errors/e3')) && (await exists('locations/venue-b/errors/e0')));
  check('the cap logged an error naming the kind', log.lines.some(l => l.level === 'error' && l.data.kind === 'errors' && l.data.cap === 5));
  check('another kind under the cap still ran', results.usage.deleted === 2 && results.usage.capped === false);
}

// ── 4. One kind failing does not stop the others ──
console.log('\nA failing kind');
await seed();
{
  const log = recordingLog();
  // A kind whose collection name Firestore refuses (an empty path segment) throws inside the sweep.
  const broken = { kind: 'broken', collection: '', field: 'date', type: 'day', keepMonths: 1 };
  const kinds = [broken, ...KINDS];
  const results = byKind(await runRetention({ db, now: NOW, enabled: { ...ALL_ON, broken: true }, kinds, log }));
  check('the broken kind is reported as failed', results.broken.failedVenues?.length === 2 || results.broken.failed === true,
    JSON.stringify(results.broken));
  check('the kinds after it still deleted', results.usage.deleted === 2 && results.clientOrders.deleted === 2);
  check('the failure was logged with a code, not a message',
    log.lines.some(l => l.level === 'error' && l.data.kind === 'broken' && 'code' in l.data && !('message' in l.data)));
}

// ── 5. A record that changed after it was read is not deleted ──
console.log('\nA record that changed after it was read');
await wipe();
{
  await db.doc('locations/venue-a/fcm-tokens/tok-racing').set(base('venue-a', { updatedAt: old(61) }));
  // A db whose batch first lets a phone refresh the token, as if at 3:30 exactly.
  const racingDb = new Proxy(db, {
    get(target, prop) {
      if (prop === 'batch') {
        return () => {
          const batch = target.batch();
          const commit = batch.commit.bind(batch);
          batch.commit = async () => {
            await target.doc('locations/venue-a/fcm-tokens/tok-racing').set({ updatedAt: NOW }, { merge: true });
            return commit();
          };
          return batch;
        };
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const log = recordingLog();
  const results = byKind(await runRetention({ db: racingDb, now: NOW, enabled: ALL_ON, log }));
  check('the refreshed token is still there', await exists('locations/venue-a/fcm-tokens/tok-racing'));
  check('…and the run reported the venue as failed for that kind only', results.fcmTokens.failedVenues.includes('venue-a')
    && KINDS.filter(k => k.kind !== 'fcmTokens').every(k => results[k.kind].failedVenues.length === 0));
}

await wipe();
console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length) {
  console.log('\n--- FAILURES ---');
  failures.forEach(f => console.log('  ✖ ' + f));
  process.exit(1);
}
console.log('The clean-up deletes exactly the old records, and nothing while switched off.\n');
