import type { Weekday } from '@mise/shared/pastries-model';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';

type Translate = (key: MessageKey, params?: MessageParams) => string;

// ⚠️ THE ID AND THE WORD ARE DIFFERENT THINGS. A Weekday is a Firestore document id
// (`pastries/Tuesday`), so it is data and never translated; a screen that must SAY «Martedì»
// looks the word up here, keyed by the id. The short label is an entry of its own, never the
// first three letters of the full name (a translated word cannot be cut safely).
const LABEL: Readonly<Record<Weekday, MessageKey>> = {
  Monday: 'weekday.monday',
  Tuesday: 'weekday.tuesday',
  Wednesday: 'weekday.wednesday',
  Thursday: 'weekday.thursday',
  Friday: 'weekday.friday',
  Saturday: 'weekday.saturday',
  Sunday: 'weekday.sunday',
};

const SHORT: Readonly<Record<Weekday, MessageKey>> = {
  Monday: 'weekday.monday.short',
  Tuesday: 'weekday.tuesday.short',
  Wednesday: 'weekday.wednesday.short',
  Thursday: 'weekday.thursday.short',
  Friday: 'weekday.friday.short',
  Saturday: 'weekday.saturday.short',
  Sunday: 'weekday.sunday.short',
};

export function weekdayLabel(t: Translate, day: Weekday): string {
  return t(LABEL[day]);
}

export function weekdayShortLabel(t: Translate, day: Weekday): string {
  return t(SHORT[day]);
}

// The addresses of Pastries, in one place so the section, the days list and the editor's and
// Records' links cannot disagree. `/pastries` itself opens the opening day.
export const PASTRIES_PATH = '/pastries';
export const RECORDS_PATH = `${PASTRIES_PATH}/records`;
export const dayPath = (day: Weekday): string => `${PASTRIES_PATH}/${day}`;
export const editorPath = (day: Weekday): string => `${PASTRIES_PATH}/${day}/edit`;

// The ids that tie a tab to the panel it controls.
export const PANEL_ID = 'pastries-day-panel';
export const tabId = (day: Weekday): string => `pastries-tab-${day}`;
