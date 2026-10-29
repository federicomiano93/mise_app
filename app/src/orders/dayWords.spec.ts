import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';

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
