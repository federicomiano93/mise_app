import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import { format } from '../../i18n/i18n';
import { it as italian } from '../../i18n/it';
import { groupedNumber, peopleText } from './labFormat';

const sayIn = (lang: 'en' | 'it') => (key: 'lab.n.people' | 'lab.n.peopleFraction', params: { n: number | string }) =>
  format(lang, (lang === 'it' ? italian : en)[key], params);

describe('the people the card holds', () => {
  it('are written in the venue number format: 1,5 persone, 1.5 people', () => {
    expect(peopleText(sayIn('it'), 1.5, 'it-IT')).toBe('1,5 persone');
    expect(peopleText(sayIn('en'), 1.5, 'en-GB')).toBe('1.5 people');
  });

  it('keep the singular and plural of a whole number', () => {
    expect(peopleText(sayIn('it'), 1, 'it-IT')).toBe('1 persona');
    expect(peopleText(sayIn('it'), 3, 'it-IT')).toBe('3 persone');
    expect(peopleText(sayIn('en'), 1, 'en-GB')).toBe('1 person');
  });
});

describe('grams with a thousands separator', () => {
  it('groups by hand, in both languages', () => {
    expect(groupedNumber(1234.5, 'it-IT')).toBe('1.234,5');
    expect(groupedNumber(1234.5, 'en-GB')).toBe('1,234.5');
  });
});
