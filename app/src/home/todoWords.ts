import { parseISODate, spellLongDate } from '@mise/shared/day';
import type { DayTranslate } from '@mise/shared/day';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import type { TodoGroup } from './todoModel';

type T = (key: MessageKey, params?: MessageParams) => string;

// The translator the word functions of @mise/shared/day expect. A feature never imports another
// feature's folder (so not orders/dayWords.ts); this is its same few lines. ⚠️ A DATE'S NUMBERS GO
// THROUGH AS PLAIN DIGITS: the translator formats a number for the language, and a year would read «2,026».
function dayTranslate(t: T): DayTranslate {
  return (key, params) => t(key as MessageKey, params === undefined ? undefined : Object.fromEntries(
    Object.entries(params).map(([name, value]) => [name, typeof value === 'number' && name !== 'n' ? String(value) : value]),
  ));
}

// A day without its year, short, for a row that is not under its own day's heading: «Mon 3 Nov».
export function shortDayText(day: string, t: T): string {
  const date = parseISODate(day);
  if (Number.isNaN(date.getTime())) return day;
  const tr = dayTranslate(t);
  return tr('day.spelledNoYear', {
    weekday: tr(`day.weekdayShort.${date.getDay()}`),
    d: date.getDate(),
    month: tr(`day.monthShort.${date.getMonth()}`),
  });
}

// The heading of a day's group: «Today», «Tomorrow», then the day spelled («Monday 10 November»), with a
// capital as a heading has one.
export function dayHeading(group: Extract<TodoGroup, { kind: 'day' }>, t: T): string {
  if (group.offset === 0) return t('day.today');
  if (group.offset === 1) return t('day.tomorrow');
  const spelled = spellLongDate(group.day, dayTranslate(t));
  return spelled.charAt(0).toLocaleUpperCase() + spelled.slice(1);
}
