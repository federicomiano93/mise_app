// What a person reads for a recipe unit, and what is stored for it, are two different
// things (P15). Until 25 Sep 2026 they were the same string, so an Italian venue read
// «to taste» and «pinch» beside its salt: the stored value is an identifier compared
// all over js/catalogue/, and could not be translated where it stood.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOGUE_UNITS, unitText } from '../js/catalogue/catalogue-model.js';
import { setLanguage, DEFAULT_LANGUAGE, DATA_WORDS } from '../js/i18n.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function inLanguage(lang, fn) {
  setLanguage(lang);
  try { return fn(); } finally { setLanguage(DEFAULT_LANGUAGE); }
}

test('an Italian venue reads its units in Italian', () => {
  inLanguage('it', () => {
    assert.equal(unitText('to taste'), 'q.b.');
    assert.equal(unitText('pinch'), 'pizzico');
    assert.equal(unitText('pcs'), 'pz');
    assert.equal(unitText('tsp'), 'cucchiaino');
    assert.equal(unitText('tbsp'), 'cucchiaio');
  });
});

test('an English venue reads exactly what it always read', () => {
  inLanguage('en', () => {
    for (const unit of CATALOGUE_UNITS) assert.equal(unitText(unit), unit);
  });
});

test('the metric symbols are the same in every language', () => {
  inLanguage('it', () => {
    for (const unit of ['g', 'kg', 'mg', 'ml', 'cl', 'dl', 'l']) assert.equal(unitText(unit), unit);
  });
});

test('every unit that is a word has its own phrase in Italian', () => {
  inLanguage('it', () => {
    const untranslated = CATALOGUE_UNITS.filter(u => /[a-z]{3}/.test(u) && unitText(u) === u);
    assert.deepEqual(untranslated, [], 'a new word unit needs a cat.unitText key');
  });
});

// ⚠️ THE STORED VALUE NEVER MOVES. A translated identifier is a recipe row whose unit
// stops matching — it would silently fall back to grams (unitOf's default).
test('⚠️ the stored units stay identifiers, protected as data words', () => {
  for (const unit of ['pcs', 'tsp', 'tbsp', 'pinch', 'to taste']) {
    assert.ok(DATA_WORDS.includes(unit), `${unit} must be a DATA_WORD`);
  }
  assert.deepEqual(CATALOGUE_UNITS,
    ['g', 'kg', 'mg', 'ml', 'cl', 'dl', 'l', 'pcs', 'tsp', 'tbsp', 'pinch', 'to taste']);
});

// Every screen that SHOWS a unit asks unitText; the editor's <option> keeps the
// identifier as its value, so what is saved is unchanged.
test('every screen that shows a recipe unit asks unitText', () => {
  const editor = read('js/catalogue/catalogue-editor.js');
  assert.match(editor, /el\('option', \{ value: u \}, unitText\(u\)\)/);
  const detail = read('js/catalogue/catalogue-detail.js');
  assert.match(detail, /unit: unitText\('to taste'\)/);
  assert.match(detail, /unit: unitText\(unit\)/);
  const run = read('js/catalogue/guided-run.js');
  assert.doesNotMatch(run, /\? 'to taste' :/, 'the guided run must not print the identifier');
  assert.match(read('js/catalogue/guided-editor.js'), /unitText\(unitOf\(row\)\)/);
});
