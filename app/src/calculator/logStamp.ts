import type { Language } from '../i18n/i18n';

// A dough's «when», shown in the interface language.
//
// ⚠️ THE STORED TEXT STAYS ENGLISH («Tuesday 13 October», «11:11 PM» — shared/src/log-time.ts): the current app and
// Mise 2 read each other's logs until the switch, so what is written must not change. Shown as written, an Italian
// venue read English dates in Dough history (driven on the lab tablet, 13 Oct 2026, beside a header that said
// «martedì 13 ottobre»). So the SCREEN translates: the English names are read back and said again by Intl in the
// interface language, with the 24-hour clock. Anything that does not read as that shape is shown exactly as
// stored — a guess at a date nobody can check is worse than the original words.
const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Every Date here is built in UTC and formatted in UTC, so the device's zone can never move a name by a day.
// The stored text has no year, so the weekday comes from a reference week (1 Jan 2023 was a Sunday) and the month from
// a reference year: only the NAMES are used, never a calendar date.
const formatters = new Map<string, Intl.DateTimeFormat>();
const name = (lang: Language, date: Date, options: Intl.DateTimeFormatOptions): string => {
  const key = `${lang}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(lang, { ...options, timeZone: 'UTC' });
    formatters.set(key, formatter);
  }
  return formatter.format(date);
};

export function localDate(date: string, lang: Language): string {
  if (lang !== 'it') return date;
  const m = /^(\w+) (\d{1,2}) (\w+)$/.exec(date.trim());
  if (!m) return date;
  const day = DAYS_EN.indexOf(m[1] ?? '');
  const month = MONTHS_EN.indexOf(m[3] ?? '');
  if (day < 0 || month < 0) return date;
  const weekday = name(lang, new Date(Date.UTC(2023, 0, 1 + day)), { weekday: 'long' });
  const monthName = name(lang, new Date(Date.UTC(2026, month, 1)), { month: 'long' });
  return `${weekday} ${Number(m[2])} ${monthName}`;
}

export function localTime(time: string, lang: Language): string {
  if (lang !== 'it') return time;
  const m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(time.trim());
  if (!m) return time;
  const hour12 = Number(m[1]);
  if (hour12 < 1 || hour12 > 12) return time;
  const hour = (hour12 % 12) + (m[3] === 'PM' ? 12 : 0);
  return name(lang, new Date(Date.UTC(2026, 0, 1, hour, Number(m[2]))), {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
}
