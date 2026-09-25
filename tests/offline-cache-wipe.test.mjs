// The offline copy of the data is cleared when the person on the phone changes
// (security audit, 23 Sep 2026).
//
// ⚠️ WHAT WAS WRONG: signing out cleared localStorage and never touched Firestore's
// own offline database, which holds every document the app has read — a manager's
// ingredient prices included. A cache answers with no signal, where the rules are not
// asked, so the next person on a shared phone could read them.
//
// The pure decision is tested by running it; the wiring in js/firebase.js is pinned by
// reading it (it imports the Firebase SDK from a URL the suite cannot load), and the
// behaviour was proved by driving the app against the emulator.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { offlineCacheVerdict, OFFLINE_CACHE_OWNER_KEY, KEEP_PREFIXES, keysToClear } from '../js/local-data.js';
import { _dictionaries } from '../js/i18n.js';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function between(src, startMarker, endMarker, file) {
  const start = src.indexOf(startMarker);
  assert.notEqual(start, -1, `${startMarker} not found in ${file}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `could not find the end of ${startMarker} in ${file}`);
  const body = codeOf(src.slice(start, end));
  assert.ok(body.length > 60, `${startMarker} read as ${body.length} characters — this test can no longer see it`);
  return body;
}

// ── The decision ─────────────────────────────────────────────────────────────

test('whose copy is it: claimed when nobody is recorded, kept for its owner, wiped for anybody else', () => {
  assert.equal(offlineCacheVerdict('', 'u1'), 'claim');
  assert.equal(offlineCacheVerdict(null, 'u1'), 'claim');
  assert.equal(offlineCacheVerdict('u1', 'u1'), 'keep');
  assert.equal(offlineCacheVerdict('u1', 'u2'), 'wipe');
  assert.equal(offlineCacheVerdict('u1', ''), 'keep', 'nobody signed in: nothing to decide');
});

test('the owner survives a venue switch, or the next boot could not tell a new person apart', () => {
  assert.ok(KEEP_PREFIXES.includes(OFFLINE_CACHE_OWNER_KEY));
  assert.deepEqual(keysToClear([OFFLINE_CACHE_OWNER_KEY]), []);
});

// ── The wiring, in the app and in its template ───────────────────────────────

for (const file of ['js/firebase.js', 'js/firebase.example.js']) {
  const src = read(file);

  test(`${file}: sign-out, a venue switch and "forget" clear the offline database before reloading`, () => {
    for (const fn of ['export async function signOutNow', 'export async function switchLocation', 'export async function forgetLocation']) {
      const body = between(src, fn, '\n}\n', file);
      const wipeAt = body.indexOf('await wipeOfflineCache()');
      const reloadAt = body.indexOf('location.reload()');
      assert.ok(wipeAt !== -1, `${fn} does not clear the offline database`);
      assert.ok(reloadAt > wipeAt, `${fn} must finish clearing BEFORE the reload — a reload mid-clear leaves it half done`);
    }
  });

  test(`${file}: the clear stops the client and deletes its database`, () => {
    const body = between(src, 'async function wipeOfflineCache', '\n}\n', file);
    assert.match(body, /await terminate\(db\)/);
    assert.match(body, /await clearIndexedDbPersistence\(db\)/);
    assert.match(body, /catch/, 'a failure must be logged, not thrown: the sign-out still has to happen');
  });

  test(`${file}: somebody else's copy is wiped at BOOT, never in the middle of a page`, () => {
    const body = between(src, 'onAuthStateChanged(auth, user =>', '\n});', file);
    const verdictAt = body.indexOf('offlineCacheVerdict(readCacheOwner(), user.uid)');
    const readAt = body.indexOf('resolveMembership(user)');
    assert.ok(verdictAt !== -1, 'the owner of the offline copy is never asked');
    assert.ok(readAt > verdictAt, 'the question must come BEFORE the first read');
    assert.match(body, /verdict === 'wipe' && atBoot/, 'a join mid-page must not be cut off: boot only');
    // ⚠️ The new owner only after a clear that WORKED, and a failed one tried once per
    // opening — never a page that reloads for ever (code review, 23 Sep 2026).
    assert.match(body, /!wipeFailedThisOpening\(user\.uid\)/);
    assert.match(body, /wipeOfflineCache\(\)\.then\(\(cleared\) => \{\s*if \(cleared\) writeCacheOwner\(user\.uid\);\s*else markWipeFailed\(user\.uid\);\s*location\.reload\(\);/);
  });

  test(`${file}: signing out forgets whose data this is only when the clear worked`, () => {
    const body = between(src, 'export async function signOutNow', '\n}\n', file);
    assert.match(body, /if \(await wipeOfflineCache\(\)\) writeCacheOwner\(''\);/);
    const wipe = between(src, 'async function wipeOfflineCache', '\n}\n', file);
    assert.match(wipe, /return true;/);
    assert.match(wipe, /return false;/);
  });
}

// ── Nothing typed is thrown away without a word ──────────────────────────────

test('every button that leads to a clear asks first when something is still waiting', () => {
  const settings = codeOf(read('js/home-settings.js'));
  assert.equal((settings.match(/await mayLeaveWithUnsent\(confirmDialog\)/g) || []).length, 2,
    'the Home settings sign-out and venue switch must both ask');
  const gate = codeOf(read('js/auth-gate.js'));
  assert.equal((gate.match(/await mayLeaveWithUnsent\(confirmDialog\)\) signOutNow\(\)/g) || []).length, 2,
    'both sign-out buttons on the gate must ask');
  assert.doesNotMatch(gate, /addEventListener\('click', \(\) => \{ signOutNow\(\); \}\)/,
    'a sign-out that skips the question is back');
});

test('the question exists in both languages', () => {
  const dicts = _dictionaries();
  for (const key of ['unsent.title', 'unsent.message', 'unsent.leave', 'unsent.stay']) {
    assert.ok(dicts.en[key], `${key} is missing in English`);
    assert.ok(dicts.it[key], `${key} is missing in Italian`);
    assert.notEqual(dicts.it[key], dicts.en[key], `${key}: the Italian is a copy of the English`);
  }
});

test('the guard is precached, or the Home would not open offline', () => {
  assert.match(read('sw.js'), /'\.\/js\/unsent-guard\.js'/);
});
