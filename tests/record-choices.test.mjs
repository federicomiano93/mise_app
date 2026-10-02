import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  categoryChoices, unitChoices, packChoices, countInCategory, categoryValue, isBlankNewChoice, DEFAULT_CATEGORIES, DEFAULT_UNITS, DEFAULT_PACKS,
} from '../js/record-choices.js';

test('a venue that never saved a list gets the defaults of its language', () => {
  for (const stored of [undefined, null, 'x', {}]) {
    assert.deepEqual(categoryChoices({ stored, ingredients: [], language: 'it' }), ['Panetteria', 'Pasticceria', 'Vendita']);
  }
  assert.deepEqual(categoryChoices({ stored: null, ingredients: [], language: 'en' }), ['Bakery', 'Pastry', 'Retail']);
});

test('an unknown or missing language falls back to English', () => {
  assert.deepEqual(categoryChoices({ stored: null, language: null }), ['Bakery', 'Pastry', 'Retail']);
  assert.ok(unitChoices({ language: undefined }).includes('case'));
});

test('an empty stored list is used as-is: no defaults come back', () => {
  assert.deepEqual(categoryChoices({ stored: [], ingredients: [], language: 'it' }), []);
});

test('categories in use are added; a suggestion gives way to an in-use spelling, two in-use spellings both stay', () => {
  const ingredients = [{ category: 'dairy' }, { category: ' Dairy ' }, { category: 'Other' }, { category: '' }, {}, null, { category: 'Eggs' }];
  assert.deepEqual(
    categoryChoices({ stored: ['Dairy', ' Flour '], ingredients, language: 'en' }),
    ['dairy', 'Dairy', 'Eggs', 'Flour'],
  );
  // The stored list's «Dairy» is only a suggestion: the in-use «dairy» replaces it.
  assert.deepEqual(categoryChoices({ stored: ['Dairy'], ingredients: [{ category: 'dairy' }] }), ['dairy']);
});

test('the current category keeps its exact spelling even when a suggestion differs in case', () => {
  assert.deepEqual(categoryChoices({ stored: ['Farine'], current: 'farine', ingredients: [] }), ['farine']);
  assert.deepEqual(categoryChoices({ stored: ['a'], current: 'A' }), ['A']);
  const both = categoryChoices({ stored: [], current: 'farine', ingredients: [{ category: 'Farine' }] });
  assert.deepEqual(both, ['farine', 'Farine']);
});

test('the current category is always offered; "Other" is none and never offered', () => {
  assert.deepEqual(categoryChoices({ stored: ['A'], current: 'Zeta' }), ['A', 'Zeta']);
  assert.deepEqual(categoryChoices({ stored: ['A'], current: 'Other' }), ['A']);
  assert.equal(categoryValue('Other'), '');
});

test('non-string stored entries are ignored', () => {
  assert.deepEqual(categoryChoices({ stored: ['A', 3, null, ''] }), ['A']);
});

test('units: defaults by language, plus those in use, sorted and deduplicated', () => {
  const it = unitChoices({ ingredients: [{ unit: 'PZ' }, { unit: 'scatola' }, { unit: ' ' }], language: 'it' });
  // «PZ» is in use, so the default «pz» gives way to it and the stored spelling survives.
  const expected = [...DEFAULT_UNITS.it.filter(u => u !== 'pz'), 'PZ', 'scatola'].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(it, expected);
  assert.ok(!it.includes('pz'));
  assert.ok(unitChoices({ language: 'it', current: 'PZ' }).includes('PZ'));
  assert.deepEqual(unitChoices({ language: 'en', current: 'tub' }), [...DEFAULT_UNITS.en, 'tub'].sort((a, b) => a.localeCompare(b)));
});

test('countInCategory matches ignoring case and spaces', () => {
  const list = [{ category: 'Dairy' }, { category: ' dairy ' }, { category: 'Eggs' }, { category: 'Other' }];
  assert.equal(countInCategory(list, 'DAIRY'), 2);
  assert.equal(countInCategory(list, 'Nothing'), 0);
  assert.equal(countInCategory(list, ''), 0);
  assert.equal(DEFAULT_CATEGORIES.it.length, 3);
});

test('isBlankNewChoice: «+ New …» with nothing typed is refused; a real menu choice never is', () => {
  assert.equal(isBlankNewChoice(true, ''), true);
  assert.equal(isBlankNewChoice(true, '   '), true);
  assert.equal(isBlankNewChoice(true, undefined), true);
  assert.equal(isBlankNewChoice(true, 'Tray'), false);
  assert.equal(isBlankNewChoice(false, ''), false);
});

test('packChoices offers the venue-language defaults, sorted', () => {
  const it = packChoices({ language: 'it' });
  assert.deepEqual(it, [...DEFAULT_PACKS.it].sort((a, b) => a.localeCompare(b)));
  assert.ok(packChoices({ language: 'en' }).includes('bag'));
  assert.ok(packChoices({ language: undefined }).includes('bag'));
});

test('packChoices adds words in use, folds a default a used word matches, keeps the current spelling', () => {
  const out = packChoices({
    language: 'it',
    ingredients: [{ packUnit: 'Busta' }, { packUnit: 'stecca' }, { packUnit: ' ' }, {}, null],
    current: 'Trancio',
  });
  assert.ok(out.includes('Busta') && !out.includes('busta'));
  assert.ok(out.includes('stecca') && out.includes('Trancio'));
  assert.equal(out.filter(w => w.toLowerCase() === 'busta').length, 1);
  assert.ok(!out.includes(''));
});

// ── «Confezione: Cartone» words (1 Oct 2026) ─────────────────────────────────
import {
  cartonWordFor, packWordFor, looseUnitFor, pieceWordFor, defaultPackFor,
} from '../js/record-choices.js';

test('the carton word follows the language, English for anything unknown', () => {
  assert.equal(cartonWordFor('it'), 'cartone');
  assert.equal(cartonWordFor('en'), 'case');
  for (const language of [null, undefined, '', 'fr']) assert.equal(cartonWordFor(language), 'case');
});

test('the default package plurals are a table, and a word outside it has none', () => {
  assert.equal(packWordFor('busta', 4, 'it'), 'buste');
  assert.equal(packWordFor('sacco', 2, 'it'), 'sacchi');
  assert.equal(packWordFor('bottiglia', 12, 'it'), 'bottiglie');
  assert.equal(packWordFor('barattolo', 6, 'it'), 'barattoli');
  assert.equal(packWordFor('scatola', 6, 'it'), 'scatole');
  assert.equal(packWordFor('vaschetta', 6, 'it'), 'vaschette');
  assert.equal(packWordFor('pezzo', 50, 'it'), 'pezzi');
  assert.equal(packWordFor('box', 3, 'en'), 'boxes');
  assert.equal(packWordFor('bag', 4, 'en'), 'bags');
  assert.equal(packWordFor('busta', 1, 'it'), 'busta', 'one is the word itself');
  assert.equal(packWordFor(' Busta ', 3, 'it'), 'buste', 'trimmed, case-insensitive');
  assert.equal(packWordFor('sleeve', 4, 'en'), null);
  assert.equal(packWordFor('busta', 4, 'en'), null, 'an Italian word on an English venue is custom');
  assert.equal(packWordFor('', 4, 'it'), null);
  assert.equal(packWordFor(null, 4, 'it'), null);
});

test('every default package word has a plural in both languages', () => {
  for (const language of ['it', 'en']) {
    for (const word of DEFAULT_PACKS[language]) {
      assert.ok(packWordFor(word, 2, language), `${language} ${word}`);
      assert.notEqual(packWordFor(word, 2, language), word, `${language} ${word} must change in the plural`);
    }
  }
});

test('the loose-item order unit words, the piece word and the default package word', () => {
  assert.equal(looseUnitFor('kg', 'it'), 'kg');
  assert.equal(looseUnitFor('l', 'it'), 'l');
  assert.equal(looseUnitFor('pcs', 'it'), 'pz');
  assert.equal(looseUnitFor('pcs', 'en'), 'pcs');
  assert.equal(looseUnitFor('weird', 'it'), '');
  assert.equal(looseUnitFor(null, 'it'), '');
  assert.equal(pieceWordFor('it'), 'pezzo');
  assert.equal(pieceWordFor('en'), 'piece');
  assert.equal(defaultPackFor('it'), 'busta');
  assert.equal(defaultPackFor('en'), 'bag');
  // the words the card writes are words the menus already offer
  assert.ok(DEFAULT_PACKS.it.includes(pieceWordFor('it')) && DEFAULT_PACKS.en.includes(pieceWordFor('en')));
  assert.ok(DEFAULT_UNITS.it.includes(looseUnitFor('pcs', 'it')) && DEFAULT_UNITS.en.includes(looseUnitFor('pcs', 'en')));
});
