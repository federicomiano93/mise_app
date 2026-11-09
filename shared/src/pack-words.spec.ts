// Tests for the package words «Che confezione è?» adds (Mise 2 only: no original to compare with).
import { describe, expect, test } from 'vitest';
import { EXTRA_PACKS, packChoicesWithExtras, packPlural } from './pack-words';
import { packChoices } from './record-choices';

describe('packPlural', () => {
  test('the default words keep the plural record-choices gives them', () => {
    expect(packPlural('bottiglia', 2, 'it')).toBe('bottiglie');
    expect(packPlural('bottiglia', 1, 'it')).toBe('bottiglia');
    expect(packPlural('Bottle', 3, 'en')).toBe('bottles');
  });

  test('the two added words have a plural, in the venue language', () => {
    expect(packPlural('secchiello', 2, 'it')).toBe('secchielli');
    expect(packPlural('secchiello', 1, 'it')).toBe('secchiello');
    expect(packPlural('latta', 3, 'it')).toBe('latte');
    expect(packPlural('latta', 1, 'it')).toBe('latta');
    expect(packPlural('bucket', 2, 'en')).toBe('buckets');
    expect(packPlural('tin', 5, 'en')).toBe('tins');
    expect(packPlural('tin', 1, 'en')).toBe('tin');
  });

  test('case and stray spaces do not matter', () => {
    expect(packPlural('  Secchiello ', 2, 'it')).toBe('secchielli');
  });

  test('a word of the other language, or any other word, is unknown (null)', () => {
    expect(packPlural('bucket', 2, 'it')).toBeNull();
    expect(packPlural('secchiello', 2, 'en')).toBeNull();
    expect(packPlural('damigiana', 2, 'it')).toBeNull();
    expect(packPlural('', 2, 'it')).toBeNull();
    expect(packPlural(undefined, 2, 'it')).toBeNull();
    expect(packPlural(7, 2, 'it')).toBeNull();
  });

  test('a word that is also a property of every object is unknown, never a function', () => {
    for (const word of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(packPlural(word, 2, 'it')).toBeNull();
      expect(packPlural(word, 1, 'it')).toBeNull();
      expect(packPlural(word, 2, 'en')).toBeNull();
    }
  });

  test('a country with no language reads the English words', () => {
    expect(packPlural('bucket', 2, null)).toBe('buckets');
    expect(packPlural('bottle', 2, undefined)).toBe('bottles');
  });
});

describe('packChoicesWithExtras', () => {
  test('adds the venue-language words to the defaults, sorted', () => {
    const it = packChoicesWithExtras({ language: 'it' });
    expect(it).toContain('secchiello');
    expect(it).toContain('latta');
    expect(it).not.toContain('bucket');
    expect(it).toStrictEqual([...it].sort((a, b) => a.localeCompare(b)));
    expect(packChoicesWithExtras({ language: 'en' })).toEqual(expect.arrayContaining(['bucket', 'tin']));
  });

  test('keeps everything packChoices has, in use or current', () => {
    const ingredients = [{ packUnit: 'damigiana' }];
    const base = packChoices({ ingredients, language: 'it', current: 'fusto' });
    const withExtras = packChoicesWithExtras({ ingredients, language: 'it', current: 'fusto' });
    for (const word of base) expect(withExtras).toContain(word);
    expect(withExtras).toHaveLength(base.length + EXTRA_PACKS.it.length);
  });

  test('a word already in use keeps ITS spelling and is not added twice', () => {
    const list = packChoicesWithExtras({ ingredients: [{ packUnit: 'Secchiello' }], language: 'it' });
    expect(list.filter(word => word.toLowerCase() === 'secchiello')).toStrictEqual(['Secchiello']);
  });

  test('takes no input at all', () => {
    expect(packChoicesWithExtras()).toContain('bucket');
  });
});
