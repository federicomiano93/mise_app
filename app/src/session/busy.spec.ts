import { describe, expect, it, vi } from 'vitest';
import { hasUnsavedWork, isBusy, isBusyApartFrom, markBusy, markLeavingOnPurpose } from './busy';

describe('the busy marker', () => {
  it('is held while any holder holds it, and each release lets go of its own hold only', () => {
    expect(isBusy()).toBe(false);
    const first = markBusy();
    const second = markBusy();
    expect(isBusy()).toBe(true);
    first();
    expect(isBusy()).toBe(true);
    first();
    expect(isBusy(), 'a second release of the same hold changes nothing').toBe(true);
    second();
    expect(isBusy()).toBe(false);
  });

  // The kiosk's rest screen holds the marker and asks whether anybody ELSE does (staff slice 5).
  it('tells a holder whether somebody else holds it', () => {
    const mine = markBusy();
    expect(isBusyApartFrom(mine)).toBe(false);
    expect(isBusyApartFrom(null)).toBe(true);
    const editor = markBusy();
    expect(isBusyApartFrom(mine)).toBe(true);
    editor();
    expect(isBusyApartFrom(mine)).toBe(false);
    mine();
    expect(isBusyApartFrom(null)).toBe(false);
  });
});

describe('what a closed window would lose', () => {
  it('ignores a quiet hold, a quiet hold that says «nothing to lose» right now, and counts the others', () => {
    let nothingToLose = true;
    const rest = markBusy({ quiet: true });
    const conditional = markBusy({ quiet: () => nothingToLose });
    expect(isBusy()).toBe(true);
    expect(hasUnsavedWork()).toBe(false);
    nothingToLose = false;
    expect(hasUnsavedWork()).toBe(true);
    nothingToLose = true;
    const editor = markBusy();
    expect(hasUnsavedWork()).toBe(true);
    editor();
    rest();
    conditional();
    expect(isBusy()).toBe(false);
  });

  it('says nothing while the app is leaving on purpose, and asks again a few seconds after', () => {
    vi.useFakeTimers();
    try {
      const editor = markBusy();
      expect(hasUnsavedWork()).toBe(true);
      markLeavingOnPurpose();
      expect(hasUnsavedWork()).toBe(false);
      expect(isBusy(), 'the update banner still waits').toBe(true);
      vi.advanceTimersByTime(6000);
      expect(hasUnsavedWork()).toBe(true);
      editor();
    } finally {
      vi.useRealTimers();
    }
  });
});
