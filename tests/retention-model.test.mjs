// The nightly clean-up's decisions (functions/retention-model.js): which record is old enough to
// go, which is not, and which can never be deleted because its date cannot be trusted. Every
// boundary is pinned one day either side; the database half is tests/rules/retention-check.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KINDS, ENABLED, CAP, BATCH_SIZE, DAY_MS, FLOOR_MS,
  parseDay, parseIso, timestampMillis, londonDay, monthsBefore, cutoffFor, decide, chunks,
} from '../functions/retention-model.js';

const kind = name => KINDS.find(k => k.kind === name);
// A stand-in for the Admin SDK's Timestamp: the model recognises it by toMillis() alone.
const ts = ms => ({ toMillis: () => ms });

// 18 Nov 2026, 12:00 London (GMT in November, so also 12:00 UTC).
const NOW = Date.UTC(2026, 10, 18, 12, 0, 0);

// ── The switch and the frame ────────────────────────────────────────────────

test('every kind ships OFF', () => {
  // ⚠️ The go-live PR that switches a kind on changes this expectation too, on purpose: a kind
  // switched on by accident must turn the suite red.
  assert.deepEqual(Object.values(ENABLED), KINDS.map(() => false));
});

test('ENABLED names exactly the kinds, each a boolean', () => {
  assert.deepEqual(Object.keys(ENABLED).sort(), KINDS.map(k => k.kind).sort());
  for (const value of Object.values(ENABLED)) assert.equal(typeof value, 'boolean');
  assert.ok(Object.isFrozen(ENABLED));
});

test('the eight kinds, their collections, fields and periods are the owner\'s decision', () => {
  assert.deepEqual(KINDS.map(k => [k.kind, k.collection, k.field, k.type, k.keepMonths ?? k.keepDays]), [
    ['clientOrders', 'client-orders', 'date', 'day', 24],
    ['orderRequests', 'order-requests', 'date', 'day', 13],
    ['pushTimers', 'push-timers', 'fireAt', 'millis', 7],
    ['printJobs', 'print-jobs', 'createdAt', 'iso', 30],
    ['fcmTokens', 'fcm-tokens', 'updatedAt', 'millis', 60],
    ['devices', 'devices', 'lastSeen', 'timestamp', 90],
    ['errors', 'errors', 'createdAt', 'timestamp', 30],
    ['usage', 'usage', 'updatedAt', 'timestamp', 400],
  ]);
  assert.ok(Object.isFrozen(KINDS) && KINDS.every(Object.isFrozen));
});

test('the three owner prunes keep their own periods', async () => {
  // The kinds that replace scripts/read-devices.mjs, read-errors.mjs --prune and read-usage.mjs
  // must not quietly move a period those scripts (still in use) state.
  const { STALE_DAYS } = await import('../scripts/device-summary.mjs');
  const { KEEP_DAYS } = await import('../scripts/error-summary.mjs');
  const { PRUNE_DAYS } = await import('../scripts/usage-summary.mjs');
  assert.equal(kind('devices').keepDays, STALE_DAYS);
  assert.equal(kind('errors').keepDays, KEEP_DAYS);
  assert.equal(kind('usage').keepDays, PRUNE_DAYS);
});

test('the cap and the batch size', () => {
  assert.equal(CAP, 500);
  assert.equal(BATCH_SIZE, 500);
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunks([], 2), []);
  assert.equal(chunks(Array(1201).fill(0)).length, 3);
  assert.ok(chunks(Array(1201).fill(0)).every(c => c.length <= 500));
});

// ── Strict parsing ──────────────────────────────────────────────────────────

test('parseDay takes only a real calendar day', () => {
  assert.deepEqual(parseDay('2024-02-29'), { year: 2024, month: 2, day: 29 });
  for (const bad of ['2023-02-29', '2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2026-01-00',
    '2026-1-01', '2026-01-1', '26-01-01', '2026/01/01', '01-01-2026', '2026-01-01T00:00', ' 2026-01-01',
    '2026-01-01 ', '', 'yesterday', 20260101, null, undefined, {}, ts(NOW)]) {
    assert.equal(parseDay(bad), null, String(bad));
  }
});

test('parseIso takes only a full ISO time with a zone', () => {
  assert.equal(parseIso('2026-10-01T09:00:00.000Z'), Date.UTC(2026, 9, 1, 9));
  assert.equal(parseIso('2026-10-01T09:00:00Z'), Date.UTC(2026, 9, 1, 9));
  assert.equal(parseIso('2026-10-01T10:00:00+01:00'), Date.UTC(2026, 9, 1, 9));
  for (const bad of ['2026-10-01', '2026-10-01T09:00:00', '2026-10-01T09:00Z', '2026-02-30T09:00:00Z',
    '2026-10-01T24:00:00Z', '2026-10-01T09:60:00Z', '2026-10-01 09:00:00Z', 'Thu, 01 Oct 2026 09:00:00 GMT',
    '', 1759309200000, null, ts(NOW)]) {
    assert.equal(parseIso(bad), null, String(bad));
  }
});

test('timestampMillis reads only a Timestamp with a finite time', () => {
  assert.equal(timestampMillis(ts(123)), 123);
  for (const bad of [ts(NaN), ts(Infinity), { toMillis: 5 }, 123, '2026-01-01', null, undefined, {}]) {
    assert.equal(timestampMillis(bad), null);
  }
});

// ── The London day ──────────────────────────────────────────────────────────

test('today is the London calendar day, not the UTC one', () => {
  // Summer (BST, UTC+1): 23:30 UTC on 30 June is already 1 July in London.
  assert.equal(londonDay(Date.UTC(2026, 5, 30, 23, 30)), '2026-07-01');
  assert.equal(londonDay(Date.UTC(2026, 5, 30, 22, 59)), '2026-06-30');
  // Winter (GMT): London and UTC agree.
  assert.equal(londonDay(Date.UTC(2026, 11, 31, 23, 59)), '2026-12-31');
  assert.equal(londonDay(Date.UTC(2027, 0, 1, 0, 0)), '2027-01-01');
});

test('the date-string cutoffs move with the London day', () => {
  // 00:30 London on 1 July 2026 is still 30 June in UTC: the cutoff is already 1 July 2024.
  const justAfterMidnight = Date.UTC(2026, 5, 30, 23, 30);
  assert.equal(cutoffFor(kind('clientOrders'), justAfterMidnight), '2024-07-01');
  assert.equal(decide(kind('clientOrders'), { date: '2024-06-30' }, justAfterMidnight), 'delete');
  assert.equal(decide(kind('clientOrders'), { date: '2024-07-01' }, justAfterMidnight), 'keep');
});

test('monthsBefore counts calendar months and never rolls forward', () => {
  assert.equal(monthsBefore('2026-11-18', 24), '2024-11-18');
  assert.equal(monthsBefore('2026-11-18', 13), '2025-10-18');
  assert.equal(monthsBefore('2026-02-28', 24), '2024-02-28');
  assert.equal(monthsBefore('2028-02-29', 24), '2026-02-28');
  assert.equal(monthsBefore('2026-03-31', 13), '2025-02-28');
  assert.equal(monthsBefore('2026-01-15', 13), '2024-12-15');
  assert.throws(() => monthsBefore('2026-02-30', 1));
});

test('cutoffFor needs a real clock', () => {
  assert.throws(() => cutoffFor(kind('usage'), NaN));
  assert.throws(() => cutoffFor(kind('usage'), undefined));
});

// ── Each kind, one day either side ──────────────────────────────────────────

test('clientOrders: deleted after 2 calendar years on the London calendar', () => {
  const spec = kind('clientOrders');
  assert.equal(cutoffFor(spec, NOW), '2024-11-18');
  assert.equal(decide(spec, { date: '2024-11-17' }, NOW), 'delete');
  assert.equal(decide(spec, { date: '2024-11-18' }, NOW), 'keep');
  assert.equal(decide(spec, { date: '2024-11-19' }, NOW), 'keep');
  assert.equal(decide(spec, { date: '2026-11-18' }, NOW), 'keep');
});

test('orderRequests: deleted after 13 calendar months', () => {
  const spec = kind('orderRequests');
  assert.equal(cutoffFor(spec, NOW), '2025-10-18');
  assert.equal(decide(spec, { date: '2025-10-17' }, NOW), 'delete');
  assert.equal(decide(spec, { date: '2025-10-18' }, NOW), 'keep');
  assert.equal(decide(spec, { date: '2025-10-19' }, NOW), 'keep');
});

// For the kinds counted in days: the cutoff instant, then a day either side of it.
function dayBoundary(name, wrap, extra = {}) {
  const spec = kind(name);
  const cutoff = NOW - spec.keepDays * DAY_MS;
  assert.equal(decide(spec, { ...extra, [spec.field]: wrap(cutoff - DAY_MS) }, NOW), 'delete', `${name}: a day past`);
  assert.equal(decide(spec, { ...extra, [spec.field]: wrap(cutoff - 1) }, NOW), 'delete', `${name}: a millisecond past`);
  assert.equal(decide(spec, { ...extra, [spec.field]: wrap(cutoff) }, NOW), 'keep', `${name}: exactly the period`);
  assert.equal(decide(spec, { ...extra, [spec.field]: wrap(cutoff + DAY_MS) }, NOW), 'keep', `${name}: a day short`);
  assert.equal(decide(spec, { ...extra, [spec.field]: wrap(NOW) }, NOW), 'keep', `${name}: today`);
}

test('pushTimers: deleted 7 days after they were due, active or cancelled', () => {
  dayBoundary('pushTimers', ms => ms);
  const old = NOW - 8 * DAY_MS;
  assert.equal(decide(kind('pushTimers'), { fireAt: old, active: true }, NOW), 'delete');
  assert.equal(decide(kind('pushTimers'), { fireAt: old, active: false }, NOW), 'delete');
  assert.equal(cutoffFor(kind('pushTimers'), NOW), NOW - 7 * DAY_MS);
});

test('fcmTokens: deleted after 60 days without a refresh', () => {
  dayBoundary('fcmTokens', ms => ms);
});

test('devices, errors, usage: 90, 30 and 400 days on a Timestamp', () => {
  dayBoundary('devices', ts);
  dayBoundary('errors', ts);
  dayBoundary('usage', ts);
});

test('printJobs: only a done or failed job older than 30 days', () => {
  const spec = kind('printJobs');
  const iso = ms => new Date(ms).toISOString();
  dayBoundary('printJobs', iso, { status: 'done' });
  assert.equal(cutoffFor(spec, NOW), iso(NOW - 30 * DAY_MS));
  const old = iso(NOW - 31 * DAY_MS);
  assert.equal(decide(spec, { createdAt: old, status: 'done' }, NOW), 'delete');
  assert.equal(decide(spec, { createdAt: old, status: 'failed' }, NOW), 'delete');
  // ⚠️ A label still waiting, or one an agent is printing, is NEVER deleted, however old.
  for (const status of ['queued', 'claimed', undefined, '', 'DONE', 'done ', 1]) {
    assert.equal(decide(spec, { createdAt: old, status }, NOW), 'keep', String(status));
  }
  assert.equal(decide(spec, { createdAt: iso(NOW - 29 * DAY_MS), status: 'done' }, NOW), 'keep');
});

test('printJobs: an offset time is compared as a time, not as text', () => {
  const spec = kind('printJobs');
  // 31 days ago at 12:00 UTC, written as 13:00+01:00: the same instant, still old.
  const d = new Date(NOW - 31 * DAY_MS);
  const day = d.toISOString().slice(0, 10);
  assert.equal(decide(spec, { createdAt: `${day}T13:00:00+01:00`, status: 'done' }, NOW), 'delete');
});

// ── What can never be deleted ───────────────────────────────────────────────

test('a missing, mistyped, malformed, non-finite or pre-2020 date is skipped, never deleted', () => {
  const longAgo = NOW - 1000 * DAY_MS;
  const bad = {
    day: [undefined, null, '', '2024-02-30', '2024-13-01', '17/11/2024', '2024-11-1', 20241117,
      ts(longAgo), { year: 2024 }, true, '2019-12-31', '1999-01-01', '0000-01-01'],
    millis: [undefined, null, '', String(longAgo), NaN, -Infinity, Infinity, ts(longAgo),
      new Date(longAgo).toISOString(), true, {}, 0, -1, FLOOR_MS - 1],
    iso: [undefined, null, '', '2024-02-30T00:00:00Z', '2024-11-17', '2024-11-17T09:00:00', longAgo,
      ts(longAgo), 'not a date', '2019-12-31T23:59:59.999Z', '1970-01-01T00:00:00Z'],
    timestamp: [undefined, null, longAgo, new Date(longAgo).toISOString(), ts(NaN), ts(-Infinity),
      ts(FLOOR_MS - 1), ts(0), { seconds: 1, nanoseconds: 0 }, true],
  };
  for (const spec of KINDS) {
    for (const value of bad[spec.type]) {
      const data = { [spec.field]: value, status: 'done' };
      assert.equal(decide(spec, data, NOW), 'skip', `${spec.kind}: ${String(value)}`);
    }
    assert.equal(decide(spec, { status: 'done' }, NOW), 'skip', `${spec.kind}: no field at all`);
    assert.equal(decide(spec, null, NOW), 'skip', `${spec.kind}: no data`);
    assert.equal(decide(spec, undefined, NOW), 'skip', `${spec.kind}: no data`);
  }
});

test('the first day of 2020 is old enough to be deleted, the day before is not trusted', () => {
  assert.equal(decide(kind('clientOrders'), { date: '2020-01-01' }, NOW), 'delete');
  assert.equal(decide(kind('clientOrders'), { date: '2019-12-31' }, NOW), 'skip');
  assert.equal(decide(kind('usage'), { updatedAt: ts(FLOOR_MS) }, NOW), 'delete');
  assert.equal(decide(kind('usage'), { updatedAt: ts(FLOOR_MS - 1) }, NOW), 'skip');
});

// ── The function itself is deployed, on the owner's night ───────────────────

test('index.js exports the retention function, scheduled at 03:30 London in us-central1', async () => {
  // Read as text: the root suite installs no Firebase. A lost export would silently undeploy the
  // clean-up, a moved schedule would run it in the middle of a shift.
  const { readFileSync } = await import('node:fs');
  const read = p => readFileSync(new URL(`../functions/${p}`, import.meta.url), 'utf8');
  assert.match(read('index.js'), /^export \{ retention \} from '\.\/retention\.js';$/m);
  const handler = read('retention.js');
  assert.match(handler, /onSchedule\(\s*\{ schedule: '30 3 \* \* \*', timeZone: 'Europe\/London', region: 'us-central1'/);
  // The scheduled handler runs with the shipped switch: no `enabled` handed in.
  assert.match(handler, /async \(\) => \{\s*await runRetention\(\);\s*\}/);
});
