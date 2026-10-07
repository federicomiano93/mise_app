// A person removed from a venue stops hearing about it (security audit, 7 Oct 2026).
//
// Their phone's notification registration used to stay behind, and the client-order
// notification went to every registration in the venue — so a removed employee kept
// seeing which clients ordered and for when, and could not stop it.
//
// Asserted against the SOURCE, as tests/order-request-notify.test.mjs does and for the
// same reason: these functions need the Admin SDK, Firestore and a live event, none of
// which exist under `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const index = readFileSync(join(ROOT, 'functions', 'index.js'), 'utf8');
const onboarding = readFileSync(join(ROOT, 'functions', 'onboarding.js'), 'utf8');

function body(src, start) {
  const from = src.indexOf(start);
  assert.ok(from >= 0, `${start} is in the source`);
  const next = src.indexOf('\nexport ', from + start.length);
  return src.slice(from, next < 0 ? undefined : next);
}

test('removing a member deletes that person\'s phone registrations in the venue', () => {
  const fn = body(onboarding, 'export const setMemberRole');
  const removed = fn.slice(fn.indexOf('if (outcome.removed)'));
  assert.match(removed, /fcm-tokens`\)\s*\.where\('uid', '==', targetUid\)/);
  assert.match(removed, /d\.ref\.delete\(\)/);
});

test('the client-order notification goes only to current members', () => {
  const fn = body(index, 'export const notifyClientOrder');
  assert.match(fn, /await stillMembers\(lid,/);
  assert.match(fn, /members\.has\(d\.data\(\)\.uid\)/);
  // …and that filter comes BEFORE the send.
  assert.ok(fn.indexOf('stillMembers(') < fn.indexOf('sendTo('));
});

test('stillMembers asks the same membership question as the rules', () => {
  const fn = index.slice(index.indexOf('async function stillMembers'));
  assert.match(fn, /membershipIn\(/);
  assert.match(index, /import \{ membershipIn \} from '\.\/onboarding\.js'/);
});

test('every callable that names a venue checks its id format before building a path', () => {
  assert.equal(/typeof locationId !== 'string' \|\| !locationId\)/.test(onboarding), false,
    'no callable may accept any non-empty string as a venue id');
});

test('a person named by uid is checked to be a uid', () => {
  for (const name of ['export const setMemberRole', 'export const setMemberName']) {
    assert.match(body(onboarding, name), /!\/\^\[A-Za-z0-9\]\{1,128\}\$\/\.test\(targetUid\)/, name);
  }
});
