import { describe, expect, it } from 'vitest';
import { spellDay } from '@mise/shared/day';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { format } from '../i18n/i18n';
import { dayTranslate } from './dayWords';

// Every key the word functions of @mise/shared/day can ask the translator for (shared/src/day.ts). dayWords.ts hands the
// translator through as it is, so a key missing from a dictionary would show up on screen as the bare key.
const DAY_KEYS: readonly string[] = [
  ...Array.from({ length: 7 }, (_, i) => `day.weekdayShort.${i}`),
  ...Array.from({ length: 7 }, (_, i) => `day.weekdayLong.${i}`),
  ...Array.from({ length: 12 }, (_, i) => `day.monthShort.${i}`),
  ...Array.from({ length: 12 }, (_, i) => `day.monthLong.${i}`),
  'day.spelled', 'day.spelledNoYear', 'day.shortDate',
  'day.today', 'day.yesterday', 'day.today.inSentence', 'day.yesterday.inSentence',
  'day.on', 'day.for', 'day.delivery',
];

describe('the day words dayWords.ts relies on', () => {
  it('exist in English', () => {
    expect(DAY_KEYS.filter(key => !(key in en))).toEqual([]);
  });

  it('exist in Italian', () => {
    expect(DAY_KEYS.filter(key => !(key in italian))).toEqual([]);
  });
});

describe('dayTranslate', () => {
  const words = (lang: 'en' | 'it') => dayTranslate((key, params) => format(lang, (lang === 'en' ? en : italian)[key], params));

  it('spells the year as plain digits, not as a quantity («2,026»)', () => {
    expect(spellDay('2026-10-24', words('en'))).toBe('Sat 24 Oct 2026');
    expect(spellDay('2026-10-24', words('it'))).toBe('sab 24 ott 2026');
  });

  it('keeps `n` a number, so a plural still picks its form', () => {
    expect(words('en')('day.inNDays', { n: 1 })).toBe('In 1 day');
    expect(words('en')('day.inNDays', { n: 3 })).toBe('In 3 days');
  });
});
