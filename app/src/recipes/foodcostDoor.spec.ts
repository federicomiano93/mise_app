import { describe, expect, test } from 'vitest';
import { mayOpenFoodCost } from '@mise/shared/recipe-link';
import { visibleSectionIds } from '../session/visibility';
import type { DocData } from '../session/backend';

// The recipe screen's «Open in Food cost» card is a DOOR, and a door that answered differently from the gate
// behind it would bounce its user straight back (the current app's rule, js/recipe-link.js). The gate in Mise 2 is
// session/visibility.ts, so the two are compared over a grid of venue documents.
//
// ONE DOCUMENTED DIFFERENCE: a venue that has no document yet (null). The gate then defaults to everything on (the
// shared rules do), while the door says no — "no venue, no", because a button for a place the session has not
// judged yet is worse than a missing one. A door that hides can never bounce anybody.

const VENUES: ReadonlyArray<readonly [string, DocData]> = [
  ['an empty document', {}],
  ['sections: {} ', { sections: {} }],
  ['foodcost on', { sections: { foodcost: true } }],
  ['foodcost off', { sections: { foodcost: false } }],
  ['foodcost off, card shown to staff', { sections: { foodcost: false }, staffShownCards: { foodcost: true } }],
  ['the card shown to staff', { sections: {}, staffShownCards: { foodcost: true } }],
  ['the card shown to staff, a typo', { sections: {}, staffShownCards: { foodcost: 'true' } }],
  ['another card shown to staff', { sections: {}, staffShownCards: { inventory: true } }],
  ['the card "hidden" (an everyday-card flag does nothing to a money card)', { sections: {}, staffHiddenCards: { foodcost: true } }],
  ['catalogue off', { sections: { catalogue: false } }],
  ['a stray space in the field name', { 'sections ': { 'foodcost ': false } }],
  ['sections is not an object', { sections: 'no' }],
  ['staffShownCards is an array', { sections: {}, staffShownCards: ['foodcost'] }],
];

describe('the Food cost door agrees with the gate behind it', () => {
  for (const [name, venue] of VENUES) {
    for (const canManage of [true, false]) {
      test(`${name}, ${canManage ? 'owner or manager' : 'employee'}`, () => {
        expect(mayOpenFoodCost(venue, canManage)).toBe(visibleSectionIds(venue, canManage).has('foodcost'));
      });
    }
  }

  test('a venue with no document: the door says no, whoever asks (the one documented difference)', () => {
    for (const canManage of [true, false]) expect(mayOpenFoodCost(null, canManage)).toBe(false);
  });

  test('the grid covers both answers, so it can fail in either direction', () => {
    const answers = new Set(VENUES.flatMap(([, venue]) => [true, false].map(manage => mayOpenFoodCost(venue, manage))));
    expect(answers).toEqual(new Set([true, false]));
  });
});
