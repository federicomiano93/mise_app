import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import { it as italian } from '../../i18n/it';
import { format } from '../../i18n/i18n';
import type { Language } from '../../i18n/i18n';
import { localeOf } from '../../i18n/i18n';
import type { ImportRecord } from './importLog';
import { dayWord, entryWord, invoicesWord, missingWord, momentWord, monthWord } from './logWords';
import type { Say } from './logWords';

const sayIn = (lang: Language): Say => (key, params) => format(lang, (lang === 'it' ? italian : en)[key], params);
const EN = localeOf('en');
const IT = localeOf('it');

const record = (over: Partial<ImportRecord>): ImportRecord => ({
  id: 'r1', fileName: 'fatture.zip', importedAt: '2026-10-20T12:00:00.000Z', firstDate: '2026-03-01', lastDate: '2026-03-31',
  months: ['2026-03'], invoiceIds: ['a', 'b'], ...over,
});

describe('the import log words', () => {
  it('says a day without the UTC shift (the first of a month stays the first)', () => {
    expect(dayWord(EN, '2026-03-01')).toBe('1 Mar 2026');
    expect(dayWord(IT, '2026-03-01')).toMatch(/^1 mar/);
    expect(dayWord(EN, '2026-01-01')).toBe('1 Jan 2026');
    expect(dayWord(EN, 'nonsense')).toBe('nonsense');
  });

  it('says the import moment as a day, and nothing for a bad one', () => {
    expect(momentWord(EN, '2026-10-20T12:00:00.000Z')).toBe('20 Oct 2026');
    expect(momentWord(EN, '')).toBe('');
  });

  it('says a month in the interface language', () => {
    expect(monthWord(EN, '2026-03')).toBe('March 2026');
    expect(monthWord(IT, '2026-03')).toBe('marzo 2026');
    expect(monthWord(EN, '2026-12')).toBe('December 2026');
  });

  it('counts invoices with the plural of the language', () => {
    expect(invoicesWord(sayIn('en'), 1)).toBe('1 invoice');
    expect(invoicesWord(sayIn('it'), 3)).toBe('3 fatture');
  });

  it('words one missing month, a run of months, and several gaps', () => {
    const t = sayIn('en');
    expect(missingWord(t, EN, [{ from: '2026-04', to: '2026-04' }])).toBe('Missing: April 2026');
    expect(missingWord(t, EN, [{ from: '2026-04', to: '2026-06' }])).toBe('Missing: from April 2026 to June 2026');
    expect(missingWord(t, EN, [{ from: '2026-04', to: '2026-04' }, { from: '2026-07', to: '2026-08' }]))
      .toBe('Missing: April 2026; from July 2026 to August 2026');
    expect(missingWord(sayIn('it'), IT, [{ from: '2026-04', to: '2026-04' }])).toBe('Manca: aprile 2026');
  });

  it('words an entry, with its one-day variant', () => {
    expect(entryWord(sayIn('en'), EN, record({}))).toBe('fatture.zip, 20 Oct 2026 — 2 invoices from 1 Mar 2026 to 31 Mar 2026');
    expect(entryWord(sayIn('en'), EN, record({ lastDate: '2026-03-01', invoiceIds: ['a'] })))
      .toBe('fatture.zip, 20 Oct 2026 — 1 invoice of 1 Mar 2026');
    expect(entryWord(sayIn('it'), IT, record({ lastDate: '2026-03-01' }))).toContain('— 2 fatture del 1 mar');
  });
});
