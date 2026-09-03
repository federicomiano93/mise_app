// The rules of a print queue — read by the app and by the agent on the shop
// computer, which is why they live in one file and are asserted here.
//
// ⚠️ THE TWO FAILURES THIS FILE EXISTS AGAINST: a label printed twice, and a
// printer that is switched off while the phone says it is ready.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JOB_STATES, canMove, buildJob, MAX_JOB_CHARS,
  isStale, printerPresence, HEARTBEAT_MS, STALE_AFTER_MS,
  expiredJobs, nextJob, JOB_TTL_MS,
} from '../js/print-queue-model.js';

const T0 = Date.parse('2026-09-03T10:00:00.000Z');
const at = ms => new Date(T0 + ms).toISOString();

// ── What a job may become ────────────────────────────────────────────────────

test('a job goes queued → claimed → done, and nowhere else', () => {
  assert.equal(canMove('queued', 'claimed'), true);
  assert.equal(canMove('claimed', 'done'), true);
  assert.equal(canMove('claimed', 'failed'), true);
});

test('⚠️⚠️ a claimed job is NEVER put back in the queue', () => {
  // If the agent died mid-print the paper may already be out. Re-queueing would
  // print the label twice — and two identical allergen labels is a smaller harm
  // than a wrong count, but printing something nobody asked for twice is still the
  // wrong answer, and the RIGHT one is that a person notices and asks again.
  assert.equal(canMove('claimed', 'queued'), false);
  assert.equal(canMove('done', 'queued'), false);
  assert.equal(canMove('failed', 'queued'), false);
});

test('a finished job is finished — nothing reopens it', () => {
  for (const to of JOB_STATES) {
    assert.equal(canMove('done', to), false, `done → ${to} must be refused`);
    assert.equal(canMove('failed', to), false, `failed → ${to} must be refused`);
  }
});

test('a state nobody recognises grants nothing', () => {
  // The app can be an old build on somebody's phone and the agent is a program on a
  // computer nobody watches. Anything unrecognised is refused, never assumed.
  assert.equal(canMove('queued', 'printing'), false);
  assert.equal(canMove('printing', 'done'), false);
  assert.equal(canMove(undefined, 'done'), false);
  assert.equal(canMove('queued', null), false);
});

// ── Building one ─────────────────────────────────────────────────────────────

test('a job carries what the agent needs and nothing else', () => {
  const job = buildJob({ payload: '^XA^XZ', createdBy: 'uid1', bakery: 'main', now: T0 });
  assert.deepEqual(job, {
    bakery: 'main', status: 'queued', payload: '^XA^XZ', copies: 1,
    createdAt: '2026-09-03T10:00:00.000Z', createdBy: 'uid1',
  });
});

test('⚠️ an empty job is not queued — it is a sheet of blank paper', () => {
  assert.equal(buildJob({ payload: '', createdBy: 'u', bakery: 'main', now: T0 }), null);
  assert.equal(buildJob({ payload: '   \n ', createdBy: 'u', bakery: 'main', now: T0 }), null);
  assert.equal(buildJob({ payload: null, createdBy: 'u', bakery: 'main', now: T0 }), null);
});

test('⚠️ a runaway job is refused rather than stored', () => {
  const huge = '^'.repeat(MAX_JOB_CHARS + 1);
  assert.equal(buildJob({ payload: huge, createdBy: 'u', bakery: 'main', now: T0 }), null);
  const big = 'a'.repeat(MAX_JOB_CHARS);
  assert.ok(buildJob({ payload: big, createdBy: 'u', bakery: 'main', now: T0 }));
});

test('a job with nobody to own it is not a job', () => {
  assert.equal(buildJob({ payload: '^XA', createdBy: '', bakery: 'main', now: T0 }), null);
  assert.equal(buildJob({ payload: '^XA', createdBy: 'u', bakery: '', now: T0 }), null);
});

test('copies are clamped, never trusted', () => {
  const of = c => buildJob({ payload: '^XA', copies: c, createdBy: 'u', bakery: 'main', now: T0 }).copies;
  assert.equal(of(undefined), 1);
  assert.equal(of(0), 1);
  assert.equal(of(-5), 1);
  assert.equal(of('3'), 3);
  assert.equal(of(1e9), 99, 'a typo must not print a whole roll');
  assert.equal(of(NaN), 1);
});

// ── Is the printer there? ────────────────────────────────────────────────────

test('a heartbeat nobody has ever written reads as ABSENT, never as fine', () => {
  // An agent that has not started yet and one that never will look identical from
  // here, and the safe reading of both is that nothing is listening.
  assert.equal(isStale(undefined, T0), true);
  assert.equal(isStale(null, T0), true);
  assert.equal(isStale('not a date', T0), true);
  assert.equal(isStale('', T0), true);
});

test('⚠️ one missed beat is not an absent printer — three are', () => {
  // A single miss is a laptop lid or a Windows update. Warning every time one
  // packet is late teaches people to ignore the warning.
  assert.equal(isStale(at(-HEARTBEAT_MS), T0), false);
  assert.equal(isStale(at(-HEARTBEAT_MS * 2), T0), false);
  assert.equal(isStale(at(-STALE_AFTER_MS - 1), T0), true);
});

test('printerPresence answers with what the screen has to say', () => {
  assert.deepEqual(printerPresence([{ lastSeenAt: at(-1000) }], T0), { ready: true, agents: 1 });
  assert.deepEqual(printerPresence([{ lastSeenAt: at(-STALE_AFTER_MS - 1) }], T0), { ready: false, agents: 0 });
  assert.deepEqual(printerPresence([], T0), { ready: false, agents: 0 });
  assert.deepEqual(printerPresence(null, T0), { ready: false, agents: 0 });
});

test('⚠️ a shop computer with a wrong clock cannot look permanently ready', () => {
  // A heartbeat stamped in the future would never go stale. More than one beat
  // ahead of now is no answer at all rather than a very good one.
  assert.deepEqual(printerPresence([{ lastSeenAt: at(HEARTBEAT_MS * 5) }], T0), { ready: false, agents: 0 });
  // A little ahead is ordinary clock drift and is accepted.
  assert.deepEqual(printerPresence([{ lastSeenAt: at(1000) }], T0), { ready: true, agents: 1 });
});

test('two agents listening is two, so somebody can be told it is odd', () => {
  const both = printerPresence([{ lastSeenAt: at(-1000) }, { lastSeenAt: at(-2000) }], T0);
  assert.equal(both.agents, 2);
});

// ── Which job is next ────────────────────────────────────────────────────────

test('the oldest waiting job goes first', () => {
  const jobs = [
    { status: 'queued', createdAt: at(-3000) },
    { status: 'queued', createdAt: at(-9000) },
    { status: 'queued', createdAt: at(-1000) },
  ];
  assert.equal(nextJob(jobs, T0).createdAt, at(-9000));
});

test('⚠️ a job somebody has already claimed is never taken again', () => {
  const jobs = [{ status: 'claimed', createdAt: at(-9000) }, { status: 'queued', createdAt: at(-1000) }];
  assert.equal(nextJob(jobs, T0).createdAt, at(-1000));
});

test('⚠️ nothing from last week comes out of the printer this morning', () => {
  // The counter tapped Print, the computer was off, and the job waited. Printing it
  // a day later puts a label with yesterday's date on today's food.
  const stale = [{ status: 'queued', createdAt: at(-JOB_TTL_MS - 1) }];
  assert.equal(nextJob(stale, T0), null);
  assert.equal(nextJob([{ status: 'queued', createdAt: 'rubbish' }], T0), null);
});

test('an empty queue is not an error', () => {
  assert.equal(nextJob([], T0), null);
  assert.equal(nextJob(null, T0), null);
});

// ── Cleaning up ──────────────────────────────────────────────────────────────

test('a finished job is rubbish the moment it is finished', () => {
  const jobs = [
    { status: 'done', createdAt: at(-1000) },
    { status: 'failed', createdAt: at(-1000) },
    { status: 'queued', createdAt: at(-1000) },
  ];
  assert.deepEqual(expiredJobs(jobs, T0).map(j => j.status), ['done', 'failed']);
});

test('⚠️ a job an agent claimed and then died holding still ages out', () => {
  // Otherwise it sits in the collection for ever, read on every app open.
  const jobs = [{ status: 'claimed', createdAt: at(-JOB_TTL_MS - 1) }];
  assert.equal(expiredJobs(jobs, T0).length, 1);
  assert.equal(expiredJobs([{ status: 'claimed', createdAt: at(-1000) }], T0).length, 0);
});

test('a job with no date can still be thrown away', () => {
  // Without this it could never age out, which is the one shape that accumulates.
  assert.equal(expiredJobs([{ status: 'queued', createdAt: undefined }], T0).length, 1);
});

test('something that is not a job is left alone rather than deleted', () => {
  assert.deepEqual(expiredJobs([null, { status: 'invented', createdAt: at(-1) }], T0), []);
});
