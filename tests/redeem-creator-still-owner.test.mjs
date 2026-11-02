// An invitation dies with its sender's ownership (security audit, 2 Nov 2026).
//
// THE DEFECT THIS CLOSES. redeemJoinCode checked only the code itself (used, locked,
// expired) and whether the caller was already inside. It never asked whether the
// owner who MINTED the code was still an owner. So an owner about to be removed could
// mint an owner link for themselves, get removed, open it and be an owner again — the
// "already a member" check passes precisely because they no longer are — and then
// remove the partner who removed them. Nothing in the app could revoke a staff code.
//
// ⚠️ SOURCE CHECKS, for the reason tests/redeem-never-demotes.test.mjs gives:
// functions/onboarding.js needs the Admin SDK, which the root suite never installs.
// What is pinned is the SHAPE that makes the guard work: read inside the transaction,
// before any write, compared with exactly 'owner', skipped only for a new customer's
// owner link, and refused with the same words as every other bad code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { redeemFailureText } from '../js/join-code.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = readFileSync(join(ROOT, 'functions', 'onboarding.js'), 'utf8');

const BODY = (() => {
  const start = SERVER.indexOf('export const redeemJoinCode');
  assert.notEqual(start, -1, 'redeemJoinCode is not exported from functions/onboarding.js');
  const end = SERVER.indexOf('\n});', start);
  assert.notEqual(end, -1, 'could not read the end of redeemJoinCode');
  const body = SERVER.slice(start, end);
  assert.ok(body.length > 1000, `redeemJoinCode read as ${body.length} characters`);
  return body;
})();

// The creator branch, from its `if` to the line that refuses.
const BRANCH = (() => {
  const at = BODY.indexOf("if (doc.purpose !== 'customer') {");
  assert.notEqual(at, -1, 'the creator check is gone from redeemJoinCode');
  const end = BODY.indexOf("status: 'revoked'", at);
  assert.notEqual(end, -1, 'the creator check no longer refuses with status revoked');
  return BODY.slice(at, end + 40);
})();

test('the creator is read through the transaction, from createdBy', () => {
  assert.match(BRANCH, /doc\.createdBy/, 'the check no longer looks at who minted the code');
  assert.match(BRANCH, /await tx\.get\(db\(\)\.doc\(`users\/\$\{creator\}`\)\)/,
    'the creator must be read with tx.get(), or a removal racing the redeem slips through');
  assert.doesNotMatch(BRANCH, /accessValue\(/, 'accessValue() reads outside the transaction');
});

test('a creator id that could bend the path is refused, not used', () => {
  assert.match(BRANCH, /\/\^\[A-Za-z0-9\]\{1,128\}\$\/\.test\(doc\.createdBy\)/,
    'createdBy goes into a document path and must be checked like any uid');
});

test('only an owner keeps the code alive, and a missing creator counts as not one', () => {
  assert.match(BRANCH, /if \(creatorAccess !== 'owner'\) return \{ ok: false, status: 'revoked' \}/,
    'the comparison must be exactly "not owner → refuse"; anything looser lets a demoted owner\'s link through');
  assert.match(BRANCH, /: false;/, 'a creator who cannot be read must count as no longer the owner');
});

test('the check runs before anything is written for the caller', () => {
  const check = BODY.indexOf("status: 'revoked'");
  assert.ok(check < BODY.indexOf('tx.set(userRef'), 'the membership is written before the creator is checked');
  assert.ok(check < BODY.indexOf('tx.update(ref, { usedAt'), 'the code is spent before the creator is checked');
});

test('a new customer\'s owner link is the only exception', () => {
  // createWorkspace and reissueOwnerLink mint it from the app admin's account, who is
  // never a member of the new venue — checking that creator would refuse every customer.
  assert.match(SERVER, /purpose: 'customer', locationId, role: 'owner', createdBy: uid/,
    'the customer owner link is no longer minted with purpose customer — the exception now names nothing');
});

test('the refusal sounds like any other bad code', () => {
  assert.equal(redeemFailureText('revoked'), redeemFailureText('missing'),
    'a revoked code must not say so: that would confirm the code existed');
});

// ── Removing somebody takes their client grant with them ─────────────────────
// A manager could write locations/{lid}/client-accounts/{their own uid} and, once removed,
// keep ordering as that client. firestore.rules now refuses such a grant; setMemberRole
// clears one written before it did, inside the transaction that removes the person.
test('removing a member deletes a client grant on their own account, atomically', () => {
  const start = SERVER.indexOf('export const setMemberRole');
  assert.notEqual(start, -1, 'setMemberRole is gone');
  const fn = SERVER.slice(start, SERVER.indexOf('\n});', start));
  const removal = fn.indexOf('if (role === null) {');
  assert.notEqual(removal, -1, 'the removal branch is gone');
  const branch = fn.slice(removal, fn.indexOf('return { removed: true };', removal));
  assert.match(branch, /tx\.delete\(db\(\)\.doc\(`locations\/\$\{locationId\}\/client-accounts\/\$\{targetUid\}`\)\)/,
    'a removed member keeps any client grant on their own account');
});

test('the rules refuse a client grant on an account that has a users document', () => {
  const rules = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');
  const at = rules.indexOf('match /client-accounts/{uid} {');
  assert.notEqual(at, -1, 'the client-accounts block is gone');
  const write = rules.slice(rules.indexOf('allow create, update:', at), rules.indexOf('allow delete:', at));
  assert.match(write, /&& !exists\(\/databases\/\$\(database\)\/documents\/users\/\$\(uid\)\)/,
    'a member can again name their own account as a client');
});
