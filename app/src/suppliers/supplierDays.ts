import type { MessageKey } from '../i18n/en';

// The stored delivery and order days are ENGLISH words (parity S43, S82) and must stay so; only the label is looked up.
// In the order a week is read here, Monday first (the card's ticks are saved in it). The dictionary's weekday words are
// numbered from Sunday = 0.
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const DAY_KEY = {
  Sunday: 'day.weekdayShort.0',
  Monday: 'day.weekdayShort.1',
  Tuesday: 'day.weekdayShort.2',
  Wednesday: 'day.weekdayShort.3',
  Thursday: 'day.weekdayShort.4',
  Friday: 'day.weekdayShort.5',
  Saturday: 'day.weekdayShort.6',
} as const satisfies Record<Weekday, MessageKey>;

export const isWeekday = (value: unknown): value is Weekday => typeof value === 'string' && Object.hasOwn(DAY_KEY, value);
