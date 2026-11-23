// A new account must have confirmed its email before a join code or link lets it in (Federico's decision,
// 22 Nov 2026: only accounts created from 23 Nov 2026; everybody else later, as its own step).
//
// ⚠️ SOURCE CHECKS FOR THE SERVER HALF, like redeem-never-demotes.test.mjs: the root suite never installs
// functions/, so what is pinned is the shape — the check runs first, before a try is charged, it trusts the
// account record over a stale token, an unreadable creation time counts as new, and the refusal carries the
// reason the app reads. The behaviour is proved by driving the app against the emulator.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = readFileSync(join(ROOT, 'functions', 'onboarding.js'), 'utf8').replace(/\r\n/g, '\n');

const body = name => {
  const start = SERVER.indexOf(name);
  assert.ok(start >= 0, `${name} is in functions/onboarding.js`);
  const next = SERVER.indexOf('\n});', start);
  return SERVER.slice(start, next);
};

test('the cut-off is 23 Nov 2026, UTC', () => {
  assert.match(SERVER, /const EMAIL_CHECK_SINCE = Date\.UTC\(2026, 10, 23\);/);
});

test('redeemJoinCode asks for a confirmed email first: before the pause answer and before a try is charged', () => {
  const redeem = body('export const redeemJoinCode');
  const check = redeem.indexOf('await requireConfirmedEmail(request, uid);');
  assert.ok(check > 0, 'redeemJoinCode calls requireConfirmedEmail');
  assert.ok(check < redeem.indexOf('digitsPaused('), 'before the digits pause');
  assert.ok(check < redeem.indexOf('chargeAttempt('), 'before a try is charged');
  assert.ok(check < redeem.indexOf('runTransaction('), 'before the code is looked up');
});

test('the check: token first, then the account record; an older account passes; an unreadable date counts as new', () => {
  const start = SERVER.indexOf('async function requireConfirmedEmail(request, uid) {');
  assert.ok(start > 0);
  const fn = SERVER.slice(start, SERVER.indexOf('\n}\n', start));
  assert.match(fn, /request\.auth\.token\.email_verified === true\) return;/);
  assert.match(fn, /getAuth\(\)\.getUser\(uid\)/);
  assert.match(fn, /account\.emailVerified === true\) return;/);
  assert.match(fn, /Number\.isFinite\(created\) && created < EMAIL_CHECK_SINCE\) return;/);
  assert.match(fn, /throw new HttpsError\('failed-precondition',[\s\S]*\{ reason: 'email-unverified' \}\);/);
  assert.ok(fn.indexOf('getUser') < fn.indexOf('throw'), 'the record is read before refusing');
});

test('getAuth comes from the Admin SDK', () => {
  assert.match(SERVER, /import \{ getAuth \} from 'firebase-admin\/auth';/);
});

// «Torna indietro» past Firebase's ~5-minute recent-login window: the server removes the caller's OWN account, and
// only one that never got anywhere. Every condition is a lock, so each is pinned.
test('discardUnconfirmedAccount: own account only, unconfirmed, young, never in a business', () => {
  const start = SERVER.indexOf('export const discardUnconfirmedAccount = onCall(CALL, async (request) => {');
  assert.ok(start > 0, 'the callable exists');
  const fn = SERVER.slice(start, SERVER.indexOf('\n});', start));
  assert.match(fn, /const uid = requireAuth\(request\);/);
  assert.doesNotMatch(fn, /request\.data/, 'it takes no uid from the caller: only its own account');
  assert.match(fn, /account\.emailVerified === true \|\| !young/);
  assert.match(fn, /Number\.isFinite\(created\) && created >= EMAIL_CHECK_SINCE && Date\.now\(\) - created <= DISCARD_WITHIN_MS/);
  assert.match(SERVER, /const DISCARD_WITHIN_MS = 7 \* 24 \* 60 \* 60 \* 1000;/);
  assert.match(fn, /db\(\)\.doc\(`users\/\$\{uid\}`\)\.get\(\)\)\.exists/);
  const del = fn.indexOf('getAuth().deleteUser(uid)');
  assert.ok(del > fn.indexOf('.exists'), 'deleted only after every check');
  assert.equal(fn.match(/deleteUser\(/g).length, 1);
});

test('discardUnconfirmedAccount is exported from functions/index.js, or it is never deployed', () => {
  const index = readFileSync(join(ROOT, 'functions', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
  const start = index.indexOf('export {\n  createWorkspace');
  assert.ok(start > 0, 'the onboarding export list is there');
  assert.match(index.slice(start, index.indexOf("} from './onboarding.js';", start)), /discardUnconfirmedAccount/);
});
