// ⚠️⚠️ THE QUESTION IS «IS THIS SENTENCE IN THE DICTIONARY?», NOT «IS THIS ONE OF THE
// FIVE SHAPES I KNOW?».
//
// tests/no-hardcoded-english.test.mjs is a good guard and it says its own limit out
// loud: *«it cannot catch every shape a string can be passed in… it catches the two
// that this app actually uses. A third shape will be found the same way this one was —
// by opening the screen in Italian.»* By 23 August 2026 it knew seven shapes, and on
// that day Federico opened Panificio Miano — the first venue with country IT and
// language it — and found the app still speaking English in about a hundred and ninety
// places.
//
// Every one of them was a shape nobody had added:
//
//   setStatus(`${names} — order saved to history ✓`)   a template handed to a helper
//   return `${n} ingredients are not priced yet…`      a sentence RETURNED by a model
//   'aria-label': `Ingredients from ${name}`           an attribute, invisible on screen
//   <title>Orders — Misé</title>                       markup, which nothing scanned
//   toLocaleDateString('en-GB', …)                     not a phrase at all
//
// Adding an eighth shape would buy a week. So this file asks the opposite question and
// takes the false-positive cost: ANY English-looking sentence in the app that is not a
// value in the dictionary is a failure, wherever and however it is written.
//
// ⚠️ THE EXEMPTIONS ARE FEW AND EACH ONE STATES WHY. An exemption list is how a guard
// dies; a list of four files with a reason each is a list somebody has to argue with.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { _dictionaries } from '../js/i18n.js';
import { stringsIn } from './helpers/strings-in.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Every phrase the app is allowed to say, in either language, plural forms included.
const PHRASES = (() => {
  const out = new Set();
  const dicts = _dictionaries();
  for (const lang of Object.keys(dicts)) {
    for (const value of Object.values(dicts[lang])) {
      if (typeof value === 'string') out.add(value);
      else if (value && typeof value === 'object') {
        for (const form of Object.values(value)) if (typeof form === 'string') out.add(form);
      }
    }
  }
  return out;
})();

// ⚠️ FOUR FILES, AND NONE OF THEM COULD BE FIXED BY TRANSLATING IT.
const EXEMPT = new Map([
  ['js/i18n.js', 'it IS the English — both dictionaries live in it'],
  ['js/i18n-dom.js', 'it writes the dictionary into the markup; its own strings are attribute names'],
  // ⚠️ THESE TWO ARE PINNED BYTE-IDENTICAL to their copies in functions/, by
  // tests/copie-allineate.test.mjs. A deploy uploads only that folder, so `../js/`
  // would resolve on this machine and be missing in the cloud: they may not import the
  // dictionary at all. js/join-code.js says so in its own header, and records that the
  // WORDS moved to js/join-link.js where they could be translated.
  // 📌 What is left is real and open: a join code refused by the SERVER shows the
  // server's English, because functions/onboarding.js throws redeemFailureText().
  ['js/join-code.js', 'copied byte-for-byte into functions/ — it cannot reach the dictionary'],
  ['js/push-model.js', 'copied byte-for-byte into functions/ — it cannot reach the dictionary'],
  ['js/firebase.example.js', 'a template for setting the project up, never loaded by a page'],
  // ⚠️ THE LABEL'S OWN WORDS, AND THEY MUST NOT BE IN THE INTERFACE DICTIONARY. What a
  // label says is chosen by the venue's COUNTRY — «Grano», «Frutta a guscio» — and
  // tests/i18n-label-separation.test.mjs forbids this file from importing t() at all,
  // precisely so a screen preference can never move a word on a legal document.
  // It is not unguarded: tests/market.test.mjs asserts it holds words and never
  // sentences, which is a stricter rule than this one.
  ['js/market.js', 'it holds the LABEL words, keyed by country — market.test.mjs guards it'],
]);

function jsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'vendor') continue;            // third-party code is not ours to translate
    const full = join(dir, name);
    if (statSync(full).isDirectory()) jsFiles(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

// ⚠️ A SENTENCE, NOT A WORD. Two or more words AND one of English's own function words
// is what separates «Order saved to history» from a class list, an id or a unit. The
// list is deliberately closed and boring: a cleverer test is one that argues with you.
const FUNCTION_WORD = /\b(the|a|an|is|are|to|of|and|or|you|your|this|that|it|no|not|for|with|be|can|will|has|have|was|were|do|does|its|their|they|we|on|in|at|from|by|if|when|what|which|who|how|any|all|only|yet|still|been|make|made|ago|just|now|left|put|use|used)\b/i;

// Things that are made of words but are not addressed to a person.
function isNotProse(text) {
  return /^[.#[]/.test(text)                                   // a CSS selector
    || /^[a-z]+\.[a-zA-Z0-9.]+$/.test(text)                    // a dictionary key
    || /https?:|^\/|\.js$|\.css$|\.html$|\.png$/.test(text)    // a URL or a path
    || /^[MmLlCcZzHhVvAaSsQqTt][\d\s.,-]/.test(text)           // SVG path data
    || (/^[a-z-]+(\s+[a-z-]+)*$/.test(text) && !/[.!?,·—]/.test(text)); // a class list
}

// ⚠️ A THROW IS THE DEVELOPER'S CHANNEL AND IT SPANS LINES. Skipping the line that
// says `throw` is not enough: js/location.js throws a two-line message, and the second
// line has no `throw` on it. Blanking the whole call — matched parentheses, not a lazy
// regex — is the difference between a guard and a guard that reports its own blind spot
// as a defect. Line numbers are preserved so a real hit still points at the right line.
function blankThrows(src) {
  let out = src;
  const start = /throw new \w*Error\(/g;
  let m;
  while ((m = start.exec(out))) {
    let depth = 0;
    let end = m.index + m[0].length - 1;
    for (let i = end; i < out.length; i++) {
      if (out[i] === '(') depth++;
      else if (out[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    const blanked = out.slice(m.index, end + 1).replace(/[^\r\n]/g, ' ');
    out = out.slice(0, m.index) + blanked + out.slice(end + 1);
    start.lastIndex = end + 1;
  }
  return out;
}

export function englishProse(rel, src) {
  const found = [];
  blankThrows(src).split(/\r?\n/).forEach((line, i) => {
    // The developer's own channel. A console line is read by whoever is debugging,
    // never by a baker, and holding it to the dictionary would put noise in it — the
    // same call english-text.test.mjs already makes.
    if (/console\.(warn|error|log|info|debug)/.test(line)) return;
    for (const raw of stringsIn(line)) {
      const text = raw.replace(/\$\{[^}]*\}/g, '').trim();
      if (text.length < 4) continue;
      if (PHRASES.has(raw.trim()) || PHRASES.has(text)) continue;
      const words = text.split(/\s+/).filter(w => /[A-Za-z]{2}/.test(w));
      if (words.length < 2) continue;
      if (!FUNCTION_WORD.test(text)) continue;
      if (isNotProse(text)) continue;
      found.push(`${rel}:${i + 1}  ${text.slice(0, 100)}`);
    }
  });
  return found;
}

test('⚠️ no sentence reaches a screen without going through the dictionary', () => {
  const found = [];
  for (const file of jsFiles(join(ROOT, 'js'))) {
    const rel = file.slice(ROOT.length + 1).replace(/\\/g, '/');
    if (EXEMPT.has(rel)) continue;
    found.push(...englishProse(rel, readFileSync(file, 'utf8')));
  }
  assert.deepEqual(found, [],
    'each of these is read by a person and is not in js/i18n.js. Give it a key in BOTH '
    + 'languages and pass it through t(). The shape it is written in does not matter — '
    + 'that is the whole point of this file.');
});

// ⚠️ AND IT MUST BE PROVED TO FIRE. A scan that quietly matches nothing passes for ever
// and guards nothing — the trap this project has now fallen into twice (a boolean
// attribute guard built inside a template literal, and a mutation harness that failed
// on a clean tree).
test('the scan finds a sentence whatever shape it is written in', () => {
  const shapes = [
    "  setStatus(`${names} — order saved to history`);",
    "  return `${n} ingredients are not priced yet — this cost is partial`;",
    "  'aria-label': `Ingredients from ${supplier.name}`,",
    "  el('p', { text: 'This cannot be undone.' }),",
    "  const note = 'You only do this once per device.';",
  ];
  for (const shape of shapes) {
    assert.equal(englishProse('x.js', shape).length, 1, `missed: ${shape}`);
  }
});

test('…and leaves alone everything that is not a sentence', () => {
  const quiet = [
    "  const cls = 'supplier-row-view';",
    "  el('div', { class: 'view-switch ing-filter' });",
    "  document.querySelector('[data-os-btn=\"ios\"]');",
    "  console.warn('Recipe did not sync to Firestore:', err);",
    "  throw new Error('No location is open yet — it was read before sign-in.');",
    // ⚠️ THE TWO-LINE THROW, which is the one that caught this scan out.
    "    throw new Error(\n      `No location is open yet — ${name} was read before sign-in completed. ` +\n      'Await sessionReady before touching Firestore.');",
    "  return t('orders.quantitiesCleared');",
    "  const path = 'js/catalogue/label-view.js';",
    "  // The link works once and has 7 days left.",
  ];
  for (const line of quiet) {
    assert.deepEqual(englishProse('x.js', line), [], `false positive: ${line}`);
  }
});

test('a phrase that IS in the dictionary passes, in either language', () => {
  const dicts = _dictionaries();
  const en = dicts.en['orders.tryAgain'];
  const it = dicts.it['orders.tryAgain'];
  assert.ok(en && it && en !== it, 'the fixture phrase must exist in both');
  assert.deepEqual(englishProse('x.js', `  const s = 'This cannot be undone.';`).length, 1,
    'a sentence outside the dictionary is caught');
});

test('the scan reads the app, not an empty folder', () => {
  const files = jsFiles(join(ROOT, 'js'));
  assert.ok(files.length > 80, `only ${files.length} files walked — the walk is broken`);
  assert.ok(PHRASES.size > 1000, `only ${PHRASES.size} phrases loaded — the dictionary is not being read`);
});

// ---------------------------------------------------------------------------
// The markup — which nothing in this project had ever scanned
// ---------------------------------------------------------------------------
//
// ⚠️ tests/i18n-keys-exist.test.mjs checks that every data-i18n key EXISTS. Nothing
// checked whether a piece of text HAS one. So every page title and thirty-five
// aria-labels sat in English through four i18n suites and a full translation release.

// ⚠️ THE PRODUCT'S NAME IS NOT A PHRASE. «Misé» is what the app is called, in every
// language, and a key for it would be an invitation to translate it.
const BRAND = /^(Misé|Mise)$/;

// ⚠️ ONE PAGE, AND IT CANNOT BE TRANSLATED AT ALL. home.html is the redirect stub for
// PWAs installed before index.html existed. Its CSP allows no script whatsoever and it
// refreshes in 0 seconds — there is nothing to run a dictionary, and nobody reads it.
const EXEMPT_PAGES = new Set(['home.html']);

function stripped(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '');
}

export function untranslatedMarkup(src) {
  const clean = stripped(src);
  const found = [];

  // Visible text: an opening tag, then a text node with letters in it.
  const TEXT = /<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>([^<>]*[A-Za-z]{2}[^<>]*)</g;
  let m;
  while ((m = TEXT.exec(clean))) {
    const [, tag, attrs, raw] = m;
    const text = raw.replace(/&[a-z]+;/g, '&').trim();
    if (!text || !/[A-Za-z]{2}/.test(text)) continue;
    if (/\bdata-i18n=/.test(attrs)) continue;
    if (BRAND.test(text)) continue;
    found.push(`<${tag}> ${JSON.stringify(text.slice(0, 70))}`);
  }

  // Attributes a person reads — three of them only ever reach a screen reader, which
  // is exactly why they were the last to be noticed.
  const TAG = /<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  while ((m = TAG.exec(clean))) {
    const [, tag, attrs] = m;
    for (const attr of ['aria-label', 'placeholder', 'alt', 'title']) {
      const value = attrs.match(new RegExp(`\\b${attr}="([^"]*)"`));
      if (!value || !/[A-Za-z]{3}/.test(value[1])) continue;
      if (attrs.includes(`data-i18n-attr="${attr}"`)) continue;
      if (BRAND.test(value[1].trim())) continue;
      found.push(`<${tag} ${attr}="${value[1].slice(0, 60)}">`);
    }
  }
  return found;
}

test('⚠️ every word written into the markup carries a key', () => {
  const offenders = [];
  for (const name of readdirSync(ROOT)) {
    if (!name.endsWith('.html') || EXEMPT_PAGES.has(name)) continue;
    for (const hit of untranslatedMarkup(readFileSync(join(ROOT, name), 'utf8'))) {
      offenders.push(`${name}  ${hit}`);
    }
  }
  assert.deepEqual(offenders, [],
    'add data-i18n (or data-i18n-attr) — the English stays in the markup as the '
    + 'fallback, exactly as js/i18n-dom.js describes, but it must not be the only copy');
});

test('the markup scan finds text and attributes when they are there', () => {
  const page = '<title>Orders — Misé</title><button aria-label="Back"></button><p>Install the app</p>';
  const hits = untranslatedMarkup(page);
  assert.equal(hits.length, 3, hits.join(' | '));
});

test('…and is satisfied by a key, on the text or on the attribute', () => {
  const page = '<title data-i18n="title.orders">Orders — Misé</title>'
    + '<button data-i18n="ui.back" data-i18n-attr="aria-label" aria-label="Back"></button>'
    + '<p data-i18n="ig.installTheApp">Install the app</p>';
  assert.deepEqual(untranslatedMarkup(page), []);
});

test('…and does not fire on the product’s own name', () => {
  assert.deepEqual(untranslatedMarkup('<h1>Misé</h1>'), [],
    'the app is called Misé in every language');
});

test('the markup scan reads real pages', () => {
  const pages = readdirSync(ROOT).filter(n => n.endsWith('.html'));
  assert.ok(pages.length >= 8, `only ${pages.length} pages found`);
  assert.ok(pages.includes('suppliers.html'), 'the newest page must be in scope');
});
