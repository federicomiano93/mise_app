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
// ⚠️ Mise 2's start-up is on the list too: it runs at the SAME origin, on the same IndexedDB, so a
// different persistence list there signs every phone out of BOTH apps.
const LONG_LIVED_AUTH = ['js/firebase.js', 'js/firebase.example.js', 'js/client-orders/firebase-client-orders.js',
  'app/src/session/firebaseBackend.ts'];
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

// Mise 2 (app/, shared/) is TypeScript and imports the SDK from npm, so the same question is asked
// of its own sources.
function everyMise2Source(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) return entry === 'node_modules' || entry === 'dist' ? [] : everyMise2Source(abs);
    return /\.(ts|tsx)$/.test(entry) && !/\.spec\.tsx?$/.test(entry) ? [abs] : [];
  });
}

test('Mise 2 loads no App Check (reCAPTCHA) either', () => {
  const files = [...everyMise2Source(join(ROOT, 'app', 'src')), ...everyMise2Source(join(ROOT, 'shared', 'src'))];
  assert.ok(files.some(f => asPosix(f) === 'app/src/session/firebaseBackend.ts'), 'the scan found no Mise 2 sources — has the layout moved?');
  const offenders = files
    .filter(abs => /firebase\/app-check|initializeAppCheck|ReCaptcha(V3|Enterprise)Provider/.test(readFileSync(abs, 'utf8')))
    .map(asPosix);
  assert.deepEqual(offenders, [], 'App Check is a decision (26 Sep 2026), and it would need www.google.com in the CSP');
});

// ⚠️ THE OTHER TWO THINGS MISE 2 MUST SHARE WITH js/firebase.js, or the two apps on one origin
// disagree: the project chosen by the hostname allowlist (never a hard-coded config), and the
// offline cache shared between tabs. And the emulator only on the local names.
test('Mise 2 picks its project by the hostname allowlist, shares the offline cache between tabs, and uses the emulator only locally', () => {
  const src = code('app/src/session/firebaseBackend.ts');
  assert.match(src, /initializeApp\(configForHost\(hostname\)\)/, 'the config must come from @mise/shared/firebase-target');
  assert.doesNotMatch(src, /apiKey\s*:/, 'no Firebase config may be written into the start-up itself');
  assert.match(src, /persistentLocalCache\(\{\s*tabManager:\s*persistentMultipleTabManager\(\)\s*\}\)/,
    'a second tab would get no cache at all');
  assert.match(src, /const isEmulator = LOCAL_HOSTS\.includes\(hostname\);\s*if \(isEmulator\) \{\s*connectAuthEmulator/,
    'the emulator is connected only on the local names');
});

test('⚠⚠ no Cloud Function enforces App Check: no phone sends a token any more', () => {
  const dir = join(ROOT, 'functions');
  const offenders = readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .filter(f => /enforceAppCheck\s*:\s*true|consumeAppCheckToken\s*:\s*true/.test(
      readFileSync(join(dir, f), 'utf8').replace(/^\s*\/\/.*$/gm, '')))
    .map(f => `functions/${f}`);
  assert.deepEqual(offenders, [],
    'enforcing App Check on a function would refuse every phone: the app sends no token since 26 Sep 2026');
});

test('no page\'s security policy still lets www.google.com run scripts or frames', () => {
  const pages = readdirSync(ROOT).filter(f => f.endsWith('.html'));
  const offenders = pages.filter(f => /Content-Security-Policy/.test(read(f)) && /www\.google\.com/.test(read(f)));
  assert.deepEqual(offenders, [], 'only reCAPTCHA needed www.google.com; a policy wider than the app is an open door');
});
