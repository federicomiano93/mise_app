// Six digits only ever make an EMPLOYEE (security audit, 7 Oct 2026, his choice).
//
// A six-digit code can be guessed — the per-code limit never fires (a wrong guess hashes
// to another document), so only the per-account and app-wide caps hold — and a guessed
// manager or owner code is a stranger running somebody else's venue. Managers and owners
// are invited with a link, which cannot be guessed.
//
// The server half is asserted against the SOURCE (createJoinCode needs the Admin SDK and a
// live call, as tests/order-request-notify.test.mjs explains); the screen half too, since
// people.js builds its overlay against Firebase.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { t, setLanguage } from '../js/i18n.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const onboarding = readFileSync(join(ROOT, 'functions', 'onboarding.js'), 'utf8');
const people = readFileSync(join(ROOT, 'js', 'staff', 'people.js'), 'utf8');

test('the server refuses six digits for anything but an employee, before minting', () => {
  const fn = onboarding.slice(onboarding.indexOf('export const createJoinCode'),
    onboarding.indexOf('export const redeemJoinCode'));
  const guard = fn.indexOf("if (kind === 'digits' && role !== 'staff')");
  assert.ok(guard > 0, 'the guard is there');
  assert.ok(guard < fn.indexOf('mintDigits()'), 'and it runs before a code is minted');
  assert.ok(guard > fn.indexOf("const role = WRITABLE_ROLES.includes(asked) ? asked : 'staff'"),
    'on the role as the server reads it, not as it was asked');
  assert.match(fn.slice(guard, guard + 300), /throw new HttpsError\('failed-precondition'/);
});

test('the invite screen hides «Read out a code» unless the choice is an employee', () => {
  assert.match(people, /const staff = newChoice\.role === 'staff';\s*byDigits\.hidden = !staff;/);
  assert.match(people, /roleField\.addEventListener\('change', showDigits\)/);
  assert.match(people, /t\('people\.add\.digitsStaffOnly'\)/);
});

test('both languages say why, and the removal dialog reminds about client links', () => {
  const vars = { name: 'N', email: 'E' };
  try {
    setLanguage('en');
    assert.match(t('people.add.digitsStaffOnly'), /link/);
    // The button's own label, quoted — so the reminder names a button that exists.
    assert.ok(t('people.remove.message', vars).includes(t('calc.replaceWithANew')));
    setLanguage('it');
    assert.match(t('people.add.digitsStaffOnly'), /link/);
    assert.ok(t('people.remove.message', vars).includes(t('calc.replaceWithANew')));
  } finally {
    setLanguage('en');
  }
});
