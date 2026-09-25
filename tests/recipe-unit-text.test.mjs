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
    assert.equal(unitText('pinch'), 'pizz.');
    assert.equal(unitText('pcs'), 'pz');
  });
});

// ⚠️⚠️ THE EDITOR'S UNIT BOX LEAVES 41.2px FOR THE WORD (catalogue.css --unit-w,
// measured in its own 14.4px Manrope — a <select> clips without reporting it). The
// first Italian labels, «cucchiaino» 72.6px and «cucchiaio» 64.0px, both showed as
// «cucch»: a teaspoon and a tablespoon, three times apart, indistinguishable (code
// review, 25 Sep 2026). Measured widths of what ships, so a longer word is a decision:
//   q.b. 24.07 · pz 15.86 · pizz. 30.79 · tbsp 30.30 · tsp 21.85
test('⚠️ every Italian unit label is one that was measured to fit the editor', () => {
  const MEASURED = new Map([['q.b.', 24.07], ['pz', 15.86], ['pizz.', 30.79], ['tbsp', 30.30], ['tsp', 21.85]]);
  inLanguage('it', () => {
    for (const unit of CATALOGUE_UNITS.filter(u => /[a-z]{2}/.test(u) && !/^(mg|ml|cl|dl|kg)$/.test(u))) {
      const label = unitText(unit);
      assert.ok(MEASURED.has(label), `«${label}» (${unit}) was never measured against the 41.2px box`);
      assert.ok(MEASURED.get(label) <= 41.2, `«${label}» does not fit`);
    }
    assert.notEqual(unitText('tsp'), unitText('tbsp'), 'the two spoons must read differently');
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
  // Both of its ingredient lists, asked positively: a deleted call must turn this red.
  assert.match(run, /unitText\('to taste'\) : \(row\.missing \? '' : unitText\(row\.unit\)\)/);
  assert.match(run, /amount === null \? unitText\('to taste'\) : unitText\(unitOf\(row\)\)/);
  assert.match(read('js/catalogue/guided-editor.js'), /unitText\(unitOf\(row\)\)/);
});
