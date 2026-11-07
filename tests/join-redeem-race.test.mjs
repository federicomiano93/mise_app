// The join race (review of PR #460, 6 Nov 2026).
//
// THE DEFECT THIS PINS. Joining with a new account is two steps — create the account,
// then redeem the code — and creating the account moves the session on by itself
// ('loading', then 'no-access'). js/auth-gate.js render() answered that by drawing a new
// screen while the code was still being checked on the old form, so a refusal (used,
// expired, offline) was written into a form nobody could see: the person was left on
// «No venue», or on an empty invitation form, with no message. Reproduced on the
// emulator with a used code before the fix (algprobe drive-join-redeem-race.mjs).
//
// Two halves: the decision itself, as a pure function, tested for every state; and the
// SHAPE of the gate around it, as source checks — render() and joinScreen need a DOM and
// a Firebase session that do not exist under `node --test`. The flow itself is proven by
// the driver, not here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { keepJoinForm, HELD_STATES } from '../js/join-hold.js';

const GATE = readFileSync(new URL('../js/auth-gate.js', import.meta.url), 'utf8');

// Every state render() draws. A new one must be placed on one side or the other.
const ALL_STATES = ['loading', 'signed-out', 'hub', 'choose-location', 'no-access', 'error', 'ready'];

// ── The decision ─────────────────────────────────────────────────────────────

test('no form sent: the gate draws every state as usual', () => {
  for (const status of ALL_STATES) {
    assert.equal(keepJoinForm(null, status, ''), false, status);
    assert.equal(keepJoinForm(undefined, status, 'tok'), false, status);
  }
});

test('while the code is being checked, the sign-up\'s own states never replace the form', () => {
  const busy = { invited: '', busy: true };
  for (const status of ['loading', 'no-access', 'error']) {
    assert.equal(keepJoinForm(busy, status, ''), true, status);
    // Not even an invitation opened meanwhile: the check finishes first.
    assert.equal(keepJoinForm(busy, status, 'another-token'), true, status);
  }
});

test('somewhere real still wins: signed out, or let into a venue', () => {
  for (const form of [{ invited: '', busy: true }, { invited: 'tok', busy: false }]) {
    for (const status of ['signed-out', 'hub', 'choose-location', 'ready']) {
      assert.equal(keepJoinForm(form, status, ''), false, `${status} busy=${form.busy}`);
    }
  }
});

test('after a refusal the form stays, so a late session answer cannot wipe the message', () => {
  assert.equal(keepJoinForm({ invited: '', busy: false }, 'no-access', ''), true);
  assert.equal(keepJoinForm({ invited: 'tok', busy: false }, 'no-access', 'tok'), true);
  assert.equal(keepJoinForm({ invited: 'tok', busy: false }, 'loading', ''), true,
    'an invitation dropped after the refusal does not free the gate');
});

// Code review, 6 Nov 2026: compared with the code in the box, an invitation refused
// earlier and still remembered threw a wrong typed code back onto that old invitation.
test('an invitation already remembered when Join was tapped does not take the screen back', () => {
  for (const status of HELD_STATES) {
    assert.equal(keepJoinForm({ invited: 'used-old', busy: false }, status, 'used-old'), true, status);
  }
});

test('after a refusal, a NEW invitation gets its own form', () => {
  assert.equal(keepJoinForm({ invited: '', busy: false }, 'no-access', 'new-token'), false);
  assert.equal(keepJoinForm({ invited: 'old', busy: false }, 'no-access', 'new-token'), false);
});

test('the held states are exactly the ones a sign-up passes through', () => {
  assert.deepEqual([...HELD_STATES].sort(), ['error', 'loading', 'no-access']);
  assert.ok(Object.isFrozen(HELD_STATES));
  for (const s of HELD_STATES) assert.ok(ALL_STATES.includes(s), s);
});

// ── The gate around it ───────────────────────────────────────────────────────

// ⚠️ Searched from joinScreen on: «form.addEventListener('submit'» and «} catch (err) {»
// appear first in signInScreen, and a slice from there would pass on the wrong code.
const JOIN_AT = GATE.indexOf('function joinScreen(');

function body(start, end, after = 0) {
  const from = GATE.indexOf(start, after);
  assert.notEqual(from, -1, `auth-gate.js no longer has «${start}»`);
  const to = GATE.indexOf(end, from);
  assert.notEqual(to, -1, `auth-gate.js no longer has «${end}» after «${start}»`);
  return GATE.slice(from, to);
}

test('render() asks before drawing anything, and only about a form still on screen', () => {
  const head = body('function render(session) {', 'switch (session.status) {');
  assert.match(head, /lastSession = session;/);
  assert.match(head, /sentJoin && sentJoin\.card\.isConnected \? sentJoin : null/);
  assert.match(head, /if \(keepJoinForm\(held, session\.status, invitedWith\)\) return;/);
  // The account name is kept current even while the form holds the gate.
  assert.ok(head.indexOf('lastAccount =') < head.indexOf('keepJoinForm('),
    'lastAccount must be set before the hold, or a kept form leaves it stale');
});

test('the submit marks the form as sent BEFORE the sign-up that moves the session', () => {
  const submit = body("form.addEventListener('submit'", "if (kept) {", JOIN_AT);
  const marked = submit.indexOf('sentJoin = sent;');
  const signUp = submit.indexOf('await signUp(');
  assert.ok(marked !== -1 && signUp !== -1, 'both steps must be present');
  assert.ok(marked < signUp, 'marked after the sign-up, the race is back');
  assert.match(submit, /const sent = \{ card, invited: invitedWith, busy: true \};/);
});

// Code review, 6 Nov 2026: Back during the check led a signed-in account to the sign-in
// screen, where the refusal landed nowhere and signing in again drew nothing.
test('Back cannot be tapped while the code is being checked, and returns after a refusal', () => {
  assert.ok(JOIN_AT !== -1);
  const submit = body("form.addEventListener('submit'", "if (kept) {", JOIN_AT);
  const off = submit.indexOf('back.disabled = true;');
  assert.ok(off !== -1 && off < submit.indexOf('await signUp('), 'Back must be off before the sign-up');
  const failure = submit.slice(submit.indexOf('} catch (err) {'));
  assert.match(failure, /back\.disabled = false;/);
});

test('an invitation opened during the check is drawn once the check is over', () => {
  const failure = body('} catch (err) {', "if (kept) {", JOIN_AT);
  assert.match(failure,
    /if \(invitedWith && invitedWith !== sent\.invited && lastSession\) render\(lastSession\);/);
  assert.ok(failure.indexOf('sent.busy = false;') < failure.indexOf('render(lastSession)'),
    'drawn while still busy, the hold would swallow it');
});

test('a refusal after a created account becomes the form for that account, name and code kept', () => {
  const failure = body('} catch (err) {', "if (kept) {", JOIN_AT);
  assert.match(failure, /sent\.busy = false;/);
  // A screen that moved somewhere real is not covered by a late refusal.
  assert.match(failure, /if \(!card\.isConnected\) return;/);
  const rebuild = failure.slice(failure.indexOf('if (createdAccount) {'));
  assert.match(rebuild, /joinScreen\(\{ needsAccount: false, prefill, kept: \{/);
  for (const field of ['account: createdAccount', 'firstName: firstName.value',
    'lastName: lastName.value', 'code: code.value', 'error: refusal', 'invited: sent.invited']) {
    assert.ok(rebuild.includes(field), `the carried form loses «${field}»`);
  }
  // The rebuild comes before the old form's own setStatus: written there, it is lost.
  assert.ok(failure.indexOf('if (createdAccount) {') < failure.indexOf('setStatus(refusal)'));
});

test('the carried form keeps itself on screen, says the refusal and names the account', () => {
  const kept = body('  if (kept) {', '  setTimeout(() => firstName.focus(), 0);', JOIN_AT);
  assert.match(kept, /sentJoin = \{ card, invited: kept\.invited \|\| '', busy: false \};/);
  assert.match(kept, /firstName\.value = kept\.firstName/);
  assert.match(kept, /lastName\.value = kept\.lastName/);
  assert.match(kept, /setStatus\(kept\.error/);
  assert.match(kept, /code\.focus\(/);
  assert.match(kept, /status\.scrollIntoView\(/);
  assert.match(kept, /code\.setAttribute\('aria-describedby', 'join-status'\)/);
  // The account it was created for, even before the session has caught up.
  assert.match(GATE, /const who = \(kept && kept\.account\)/);
});

test('sentJoin is declared before the first session subscription (no TDZ crash)', () => {
  const declared = GATE.indexOf('let sentJoin = null;');
  const subscribed = GATE.indexOf('onSession(render);');
  assert.ok(declared !== -1 && subscribed !== -1);
  assert.ok(declared < subscribed);
});
