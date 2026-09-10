// The Firebase SDK is not installed, it is FETCHED — every data layer names a
// full gstatic URL with the version inside it, in 14 files. That makes an upgrade
// a find-and-replace across the repo, and find-and-replace is exactly the kind of
// job that leaves one file behind.
//
// ⚠️ ONE FILE LEFT BEHIND IS NOT A SMALL PROBLEM, AND IT IS INVISIBLE HERE.
// Two versions of the SDK loaded into one page do not merge: the second
// initializeApp() registers its components against a different internal registry,
// and the app dies at runtime with "Service firestore is not available" — a
// message that names no file and points at no version. It is a real, reported
// failure mode (firebase-js-sdk#9360), and it would reach a phone, because
// nothing in this repo compiles or bundles these imports: every other test reads
// the app as SOURCE, and a stale URL is perfectly valid source.
//
// So this pins the one property that keeps the upgrade honest: EVERY gstatic URL
// in the app names the SAME version, whatever that version is. It deliberately
// does not name a version itself — a test that has to be edited on every upgrade
// is a test that gets edited without being read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const read = (abs) => readFileSync(abs, 'utf8');
const asPosix = (abs) => relative(ROOT, abs).split(sep).join('/');

// Everything the browser can load: the app's own modules and the pages. Anything
// under node_modules, .git or the vendored library is not ours to police.
function everySourceFile(dir) {
  return readdirSync(dir).flatMap((entry) => {
    if (['node_modules', '.git', 'vendor', 'icons', 'fonts'].includes(entry)) return [];
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) return everySourceFile(abs);
    return /\.(js|html|mjs)$/.test(entry) ? [abs] : [];
  });
}

// A full URL, so a bare "/firebasejs/" path guard in sw.js is not mistaken for one.
const SDK_URL = /https:\/\/www\.gstatic\.com\/firebasejs\/(\d+\.\d+\.\d+)\/firebase-[a-z-]+\.js/g;

function everySdkReference() {
  const found = [];
  for (const abs of everySourceFile(ROOT)) {
    const file = asPosix(abs);
    // This test file quotes the URL shape in its own regex; it is not a loader.
    if (file === 'tests/firebase-sdk-version.test.mjs') continue;
    for (const m of read(abs).matchAll(SDK_URL)) found.push({ file, version: m[1] });
  }
  return found;
}

test('every Firebase SDK URL in the app names the same version', () => {
  const refs = everySdkReference();

  // A guard on the guard: if this ever finds nothing, the regex has drifted away
  // from how the app loads the SDK and every assertion below passes vacuously.
  assert.ok(refs.length > 20,
    `expected the app to load the SDK from gstatic in many files, found ${refs.length} — ` +
    'if the loading style changed, this test must change with it, not be deleted');

  const versions = [...new Set(refs.map((r) => r.version))];
  if (versions.length > 1) {
    const byVersion = versions
      .map((v) => `  ${v}: ${refs.filter((r) => r.version === v).map((r) => r.file).join(', ')}`)
      .join('\n');
    assert.fail(
      'Two versions of the Firebase SDK are loaded by the same app. In a browser the ' +
      'second one registers against a different component registry and Firestore ' +
      `stops existing at runtime ("Service firestore is not available"):\n${byVersion}`);
  }
});

// ⚠️ THE SDK CACHE IS WHITELISTED IN activate(), WHICH IS THE WHOLE POINT OF THIS
// SECOND CHECK. Every other cache is deleted on the way in when CACHE_NAME moves;
// SDK_CACHE is deliberately spared, so the ~900 KB of SDK modules survive a
// deploy instead of being re-downloaded. The cost of that kindness is that the
// old version's modules are never evicted by anything else — an upgrade that
// changes the URLs but not this name leaves every installed phone carrying both
// copies for ever, growing by one SDK on every upgrade.
//
// Renaming it is what throws the old copy away. Nobody would notice forgetting:
// the app works perfectly either way.
test('the service worker names its SDK cache after the version it actually loads', () => {
  const sw = read(join(ROOT, 'sw.js'));

  const cacheName = sw.match(/const SDK_CACHE = '([^']+)'/)?.[1];
  assert.ok(cacheName, 'sw.js no longer declares SDK_CACHE');

  const versions = [...new Set(everySdkReference().map((r) => r.version))];
  assert.equal(versions.length, 1, 'resolve the mixed versions above first');

  const expected = `firebase-sdk-${versions[0].replace(/\./g, '-')}`;
  assert.equal(cacheName, expected,
    `SDK_CACHE is '${cacheName}' but the app loads ${versions[0]}. activate() spares this ` +
    'cache by name, so the previous version\'s modules would stay on every installed ' +
    'phone for ever. Rename it with the upgrade.');
});

// The template must teach the same thing as the real file (P7). It is not loaded
// by the app, so nothing else would ever notice it going stale.
test('firebase.example.js is on the same SDK version as firebase.js', () => {
  const versionsIn = (file) =>
    [...new Set([...read(join(ROOT, file)).matchAll(SDK_URL)].map((m) => m[1]))];

  const real = versionsIn('js/firebase.js');
  const example = versionsIn('js/firebase.example.js');

  assert.deepEqual(example, real,
    'js/firebase.example.js is the file somebody copies to set this project up. ' +
    'Left behind, it teaches an SDK version the app no longer uses.');
});
