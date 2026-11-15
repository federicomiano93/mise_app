import type { DayTranslate } from '@mise/shared/day';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';

// The word functions of @mise/shared/day take the translator as their LAST argument and ask it for keys of the current
// app's dictionary (`day.weekdayShort.N`, `day.shortDate`, `day.for`, `day.delivery`). Mise 2's dictionary carries the same
// keys; `dayWords.spec.ts` fails if one is missing in either language.
//
// ⚠️ A YEAR IS SPELLED, NOT FORMATTED AS A QUANTITY. The translator formats a number for the language (12000 reads «12,000»), so the
// year of «Sat 24 Oct 2026» came out as «2,026». Every number but `n` (the one that picks a plural form, which must stay a number)
// goes through as plain digits.
export function dayTranslate(t: (key: MessageKey, params?: MessageParams) => string): DayTranslate {
  return (key, params) => t(key as MessageKey, params === undefined ? undefined : Object.fromEntries(
    Object.entries(params).map(([name, value]) => [name, typeof value === 'number' && name !== 'n' ? String(value) : value]),
  ));
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
