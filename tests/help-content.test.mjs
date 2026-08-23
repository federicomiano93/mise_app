// Every screen explains itself, and keeps doing so.
//
// These are text tests, which sounds trivial and is not: an explanation is only worth
// having while it is short enough to be read and true enough to be trusted. The checks
// below hold the first of those; the second is a matter of writing, and the test that
// every page HAS one is what stops a new screen shipping without any.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
    // long and explains itself by being that short.
    .filter(f => !['home.html', 'install-guide.html', 'order.html'].includes(f));
}

test('every page of the app carries a help button', () => {
  for (const page of appPages()) {
    const html = read(page);
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

test('nothing in the explanations names a real client or supplier', () => {
  // This repo is public. The texts describe the app, never the business.
  const all = Object.values(HELP).flatMap(e => [e.title, ...e.lines]).join(' ');
  assert.equal(/\b(club fish|bakery ltd|salvo|brakes|caterite|continental|bako|almonds)\b/i.test(all), false);
});
