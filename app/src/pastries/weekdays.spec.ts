import { describe, expect, it, vi } from 'vitest';
import { WEEKDAYS } from '@mise/shared/pastries-model';
import { en } from '../i18n/en';
import type { MessageKey } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { format } from '../i18n/i18n';
import type { MessageParams } from '../i18n/i18n';
import { weekdayLabel, weekdayShortLabel } from './weekdays';

const english = (key: MessageKey, params?: MessageParams) => format('en', en[key], params);
const italiano = (key: MessageKey, params?: MessageParams) => format('it', italian[key], params);

describe('weekdayLabel', () => {
  it('says the day in English', () => {
    expect(WEEKDAYS.map(day => weekdayLabel(english, day))).toEqual([
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    ]);
  });

  it('says the day in Italian', () => {
    expect(WEEKDAYS.map(day => weekdayLabel(italiano, day))).toEqual([
      'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica',
    ]);
  });
});

describe('weekdayShortLabel', () => {
  it('says the short day in English and in Italian', () => {
    expect(WEEKDAYS.map(day => weekdayShortLabel(english, day))).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(WEEKDAYS.map(day => weekdayShortLabel(italiano, day))).toEqual(['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']);
  });

  // A translated word cannot be cut safely: the short label is an entry of its own.
  it('asks the dictionary for its own entry, never cutting the full name', () => {
    const asked: string[] = [];
    const spy = vi.fn((key: MessageKey) => { asked.push(key); return key; });
    for (const day of WEEKDAYS) weekdayShortLabel(spy, day);
    expect(asked).toEqual(WEEKDAYS.map(day => `weekday.${day.toLowerCase()}.short`));
  });

  it('is different for the seven days', () => {
    expect(new Set(WEEKDAYS.map(day => weekdayShortLabel(italiano, day))).size).toBe(7);
  });
});
