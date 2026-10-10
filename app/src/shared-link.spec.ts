import { describe, expect, it } from 'vitest';
import { STAFF_CARDS, HIDEABLE_IDS } from '@mise/shared/home-cards';

// The app and ../shared are two packages: this fails if the link between them (the
// `file:../shared` dependency and its `exports` map) stops resolving, long before any
// screen needs the shared logic.
describe('@mise/shared', () => {
  it('resolves from the app', () => {
    expect(Array.isArray(STAFF_CARDS)).toBe(true);
    expect(STAFF_CARDS.length).toBeGreaterThan(0);
    expect(Object.isFrozen(STAFF_CARDS)).toBe(true);
    expect(HIDEABLE_IDS).toHaveLength(STAFF_CARDS.length);
  });
});
