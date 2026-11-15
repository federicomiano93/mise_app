// Unit tests for the join form that stays on screen while its code is checked (current-app fix
// 9e0a2dac), run against BOTH implementations: the TypeScript port in shared/ and js/join-hold.js,
// which the live app uses today. parity.spec.ts compares their exports as well.

import { describe, expect, test } from 'vitest';
import * as ported from './join-hold';
import * as legacyJs from '../../js/join-hold.js';

const legacy = legacyJs as unknown as typeof ported;
const LINK = 'aB3dEf6hIj9lMn2pQr5tUv8xYz1CdEf4';
const OTHER = 'zZ3dEf6hIj9lMn2pQr5tUv8xYz1CdEf4';

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('the held states are loading, no access and error, frozen', () => {
    expect([...m.HELD_STATES]).toEqual(['loading', 'no-access', 'error']);
    expect(Object.isFrozen(m.HELD_STATES)).toBe(true);
  });

  test('no form sent: nothing is held', () => {
    expect(m.keepJoinForm(null, 'no-access')).toBe(false);
    expect(m.keepJoinForm(undefined, 'loading')).toBe(false);
  });

  test('a form still being checked is held through every held state', () => {
    for (const status of ['loading', 'no-access', 'error']) {
      expect(m.keepJoinForm({ busy: true, invited: '' }, status, OTHER), status).toBe(true);
    }
  });

  // Signed out, or let into a venue: somewhere real, drawn as usual even mid-check.
  test('signed out or in a venue is never held', () => {
    for (const status of ['signed-out', 'ready', 'choose-location']) {
      expect(m.keepJoinForm({ busy: true, invited: '' }, status), status).toBe(false);
    }
  });

  test('a finished form keeps its refusal on screen', () => {
    expect(m.keepJoinForm({ busy: false, invited: '' }, 'no-access')).toBe(true);
    expect(m.keepJoinForm({ busy: false, invited: LINK }, 'no-access', LINK)).toBe(true);
  });

  // A NEW invitation opened since the tap deserves its own form; the same one does not.
  test('a finished form gives way to a new invitation only', () => {
    expect(m.keepJoinForm({ busy: false, invited: LINK }, 'no-access', OTHER)).toBe(false);
    expect(m.keepJoinForm({ busy: false, invited: '' }, 'no-access', LINK)).toBe(false);
  });
});
