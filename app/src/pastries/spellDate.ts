import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';

type Translate = (key: MessageKey, params?: MessageParams) => string;

// Indexed by getDay() (Sunday is 0) and getMonth(). Written out so every key is checked by the
// compiler: a typo here is a build error, not a blank on a card.
const WEEKDAY_SHORT = [
  'day.weekdayShort.0', 'day.weekdayShort.1', 'day.weekdayShort.2', 'day.weekdayShort.3',
  'day.weekdayShort.4', 'day.weekdayShort.5', 'day.weekdayShort.6',
] as const satisfies readonly MessageKey[];

const MONTH_SHORT = [
  'day.monthShort.0', 'day.monthShort.1', 'day.monthShort.2', 'day.monthShort.3',
  'day.monthShort.4', 'day.monthShort.5', 'day.monthShort.6', 'day.monthShort.7',
  'day.monthShort.8', 'day.monthShort.9', 'day.monthShort.10', 'day.monthShort.11',
] as const satisfies readonly MessageKey[];

// 'Wed 5 Aug' / 'mer 5 ago', in the INTERFACE language. Spelled out by hand from the dictionary's
// own words rather than with toLocaleDateString, so it reads the same on every device and can be
// asserted (the current app does the same, js/pastries/pastries-logs.js).
//
// `${iso}T00:00:00` is local midnight: a date-only string would be read as UTC and could land on
// the day before west of Greenwich. A date nobody can read is shown as it came — better than a
// blank card on the one screen where somebody would notice something is wrong.
export function spellDate(t: Translate, iso: string): string {
  if (typeof iso !== 'string' || iso === '') return '';
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  const weekday = WEEKDAY_SHORT[date.getDay()];
  const month = MONTH_SHORT[date.getMonth()];
  if (weekday === undefined || month === undefined) return iso;
  return t('day.spelledNoYear', { weekday: t(weekday), d: String(date.getDate()), month: t(month) });
}
