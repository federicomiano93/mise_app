// The page «Forgot your password?» lands on: reset-password.html + js/reset-password-boot.js
// (draws the card, hands anything it cannot do to Firebase's own page) + js/reset-password.js
// (the real page). Pins the pure helpers, the hand-over, the order of the checks in the form,
// and — by RUNNING the page against a fake Firebase and a small fake DOM — what each outcome
// shows. Also that the code and the email are never logged (P17).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingFromPrecache } from './helpers/precache.mjs';
import { pageScripts } from './helpers/page-scripts.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  readAction, pickLanguage, errorKeyFor, start, REQUIRED_KEYS, DONE_KEY,
} from '../js/reset-password.js';
import { boot, forwardUrl, wordsFor, languageOf, showNeedsUpdate } from '../js/reset-password-boot.js';
import { t, setLanguage, _dictionaries } from '../js/i18n.js';
import { Node, walk } from './helpers/form-dom.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(ROOT, f), 'utf8');
const source = read('js/reset-password.js');
const bootSource = read('js/reset-password-boot.js');
const html = read('reset-password.html');

// ── A DOM just big enough for this page ──────────────────────────────────────

class FakeNode extends Node {
  append(...kids) { kids.forEach(kid => this.appendChild(kid)); }
  // The shared Node derives `type` from its attributes; a page sets the property.
  get type() { return this.attributes.type !== undefined ? this.attributes.type : super.type; }
  set type(value) { this.attributes.type = String(value); }
}

function fakeDocument() {
  const root = new FakeNode('div');
  return {
    root,
    documentElement: { lang: 'en' },
    createElement: tag => new FakeNode(tag),
    getElementById: id => (id === 'auth-gate' ? root : null),
  };
}

const find = (doc, test) => walk(doc.root).find(test);
const byId = (doc, id) => find(doc, n => n.id === id);
const byTag = (doc, tag) => find(doc, n => n.tagName === tag.toUpperCase());
const withText = (doc, text) => find(doc, n => n.children.length === 0 && n.textContent === text);

function fakeStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

function fakeFirebase(over = {}) {
  const calls = { check: [], set: [] };
  return {
    calls,
    isPreview: false,
    checkResetCode: async code => { calls.check.push(code); return 'ana@example.test'; },
    setNewPassword: async (code, password) => { calls.set.push([code, password]); },
    ...over,
  };
}

const LINK = '?mode=resetPassword&oobCode=code-123&apiKey=k&lang=en';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function open({ fb = fakeFirebase(), search = LINK, language = 'en-GB', storage = fakeStorage() } = {}) {
  const doc = fakeDocument();
  await start({ fb, doc, loc: { search }, nav: { language }, storage });
  return { doc, fb, storage };
}

async function submit(doc, first, second) {
  byId(doc, 'reset-password').value = first;
  byId(doc, 'reset-password2').value = second;
  byTag(doc, 'form').fire('submit', { preventDefault() {} });
  await tick();
}

const GOOD = 'a-long-enough-phrase';

// ── Pure helpers ─────────────────────────────────────────────────────────────

test('readAction reads mode and oobCode from the query string', () => {
  assert.deepEqual(
    readAction('?mode=resetPassword&oobCode=abc123&apiKey=k&lang=it&continueUrl=x'),
    { mode: 'resetPassword', code: 'abc123' },
  );
  assert.deepEqual(readAction(''), { mode: '', code: '' });
  assert.deepEqual(readAction(undefined), { mode: '', code: '' });
});

test('the language is always the PHONE\'s — the link\'s lang= is ignored', () => {
  assert.equal(pickLanguage('it-IT'), 'it');
  assert.equal(pickLanguage('en-GB'), 'en');
  assert.equal(pickLanguage('de'), 'en');
  assert.equal(pickLanguage(''), 'en');
  assert.equal(pickLanguage(undefined), 'en');
  assert.doesNotMatch(source, /params\.get\('lang'\)|\.lang\b/, 'nothing may read the link\'s language');
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
  assert.equal(t('reset.retry'), 'Try again');
  assert.equal(t('reset.checkFailed'), 'Could not check the link — check your connection and try again.');
  setLanguage('it');
  assert.equal(t('reset.title'), 'Scegli una nuova password');
  assert.equal(t('reset.for', { email: 'a@b.c' }), 'Per a@b.c');
  assert.equal(t('reset.save'), 'Salva la nuova password');
  assert.equal(t('reset.saving'), 'Salvataggio…');
  assert.equal(t('reset.openMise'), 'Apri Mise');
  assert.equal(t('reset.retry'), 'Riprova');
  assert.equal(t('reset.checkFailed'), 'Non riesco a controllare il link: controlla la connessione e riprova.');
  assert.match(t('reset.badLink'), /“Password dimenticata\?”/);
  setLanguage('en');
});

test('every sentence the page needs is in BOTH dictionaries, so an old one is detectable', () => {
  const dictionaries = _dictionaries();
  for (const key of REQUIRED_KEYS) {
    assert.ok(dictionaries.en[key] !== undefined, `en lacks ${key}`);
    assert.ok(dictionaries.it[key] !== undefined, `it lacks ${key}`);
  }
});

// ── The boot file: draws at once, hands on what it cannot do ─────────────────

test('forwardUrl hands the same query string to Firebase\'s default handler, per project', () => {
  assert.equal(
    forwardUrl('federicomiano93.github.io', '?mode=verifyEmail&oobCode=zz&apiKey=k'),
    'https://bakery-app-ebf90.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=zz&apiKey=k',
  );
  assert.equal(
    forwardUrl('mise-app-preview--pr-1-x.web.app', '?mode=resetPassword&oobCode=zz'),
    'https://mise-app-preview.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=zz',
  );
});

test('on a local server there is no hosted handler to forward to', () => {
  for (const host of ['localhost', '127.0.0.1', '::1', '[::1]']) {
    assert.equal(forwardUrl(host, '?mode=resetPassword&oobCode=zz'), null, host);
  }
});

test('the boot words are English or Italian by the phone, English otherwise', () => {
  assert.equal(wordsFor('it-IT').checking, 'Controllo del link…');
  assert.equal(wordsFor('en-GB').checking, 'Checking your link…');
  assert.equal(wordsFor('fr').checking, 'Checking your link…');
  assert.equal(wordsFor(undefined).checking, 'Checking your link…');
});

test('the boot file\'s own sentences are word for word the dictionary\'s, so they cannot drift', () => {
  const dictionaries = _dictionaries();
  for (const lang of ['en', 'it']) {
    const words = wordsFor(lang);
    assert.equal(words.checking, dictionaries[lang]['reset.checking'], lang);
    assert.equal(words.broken, dictionaries[lang]['reset.unavailable'], lang);
    assert.equal(words.needsUpdate, dictionaries[lang]['reset.needsUpdate'], lang);
  }
});

function bootWith({ hostname = 'federicomiano93.github.io', search = LINK, language = 'en-GB', load }) {
  const doc = fakeDocument();
  const replaced = [];
  const loc = { hostname, search, replace: url => replaced.push(url) };
  const done = boot({ doc, loc, nav: { language }, load });
  return { doc, replaced, done };
}

test('⚠ the card is drawn with «Checking your link…» BEFORE anything is loaded', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { doc, done } = bootWith({ language: 'it-IT', load: async () => { await gate; return { start: async () => {} }; } });
  assert.ok(withText(doc, 'Controllo del link…'), 'the checking line must be on screen at once');
  assert.ok(withText(doc, 'Mise'));
  release();
  await done;
});

test('a loaded page is started, and nothing is forwarded', async () => {
  let started = 0;
  const { replaced, done } = bootWith({ load: async () => ({ start: async () => { started += 1; } }) });
  await done;
  assert.equal(started, 1);
  assert.deepEqual(replaced, []);
});

const NEEDS_UPDATE = {
  en: 'This link needs the latest version of Mise. Open the Mise app, tap “Update now” if it appears, then tap the link in the email again.',
  it: 'Questo link richiede la versione più recente di Mise. Apri l’app Mise, tocca “Aggiorna ora” se compare, poi tocca di nuovo il link nell’email.',
};

test('the needs-update sentence is the agreed wording, and names the button the update prompt really has', () => {
  assert.equal(wordsFor('en').needsUpdate, NEEDS_UPDATE.en);
  assert.equal(wordsFor('it').needsUpdate, NEEDS_UPDATE.it);
  const d = _dictionaries();
  assert.ok(NEEDS_UPDATE.en.includes('“' + d.en['help.updateNow'] + '”'));
  assert.ok(NEEDS_UPDATE.it.includes('“' + d.it['help.updateNow'] + '”'));
});

for (const hostname of ['federicomiano93.github.io', 'localhost']) {
  test(`⚠ a reset whose module fails to load says «update the app» on ${hostname}, never forwarded`, async () => {
    const { doc, replaced, done } = bootWith({ hostname, language: 'it-IT', load: async () => { throw new TypeError('does not provide an export named confirmProblem'); } });
    await done;
    assert.deepEqual(replaced, [], 'Firebase\'s own page cannot work: the API key is referrer-restricted');
    const message = withText(doc, NEEDS_UPDATE.it);
    assert.ok(message);
    assert.equal(message.getAttribute('role'), 'alert');
    assert.equal(message.getAttribute('tabindex'), '-1');
    assert.equal(message.focused, 1);
  });

  test(`⚠ a reset whose start rejects (old firebase.js or dictionary) says «update the app» on ${hostname}`, async () => {
    const { doc, replaced, done } = bootWith({ hostname, load: async () => ({ start: async () => { throw new Error('too old'); } }) });
    await done;
    assert.deepEqual(replaced, []);
    assert.ok(withText(doc, NEEDS_UPDATE.en));
  });
}

// The real dictionary is frozen, so «an old dictionary» is a copy of the page's source wired to a
// stand-in i18n.js whose t() answers with the key itself for one missing sentence — exactly what
// an old precached i18n.js does.
async function pageWithDictionaryMissing(missingKey) {
  const stub = 'data:text/javascript,' + encodeURIComponent(
    `export const t = k => (k === ${JSON.stringify(missingKey)} ? k : 'word');
     export const setLanguage = () => {};
     export const languageFromTag = () => 'en';`);
  const credentials = new URL('../js/credentials.js', import.meta.url).href;
  const code = source
    .replace("'./i18n.js'", JSON.stringify(stub))
    .replace("'./credentials.js'", JSON.stringify(credentials));
  assert.notEqual(code, source);
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
}

test('⚠ a dictionary too old for the page: start() rejects, and through the boot it ends in «update the app»', async () => {
  for (const key of REQUIRED_KEYS) {
    const page = await pageWithDictionaryMissing(key);
    const args = { fb: fakeFirebase(), doc: fakeDocument(), loc: { search: LINK }, nav: { language: 'en-GB' }, storage: fakeStorage() };
    await assert.rejects(page.start(args), /dictionary/, key);
    const doc = fakeDocument();
    const replaced = [];
    await boot({
      doc, loc: { hostname: 'federicomiano93.github.io', search: LINK, replace: u => replaced.push(u) }, nav: { language: 'en-GB' },
      load: async () => ({ start: () => page.start({ ...args, doc }) }),
    });
    assert.deepEqual(replaced, [], key);
    assert.ok(withText(doc, NEEDS_UPDATE.en), key);
  }
});

test('every mode but resetPassword is forwarded without loading the page at all', async () => {
  let loaded = 0;
  const search = '?mode=verifyEmail&oobCode=zz&apiKey=k';
  const { replaced, done } = bootWith({ search, load: async () => { loaded += 1; return { start: async () => {} }; } });
  await done;
  assert.equal(loaded, 0);
  assert.deepEqual(replaced, ['https://bakery-app-ebf90.firebaseapp.com/__/auth/action' + search]);
});

test('another mode on localhost shows the plain «unavailable» message instead of navigating', async () => {
  const { doc, replaced, done } = bootWith({ hostname: 'localhost', search: '?mode=verifyEmail&oobCode=zz', language: 'it-IT', load: async () => ({ start: async () => {} }) });
  await done;
  assert.deepEqual(replaced, []);
  assert.ok(withText(doc, wordsFor('it').broken));
});

test('the boot sets the page language to the phone\'s before any dictionary loads', async () => {
  assert.equal(languageOf('it-IT'), 'it');
  assert.equal(languageOf('fr'), 'en');
  const it = bootWith({ language: 'it-IT', load: async () => ({ start: async () => {} }) });
  assert.equal(it.doc.documentElement.lang, 'it');
  await it.done;
  const en = bootWith({ language: 'de-DE', load: async () => ({ start: async () => {} }) });
  assert.equal(en.doc.documentElement.lang, 'en');
  await en.done;
});

test('the last-resort message never throws, even on a page with nothing to draw into', () => {
  assert.doesNotThrow(() => showNeedsUpdate({ getElementById: () => { throw new Error('no dom'); } }, { language: 'it' }));
  assert.doesNotThrow(() => showNeedsUpdate(undefined, undefined));
});

test('⚠ the boot module RUNS when it is loaded: it draws the card, and a failure ends in the message', async () => {
  const doc = fakeDocument();
  const names = ['document', 'location', 'navigator'];
  const saved = names.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  const define = (k, value) => Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
  define('document', doc);
  define('location', { hostname: 'localhost', search: LINK, replace() { throw new Error('must not forward'); } });
  define('navigator', { language: 'it-IT' });
  try {
    await import('../js/reset-password-boot.js?runs-at-import');
    assert.ok(withText(doc, 'Mise'), 'the card must be drawn by importing the module alone');
    assert.equal(doc.documentElement.lang, 'it');
    // The real page cannot start in Node (no Firebase CDN): exactly a failed load.
    for (let i = 0; i < 100 && !withText(doc, NEEDS_UPDATE.it); i += 1) await tick();
    assert.ok(withText(doc, NEEDS_UPDATE.it), 'never stuck on «Checking your link…»');
  } finally {
    for (const [k, d] of saved) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
  }
});

test('the top-level call is guarded by the environment and has a last-resort catch', () => {
  assert.match(bootSource, /if \(typeof document !== 'undefined' && typeof location !== 'undefined'\) \{\s*boot\(\{ doc: document, loc: location, nav: navigator \}\)\s*\.catch\(\(\) => showNeedsUpdate\(document, navigator\)\);/);
});

// ── The page itself, against a fake Firebase ─────────────────────────────────

test('a good link asks Firebase once, then shows the form for that account', async () => {
  const { doc, fb } = await open();
  assert.deepEqual(fb.calls.check, ['code-123']);
  assert.ok(byTag(doc, 'form'), 'the form must be drawn');
  assert.ok(withText(doc, 'For ana@example.test'));
  assert.equal(byId(doc, 'reset-password').focused, 1, 'the cursor goes to the first box');
});

test('the form carries the marker the update gate waits on', async () => {
  const { doc } = await open();
  assert.ok(byTag(doc, 'form').classList.contains('reset-form'));
  assert.match(read('js/update-gate.js'), /'\.reset-form'/);
});

test('⚠ a password typed twice differently never reaches Firebase', async () => {
  const { doc, fb } = await open();
  await submit(doc, GOOD, GOOD + 'x');
  assert.deepEqual(fb.calls.set, []);
  assert.equal(byId(doc, 'reset-password2').focused, 1, 'the second box gets the cursor');
});

test('a weak password never reaches Firebase either, and the first box gets the cursor', async () => {
  const { doc, fb } = await open();
  await submit(doc, 'short', 'short');
  assert.deepEqual(fb.calls.set, []);
  assert.equal(byId(doc, 'reset-password').focused, 2, 'focused on open and again on the refusal');
});

test('⚠ an expired or used link shows the bad-link state and takes the focus', async () => {
  for (const code of ['auth/expired-action-code', 'auth/invalid-action-code']) {
    const fb = fakeFirebase({ checkResetCode: async () => { const e = new Error('x'); e.code = code; throw e; } });
    const { doc } = await open({ fb });
    const message = withText(doc, t('reset.badLink'));
    assert.ok(message, code);
    assert.equal(message.getAttribute('role'), 'alert');
    assert.equal(message.getAttribute('tabindex'), '-1');
    assert.equal(message.focused, 1, 'focus moves to the message');
    assert.equal(byTag(doc, 'form'), undefined);
  }
});

test('a link with no code at all is a bad link, and Firebase is not asked', async () => {
  const { doc, fb } = await open({ search: '?mode=resetPassword' });
  assert.ok(withText(doc, t('reset.badLink')));
  assert.deepEqual(fb.calls.check, []);
});

test('⚠ success shows the done state, focuses it, and remembers the code for this tab', async () => {
  const { doc, fb, storage } = await open();
  await submit(doc, GOOD, GOOD);
  assert.deepEqual(fb.calls.set, [['code-123', GOOD]]);
  const done = withText(doc, t('reset.done'));
  assert.ok(done);
  assert.equal(done.getAttribute('role'), 'status');
  assert.equal(done.focused, 1);
  assert.ok(withText(doc, 'Open Mise'));
  assert.equal(storage.data[DONE_KEY], 'code-123');
});

test('⚠ a reload after success shows done without asking Firebase — not «link expired»', async () => {
  const storage = fakeStorage({ [DONE_KEY]: 'code-123' });
  const { doc, fb } = await open({ storage });
  assert.ok(withText(doc, t('reset.done')));
  assert.deepEqual(fb.calls.check, []);
  assert.equal(withText(doc, t('reset.badLink')), undefined);
});

test('a remembered success is for THAT code only: another link is checked as usual', async () => {
  const storage = fakeStorage({ [DONE_KEY]: 'an-older-code' });
  const { doc, fb } = await open({ storage });
  assert.deepEqual(fb.calls.check, ['code-123']);
  assert.ok(byTag(doc, 'form'));
});

test('a browser that refuses storage still gets the done state', async () => {
  const storage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  const { doc } = await open({ storage });
  await submit(doc, GOOD, GOOD);
  assert.ok(withText(doc, t('reset.done')));
});

test('a failure while SAVING keeps the «could not save» wording and lets them retry', async () => {
  const fb = fakeFirebase({ setNewPassword: async () => { const e = new Error('x'); e.code = 'auth/network-request-failed'; throw e; } });
  const { doc } = await open({ fb });
  await submit(doc, GOOD, GOOD);
  assert.ok(withText(doc, t('reset.failed')));
  assert.equal(find(doc, n => n.tagName === 'BUTTON' && n.textContent === t('reset.save')).disabled, false);
  assert.equal(withText(doc, t('reset.done')), undefined);
});

test('⚠ a network failure while CHECKING has its own sentence and a retry that asks again', async () => {
  let attempt = 0;
  const fb = fakeFirebase({
    checkResetCode: async code => {
      attempt += 1;
      if (attempt === 1) { const e = new Error('x'); e.code = 'auth/network-request-failed'; throw e; }
      return 'ana@example.test';
    },
  });
  const { doc } = await open({ fb });
  const message = withText(doc, t('reset.checkFailed'));
  assert.ok(message, 'the checking failure must not borrow «could not save»');
  assert.equal(withText(doc, t('reset.failed')), undefined);
  assert.equal(message.focused, 1);
  const retry = find(doc, n => n.tagName === 'BUTTON' && n.textContent === 'Try again');
  assert.ok(retry, 'a Try again button');
  retry.fire('click');
  await tick();
  assert.equal(attempt, 2, 'the retry must ask Firebase again');
  assert.ok(byTag(doc, 'form'), 'and a good answer shows the form');
});

test('an account that is no longer active says so, without a retry', async () => {
  const fb = fakeFirebase({ checkResetCode: async () => { const e = new Error('x'); e.code = 'auth/user-disabled'; throw e; } });
  const { doc } = await open({ fb });
  assert.ok(withText(doc, t('reset.inactive')));
  assert.equal(find(doc, n => n.tagName === 'BUTTON'), undefined);
});

test('the page follows the phone\'s language, in Italian too', async () => {
  const { doc } = await open({ language: 'it-IT' });
  assert.ok(withText(doc, 'Per ana@example.test'));
  setLanguage('en');
});

test('⚠ start refuses, by throwing, when firebase.js is too old to check a code', async () => {
  const fb = { isPreview: false };
  await assert.rejects(start({ fb, doc: fakeDocument(), loc: { search: LINK }, nav: { language: 'en' }, storage: fakeStorage() }));
});

// ── Source pins ──────────────────────────────────────────────────────────────

test('the form checks the password and the repeat, in that order, before setNewPassword', () => {
  const weak = source.indexOf('passwordProblem(password.value, email)');
  const same = source.indexOf('confirmProblem(password.value, password2.value)');
  const send = source.indexOf('firebase.setNewPassword(code, password.value)');
  assert.ok(weak > 0 && same > weak && send > same, 'order: passwordProblem, confirmProblem, setNewPassword');
  assert.match(source, /password2\.focus\(\)/);
});

test('the person is never signed in by this page', () => {
  assert.doesNotMatch(source, /signIn\(|signInWith|signUp\(/);
});

test('the password boxes are new-password and the username is there for the password manager', () => {
  assert.match(source, /input\.autocomplete = 'new-password'/);
  assert.match(source, /username\.autocomplete = 'username'/);
});

test('nothing logs, and the only navigation is the boot file\'s hand-over', () => {
  assert.doesNotMatch(source, /console\./);
  assert.doesNotMatch(bootSource, /console\./);
  assert.doesNotMatch(source, /location\.(replace|assign|href)/);
  const navigations = bootSource.match(/loc\.(replace|assign|href)[^\n]*/g) || [];
  assert.equal(navigations.length, 1, navigations.join('\n'));
  assert.doesNotMatch(source + bootSource, /firebaseapp\.com|bakery-app|mise-app-preview/,
    'no project is hardcoded: the address comes from firebase-target.js');
});

test('the boot file imports nothing that an older cached release could be missing', () => {
  const imports = [...bootSource.matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1]);
  assert.deepEqual(imports, ['./firebase-target.js']);
  assert.match(bootSource, /import\('\.\/reset-password\.js'\)/, 'the real page is a dynamic import');
});

test('the page loads the BOOT file as a module, plus the update prompt, and no kiosk', () => {
  // The page's one bundle tag, and the scripts that bundle's entry runs, in order.
  assert.match(html, /<script type="module" src="dist\/reset-password\.js"><\/script>/);
  assert.deepEqual(pageScripts(html),
    ['js/i18n-dom.js', 'js/reset-password-boot.js', 'js/sw-update.js']);
  assert.doesNotMatch(html, /src="js\/reset-password\.js"/);
  assert.doesNotMatch(html, /kiosk\.js/);
  assert.ok(!pageScripts(html).includes('js/kiosk.js'));
  assert.match(html, /href="tokens\.css"/);
  assert.match(html, /href="auth\.css"/);
});

test('⚠ the referrer is strict-origin: no-referrer would get the API key refused', () => {
  assert.match(html, /<meta name="referrer" content="strict-origin">/);
  assert.doesNotMatch(html, /content="no-referrer"/);
});

test('the page and both its scripts are precached together', () => {
  const sw = read('sw.js');
  assert.match(sw, /'\.\/reset-password\.html',/);
  assert.match(sw, /'\.\/dist\/reset-password\.js',/);
  assert.deepEqual(missingFromPrecache(['js/reset-password.js', 'js/reset-password-boot.js']), []);
});

test('firebase.js and its example both export the two reset helpers', () => {
  for (const f of ['js/firebase.js', 'js/firebase.example.js']) {
    const s = read(f);
    assert.match(s, /export function checkResetCode\(code\)/, f);
    assert.match(s, /export function setNewPassword\(code, password\)/, f);
    assert.match(s, /verifyPasswordResetCode,\s*\n\s*confirmPasswordReset,/, f);
  }
});

// The first drive showed the form in the browser's Times: this page loads no style.css,
// where the app's body font lives. The page's body carries .auth-page, which sets it.
test('the reset page sets the app font on its body', () => {
  const css = read('auth.css');
  assert.match(html, /<body class="auth-page">/);
  assert.match(css, /\.auth-page \{ font-family: var\(--font\);/);
});

test('⚠ after «Try again» the button is gone and the cursor lands on the «Checking…» line, not the page', async () => {
  let attempt = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const fb = fakeFirebase({
    checkResetCode: async () => {
      attempt += 1;
      if (attempt === 1) { const e = new Error('x'); e.code = 'auth/network-request-failed'; throw e; }
      await gate;
      return 'ana@example.test';
    },
  });
  const { doc } = await open({ fb });
  find(doc, n => n.tagName === 'BUTTON' && n.textContent === 'Try again').fire('click');
  await tick();
  assert.equal(find(doc, n => n.tagName === 'BUTTON'), undefined, 'the retry button is removed');
  const checking = withText(doc, t('reset.checking'));
  assert.ok(checking);
  assert.equal(checking.getAttribute('tabindex'), '-1');
  assert.equal(checking.focused, 1, 'focus must not drop to the body');
  release();
  await tick();
});
