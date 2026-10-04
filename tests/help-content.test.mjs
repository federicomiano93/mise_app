// Every screen explains itself, and keeps doing so.
//
// These are text tests, which sounds trivial and is not: an explanation is only worth
// having while it is short enough to be read and true enough to be trusted. The checks
// below hold the first of those; the second is a matter of writing, and the test that
// every page HAS one is what stops a new screen shipping without any.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HELP, SECTIONS, helpFor, helpText, helpTitle } from '../js/help-content.js';
import { t, setLanguage } from '../js/i18n.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

// ⚠️ SHORT ENOUGH TO BE READ. A screen-by-screen manual is a thing nobody reads and
// nobody keeps up to date, and an out-of-date explanation is worse than none: it is
// believed. Three to five lines, and a line that reads like a paragraph is too long.
const MIN_LINES = 3;
const MAX_LINES = 5;
// ⚠️⚠️ THIS MEASURES THE SENTENCE, NOT THE KEY, AND IT DID NOT UNTIL v1.70.0. The lines
// used to BE the English text; when they became i18n keys the check kept measuring
// `line.length` — the length of «help.typeTheSellingPrice», never more than 40 — so a
// limit of 130 could not fail whatever anybody wrote. The longest real line today is
// 208 characters (Italian, help.suppliersPasteThePack), and the cap is set from that
// with a little room: the point is to stop a paragraph, not to re-edit what is there.
const MAX_LINE = 240;

test('every section has an explanation, and it is short', () => {
  assert.ok(SECTIONS.length >= 6, `expected the whole app to be covered, got ${SECTIONS.length}`);
  for (const id of SECTIONS) {
    const entry = helpFor(id);
    assert.ok(entry.title && entry.title.length <= 40, `${id}: bad title ${JSON.stringify(entry.title)}`);
    assert.ok(entry.lines.length >= MIN_LINES && entry.lines.length <= MAX_LINES,
      `${id}: ${entry.lines.length} lines — keep it between ${MIN_LINES} and ${MAX_LINES}`);
    entry.lines.forEach((line, i) => {
      assert.ok(line.trim().length > 0, `${id}: line ${i + 1} is empty`);
      assert.equal(line, line.trim(), `${id}: line ${i + 1} has stray spaces at an end`);
    });
  }
});

// ⚠️ AND IN BOTH LANGUAGES. Italian runs longer than English on every screen of this
// app; a limit checked only in English is a limit the Italian walks past.
test('and it is short in the language somebody actually reads', () => {
  for (const lang of ['en', 'it']) {
    setLanguage(lang);
    for (const id of SECTIONS) {
      helpFor(id).lines.forEach((key, i) => {
        const sentence = t(key);
        assert.notEqual(sentence, key,
          `${id}: line ${i + 1} (${key}) has no ${lang} text — t() returned the key itself`);
        assert.ok(sentence.length <= MAX_LINE,
          `${id} [${lang}]: line ${i + 1} is ${sentence.length} chars — over ${MAX_LINE}`);
      });
    }
  }
  setLanguage('en');
});

test('an unknown screen asks for nothing rather than showing an empty box', () => {
  assert.equal(helpFor('nope'), null);
  assert.equal(helpText('nope'), '');
  assert.equal(helpTitle('nope'), '');
  assert.equal(helpFor(undefined), null);
  assert.equal(helpText(null), '');
});

test('the text arrives as paragraphs the dialog can show', () => {
  // .app-dialog-msg is `white-space: pre-line`, so blank lines survive with no markup.
  const text = helpText('calculator');
  assert.match(text, /\n\n/);
  assert.equal(text.includes('\n\n\n'), false, 'no empty paragraph');
  assert.equal(text, text.trim());
});

// ── The half that catches a NEW screen shipping with no explanation ───────────

// Every .js file under js/, found from disk for the same reason the pages are.
function jsFiles(dir = 'js') {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...jsFiles(`${dir}/${entry.name}`));
    else if (entry.name.endsWith('.js')) out.push(`${dir}/${entry.name}`);
  }
  return out;
}

// Every page of the app, found from disk rather than listed here: a list would be the
// thing somebody forgets to add to, which is exactly the failure this test is for.
function appPages() {
  return readdirSync(ROOT)
    .filter(f => f.endsWith('.html'))
    // home.html is a redirect stub for old installed PWAs; install-guide.html is
    // itself an explanation; order.html is the CLIENT's page, which is one screen
    // long and explains itself by being that short; reset-password.html is the same
    // shape — one card with two boxes, reached from an email, no venue open.
    .filter(f => !['home.html', 'install-guide.html', 'order.html', 'reset-password.html'].includes(f));
}

// ⚠️ ONE PAGE KEEPS ITS HELP ONE TAP DEEPER, ON PURPOSE (28 Sep 2026): the Orders
// green bar holds the bell, the order lists and send, and a «?» beside them does not
// fit a 296px phone — so Orders' help is the «Help» row of its Settings. Allowed only
// while that row really calls it.
const HELP_IN_SETTINGS = { 'orders.html': { id: 'orders', file: 'js/orders/management.js' } };

test('the page whose help lives in Settings really opens it from there', () => {
  for (const { id, file } of Object.values(HELP_IN_SETTINGS)) {
    assert.match(read(file), new RegExp(`showHelp\\('${id}'\\)`), `${file} must open the «${id}» help`);
    assert.ok(helpFor(id), `«${id}» must have text`);
  }
});

test('every page of the app carries a help button', () => {
  for (const page of appPages()) {
    const html = read(page);
    if (HELP_IN_SETTINGS[page]) {
      assert.match(html, /js\/help-button\.js|js\/orders\/orders-main\.js/, `${page} loads its scripts`);
      continue;
    }
    assert.match(html, /data-help="[a-z-]+"/,
      `${page} has no data-help host — every screen must be able to explain itself`);
    assert.match(html, /js\/help-button\.js/, `${page} does not load js/help-button.js`);
  }
});

test('every host names a screen that actually has text', () => {
  for (const page of appPages()) {
    for (const [, id] of read(page).matchAll(/data-help="([a-z-]+)"/g)) {
      assert.ok(helpFor(id), `${page} points at "${id}", which has no entry in help-content.js`);
    }
  }
});

test('the two files that must both know about a section agree', () => {
  // A section with text nobody can reach is as useless as a button with no text.
  const hosted = new Set();
  for (const page of appPages()) {
    for (const [, id] of read(page).matchAll(/data-help="([a-z-]+)"/g)) hosted.add(id);
  }
  // ⚠️ AND A HOST CAN BE BUILT IN JAVASCRIPT, since v1.70.0. The three sections of the
  // ingredient card carry their own «?», and that card is an overlay created long
  // after the page loads — mountHelpButtons(root) exists for exactly that. Reading
  // only the .html files would have called those three unreachable while they were on
  // screen, which is the same mistake as judging a screen by its static markup.
  for (const file of jsFiles()) {
    for (const [, id] of read(file).matchAll(/'data-help':\s*'([a-z-]+)'|data-help="([a-z-]+)"/g)) {
      // one alternative or the other matched; take whichever is defined
      hosted.add(id);
    }
    for (const [, id] of read(file).matchAll(/help:\s*'([a-z-]+)'/g)) hosted.add(id);
    // A settings row that opens the help directly (HELP_IN_SETTINGS above).
    for (const [, id] of read(file).matchAll(/showHelp\('([a-z-]+)'\)/g)) hosted.add(id);
  }
  const unreachable = SECTIONS.filter(id => !hosted.has(id));
  assert.deepEqual(unreachable, [],
    `written but reachable from no page: ${unreachable.join(', ')} — add a data-help host, or remove the text`);
});

test('the help is precached, or an offline phone loses it', () => {
  const sw = read('sw.js');
  assert.match(sw, /'\.\/js\/help-content\.js'/);
  assert.match(sw, /'\.\/js\/help-button\.js'/);
});

// This repo is public, so the list of names a help text must never contain cannot be
// readable here: it would publish exactly what it guards. Only the SHA-256 digests of the
// lowercased names are kept; a text is split into words and every 1-word and 2-word run is
// hashed and looked up.
const FORBIDDEN_NAME_HASHES = new Set([
  '4890b0fb9f15499f8e160677b3965dc9b1819f716d91670256adb1864e1dbeaf',
  'a9866a92728178a8c630f5377872f7c5c0d2c62a2a4158e6b768729996b8d000',
  'fbfdc403f3e42b7315f67644dbb78eecf765c869f951136bf3e35b673aeafca4',
  '67c565f1912de6ef87a3a109d5645fbb602bf64ab5f0cb2c261f8687a278a946',
  '9698c413fc6a0ca4b53fb5ae2a97796db329a85fe5d4166ddb122d4975160c0c',
  'ad21acb889da17fe038f780b19e02f0110bbcba66f3248f4912d9f6539919c8f',
  'ef1cab5a69c62e6bef2ee237370ae5b7b0cde4cd820a312114169db5cec1ed92',
]);

const sha256 = s => createHash('sha256').update(s).digest('hex');

function namesFound(text, hashes = FORBIDDEN_NAME_HASHES) {
  const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  const grams = [...words];
  for (let i = 0; i + 1 < words.length; i++) grams.push(`${words[i]} ${words[i + 1]}`);
  return grams.filter(g => hashes.has(sha256(g)));
}

// HELP holds dictionary KEYS; what a person reads is t(key). The guard reads the sentences
// themselves, in every language they are shown in — scanning the keys alone was blind.
test('nothing in the explanations names a real client or supplier', () => {
  const keys = Object.values(HELP).flatMap(e => [e.title, ...e.lines]);
  try {
    for (const lang of ['en', 'it']) {
      setLanguage(lang);
      const all = keys.map(k => t(k)).join(' ');
      assert.ok(all.length > 500, `the ${lang} help text was read`);
      // (The old list also banned «almonds»; read as real sentences, the allergen help
      // rightly names almonds as a nut, so a food word cannot be policed here.)
      assert.deepEqual(namesFound(all), [], lang);
    }
  } finally {
    setLanguage('en');
  }
});

test('the name guard catches a planted name, so it cannot pass by being blind', () => {
  // Proved with FICTIONAL names hashed here, so no real name has to be written down to test it.
  const planted = new Set([sha256('faro'), sha256('gelso bakery')]);
  assert.deepEqual(namesFound('Order from FARO, today.', planted), ['faro']);
  assert.deepEqual(namesFound('Ask Gelso  Bakery first', planted), ['gelso bakery']);
  assert.deepEqual(namesFound('Order from a supplier today.', planted), []);
  assert.equal(FORBIDDEN_NAME_HASHES.size, 7);
});
