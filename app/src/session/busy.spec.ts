import { describe, expect, it } from 'vitest';
import { isBusy, isBusyApartFrom, markBusy } from './busy';

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
