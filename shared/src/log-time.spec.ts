// Unit tests for the log timestamp formatting (P15 — the owner cannot read code), run against BOTH
// implementations: the TypeScript port in shared/ and js/log-time.js, which the live app uses today. Ported
// from tests/log-time.test.mjs (all 7 of its tests); the two must stay equal until the switch to Mise 2.
//
// They lock the 12-hour AM/PM format and the date string built by logTimestamp. ⚠️ It is ENGLISH whatever
// the interface language: the text goes into the log document, which the current app and Mise 2 both read.
// log-time.ts is a FULL port, so parity.spec.ts pairs it.

import { describe, expect, test } from 'vitest';
import * as ported from './log-time';
import * as legacyJs from '../../js/log-time.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('midnight reads as 12:MM AM', () => {
    // 2026-06-08 is a Monday; midnight, 7 minutes past.
    expect(m.logTimestamp(new Date(2026, 5, 8, 0, 7)).time).toBe('12:07 AM');
  });

  test('morning reads as AM with no leading zero on the hour', () => {
    expect(m.logTimestamp(new Date(2026, 5, 8, 9, 5)).time).toBe('9:05 AM');
  });

  test('noon reads as 12:MM PM', () => {
    expect(m.logTimestamp(new Date(2026, 5, 8, 12, 0)).time).toBe('12:00 PM');
  });

  test('afternoon converts 24h to 12h with PM', () => {
    expect(m.logTimestamp(new Date(2026, 5, 8, 14, 5)).time).toBe('2:05 PM');
  });

  test('late evening reads as PM', () => {
    expect(m.logTimestamp(new Date(2026, 5, 8, 23, 59)).time).toBe('11:59 PM');
  });

  test('minutes are zero-padded', () => {
    expect(m.logTimestamp(new Date(2026, 5, 8, 8, 3)).time).toBe('8:03 AM');
  });

  test('date string is "Weekday DD Month" with padded day', () => {
    expect(m.logTimestamp(new Date(2026, 5, 8, 8, 3)).date).toBe('Monday 08 June');
  });

  test('every weekday and month is spelled out in English', () => {
    const dates = Array.from({ length: 12 }, (_, month) => m.logTimestamp(new Date(2026, month, 1)).date.split(' ')[2]);
    expect(dates).toStrictEqual(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
    const weekdays = Array.from({ length: 7 }, (_, day) => m.logTimestamp(new Date(2026, 5, 7 + day)).date.split(' ')[0]);
    expect(weekdays).toStrictEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
  });
});
