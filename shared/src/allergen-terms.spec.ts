// Unit tests for the allergen vocabulary (P15). Nothing in tests/ targets js/allergen-terms.js
// directly (its words are exercised through tests/allergen-match.test.mjs, ported to
// allergen-match.spec.ts), so this file pins the port to the original itself:
//   · every exported table deep-equals the original's, word for word and in the same order
//     (a lost word is a missed allergen, and the matching order depends on the list order);
//   · all 26 allergen codes have words in BOTH languages in the port;
//   · the freezing is the original's: the tables and their entries are frozen, the word arrays
//     inside TERMS are plain arrays (parity.spec.ts compares the frozen tree as well).

import { describe, expect, test } from 'vitest';
import * as ported from './allergen-terms';
import * as legacyJs from '../../js/allergen-terms.js';
import { ALLERGENS } from './allergen-model';

const legacy = legacyJs as unknown as typeof ported;

describe('allergen-terms: the port is the original, word for word', () => {
  test('the same exports', () => {
    expect(Object.keys(ported).sort()).toStrictEqual(Object.keys(legacy).sort());
    expect(Object.keys(legacy).sort()).toStrictEqual(['AMBIGUOUS', 'NEGATIVE_PHRASES', 'REMAPS', 'TERMS', 'TRACES_MARKERS']);
  });

  test.each(['TERMS', 'NEGATIVE_PHRASES', 'REMAPS', 'AMBIGUOUS', 'TRACES_MARKERS'] as const)('%s deep-equals the original', (name) => {
    expect(ported[name]).toStrictEqual(legacy[name]);
  });

  test('TERMS keeps the original’s order of codes, and of words inside each language', () => {
    expect(Object.keys(ported.TERMS)).toStrictEqual(Object.keys(legacy.TERMS));
    for (const code of Object.keys(legacy.TERMS)) {
      expect(JSON.stringify(ported.TERMS[code])).toBe(JSON.stringify(legacy.TERMS[code]));
    }
  });

  test('the tables are frozen as the original freezes them', () => {
    for (const [table, original] of [[ported.TERMS, legacy.TERMS], [ported.NEGATIVE_PHRASES, legacy.NEGATIVE_PHRASES],
      [ported.REMAPS, legacy.REMAPS], [ported.AMBIGUOUS, legacy.AMBIGUOUS], [ported.TRACES_MARKERS, legacy.TRACES_MARKERS]] as const) {
      expect(Object.isFrozen(table)).toBe(Object.isFrozen(original));
      expect(Object.isFrozen(table)).toBe(true);
    }
    for (const entry of [...ported.REMAPS, ...ported.AMBIGUOUS, ...Object.values(ported.TERMS)]) expect(Object.isFrozen(entry)).toBe(true);
    for (const langs of Object.values(ported.TERMS)) {
      expect(Object.isFrozen(langs.en)).toBe(false);
      expect(Object.isFrozen(langs.it)).toBe(false);
    }
  });
});

describe('allergen-terms: coverage', () => {
  test('all 26 allergen codes have words in BOTH languages in the port', () => {
    // ⚠️ An English bakery buys Italian-labelled packs, so an English-only entry is a silent gap.
    expect(ALLERGENS.length).toBe(26);
    for (const { code } of ALLERGENS) {
      const entry = ported.TERMS[code];
      expect(entry, code).toBeTruthy();
      expect(entry?.en.length, `${code} en`).toBeGreaterThan(0);
      expect(entry?.it.length, `${code} it`).toBeGreaterThan(0);
    }
    expect(Object.keys(ported.TERMS).length).toBe(26);
  });

  test('the spot words that share no letters with their allergen are all there', () => {
    // The ones the header of the original names as the silent misses.
    const all = (code: string): string[] => [...(ported.TERMS[code]?.en ?? []), ...(ported.TERMS[code]?.it ?? [])];
    expect(all('milk')).toEqual(expect.arrayContaining(['caseinato', 'siero', 'lattosio']));
    expect(all('eggs')).toContain('lisozima');
    expect(all('gluten-wheat')).toContain('semola');
    expect(all('sesame')).toContain('tahina');
    expect(all('sulphites')).toContain('metabisolfito');
    expect(ported.REMAPS.find(r => r.phrase === 'noccioline')?.code).toBe('peanuts');
  });
});
