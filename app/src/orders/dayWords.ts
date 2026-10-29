import type { DayTranslate } from '@mise/shared/day';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';

// The word functions of @mise/shared/day take the translator as their LAST argument and ask it for keys of the current
// app's dictionary (`day.weekdayShort.N`, `day.shortDate`, `day.for`, `day.delivery`). Mise 2's dictionary carries the same
// keys; `dayWords.spec.ts` fails if one is missing in either language.
export function dayTranslate(t: (key: MessageKey, params?: MessageParams) => string): DayTranslate {
  return (key, params) => t(key as MessageKey, params);
}

// A supplier's stored delivery days are ENGLISH words (data) and must stay so; only the label is looked up. The short
// weekday words are numbered from Sunday = 0, as the dictionary has them.
const DAY_INDEX: Readonly<Record<string, number>> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};

export function deliveryDaysText(days: unknown, t: (key: MessageKey) => string): string {
  const list = Array.isArray(days) ? days : [];
  return list
    .filter((day): day is string => typeof day === 'string')
    .map(day => {
      const index = DAY_INDEX[day];
      return index === undefined ? day : t(`day.weekdayShort.${index}` as MessageKey);
    })
    .join(', ');
}
