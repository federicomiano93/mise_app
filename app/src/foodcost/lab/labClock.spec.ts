import { describe, expect, it } from 'vitest';
import { elapsedMs, formatClock, timerMinutes } from './labClock';

// The lab's clock comes from ONE stored instant: screen-off, leaving the app and a reload cannot lose a second.

describe('the clock is worked out from the start instant', () => {
  const START = Date.UTC(2026, 10, 12, 8, 0, 0);

  it('is now minus the start, whatever happened in between', () => {
    // Two "renders" an hour apart (the screen was off): the second is simply right.
    expect(formatClock(elapsedMs(START, START + 12 * 60_000 + 34_000))).toBe('0:12:34');
    expect(formatClock(elapsedMs(START, START + 3_600_000 + 5_000))).toBe('1:00:05');
  });

  it('reads the same after a reload: nothing but the start instant is needed', () => {
    const before = elapsedMs(START, START + 90_000);
    const afterReload = elapsedMs(START, START + 90_000);
    expect(afterReload).toBe(before);
  });

  it('counts a start in the future (the phone clock was set back) as zero, never a negative clock', () => {
    expect(elapsedMs(START + 60_000, START)).toBe(0);
    expect(formatClock(elapsedMs(START + 60_000, START))).toBe('0:00:00');
  });

  it('is zero before the start and for junk', () => {
    expect(elapsedMs(null, START)).toBe(0);
    expect(elapsedMs(Number.NaN, START)).toBe(0);
    expect(elapsedMs(START, Number.NaN)).toBe(0);
    expect(formatClock(Number.NaN)).toBe('0:00:00');
    expect(formatClock(-5)).toBe('0:00:00');
  });

  it('writes hours without a leading zero and minutes and seconds with two digits', () => {
    expect(formatClock(0)).toBe('0:00:00');
    expect(formatClock(59_999)).toBe('0:00:59');
    expect(formatClock(10 * 3_600_000 + 61_000)).toBe('10:01:01');
  });
});

describe('the labour time from the timer', () => {
  it('is whole minutes, rounded, and never less than one', () => {
    expect(timerMinutes(0)).toBe(1);
    expect(timerMinutes(29_000)).toBe(1);
    expect(timerMinutes(35 * 60_000 + 20_000)).toBe(35);
    expect(timerMinutes(35 * 60_000 + 40_000)).toBe(36);
    expect(timerMinutes(Number.NaN)).toBe(1);
  });
});
