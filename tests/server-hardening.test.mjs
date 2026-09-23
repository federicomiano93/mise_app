// The server fixes from the security audit of 23 Sep 2026.
//
// ⚠️ SOURCE CHECKS, AND THEY HAVE TO BE: the files below import firebase-functions
// and the Admin SDK, which the root suite never installs (the same constraint
// tests/redeem-never-demotes.test.mjs explains). What can be pinned is the SHAPE,
// and here the shape IS the fix — a read that must sit inside a transaction, a check
// that must come before a send. The behaviour was proved against the emulator with
// parallel calls; these keep a later edit from quietly undoing it.
//
// Every slice is asserted non-empty first: a slice that silently comes back short
// makes every check after it pass while testing nothing (the v1.66.0 survivor).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { _dictionaries } from '../js/i18n.js';

// Line endings folded: a Windows checkout carries CRLF, and the end markers below
// are written with a bare newline.
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// Comments removed, so a sentence ABOUT a call can never stand in for the call.
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function between(src, startMarker, endMarker, file) {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} not found in ${file}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `could not find the end of ${startMarker} in ${file}`);
  const body = codeOf(src.slice(start, end));
  assert.ok(body.length > 200, `${startMarker} read as ${body.length} characters — this test can no longer see it`);
  return body;
}

const ONBOARDING = read('functions/onboarding.js');
const INDEX = read('functions/index.js');

// ── 1. Six-digit codes ───────────────────────────────────────────────────────

test('the per-account limit is charged inside a transaction', () => {
  const body = between(ONBOARDING, 'async function chargeAttempt', '\n}\n', 'functions/onboarding.js');
  assert.match(body, /runTransaction\(/, 'chargeAttempt must read and write the count in ONE transaction');
  assert.match(body, /tx\.get\(ref\)/, 'the count must be read through the transaction');
  assert.match(body, /tx\.set\(ref,/, 'the count must be written through the transaction');
  assert.doesNotMatch(body, /await ref\.(get|set)\(/,
    'a read or write outside the transaction brings back the race parallel calls used');
});

test('every wrong six-digit guess counts towards the app-wide limit, and a pause stops the lookup', () => {
  const body = between(ONBOARDING, 'export const redeemJoinCode', '\n});', 'functions/onboarding.js');
  assert.match(body, /kind === 'digits' \? db\(\)\.doc\(DIGITS_GUARD_DOC\)/,
    'the guard must apply to six digits and never to a link');
  const pausedAt = body.indexOf('digitsPaused(guard');
  const lookupAt = body.indexOf('tx.get(ref)');
  assert.ok(pausedAt !== -1 && lookupAt !== -1, 'the pause check or the code lookup is missing');
  assert.ok(pausedAt < lookupAt, 'while paused, no guess may reach a code — the pause check must come first');
  assert.match(body, /tx\.set\(guardRef, withWrongGuess\(guard, now\)\)/,
    'a wrong guess must be written to the app-wide counter inside the transaction');
  assert.match(body, /reason: 'digits-paused'/, 'the pause must travel with its reason so the app can say it');
});

test('the app says the pause in the language on screen, in both languages', () => {
  const gate = codeOf(read('js/auth-gate.js'));
  assert.match(gate, /reason === 'digits-paused'/);
  assert.match(gate, /t\('join\.digitsPaused'\)/);
  const dicts = _dictionaries();
  assert.ok(Object.keys(dicts).length >= 2, 'the dictionaries could not be read');
  for (const lang of Object.keys(dicts)) {
    assert.ok(dicts[lang]['join.digitsPaused'], `join.digitsPaused is missing in '${lang}'`);
  }
  assert.notEqual(dicts.it['join.digitsPaused'], dicts.en['join.digitsPaused'], 'the Italian is a copy of the English');
  assert.match(dicts.it['join.digitsPaused'], /link/i, 'the Italian must point at the link too');
});

// ── 2. Roles ─────────────────────────────────────────────────────────────────

test('the last-owner count and the write are ONE transaction', () => {
  const body = between(ONBOARDING, 'export const setMemberRole', '\n});', 'functions/onboarding.js');
  const txAt = body.indexOf('runTransaction(');
  const countAt = body.indexOf('tx.get(ownersQuery)');
  assert.ok(txAt !== -1, 'setMemberRole must run in a transaction');
  assert.ok(countAt > txAt, 'the owners must be counted INSIDE the transaction, or two owners can demote each other');
  assert.doesNotMatch(body, /\.where\('role', '==', 'owner'\)\.get\(\)/,
    'an owner count read outside the transaction is the race this closed');
});

test('a role can only be set for somebody already in the location', () => {
  const body = between(ONBOARDING, 'export const setMemberRole', '\n});', 'functions/onboarding.js');
  assert.match(body, /membershipIn\(userSnap\.exists/, 'the target\'s membership must be read in the transaction');
  assert.match(body, /refused: 'not-member'/);
  assert.match(body, /'not-found', 'That person is not in this location\.'/);
});

// ── 3. The photo allowance ───────────────────────────────────────────────────

test('the photo allowance is charged in one transaction, by both readers', () => {
  const recipe = read('functions/recipe-photo.js');
  const body = between(recipe, 'export function chargeAllowance', '\n}\n', 'functions/recipe-photo.js');
  assert.match(body, /runTransaction\(/);
  assert.match(body, /tx\.get\(ref\)/);
  assert.match(body, /tx\.set\(ref, result\.next\)/);
  assert.match(codeOf(recipe), /charge: chargeAllowance/);

  const pack = codeOf(read('functions/pack-photo.js'));
  assert.match(pack, /charge: chargeAllowance/, 'the pack reader must charge the same way, not a copy');
  assert.doesNotMatch(pack, /saveLimit/, 'the old read-then-write is back in the pack reader');

  const model = codeOf(read('functions/recipe-photo-model.js'));
  assert.doesNotMatch(model, /store\.limit\(|store\.saveLimit\(/,
    'the model must not read and write the allowance as two separate calls');
});

// ── 4. Timer notifications ───────────────────────────────────────────────────

test('a timer rings only a phone registered to whoever set it', () => {
  const body = between(INDEX, 'export const sendTimerPush', '\n);', 'functions/index.js');
  const checkAt = body.indexOf('tokenBelongsTo(lid, timer.token, timer.uid)');
  const sendAt = body.indexOf('sendTo(timer.token');
  assert.ok(checkAt !== -1, 'sendTimerPush must check who the phone belongs to');
  assert.ok(sendAt > checkAt, 'the check must come BEFORE the send');

  const helper = between(INDEX, 'async function tokenBelongsTo', '\n}\n', 'functions/index.js');
  assert.match(helper, /includes\('\/'\)/, 'a token holding a slash would name another document');
  assert.match(helper, /\.uid === uid/);
  assert.match(helper, /return false/, 'a failed read must answer no — the quiet direction');
});

test('a shared phone is registered again in the name of whoever starts a timer', () => {
  const push = codeOf(read('js/push.js'));
  const body = between(read('js/push.js'), 'export async function scheduleAlarm', '\n}\n', 'js/push.js');
  assert.match(body, /storedTokenOwner\(\) !== uid\) await rememberToken\(token\)/);
  assert.match(push, /localStorage\.setItem\(TOKEN_UID_KEY, uid\)/);
  assert.match(push, /localStorage\.removeItem\(TOKEN_UID_KEY\)/, 'turning notifications off must forget the owner too');
});
