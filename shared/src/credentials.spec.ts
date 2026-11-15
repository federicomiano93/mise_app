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
  MIN_PASSWORD_LENGTH: number;
  cleanName(value: unknown): string;
  nameProblem(value: unknown, which: 'first' | 'last'): string | null;
  passwordProblem(value: unknown, email?: unknown): string | null;
  confirmProblem(value: unknown, repeated: unknown): string | null;
  emailConfirmProblem(value: unknown, repeated: unknown): string | null;
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
    for (const name of ['cleanName', 'nameProblem', 'passwordProblem', 'confirmProblem', 'emailConfirmProblem'] as const) {
      expect(ported[name].name).toBe(legacy[name].name);
      expect(ported[name].length).toBe(legacy[name].length);
    }
  });
});

// The password and email checks (staff slice 2). Each case asks the original for its words and the port for its key, and
// demands that the original's own t() says exactly those words for that key, `{ n }` included.
const PASSWORDS: readonly unknown[] = [
  '', null, undefined, 42, 'short', '123456789', 'abcdefghij', 'correct horse battery', 'password12', 'letmein!!!!',
  'P@ssw0rd!!', 'Passw0rd', 'PASSWORD', 'aaaaaaaaaa', '1111111111111', 'bakery2026', 'TheItalianClub',
  'anna.rossi-kitchen', 'my anna.rossi pass', 'x'.repeat(10), 'ab'.repeat(5), '  spaces  around  ',
];
const EMAILS: readonly unknown[] = ['anna.rossi@club.test', 'ann@club.test', 'ANNA.ROSSI@club.test', '', undefined, null, 7, '@x'];
const PAIRS: readonly (readonly [unknown, unknown])[] = [
  ['a@b.it', 'a@b.it'], ['Anna@x.it', 'anna@x.it '], ['a@b.it', 'a@c.it'], ['a@b.it', ''], ['a@b.it', '   '], ['a@b.it', undefined],
  ['a@b.it', null], [undefined, ''], [null, 'null'], ['', ''], ['pass word', 'pass word'], ['pass word', 'pass word '],
  ['Secret1234', 'secret1234'], ['x', 42],
];

describe('passwords and emails, against js/credentials.js', () => {
  test('the same minimum', () => {
    expect(ported.MIN_PASSWORD_LENGTH).toBe(legacy.MIN_PASSWORD_LENGTH);
    expect(ported.MIN_PASSWORD_LENGTH).toBe(10);
  });

  test.each(['en', 'it'] as const)('every check names the same problem, in %s', lang => {
    setLanguage(lang);
    const say = (key: string | null) => (key === null ? null : t(key, { n: ported.MIN_PASSWORD_LENGTH }));
    try {
      for (const value of PASSWORDS) {
        expect(say(ported.passwordProblem(value)), `${String(value)}`).toBe(legacy.passwordProblem(value));
        for (const email of EMAILS) {
          expect(say(ported.passwordProblem(value, email)), `${String(value)} / ${String(email)}`)
            .toBe(legacy.passwordProblem(value, email));
        }
      }
      for (const [a, b] of PAIRS) {
        expect(say(ported.confirmProblem(a, b)), `${String(a)} / ${String(b)}`).toBe(legacy.confirmProblem(a, b));
        expect(say(ported.emailConfirmProblem(a, b)), `${String(a)} / ${String(b)}`).toBe(legacy.emailConfirmProblem(a, b));
      }
    } finally {
      setLanguage('en');
    }
  });
});

describe('the port on its own', () => {
  test('a long, unusual password is no problem; the obvious ones are', () => {
    expect(ported.passwordProblem('correct horse battery', 'anna@club.test')).toBeNull();
    expect(ported.passwordProblem('')).toBe('help.chooseAPassword');
    expect(ported.passwordProblem('123456789')).toBe('help.passwordTooShort');
    expect(ported.passwordProblem('P@ssw0rd!!')).toBe('help.thatOneIsGuessed');
    expect(ported.passwordProblem('aaaaaaaaaa')).toBe('help.thatIsOneCharacter');
    expect(ported.passwordProblem('anna.rossi-kitchen', 'anna.rossi@club.test')).toBe('help.doNotUseYour');
  });

  test('the repeated email is compared as Firebase compares addresses; the password exactly', () => {
    expect(ported.emailConfirmProblem('Anna@x.it', ' anna@x.it ')).toBeNull();
    expect(ported.emailConfirmProblem('a@b.it', 'a@c.it')).toBe('help.emailsDoNotMatch');
    expect(ported.emailConfirmProblem('a@b.it', ' ')).toBe('help.repeatTheEmail');
    expect(ported.confirmProblem('Secret 12345', 'Secret 12345')).toBeNull();
    expect(ported.confirmProblem('Secret 12345', 'Secret 12345 ')).toBe('help.passwordsDoNotMatch');
    expect(ported.confirmProblem('Secret 12345', '')).toBe('help.repeatThePassword');
  });

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
