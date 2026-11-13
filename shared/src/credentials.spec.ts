// Unit tests for the name a person gives when joining (P15), run against BOTH implementations: the
// TypeScript port in shared/ and js/credentials.js, which the live app uses today. Ported from the
// name half of tests/credentials.test.mjs.
//
// credentials.ts is a PARTIAL and ADAPTED port (its header says what it leaves out): `nameProblem`
// returns the dictionary KEY instead of the words. Each case here asks the original for its words
// and the port for its key, and demands that the original's own t() says exactly those words for
// that key — so the two cannot drift apart while both apps are live.

import { describe, expect, test } from 'vitest';
import * as ported from './credentials';
import * as legacyJs from '../../js/credentials.js';
import { setLanguage, t } from '../../js/i18n.js';

const legacy = legacyJs as unknown as {
  MAX_NAME_LENGTH: number;
  cleanName(value: unknown): string;
  nameProblem(value: unknown, which: 'first' | 'last'): string | null;
};

const NAMES: readonly unknown[] = [
  'Luca', 'Rossi', '  Luca   Maria  ', 'Luca\nRossi', 'Luca Rossi', '', '   ', '\n\t', '-', '—', '...', '?!',
  'A', 'Ø', '李', 'Ἀθηνᾶ', 'x'.repeat(200), null, undefined, 42, {}, [],
];

describe('names, against js/credentials.js', () => {
  test('the same cap', () => {
    expect(ported.MAX_NAME_LENGTH).toBe(legacy.MAX_NAME_LENGTH);
  });

  test('cleanName gives the same text for every input', () => {
    for (const value of NAMES) expect(ported.cleanName(value), String(value)).toBe(legacy.cleanName(value));
  });

  test.each(['en', 'it'] as const)('nameProblem names the same problem, in %s', lang => {
    setLanguage(lang);
    try {
      for (const value of NAMES) {
        for (const which of ['first', 'last'] as const) {
          const key = ported.nameProblem(value, which);
          const words = legacy.nameProblem(value, which);
          expect(key === null ? null : t(key), `${String(value)} (${which})`).toBe(words);
        }
      }
    } finally {
      setLanguage('en');
    }
  });

  test('the names and shapes of what is ported match the original', () => {
    for (const name of ['cleanName', 'nameProblem'] as const) {
      expect(ported[name].name).toBe(legacy[name].name);
      expect(ported[name].length).toBe(legacy[name].length);
    }
  });
});

describe('the port on its own', () => {
  test('an ordinary name is no problem', () => {
    expect(ported.nameProblem('Luca', 'first')).toBeNull();
    expect(ported.nameProblem('Rossi', 'last')).toBeNull();
  });

  test('blank is asked for by the field it is about', () => {
    expect(ported.nameProblem('  ', 'first')).toBe('help.enterYourFirstName');
    expect(ported.nameProblem('  ', 'last')).toBe('help.enterYourSurname');
  });

  test('punctuation is not a name', () => {
    expect(ported.nameProblem('-', 'first')).toBe('help.thatFirstNameNeeds');
    expect(ported.nameProblem('...', 'last')).toBe('help.thatSurnameNeedsLetters');
  });

  test('names outside the Latin alphabet are names', () => {
    expect(ported.nameProblem('李', 'first')).toBeNull();
    expect(ported.nameProblem('Ἀθηνᾶ', 'last')).toBeNull();
  });
});
