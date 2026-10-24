// Unit tests for the ingredient card's menu lists (P15), run against BOTH implementations: the
// TypeScript port in shared/ and js/record-choices.js, which the live app uses today. Ported from
// tests/record-choices.test.mjs; the two must stay equal until the switch to Mise 2. The module is
// a FULL port, so parity.spec.ts also compares its exports (names, constants, frozen-ness, shapes).
//
// PORTED: all 16 tests of tests/record-choices.test.mjs — the file is pure, nothing in it reads a
// source file, the DOM or the dictionary. Added below: supplierToSave and the marker (no test in the
// original file), and the frozen tables.

import { describe, expect, test } from 'vitest';
import * as ported from './record-choices';
import * as legacyJs from '../../js/record-choices.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const sorted = (words: readonly string[]): string[] => [...words].sort((a, b) => a.localeCompare(b));

  test('a venue that never saved a list gets the defaults of its language', () => {
    for (const stored of [undefined, null, 'x', {}]) {
      expect(m.categoryChoices({ stored, ingredients: [], language: 'it' })).toStrictEqual(['Panetteria', 'Pasticceria', 'Vendita']);
    }
    expect(m.categoryChoices({ stored: null, ingredients: [], language: 'en' })).toStrictEqual(['Bakery', 'Pastry', 'Retail']);
  });

  test('an unknown or missing language falls back to English', () => {
    expect(m.categoryChoices({ stored: null, language: null })).toStrictEqual(['Bakery', 'Pastry', 'Retail']);
    expect(m.unitChoices({ language: undefined })).toContain('case');
  });

  test('an empty stored list is used as-is: no defaults come back', () => {
    expect(m.categoryChoices({ stored: [], ingredients: [], language: 'it' })).toStrictEqual([]);
  });

  test('categories in use are added; a suggestion gives way to an in-use spelling, two in-use spellings both stay', () => {
    const ingredients = [{ category: 'dairy' }, { category: ' Dairy ' }, { category: 'Other' }, { category: '' }, {}, null, { category: 'Eggs' }];
    expect(m.categoryChoices({ stored: ['Dairy', ' Flour '], ingredients, language: 'en' })).toStrictEqual(['dairy', 'Dairy', 'Eggs', 'Flour']);
    // The stored list's «Dairy» is only a suggestion: the in-use «dairy» replaces it.
    expect(m.categoryChoices({ stored: ['Dairy'], ingredients: [{ category: 'dairy' }] })).toStrictEqual(['dairy']);
  });

  test('the current category keeps its exact spelling even when a suggestion differs in case', () => {
    expect(m.categoryChoices({ stored: ['Farine'], current: 'farine', ingredients: [] })).toStrictEqual(['farine']);
    expect(m.categoryChoices({ stored: ['a'], current: 'A' })).toStrictEqual(['A']);
    const both = m.categoryChoices({ stored: [], current: 'farine', ingredients: [{ category: 'Farine' }] });
    expect(both).toStrictEqual(['farine', 'Farine']);
  });

  test('the current category is always offered; "Other" is none and never offered', () => {
    expect(m.categoryChoices({ stored: ['A'], current: 'Zeta' })).toStrictEqual(['A', 'Zeta']);
    expect(m.categoryChoices({ stored: ['A'], current: 'Other' })).toStrictEqual(['A']);
    expect(m.categoryValue('Other')).toBe('');
  });

  test('non-string stored entries are ignored', () => {
    expect(m.categoryChoices({ stored: ['A', 3, null, ''] })).toStrictEqual(['A']);
  });

  test('units: defaults by language, plus those in use, sorted and deduplicated', () => {
    const it = m.unitChoices({ ingredients: [{ unit: 'PZ' }, { unit: 'scatola' }, { unit: ' ' }], language: 'it' });
    // «PZ» is in use, so the default «pz» gives way to it and the stored spelling survives.
    expect(it).toStrictEqual(sorted([...m.DEFAULT_UNITS.it.filter(u => u !== 'pz'), 'PZ', 'scatola']));
    expect(it).not.toContain('pz');
    expect(m.unitChoices({ language: 'it', current: 'PZ' })).toContain('PZ');
    expect(m.unitChoices({ language: 'en', current: 'tub' })).toStrictEqual(sorted([...m.DEFAULT_UNITS.en, 'tub']));
  });

  test('countInCategory matches ignoring case and spaces', () => {
    const list = [{ category: 'Dairy' }, { category: ' dairy ' }, { category: 'Eggs' }, { category: 'Other' }];
    expect(m.countInCategory(list, 'DAIRY')).toBe(2);
    expect(m.countInCategory(list, 'Nothing')).toBe(0);
    expect(m.countInCategory(list, '')).toBe(0);
    expect(m.DEFAULT_CATEGORIES.it.length).toBe(3);
  });

  test('isBlankNewChoice: «+ New …» with nothing typed is refused; a real menu choice never is', () => {
    expect(m.isBlankNewChoice(true, '')).toBe(true);
    expect(m.isBlankNewChoice(true, '   ')).toBe(true);
    expect(m.isBlankNewChoice(true, undefined)).toBe(true);
    expect(m.isBlankNewChoice(true, 'Tray')).toBe(false);
    expect(m.isBlankNewChoice(false, '')).toBe(false);
  });

  test('packChoices offers the venue-language defaults, sorted', () => {
    expect(m.packChoices({ language: 'it' })).toStrictEqual(sorted(m.DEFAULT_PACKS.it));
    expect(m.packChoices({ language: 'en' })).toContain('bag');
    expect(m.packChoices({ language: undefined })).toContain('bag');
  });

  test('packChoices adds words in use, folds a default a used word matches, keeps the current spelling', () => {
    const out = m.packChoices({
      language: 'it',
      ingredients: [{ packUnit: 'Busta' }, { packUnit: 'stecca' }, { packUnit: ' ' }, {}, null],
      current: 'Trancio',
    });
    expect(out.includes('Busta') && !out.includes('busta')).toBe(true);
    expect(out.includes('stecca') && out.includes('Trancio')).toBe(true);
    expect(out.filter(w => w.toLowerCase() === 'busta').length).toBe(1);
    expect(out).not.toContain('');
  });

  // ── «Confezione: Cartone» words (1 Oct 2026) ───────────────────────────────

  test('the carton word follows the language, English for anything unknown', () => {
    expect(m.cartonWordFor('it')).toBe('cartone');
    expect(m.cartonWordFor('en')).toBe('case');
    for (const language of [null, undefined, '', 'fr']) expect(m.cartonWordFor(language)).toBe('case');
  });

  test('the default package plurals are a table, and a word outside it has none', () => {
    expect(m.packWordFor('busta', 4, 'it')).toBe('buste');
    expect(m.packWordFor('sacco', 2, 'it')).toBe('sacchi');
    expect(m.packWordFor('bottiglia', 12, 'it')).toBe('bottiglie');
    expect(m.packWordFor('barattolo', 6, 'it')).toBe('barattoli');
    expect(m.packWordFor('scatola', 6, 'it')).toBe('scatole');
    expect(m.packWordFor('vaschetta', 6, 'it')).toBe('vaschette');
    expect(m.packWordFor('pezzo', 50, 'it')).toBe('pezzi');
    expect(m.packWordFor('box', 3, 'en')).toBe('boxes');
    expect(m.packWordFor('bag', 4, 'en')).toBe('bags');
    expect(m.packWordFor('busta', 1, 'it'), 'one is the word itself').toBe('busta');
    expect(m.packWordFor(' Busta ', 3, 'it'), 'trimmed, case-insensitive').toBe('buste');
    expect(m.packWordFor('sleeve', 4, 'en')).toBeNull();
    expect(m.packWordFor('busta', 4, 'en'), 'an Italian word on an English venue is custom').toBeNull();
    expect(m.packWordFor('', 4, 'it')).toBeNull();
    expect(m.packWordFor(null, 4, 'it')).toBeNull();
  });

  test('every default package word has a plural in both languages', () => {
    for (const language of ['it', 'en'] as const) {
      for (const word of m.DEFAULT_PACKS[language]) {
        expect(m.packWordFor(word, 2, language), `${language} ${word}`).toBeTruthy();
        expect(m.packWordFor(word, 2, language), `${language} ${word} must change in the plural`).not.toBe(word);
      }
    }
  });

  test('the loose-item order unit words, the piece word and the default package word', () => {
    expect(m.looseUnitFor('kg', 'it')).toBe('kg');
    expect(m.looseUnitFor('l', 'it')).toBe('l');
    expect(m.looseUnitFor('pcs', 'it')).toBe('pz');
    expect(m.looseUnitFor('pcs', 'en')).toBe('pcs');
    expect(m.looseUnitFor('weird', 'it')).toBe('');
    expect(m.looseUnitFor(null, 'it')).toBe('');
    expect(m.pieceWordFor('it')).toBe('pezzo');
    expect(m.pieceWordFor('en')).toBe('piece');
    expect(m.defaultPackFor('it')).toBe('busta');
    expect(m.defaultPackFor('en')).toBe('bag');
    // the words the card writes are words the menus already offer
    expect(m.DEFAULT_PACKS.it.includes(m.pieceWordFor('it')) && m.DEFAULT_PACKS.en.includes(m.pieceWordFor('en'))).toBe(true);
    expect(m.DEFAULT_UNITS.it.includes(m.looseUnitFor('pcs', 'it')) && m.DEFAULT_UNITS.en.includes(m.looseUnitFor('pcs', 'en'))).toBe(true);
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('supplierToSave: the «+ New supplier…» marker never reaches a save', () => {
    expect(m.supplierToSave(m.NEW_SUPPLIER_CHOICE, 'old-id')).toBe('old-id');
    expect(m.supplierToSave('new-id', 'old-id')).toBe('new-id');
    expect(m.supplierToSave('', 'old-id')).toBe('');
    expect(m.NEW_SUPPLIER_CHOICE).toBe('__mise_new_supplier__');
  });

  test('every table is frozen, all the way down', () => {
    for (const table of [m.DEFAULT_CATEGORIES, m.DEFAULT_UNITS, m.DEFAULT_PACKS, m.CARTON_WORD, m.LOOSE_UNIT_WORDS, m.PIECE_WORD]) {
      expect(Object.isFrozen(table)).toBe(true);
    }
    for (const table of [m.DEFAULT_CATEGORIES, m.DEFAULT_UNITS, m.DEFAULT_PACKS, m.LOOSE_UNIT_WORDS]) {
      expect(Object.isFrozen(table.it)).toBe(true);
      expect(Object.isFrozen(table.en)).toBe(true);
    }
  });
});
