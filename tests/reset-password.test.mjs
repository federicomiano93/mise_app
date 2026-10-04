// The page «Forgot your password?» lands on: reset-password.html + js/reset-password.js.
// Pins the pure helpers, the forward of every other email action to Firebase's own page, the
// order of the checks in the form, and that the code and the email are never logged (P17).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  readAction, pickLanguage, forwardUrl, errorKeyFor,
} from '../js/reset-password.js';
import { t, setLanguage } from '../js/i18n.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');
const source = read('js/reset-password.js');
const html = read('reset-password.html');

test('readAction reads mode, oobCode and lang from the query string', () => {
  assert.deepEqual(
    readAction('?mode=resetPassword&oobCode=abc123&apiKey=k&lang=it&continueUrl=x'),
    { mode: 'resetPassword', code: 'abc123', lang: 'it' },
  );
  assert.deepEqual(readAction(''), { mode: '', code: '', lang: '' });
  assert.deepEqual(readAction(undefined), { mode: '', code: '', lang: '' });
});

test('the language is the link\'s when supported, else the phone\'s', () => {
  assert.equal(pickLanguage('it', 'en-GB'), 'it');
  assert.equal(pickLanguage('en', 'it-IT'), 'en');
  assert.equal(pickLanguage('it-IT', 'en'), 'it');
  assert.equal(pickLanguage('fr', 'it-IT'), 'it');
  assert.equal(pickLanguage('', 'it-IT'), 'it');
  assert.equal(pickLanguage('', 'de'), 'en');
});

test('forwardUrl hands the same query string to Firebase\'s default handler', () => {
  assert.equal(
    forwardUrl('some-project.firebaseapp.com', '?mode=verifyEmail&oobCode=zz&apiKey=k'),
    'https://some-project.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=zz&apiKey=k',
  );
});

test('every mode but resetPassword is forwarded, using the configured authDomain', () => {
  assert.match(source, /mode !== 'resetPassword'/);
  assert.match(source, /location\.replace\(forwardUrl\(fb\.firebaseConfig\.authDomain, location\.search\)\)/);
  // never a hardcoded project
  assert.doesNotMatch(source, /firebaseapp\.com|bakery-app|mise-app-preview/);
});

test('Firebase error codes map to the right sentence', () => {
  assert.equal(errorKeyFor('auth/expired-action-code'), 'reset.badLink');
  assert.equal(errorKeyFor('auth/invalid-action-code'), 'reset.badLink');
  assert.equal(errorKeyFor('auth/user-disabled'), 'reset.inactive');
  assert.equal(errorKeyFor('auth/user-not-found'), 'reset.inactive');
  assert.equal(errorKeyFor('auth/weak-password'), 'help.passwordTooShort');
  assert.equal(errorKeyFor('auth/network-request-failed'), 'reset.failed');
  assert.equal(errorKeyFor(undefined), 'reset.failed');
});

test('the sentences exist in English and Italian, with the agreed wording', () => {
  setLanguage('en');
  assert.equal(t('reset.title'), 'Choose a new password');
  assert.equal(t('reset.for', { email: 'a@b.c' }), 'For a@b.c');
  assert.equal(t('reset.save'), 'Save the new password');
  assert.equal(t('reset.openMise'), 'Open Mise');
  setLanguage('it');
  assert.equal(t('reset.title'), 'Scegli una nuova password');
  assert.equal(t('reset.for', { email: 'a@b.c' }), 'Per a@b.c');
  assert.equal(t('reset.save'), 'Salva la nuova password');
  assert.equal(t('reset.saving'), 'Salvataggio…');
  assert.equal(t('reset.openMise'), 'Apri Mise');
  assert.match(t('reset.badLink'), /“Password dimenticata\?”/);
  setLanguage('en');
});

test('the form checks the password and the repeat, in that order, before setNewPassword', () => {
  const weak = source.indexOf('passwordProblem(password.value, email)');
  const same = source.indexOf('confirmProblem(password.value, password2.value)');
  const send = source.indexOf('fb.setNewPassword(code, password.value)');
  assert.ok(weak > 0 && same > weak && send > same, 'order: passwordProblem, confirmProblem, setNewPassword');
  assert.match(source, /password2\.focus\(\)/);
});

test('the person is never signed in by this page', () => {
  assert.doesNotMatch(source, /fb\.signIn|signInWith|signUp\(/);
});

test('the password boxes are new-password and the username is there for the password manager', () => {
  assert.match(source, /input\.autocomplete = 'new-password'/);
  assert.match(source, /username\.autocomplete = 'username'/);
});

test('nothing logs, and the code and the email never go into a navigation', () => {
  assert.doesNotMatch(source, /console\./);
  // the only navigation is the forward, which carries the query string it already had
  const navigations = source.match(/location\.(replace|assign|href)[^\n]*/g) || [];
  assert.equal(navigations.length, 1, navigations.join('\n'));
});

test('the page loads its script as a module, plus the update prompt, and no kiosk', () => {
  assert.match(html, /<script type="module" src="js\/i18n-dom\.js"><\/script>/);
  assert.match(html, /<script type="module" src="js\/reset-password\.js"><\/script>/);
  assert.match(html, /<script type="module" src="js\/sw-update\.js"><\/script>/);
  assert.doesNotMatch(html, /kiosk\.js/);
  assert.match(html, /href="tokens\.css"/);
  assert.match(html, /href="auth\.css"/);
});

test('the page and its script are precached together', () => {
  const sw = read('sw.js');
  assert.match(sw, /'\.\/reset-password\.html',/);
  assert.match(sw, /'\.\/js\/reset-password\.js',/);
});

test('firebase.js and its example both export the two reset helpers', () => {
  for (const f of ['js/firebase.js', 'js/firebase.example.js']) {
    const s = read(f);
    assert.match(s, /export function checkResetCode\(code\)/, f);
    assert.match(s, /export function setNewPassword\(code, password\)/, f);
    assert.match(s, /verifyPasswordResetCode,\s*\n\s*confirmPasswordReset,/, f);
  }
});
