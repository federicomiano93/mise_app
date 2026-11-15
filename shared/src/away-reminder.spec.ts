// The once-a-day holiday reminder's rules, run against BOTH implementations: the TypeScript
// port in shared/ and the js/ file the live app uses today.

import { describe, expect, test } from 'vitest';
import * as ported from './away-reminder';
import * as legacyJs from '../../js/away-reminder.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('the key is the one the current app writes', () => {
    expect(m.AWAY_REMINDER_KEY).toBe('away-reminded-date');
  });

  test('reminds once: away, a real today, not yet reminded today', () => {
    expect(m.reminderDue(true, null, '2026-09-16')).toBe(true);
    expect(m.reminderDue(true, '2026-09-15', '2026-09-16')).toBe(true);
    expect(m.reminderDue(true, '2026-09-16', '2026-09-16')).toBe(false);
  });

  test('never when not away — only the boolean true counts', () => {
    expect(m.reminderDue(false, null, '2026-09-16')).toBe(false);
    expect(m.reminderDue('yes', null, '2026-09-16')).toBe(false);
    expect(m.reminderDue(1, null, '2026-09-16')).toBe(false);
  });

  test('never without a real today', () => {
    expect(m.reminderDue(true, null, '')).toBe(false);
    expect(m.reminderDue(true, null, '16/09/2026')).toBe(false);
    expect(m.reminderDue(true, null, undefined)).toBe(false);
  });

  test('storage that cannot be read (null) reads as not reminded yet', () => {
    expect(m.reminderDue(true, null, '2026-09-16')).toBe(true);
    expect(m.reminderDue(true, undefined, '2026-09-16')).toBe(true);
  });

  test('dayFromISO reads a real day as local midnight', () => {
    const d = m.dayFromISO('2026-09-16');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(8);
    expect(d?.getDate()).toBe(16);
    expect(d?.getHours()).toBe(0);
  });

  test('dayFromISO refuses what is not a real calendar day', () => {
    expect(m.dayFromISO('2026-02-30')).toBeNull();
    expect(m.dayFromISO('2026-13-01')).toBeNull();
    expect(m.dayFromISO('2026-9-16')).toBeNull();
    expect(m.dayFromISO('')).toBeNull();
    expect(m.dayFromISO(null)).toBeNull();
    expect(m.dayFromISO(20260916)).toBeNull();
  });
});
