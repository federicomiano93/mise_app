// logWords.ts — the dates and the sentences of the import log, in the interface language (pure: the screen hands in `t` and the
// locale). ⚠️ A DAY 'YYYY-MM-DD' IS BUILT AS A LOCAL DATE (`new Date(y, m - 1, d)`): `new Date('2026-03-01')` is midnight UTC and
// would read as 28 February west of Greenwich. A date is never the venue's clock to ask, only to say.

import type { MessageKey } from '../../i18n/en';
import type { MessageParams } from '../../i18n/i18n';
import type { ImportRecord, LogSummary } from './importLog';

export type Say = (key: MessageKey, params?: MessageParams) => string;

const DAY = { day: 'numeric', month: 'short', year: 'numeric' } as const satisfies Intl.DateTimeFormatOptions;
const MONTH = { month: 'long', year: 'numeric' } as const satisfies Intl.DateTimeFormatOptions;

const say = (locale: string, date: Date, options: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat(locale, options).format(date);

// «1 Mar 2026» for '2026-03-01'; the text itself when it is not a day.
export function dayWord(locale: string, day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  return say(locale, new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])), DAY);
}

// The moment a file was imported (ISO), said as a day; '' when it is not a date.
export function momentWord(locale: string, iso: string): string {
  const moment = new Date(iso);
  return Number.isNaN(moment.getTime()) ? '' : say(locale, moment, DAY);
}

// «March 2026» for '2026-03'.
export function monthWord(locale: string, month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  return say(locale, new Date(Number(match[1]), Number(match[2]) - 1, 1), MONTH);
}

export function invoicesWord(t: Say, n: number): string {
  return t('sup.imp.log.invoices', { n });
}

// «Missing: March 2026» / «Missing: from March to May 2026; July 2026».
export function missingWord(t: Say, locale: string, gaps: LogSummary['gaps']): string {
  const word = (gap: LogSummary['gaps'][number]) => (gap.from === gap.to
    ? monthWord(locale, gap.from)
    : t('sup.imp.log.gap', { from: monthWord(locale, gap.from), to: monthWord(locale, gap.to) }));
  const only = gaps.length === 1 ? gaps[0] : undefined;
  if (only && only.from === only.to) return t('sup.imp.log.missingOne', { month: word(only) });
  return t('sup.imp.log.missing', { months: gaps.map(word).join('; ') });
}

// One line of the list of past imports.
export function entryWord(t: Say, locale: string, record: ImportRecord): string {
  const invoices = invoicesWord(t, record.invoiceIds.length);
  const date = momentWord(locale, record.importedAt);
  if (record.firstDate === record.lastDate) {
    return t('sup.imp.log.entryOneDay', { file: record.fileName, date, invoices, day: dayWord(locale, record.firstDate) });
  }
  return t('sup.imp.log.entry', {
    file: record.fileName, date, invoices, from: dayWord(locale, record.firstDate), to: dayWord(locale, record.lastDate),
  });
}
