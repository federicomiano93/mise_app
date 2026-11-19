import { describe, expect, it } from 'vitest';
import { COMMON_FIRST_NAMES, COMMON_SURNAMES } from './commonNames';
import { applyName, foldName, suggestNames } from './nameSuggestions';

const names = (text: string) => suggestNames(text).map(row => row.name);

describe('suggestNames', () => {
  it('starts at two letters, not one', () => {
    expect(names('G')).toEqual([]);
    expect(names('')).toEqual([]);
    expect(names('Gi')[0]).toBe('Giuseppe');
  });

  it('ignores case, accents and apostrophes', () => {
    expect(names('pata')).toContain('Patanè');
    expect(names('dag')).toContain('D\'Agata');
    expect(names('D’ag')).toContain('D\'Agata');
    expect(suggestNames('nico', 20).map(r => r.name)).toContain('Nicolò');
  });

  it('finds a compound surname by its two words joined, and the pick replaces both', () => {
    const rows = suggestNames('Maria Di M');
    const row = rows.find(r => r.name === 'Di Mauro');
    expect(row).toBeDefined();
    expect(rows.some(r => r.name === 'Dimartino')).toBe(false);
    expect(applyName('Maria Di M', row!)).toBe('Maria Di Mauro ');
    expect(names('dima')).toContain('Di Mauro');
  });

  it('first word: first names first, then surnames; later word: surnames first, then first names', () => {
    expect(COMMON_FIRST_NAMES).toContain(suggestNames('Pa')[0]?.name);
    expect(COMMON_SURNAMES).toContain(suggestNames('Mario Pa')[0]?.name);
    expect(names('Pap')[0]).toBe('Pappalardo');
    expect(names('Mario Pap')[0]).toBe('Pappalardo');
    const rows = names('Gi');
    const firstSurnameOnly = rows.findIndex(name => !COMMON_FIRST_NAMES.includes(name));
    const lastFirstName = rows.map(name => COMMON_FIRST_NAMES.includes(name)).lastIndexOf(true);
    if (firstSurnameOnly >= 0) expect(lastFirstName).toBeLessThan(firstSurnameOnly);
  });

  it('fills up with the other list and never shows more than five or the same word twice', () => {
    const rows = names('Ma');
    expect(rows).toHaveLength(5);
    expect(new Set(rows).size).toBe(5);
    expect(suggestNames('Ma', 3)).toHaveLength(3);
    expect(names('Mario Gi').length).toBeGreaterThan(0);
  });

  it('a word already complete gives no row, and a finished word gives nothing', () => {
    expect(names('Giuseppe')).not.toContain('Giuseppe');
    expect(names('Giuseppe ')).toEqual([]);
    expect(names('Giuseppe G')).toEqual([]);
  });

  it('the typed letters are counted for the bold part', () => {
    expect(suggestNames('pata').find(r => r.name === 'Patanè')?.typedLetters).toBe(4);
    expect(suggestNames('D’ag').find(r => r.name === 'D\'Agata')?.typedLetters).toBe(4);
  });
});

describe('applyName', () => {
  it('replaces the typed word, keeps the earlier words and adds one space', () => {
    expect(applyName('Maria Pap', suggestNames('Maria Pap')[0]!)).toBe('Maria Pappalardo ');
    expect(applyName('Giu', suggestNames('Giu')[0]!)).toBe('Giuseppe ');
  });

  it('is cut to the limit', () => {
    expect(applyName('Giu', suggestNames('Giu')[0]!, 5)).toBe('Giuse');
  });
});

describe('commonNames', () => {
  for (const [label, list] of [['first names', COMMON_FIRST_NAMES], ['surnames', COMMON_SURNAMES]] as const) {
    it(`${label}: no exact duplicate, every entry trimmed, non-empty and capitalised`, () => {
      expect(new Set(list).size).toBe(list.length);
      for (const name of list) {
        expect(name).not.toBe('');
        expect(name).toBe(name.trim());
        expect(name.charAt(0)).toBe(name.charAt(0).toUpperCase());
        expect(name.charAt(0)).not.toBe(name.charAt(0).toLowerCase());
      }
    });
  }

  it('foldName strips what matching ignores', () => {
    expect(foldName('D\'Agata')).toBe('dagata');
    expect(foldName('Di Mauro')).toBe('dimauro');
    expect(foldName('Patanè')).toBe('patane');
  });
});
