// Somebody who arrives on an invitation must be shown how to put the app on their
// phone — and nobody else must be shown anything.
//
// THE GAP THIS CLOSES. install-guide.html was reachable from exactly ONE place in the
// whole app: the sign-in screen. Whoever opens an invitation link never sees that
// screen — js/auth-gate.js sends them straight to the join form, deliberately, because
// the sign-in form asks for a password they do not have yet. So the guide existed for
// the new employee and was structurally out of their reach, and they ended up working
// in a browser tab with nothing ever telling them otherwise. Federico reported it on
// 24 Aug 2026: the invitation "doveva essere anche la guida ad istallare l'app".
//
// ⚠️⚠️ AND THE ORDER IS A CONSTRAINT, NOT A PREFERENCE. "Install it first" is the
// natural instruction and it would LOSE the invitation: the code travels in the URL
// fragment, and an installed app always starts from its own start_url with no fragment
// on it. Join first, install second — which is why the offer is made after the join
// and not in the message that carried the link.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { checkInstallHint, markJustJoined, JUST_JOINED_KEY } from '../js/install-hint.js';
import { _dictionaries } from '../js/i18n.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = readFileSync(join(ROOT, 'js', 'auth-gate.js'), 'utf8');
const HOME = readFileSync(join(ROOT, 'index.html'), 'utf8');
const SW = readFileSync(join(ROOT, 'sw.js'), 'utf8');

// A storage that behaves like localStorage, and one that refuses everything the way a
// private window does.
function fakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}
const brokenStorage = {
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
  removeItem() { throw new Error('denied'); },
};

// ── The silences ─────────────────────────────────────────────────────────────

test('nobody who has not just joined is offered anything', () => {
  const r = checkInstallHint({ storage: fakeStorage(), standalone: false });
  assert.equal(r.offer, false, 'the notice would appear to somebody who never joined');
});

// ⚠️ THE ONE THAT WOULD READ AS BROKEN. Somebody who joined from inside the installed
// app has already done the exact thing this asks for; telling them to do it would be
// the app failing to notice where it is running.
test('an app already on the home screen says nothing, and forgets the flag', () => {
  const storage = fakeStorage({ [JUST_JOINED_KEY]: '1' });
  const r = checkInstallHint({ storage, standalone: true });
  assert.equal(r.offer, false, 'the installed app tells you to install it');
  assert.equal(storage.getItem(JUST_JOINED_KEY), null,
    'the flag survives, so the notice waits to ambush them in a browser tab later');
});

test('a storage that refuses everything is a silence, not a crash', () => {
  const r = checkInstallHint({ storage: brokenStorage, standalone: false });
  assert.equal(r.offer, false);
  assert.doesNotThrow(() => r.adopt());
  assert.equal(markJustJoined(brokenStorage), false,
    'markJustJoined reports failure rather than throwing into the join that just succeeded');
});

// ── The one time it speaks ───────────────────────────────────────────────────

test('somebody who has just joined, in a browser, is offered the guide', () => {
  const storage = fakeStorage();
  assert.equal(markJustJoined(storage), true);
  const r = checkInstallHint({ storage, standalone: false });
  assert.equal(r.offer, true, 'the person this whole thing exists for is told nothing');
});

// ⚠️ ONCE. A notice that comes back every morning stops being read, and this one has
// nothing new to say on the second showing.
test('it is spent by adopt(), and never offered again', () => {
  const storage = fakeStorage();
  markJustJoined(storage);
  const first = checkInstallHint({ storage, standalone: false });
  assert.equal(first.offer, true);
  first.adopt();
  assert.equal(checkInstallHint({ storage, standalone: false }).offer, false,
    'the notice returns on the next open');
});

// ⚠️ AND NOT BEFORE. checkInstallHint must NOT clear the flag by itself: the caller
// still has to wait for the Home, the splash and any other dialog, and an app closed
// in that gap would otherwise have spent its one notice without showing it — the
// mistake js/install-version-boot.js records in its own comment about when to adopt.
test('merely asking does not spend it', () => {
  const storage = fakeStorage();
  markJustJoined(storage);
  checkInstallHint({ storage, standalone: false });
  assert.equal(storage.getItem(JUST_JOINED_KEY), '1',
    'asking spent the notice, so an app closed before the dialog appears loses it for good');
});

// ── The wiring ───────────────────────────────────────────────────────────────

test('the join screen carries the guide, like the sign-in screen', () => {
  const at = GATE.indexOf('function joinScreen(');
  assert.notEqual(at, -1, 'joinScreen is gone — has it been renamed?');
  const end = GATE.indexOf('\n// ── The app', at);
  const body = GATE.slice(at, end === -1 ? at + 8000 : end);
  assert.ok(body.length > 500, `joinScreen read as ${body.length} characters — this test cannot see it`);
  assert.match(body, /install-guide\.html/,
    'the screen an invitation lands on has no way to the install guide again');
  assert.match(body, /t\('auth\.installGuide'\)/,
    'the link is there but not named from the dictionary');
});

test('joining marks the flag, and does it before the reload throws the page away', () => {
  const mark = GATE.indexOf('markJustJoined(localStorage)');
  const reload = GATE.indexOf('location.reload()');
  assert.notEqual(mark, -1, 'nothing records that somebody has just joined');
  assert.notEqual(reload, -1, 'the reload after joining is gone — has this flow changed?');
  assert.ok(mark < reload,
    'the flag is written after the reload, which never runs');
});

test('the Home loads the notice, and both files are precached', () => {
  assert.match(HOME, /js\/install-hint-boot\.js/,
    'index.html does not load the notice, so it can never appear');
  for (const file of ['./js/install-hint.js', './js/install-hint-boot.js']) {
    assert.ok(SW.includes(`'${file}'`),
      `${file} is not in the precache list — an offline install would be missing it`);
  }
});

// ── The words ────────────────────────────────────────────────────────────────

test('every sentence exists in both languages and is actually translated', () => {
  const dicts = _dictionaries();
  for (const key of ['install.hint.title', 'install.hint.body', 'install.hint.ok', 'install.hint.later']) {
    assert.ok(dicts.en[key], `${key} is missing from the English dictionary`);
    assert.ok(dicts.it[key], `${key} is missing from the Italian dictionary`);
    assert.notEqual(dicts.en[key], dicts.it[key], `${key}: the Italian is a copy of the English`);
  }
});

// ⚠️ THE MESSAGE MUST STILL CARRY THE LINK, and it must not tell them to install
// first. A sentence that says "install the app, then open this" loses the code: the
// invitation lives in the fragment and an installed app starts without one.
test('the invitation message mentions installing, and keeps the link', () => {
  const dicts = _dictionaries();
  for (const [lang, mentions] of [['en', /add it to your phone/i], ['it', /aggiungerla al telefono/i]]) {
    const message = dicts[lang]['people.link.message'];
    assert.ok(message.includes('{link}'), `${lang}: the message no longer carries the link`);
    assert.ok(message.includes('{venue}'), `${lang}: the message no longer names the business`);
    assert.match(message, mentions, `${lang}: the message says nothing about installing the app`);
    assert.doesNotMatch(message, /^[^:]*install[^:]*first/i,
      `${lang}: the message tells them to install BEFORE opening the link, which loses the code`);
  }
});
