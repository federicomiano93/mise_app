import { describe, expect, it } from 'vitest';
import { localLogDate as localDate, localLogTime as localTime, logStampText, logTimestamp } from '@mise/shared/log-time';

// The stored text is English; the saying of it lives in shared/src/log-time.ts since item 39 (it was app/src/calculator/logStamp.ts); an Italian screen says it in Italian (found on the lab tablet, 13 Oct 2026).
describe('a dough\'s «when» in the interface language', () => {
  it('says the stored English date in Italian', () => {
    expect(localDate('Tuesday 13 October', 'it')).toBe('martedì 13 ottobre');
    expect(localDate('Monday 09 June', 'it')).toBe('lunedì 9 giugno');
    expect(localDate('Sunday 01 March', 'it')).toBe('domenica 1 marzo');
  });

  it('says the time on the 24-hour clock, midnight and noon included', () => {
    expect(localTime('11:11 PM', 'it')).toBe('23:11');
    expect(localTime('2:05 PM', 'it')).toBe('14:05');
    expect(localTime('12:00 AM', 'it')).toBe('00:00');
    expect(localTime('12:30 PM', 'it')).toBe('12:30');
    expect(localTime('8:30 AM', 'it')).toBe('08:30');
  });

  it('leaves English exactly as stored', () => {
    expect(localDate('Tuesday 13 October', 'en')).toBe('Tuesday 13 October');
    expect(localTime('11:11 PM', 'en')).toBe('11:11 PM');
  });

  it('shows anything it cannot read exactly as stored, never a guess', () => {
    for (const odd of ['', 'yesterday', 'Funday 13 October', 'Tuesday 13 Octember', '13/10/2026']) {
      expect(localDate(odd, 'it')).toBe(odd);
    }
    for (const odd of ['', '23:11', '13:00 PM', 'noon']) expect(localTime(odd, 'it')).toBe(odd);
  });

  it('reads back every date and time the log writer can produce', () => {
    for (let month = 0; month < 12; month++) {
      for (const hour of [0, 9, 12, 23]) {
        const at = logTimestamp(new Date(2026, month, 1 + month, hour, 7));
        expect(localDate(at.date, 'it')).not.toBe(at.date);
        expect(localTime(at.time, 'it')).toBe(`${String(hour).padStart(2, '0')}:07`);
      }
    }
  });
});

describe('the «when» line of a version', () => {
  it('is the date and the time, said in the language the screen is in', () => {
    const at = { date: 'Tuesday 13 October', time: '11:11 PM' };
    expect(logStampText(at, 'it')).toBe('martedì 13 ottobre — 23:11');
    expect(logStampText(at, 'en')).toBe('Tuesday 13 October — 11:11 PM');
  });

  it('a version with no time stamp has an empty line either side of the dash, as the current app draws it', () => {
    expect(logStampText(undefined, 'it')).toBe(' — ');
  });
});
