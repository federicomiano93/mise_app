import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { format } from '../i18n/i18n';
import { it as italian } from '../i18n/it';
import type { Language, MessageParams } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import { spellDate } from './spellDate';

const translator = (lang: Language) => (key: MessageKey, params?: MessageParams) =>
  format(lang, (lang === 'it' ? italian : en)[key], params);

describe('spellDate', () => {
  it('spells a date in English, as «Wed 14 Oct»', () => {
    expect(spellDate(translator('en'), '2026-10-14')).toBe('Wed 14 Oct');
  });

  it('spells it in Italian from the same words of the dictionary', () => {
    expect(spellDate(translator('it'), '2026-10-14')).toBe('mer 14 ott');
  });

  it('keeps a one-digit day as it is, with no zero in front', () => {
    expect(spellDate(translator('en'), '2026-08-05')).toBe('Wed 5 Aug');
    expect(spellDate(translator('it'), '2026-08-05')).toBe('mer 5 ago');
  });

  // The first and last of each: Sunday is 0 for getDay(), January is 0 for getMonth().
  it('knows all seven weekdays and all twelve months', () => {
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    // 12 Oct 2026 is a Monday.
    weekdays.forEach((short, offset) => {
      expect(spellDate(translator('en'), `2026-10-${String(12 + offset)}`)).toBe(`${short} ${12 + offset} Oct`);
    });
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    months.forEach((short, index) => {
      const iso = `2026-${String(index + 1).padStart(2, '0')}-01`;
      expect(spellDate(translator('en'), iso)).toMatch(new RegExp(` 1 ${short}$`));
    });
  });

  it('reads the date as the local day, never the one before it', () => {
    // Read as UTC midnight, this would be Tuesday 13 west of Greenwich.
    expect(spellDate(translator('en'), '2026-10-14')).toMatch(/^Wed /);
  });

  it('shows a date nobody can read as it came, rather than a blank card', () => {
    expect(spellDate(translator('en'), 'last tuesday')).toBe('last tuesday');
    expect(spellDate(translator('en'), '2026-13-45')).toBe('2026-13-45');
  });

  it('is empty for no date at all', () => {
    expect(spellDate(translator('en'), '')).toBe('');
    expect(spellDate(translator('en'), undefined as unknown as string)).toBe('');
  });
});
