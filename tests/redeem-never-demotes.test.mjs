// A join code may not change what somebody already inside a location can do —
// and above all it may not take the owner's own business away from them.
//
// THE DEFECT THIS CLOSES. redeemJoinCode wrote the membership with
// `tx.set(users/{uid}, { locations: { [locationId]: value } }, { merge: true })`
// and never asked whether the caller was already a member. merge does not mean
// "keep what is there" for the key being written: it OVERWRITES that key. So a
// staff invitation opened by the OWNER of the same business rewrote their own
// membership from 'owner' to true — an employee of the place they own, in one tap.
//
// Federico found it on 24 Aug 2026 the ordinary way: he minted a staff code for
// The Italian Club and opened the link himself to check it worked, which is what
// anybody would do. The app asked "Add this business to <your email>?" and one tap
// would have done it. He asked what the question meant instead of answering it.
//
// ⚠️ AND setMemberRole'S LAST-OWNER GUARD DOES NOT COVER THIS PATH. That function
// refuses to demote the only owner, precisely so a location can never be left with
// nobody who can invite, promote or delete. It is a guard on ONE door; this was a
// second door into the same room, and it had none. Recovery would have needed the
// Firebase console — the thing functions/onboarding.js exists to stop needing.
//
// ⚠️ THESE ARE SOURCE CHECKS FOR THE SERVER HALF, and they have to be:
// functions/onboarding.js imports firebase-functions and the Admin SDK, and the
// root suite never runs `npm ci` in functions/ (the same constraint that keeps
// functions/recipe-photo-model.js pure). What can be pinned is the SHAPE, and the
// shape is where the danger is: a read that must be inside the transaction, a
// refusal that must write nothing, and an order that must hold. The behaviour
// itself is proved by driving the app against the emulator.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { redeemFailureText } from '../js/join-code.js';
import { _dictionaries } from '../js/i18n.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = readFileSync(join(ROOT, 'functions', 'onboarding.js'), 'utf8');
const GATE = readFileSync(join(ROOT, 'js', 'auth-gate.js'), 'utf8');

// The body of redeemJoinCode, from its declaration to the closing of its own
// braces. ⚠️ ASSERTED NON-EMPTY, because a slice that silently comes back short
// makes every check below pass while testing nothing (the v1.66.0 survivor).
const BODY = (() => {
  const start = SERVER.indexOf('export const redeemJoinCode');
  assert.notEqual(start, -1, 'redeemJoinCode is not exported from functions/onboarding.js');
  const end = SERVER.indexOf('\n});', start);
  assert.notEqual(end, -1, 'could not read the end of redeemJoinCode');
  const body = SERVER.slice(start, end);
  assert.ok(body.length > 1000,
    `redeemJoinCode read as ${body.length} characters — this test can no longer see it`);
  return body;
})();

// ── The guard itself ─────────────────────────────────────────────────────────

test('redeemJoinCode refuses a code for a location the caller is already in', () => {
  assert.match(BODY, /membershipIn\(/,
    'redeemJoinCode no longer asks whether the caller is already a member — a staff code would overwrite an owner');
  assert.match(BODY, /status: 'already-member'/,
    'the refusal has lost its name, so the app can no longer tell it from a bad code');
});

// ⚠️ THE READ MUST BE INSIDE THE TRANSACTION. accessValue() fetches for itself, so
// using it here would read the membership OUTSIDE the transaction that writes it,
// and two requests overlapping could both pass the check.
test('the membership is read through the transaction, not fetched on the side', () => {
  assert.match(BODY, /await tx\.get\(userRef\)/,
    'the membership must be read with tx.get(), or the check is not part of the transaction');
  assert.doesNotMatch(BODY, /accessValue\(/,
    'accessValue() reads outside the transaction — inside redeemJoinCode that is a race, not a check');
});

// ⚠️ ORDER, NOT PRESENCE. A check that runs after the write it exists to prevent is
// decoration. Firestore also refuses a read after a write inside one transaction,
// so getting this backwards fails loudly — but only while somebody is redeeming a
// code, which is the one moment nobody is watching.
test('the check happens BEFORE the membership is written', () => {
  const read = BODY.indexOf('await tx.get(userRef)');
  const write = BODY.indexOf('tx.set(userRef');
  assert.notEqual(read, -1, 'the membership read is gone');
  assert.notEqual(write, -1, 'the membership write is gone — has it been renamed?');
  assert.ok(read < write,
    'the membership is written before anybody asks who the caller already is');
});

// ⚠️ THE CODE MUST SURVIVE THE REFUSAL. Whoever opened it to check is not the
// person it was minted for: marking it used, or spending one of its five lives,
// would mean re-minting and re-sending a code that nobody had actually tried.
test('refusing an already-member costs the code nothing', () => {
  const at = BODY.indexOf('if (membershipIn(');
  assert.notEqual(at, -1, 'the already-member branch is gone');
  const end = BODY.indexOf('\n    }', at);
  assert.notEqual(end, -1, 'could not read the end of the already-member branch');
  const branch = BODY.slice(at, end);
  assert.ok(branch.length > 40,
    `the branch read as ${branch.length} characters — this check is testing nothing`);
  assert.doesNotMatch(branch, /tx\./,
    'the refusal writes to the transaction — a code opened by mistake must not be spent or marked failed');
});

// ⚠️ ONE COPY OF "WHICH VALUES COUNT AS MEMBERSHIP". That list has already been
// missed in three separate files, and the mistake it makes is a LOCKOUT, not a
// demotion. accessValue and the transaction must ask the same function.
test('accessValue and the transaction share one definition of membership', () => {
  assert.match(SERVER, /export function membershipIn\(/,
    'membershipIn is gone — has the ACCESS_VALUES check been copied out again?');
  const at = SERVER.indexOf('export async function accessValue(');
  assert.notEqual(at, -1, 'accessValue is gone');
  assert.match(SERVER.slice(at, at + 300), /membershipIn\(/,
    'accessValue no longer asks membershipIn — the two answers can now drift apart');
});

// ── What the person is told ──────────────────────────────────────────────────

// ⚠️ EVERY OTHER REFUSAL SOUNDS IDENTICAL ON PURPOSE: naming one confirms a code
// EXISTS, which is the signal a search wants. This one is safe to name because it
// says something about the ACCOUNT — one already inside the location the code
// belongs to — and nothing at all about the code.
test('already-member is the only refusal with words of its own', () => {
  const generic = redeemFailureText('missing');
  for (const status of ['missing', 'expired', 'used', 'locked', 'anything-else']) {
    assert.equal(redeemFailureText(status), generic,
      `'${status}' has grown its own message — a refusal that names its reason confirms the code exists`);
  }
  assert.notEqual(redeemFailureText('already-member'), generic,
    'an owner opening their own invitation is told the code is broken, which is neither true nor actionable');
});

test('the refusal travels with a reason the app can translate', () => {
  assert.match(BODY, /new HttpsError\('failed-precondition',[\s\S]{0,120}reason: 'already-member'/,
    'the reason is no longer sent, so the app can only show the server\'s English');
});

test('the join screen answers already-member in the language on screen', () => {
  assert.match(GATE, /details[\s\S]{0,40}reason === 'already-member'/,
    'js/auth-gate.js no longer recognises the reason the server sends');
  assert.match(GATE, /t\('join\.alreadyMember'\)/,
    'the translated sentence is not used — the screen falls back to English');
  assert.match(GATE, /if \(alreadyMember\) forgetInvite\(\)/,
    'an invitation that can never be redeemed is kept, so it is offered again on every page');
});

test('the sentence exists in both languages and is actually translated', () => {
  const dicts = _dictionaries();
  const en = dicts.en['join.alreadyMember'];
  const it = dicts.it['join.alreadyMember'];
  assert.ok(en, 'join.alreadyMember is missing from the English dictionary');
  assert.ok(it, 'join.alreadyMember is missing from the Italian dictionary');
  assert.notEqual(en, it, 'the Italian is a copy of the English');
});
