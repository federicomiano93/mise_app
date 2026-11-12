// The same stored text, said in the interface language (item 39 of docs/mise2-port-owed.md; current app 021a49ff,
// tests/log-time.test.mjs), run against BOTH files: the TypeScript port in shared/ and js/log-time.js. The stored text
// stays English (log-time.spec.ts); the screen says it again with Intl.

import { describe, expect, test } from 'vitest';
import * as ported from './log-time';
import * as legacyJs from '../../js/log-time.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s — the stamp in the interface language', (_name, m) => {
  test('an Italian venue reads the date in Italian and the time on the 24-hour clock', () => {
    expect(m.localLogDate('Saturday 31 October', 'it')).toBe('sabato 31 ottobre');
    expect(m.localLogDate('Monday 09 June', 'it')).toBe('lunedì 9 giugno');
    expect(m.localLogTime('8:19 PM', 'it')).toBe('20:19');
    expect(m.localLogTime('12:05 AM', 'it')).toBe('00:05');
    expect(m.localLogTime('12:00 PM', 'it')).toBe('12:00');
    expect(m.localLogTime('2:05 PM', 'it')).toBe('14:05');
  });

  test('English is shown exactly as stored', () => {
    expect(m.localLogDate('Saturday 31 October', 'en')).toBe('Saturday 31 October');
    expect(m.localLogTime('8:19 PM', 'en')).toBe('8:19 PM');
  });

  test('every weekday and month that logTimestamp writes can be read back by the Italian screen', () => {
    for (let month = 0; month < 12; month++) {
      const { date } = m.logTimestamp(new Date(2026, month, 5));
      expect(m.localLogDate(date, 'it'), date).not.toBe(date);
    }
    for (let day = 0; day < 7; day++) {
      const { date } = m.logTimestamp(new Date(2026, 5, 7 + day));
      expect(m.localLogDate(date, 'it'), date).not.toBe(date);
    }
  });

  test('⚠️ text that does not read as the stored shape is shown exactly as it is, never guessed at', () => {
    for (const odd of ['', 'yesterday', 'Saturday 31 Octember', 'Funday 31 October', '31 October', 'Saturday 31 October 2026']) {
      expect(m.localLogDate(odd, 'it'), odd).toBe(odd);
    }
    for (const odd of ['', 'noon', '13:00 PM', '0:30 AM', '8:75 PM', '8:19']) {
      expect(m.localLogTime(odd, 'it'), odd).toBe(odd);
    }
    expect(m.localLogDate(undefined, 'it')).toBe('');
    expect(m.localLogTime(null, 'it')).toBe('');
  });

  test('the «when» line joins the two with the dash every history screen uses', () => {
    expect(m.logStampText({ date: 'Saturday 31 October', time: '8:19 PM' }, 'it')).toBe('sabato 31 ottobre — 20:19');
    expect(m.logStampText({ date: 'Saturday 31 October', time: '8:19 PM' }, 'en')).toBe('Saturday 31 October — 8:19 PM');
    expect(m.logStampText(undefined, 'en')).toBe(' — ');
  });
});

describe('the port with the language it is handed', () => {
  test('logStampText with no language says the stored English: the argument is the only source of a language', () => {
    expect(ported.logStampText({ date: 'Saturday 31 October', time: '8:19 PM' })).toBe('Saturday 31 October — 8:19 PM');
  });
});
