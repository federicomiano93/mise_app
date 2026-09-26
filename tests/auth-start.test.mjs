// How Firebase Auth is started, and what is NOT started beside it (speed audit,
// 26 Sep 2026). Source checks: the SDK runs only in a browser, so these pin the two
// facts a browser would only reveal on real phones.
//
// 1. initializeAuth, not getAuth. getAuth() also brings the "Sign in with Google"
//    pop-up machinery, which on a MOBILE browser loads a script from apis.google.com
//    on every page before it says who is signed in — refused by this app's security
//    policy, so it was wasted work and a console error on every screen.
//
// 2. ⚠️⚠️ THE PERSISTENCE LIST IS getAuth()'s OWN, IN THE SAME ORDER. It is where a
//    phone keeps "who is signed in". Change it and every phone already signed in
//    looks in a different place on its next opening: the whole staff signed out at
//    once, on the morning the release goes live.
//
// 3. No App Check. reCAPTCHA ran on every page and, in monitor mode, blocked nothing
//    (Federico's decision, 26 Sep 2026). Putting it back is a decision too — and it
//    needs www.google.com back in every page's security policy, which this file
//    checks is gone, so the two cannot drift apart unnoticed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
// The code without its whole-line comments — which name getAuth() to explain why it is gone.
const code = (rel) => read(rel).replace(/^\s*\/\/.*$/gm, '');
const asPosix = (abs) => relative(ROOT, abs).split(sep).join('/');

function everyJsFile(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) return entry === 'vendor' ? [] : everyJsFile(abs);
    return entry.endsWith('.js') ? [abs] : [];
  });
}

// The apps that live for as long as a page does, each with a signed-in person in it.
// (js/client-orders-data.js makes a throwaway app to mint a link and deletes it at
// once; it never signs anybody in for longer than the call.)
const LONG_LIVED_AUTH = ['js/firebase.js', 'js/firebase.example.js', 'js/client-orders/firebase-client-orders.js'];
const GET_AUTH_DEFAULT = ['indexedDBLocalPersistence', 'browserLocalPersistence', 'browserSessionPersistence'];

for (const file of LONG_LIVED_AUTH) {
  test(`${file} starts Auth with initializeAuth and no pop-up machinery`, () => {
    const src = code(file);
    assert.match(src, /\binitializeAuth\(\s*app\s*,/, `${file} must start Auth with initializeAuth(app, …)`);
    assert.doesNotMatch(src, /\bgetAuth\(/, `${file} must not call getAuth(): on phones it loads apis.google.com on every page`);
    assert.doesNotMatch(src, /popupRedirectResolver|browserPopupRedirectResolver/,
      'the app signs in with email and password only; the pop-up resolver is what loads apis.google.com');
  });

  test(`⚠⚠ ${file} keeps getAuth()'s persistence list, in its order — or every phone is signed out`, () => {
    const call = code(file).match(/initializeAuth\(\s*app\s*,\s*\{([\s\S]*?)\}\s*\)/);
    assert.ok(call, `${file}: initializeAuth(app, { … }) not found`);
    const list = call[1].match(/persistence:\s*\[([^\]]*)\]/);
    assert.ok(list, `${file}: initializeAuth must be given a persistence list`);
    assert.deepEqual(list[1].split(',').map(s => s.trim()).filter(Boolean), GET_AUTH_DEFAULT);
  });
}

test('no file loads App Check (reCAPTCHA): removed by decision, 26 Sep 2026', () => {
  const offenders = everyJsFile(join(ROOT, 'js'))
    .filter(abs => /firebase-app-check\.js|initializeAppCheck|ReCaptcha(V3|Enterprise)Provider/.test(readFileSync(abs, 'utf8')))
    .map(asPosix);
  assert.deepEqual(offenders, [],
    'App Check is back: that is a decision (speed vs protection), and it also needs www.google.com back in every page\'s CSP');
});

test('no page\'s security policy still lets www.google.com run scripts or frames', () => {
  const pages = readdirSync(ROOT).filter(f => f.endsWith('.html'));
  const offenders = pages.filter(f => /Content-Security-Policy/.test(read(f)) && /www\.google\.com/.test(read(f)));
  assert.deepEqual(offenders, [], 'only reCAPTCHA needed www.google.com; a policy wider than the app is an open door');
});
