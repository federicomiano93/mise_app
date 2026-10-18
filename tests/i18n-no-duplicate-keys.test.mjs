// Two guards on the interface dictionary that a passing glance cannot give.
//
// ⚠️ A KEY WRITTEN TWICE IN ONE LANGUAGE IS SILENT. `js/i18n.js` is an object
// literal: JavaScript keeps the LAST definition and says nothing, so the first one
// is dead text that looks alive. That is how the recipe screen's Procedure card
// lost its list: `cat.notInAnyStep` was «Not in any step: {list}» for the card and,
// 250 lines later, the guided run's «Not in any step — check these went in:» title,
// with no {list}. The second won, and the card said «not in any step» without
// saying WHICH ingredients — the one sentence of the safety net that matters.
// The duplicates only exist in the source text, so this suite reads the text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LANGUAGES, setLanguage, currentLanguage, t, _dictionaries } from '../js/i18n.js';
import { unassignedRows } from '../js/catalogue/guided-model.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Every top-level key of each language block, in source order, with its line.
// A block opens with `  en: Object.freeze({` and closes with `  }),`; its keys sit
// at four spaces (a plural entry's `one:` / `other:` sit deeper and are skipped),
// sometimes several to a line (`'day.weekdayShort.0': 'Sun', 'day.weekdayShort.1': …`).
function keysInSource() {
  const lines = read('js/i18n.js').split(/\r?\n/);
  const out = {};
  let lang = null;
  lines.forEach((line, i) => {
    const open = line.match(/^ {2}([a-z]{2}): Object\.freeze\(\{/);
    if (open) { lang = open[1]; out[lang] = []; return; }
    if (lang && /^ {2}\}\),?\s*$/.test(line)) { lang = null; return; }
    if (!lang || !/^ {4}'/.test(line)) return;
    for (const key of line.matchAll(/(?:^ {4}|,\s*)'([^']+)':/g)) out[lang].push({ key: key[1], line: i + 1 });
  });
  return out;
}

test('the source reader sees every key of every language', () => {
  // Proves the reader below is not passing because it found nothing: the keys it
  // reads from the text are exactly the keys the dictionary holds.
  const found = keysInSource();
  assert.deepEqual(Object.keys(found).sort(), [...LANGUAGES].sort());
  for (const lang of LANGUAGES) {
    assert.deepEqual(new Set(found[lang].map(k => k.key)), new Set(Object.keys(_dictionaries()[lang])),
      `the text of the «${lang}» block and its dictionary disagree — the reader in this test needs updating`);
  }
});

test('no key is defined twice in a language', () => {
  for (const [lang, keys] of Object.entries(keysInSource())) {
    const first = new Map();
    const twice = [];
    for (const { key, line } of keys) {
      if (first.has(key)) twice.push(`${key} (lines ${first.get(key)} and ${line})`);
      else first.set(key, line);
    }
    assert.deepEqual(twice, [],
      `«${lang}» defines these keys twice; only the LAST one is ever shown — give each use its own key: ${twice.join(', ')}`);
  }
});

// ── The Procedure card names what is in no step ──────────────────────────────

function withLanguage(lang, fn) {
  const before = currentLanguage();
  try { setLanguage(lang); fn(); } finally { setLanguage(before); }
}

test('the Procedure card\'s warning lists the ingredients that are in no step, in every language', () => {
  const recipe = {
    ingredients: [
      { rid: 'ra', label: 'Flour', grams: 1000, unit: 'g' },
      { rid: 'rb', label: 'Salt', grams: 20, unit: 'g' },
      { rid: 'rc', label: 'Malt', grams: 10, unit: 'g' },
    ],
    steps: [{ text: 'Mix', seconds: 0, rows: ['ra'] }],
  };
  // The card's own sentence, built the way guidedPanel builds it.
  const missed = unassignedRows(recipe);
  for (const lang of LANGUAGES) {
    withLanguage(lang, () => {
      const sentence = t('cat.notInAnyStep', { list: missed.map(r => r.label).join(', ') });
      assert.match(sentence, /Salt, Malt/, `«${lang}»: the card must say WHICH rows — got «${sentence}»`);
      assert.doesNotMatch(sentence, /\{list\}/);
    });
  }
});

test('the card and the run\'s finish card ask for their own keys', () => {
  const detail = codeOf(read('js/catalogue/catalogue-detail.js'));
  const run = codeOf(read('js/catalogue/guided-run.js'));
  assert.match(detail, /t\('cat\.notInAnyStep', \{ list: missed\.map\(r => r\.label\)\.join\(', '\) \}\)/,
    'the Procedure card passes the rows to cat.notInAnyStep');
  // The finish card draws the rows UNDER its title, so its title takes no list.
  assert.match(run, /t\('cat\.notInAnyStepCheck'\)/);
  assert.doesNotMatch(run, /t\('cat\.notInAnyStep'\)/);
  for (const lang of LANGUAGES) {
    assert.doesNotMatch(_dictionaries()[lang]['cat.notInAnyStepCheck'], /\{list\}/);
  }
});

// The general shape of the defect: a call that hands t() a list to a phrase that
// has nowhere to put it. Every `t('key', { list: … })` in the app must reach a
// phrase holding {list} in every language.
test('every phrase handed a {list} has a place for it', () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(join(ROOT, rel)).isDirectory()) { if (name !== 'vendor') walk(rel); }
      else if (name.endsWith('.js') && rel !== 'js/i18n.js') files.push(rel);
    }
  };
  walk('js');
  const asked = new Set();
  for (const file of files) {
    for (const m of codeOf(read(file)).matchAll(/\bt\('([^']+)',\s*\{\s*list:/g)) asked.add(m[1]);
  }
  assert.ok(asked.has('cat.notInAnyStep'), 'the scan finds the Procedure card\'s call');
  const holes = [];
  for (const key of asked) {
    for (const lang of LANGUAGES) {
      const value = _dictionaries()[lang][key];
      const forms = typeof value === 'string' ? [value] : Object.values(value || {});
      if (!forms.length || forms.some(f => !f.includes('{list}'))) holes.push(`${lang} ${key}`);
    }
  }
  assert.deepEqual(holes, []);
});
