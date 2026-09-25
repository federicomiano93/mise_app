// Classes the code USES against classes the stylesheets DEFINE — both directions (P15).
//
// ⚠️ THIS IS THE FOURTH SILENT-CSS FAMILY IN THIS PROJECT. Three undefined custom
// properties, then dead rules nobody could reach (v1.85.1, 40 rules), and the class
// names the code writes onto an element that no stylesheet has ever styled. None of
// them breaks a test or throws; each one is a screen that is quietly not what it was
// written to be, found — when it is found — by somebody looking at a phone.
//
// The audit of 19 Sep 2026 was a script run by hand. This is that script as a test,
// run in both directions on every push.
//
// ⚠️⚠️ «NO FILE NAMES THIS CLASS» DOES NOT MEAN THE CSS IS DEAD. Classes are BUILT at
// run time — from a modifier (`auth-status--${kind}`) or a prefix (`lab-sheet-${role}`,
// which makes the bold name and «Contains» line on every PRINTED LABEL). Two automated
// passes deleted those rules with every test green. So a defined class counts as used
// when ANY hyphen prefix of it is followed, somewhere in the code, by `${` or by a
// closing quote and `+` — and the test proves it still finds those two before a clean
// report is believed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rel = f => f.slice(ROOT.length + 1).replace(/\\/g, '/');

function jsFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'vendor') continue;            // third-party code styles nothing of ours
    const full = join(dir, name);
    if (statSync(full).isDirectory()) jsFiles(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}
const CSS_FILES = readdirSync(ROOT).filter(n => n.endsWith('.css')).map(n => join(ROOT, n));
const HTML_FILES = readdirSync(ROOT).filter(n => n.endsWith('.html')).map(n => join(ROOT, n));
const JS_FILES = jsFiles(join(ROOT, 'js'));
const SOURCES = new Map([...JS_FILES, ...HTML_FILES].map(f => [rel(f), readFileSync(f, 'utf8')]));
const ALL_CODE = [...SOURCES.values()].join('\n');

const NAME = '-?[_a-zA-Z][_a-zA-Z0-9-]*';

// ── What the stylesheets define ─────────────────────────────────────────────────

// The text before each `{` is a selector or an at-rule prelude; declarations end in
// `;` or `}` and never reach a `{`. Comments go first: a class NAMED in a comment is
// not a class defined.
export function selectorsIn(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '{') { out.push(src.slice(start, i)); start = i + 1; }
    else if (src[i] === '}' || src[i] === ';') start = i + 1;
  }
  return out.filter(s => !s.trim().startsWith('@'));
}

export function classesDefinedIn(css) {
  const found = new Set();
  for (const sel of selectorsIn(css)) {
    for (const m of sel.matchAll(new RegExp(`\\.(${NAME})`, 'g'))) found.add(m[1]);
  }
  return found;
}

function definedClasses() {
  const all = new Set();
  const sheets = CSS_FILES.map(f => readFileSync(f, 'utf8'));
  for (const f of HTML_FILES) {
    for (const m of readFileSync(f, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) sheets.push(m[1]);
  }
  for (const css of sheets) for (const c of classesDefinedIn(css)) all.add(c);
  return all;
}

// ── What the code writes onto an element ────────────────────────────────────────

// Only the positions that ASSIGN a class. A template's `${…}` holes are dropped: what
// they build is judged by the prefix rule, and a token left hanging on a hyphen
// (`auth-status--`) is the fixed half of a built name, not a class.
export function classesAssignedIn(src) {
  const found = new Map();
  const add = (text, line) => {
    for (const tok of text.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
      if (!new RegExp(`^${NAME}$`).test(tok) || tok.endsWith('-')) continue;
      if (!found.has(tok)) found.set(tok, line);
    }
  };
  src.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    const at = i + 1;
    for (const m of line.matchAll(/\bclass(?:Name)?\s*[:=]\s*(['"`])((?:(?!\1).)*)\1/g)) add(m[2], at);
    for (const m of line.matchAll(/classList\.(?:add|toggle|replace)\(([^)]*)\)/g)) {
      for (const s of m[1].matchAll(/(['"`])((?:(?!\1).)*)\1/g)) add(s[2], at);
    }
    // The two-argument el(tag, 'class', …) that auth-gate.js and away-screen.js use.
    for (const m of line.matchAll(/\bel\(\s*'[a-z0-9]+'\s*,\s*'([^']*)'/g)) add(m[1], at);
  });
  // Markup: class="…" outside scripts.
  for (const m of src.replace(/<script[\s\S]*?<\/script>/g, '').matchAll(/\bclass="([^"]*)"/g)) {
    add(m[1], src.slice(0, m.index).split('\n').length);
  }
  return found;
}

// A class the code FINDS an element by is a hook, and a hook needs no style: it is
// the handle a script holds. `.name` inside a string, or the two calls that take a
// bare class name.
function classesLookedUp() {
  const found = new Set();
  for (const m of ALL_CODE.matchAll(/(['"`])((?:(?!\1)[^\n])*)\1/g)) {
    for (const c of m[2].matchAll(new RegExp(`(?:^|[\\s>+~,(\\]:*a-zA-Z0-9_-])\\.(${NAME})`, 'g'))) found.add(c[1]);
  }
  for (const m of ALL_CODE.matchAll(new RegExp(`(?:classList\\.(?:contains|remove)|getElementsByClassName)\\(\\s*['"\`](${NAME})['"\`]`, 'g'))) {
    found.add(m[1]);
  }
  return found;
}

// ── Built names ─────────────────────────────────────────────────────────────────

export function builtFromPrefix(cls, code) {
  const parts = cls.split('-');
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join('-') + '-';
    if (code.includes(`${prefix}\${`) || code.includes(`${prefix}' +`)
      || code.includes(`${prefix}" +`) || code.includes(`${prefix}\` +`)) return prefix;
  }
  return null;
}

const mentioned = (cls, code) =>
  new RegExp(`(^|[^a-zA-Z0-9_-])${cls.replace(/-/g, '\\-')}($|[^a-zA-Z0-9_-])`).test(code);

// ── What was already there on 25 Sep 2026 — a list that may only get SHORTER ────
//
// ⚠️ THE ONE REAL DEFECT ON THE FIRST RUN WAS NOT ON THIS LIST: the order editor's
// body said .mgmt-content, which nothing had ever styled, so its text touched both
// edges and a long order could not scroll. It is .mgmt-scroll now, like its siblings.
// These are the names that were judged, one by one, to be harmless — each by the rule
// beside its group. A NEW unstyled class fails the test and has to be decided the same
// way, and the test below makes an entry leave this list the day it is styled or gone.
const KNOWN_UNSTYLED = new Map([
  // A modifier on an element another class already styles; it names what the element is.
  ...['alg-sheet', 'lab-view', 'ing-filter', 'pc-overlay', 'send-chooser', 'home-cards-list',
    'order-field'].map(c => [c, 'a name beside a class that styles the element']),
  // A plain wrapper: block layout is all it needs, its children carry the look.
  ...['cat-cost-host', 'cat-guided-host', 'help-host', 'cp-client-list', 'guided-edit-list',
    'guided-edit-missed', 'guided-body', 'lab-body', 'pas-body', 'missing-list', 'supplier-list',
    'orders-cards', 'history-older'].map(c => [c, 'a wrapper; its children are styled']),
  // Text inside a row the ROW lays out.
  ...['crate-count-val', 'history-item-name', 'cat-photo-setting-label']
    .map(c => [c, 'text laid out by its row']),
  // A state marker whose look comes from elsewhere (the button is also disabled; the
  // svg is sized by its own attributes; nothing in the app styles a signed-in body).
  ...['dirty', 'icon', 'signed-in'].map(c => [c, 'a marker; the look comes from elsewhere']),
]);

// ── The two directions ──────────────────────────────────────────────────────────

test('⚠️ every class the code writes is styled, or is a hook the code looks up', () => {
  const defined = definedClasses();
  const hooks = classesLookedUp();
  const offenders = [];
  for (const [file, src] of SOURCES) {
    for (const [cls, line] of classesAssignedIn(src)) {
      if (!defined.has(cls) && !hooks.has(cls) && !KNOWN_UNSTYLED.has(cls)) offenders.push(`${file}:${line}  .${cls}`);
    }
  }
  assert.deepEqual(offenders, [],
    'each of these is put on an element and nothing styles it or looks it up — a typo, '
    + 'a rule that was renamed, or a leftover. Style it, use the class that exists, or remove it.');
});

test('⚠️ every class a stylesheet defines is written by the code, whole or built', () => {
  const dead = [...definedClasses()].filter(c => !mentioned(c, ALL_CODE) && !builtFromPrefix(c, ALL_CODE));
  assert.deepEqual(dead.sort(), [],
    'no page or script can put these on an element: delete the rules — but first search '
    + 'the code for every hyphen prefix of the name followed by ${ or \' +');
});

test('the list of known unstyled classes only shrinks', () => {
  const defined = definedClasses();
  const hooks = classesLookedUp();
  const assigned = new Set();
  for (const src of SOURCES.values()) for (const cls of classesAssignedIn(src).keys()) assigned.add(cls);
  const stale = [...KNOWN_UNSTYLED.keys()].filter(c => defined.has(c) || hooks.has(c) || !assigned.has(c));
  assert.deepEqual(stale, [],
    'these are styled, looked up or no longer written — take them off KNOWN_UNSTYLED');
});

// ── And the proofs that both scans still see what they must ─────────────────────

test('the prefix rule still finds the two built names that print on every label', () => {
  assert.ok(builtFromPrefix('lab-sheet-name', ALL_CODE), 'lab-sheet-${…} must be found');
  assert.ok(builtFromPrefix('lab-sheet-contains', ALL_CODE), 'lab-sheet-${…} must be found');
  assert.ok(builtFromPrefix('auth-status--error', ALL_CODE), 'auth-status--${…} must be found');
  assert.equal(builtFromPrefix('plain-class', "el('p', { class: 'plain-class' })"), null);
});

test('the dead-rule direction fires on a rule nothing writes', () => {
  const defined = classesDefinedIn('.used-one { color: red; }\n.never-written, .used-one:hover { margin: 0; }');
  const code = "el('p', { class: 'used-one' })";
  const dead = [...defined].filter(c => !mentioned(c, code) && !builtFromPrefix(c, code));
  assert.deepEqual(dead, ['never-written']);
});

test('the undefined direction fires on a class nothing styles, and not on a hook', () => {
  const assigned = classesAssignedIn([
    "el('div', { class: 'mgmt-contnet' })",
    "el('div', { class: `row ${on ? 'is-on' : ''}` })",
    "el('label', 'auth-label', text)",
    "node.classList.add('dirty')",
  ].join('\n'));
  assert.deepEqual([...assigned.keys()].sort(), ['auth-label', 'dirty', 'mgmt-contnet', 'row'].sort());
});

test('a class NAMED in a CSS comment is not a class defined', () => {
  assert.deepEqual([...classesDefinedIn('/* .ghost was here */ .real { color: red; }')], ['real']);
});

test('the scans read the real app, not an empty folder', () => {
  assert.ok(CSS_FILES.length >= 8, `only ${CSS_FILES.length} stylesheets`);
  assert.ok(JS_FILES.length > 150, `only ${JS_FILES.length} scripts`);
  assert.ok(definedClasses().size > 1000, 'the stylesheets were not read');
});
