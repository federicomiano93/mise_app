import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { resetFailureKey, signInErrorKey } from './authErrors';

describe('signInErrorKey', () => {
  it.each([
    ['auth/invalid-credential', 'auth.err.badPair'],
    ['auth/invalid-login-credentials', 'auth.err.badPair'],
    ['auth/wrong-password', 'auth.err.badPair'],
    ['auth/user-not-found', 'auth.err.badPair'],
    ['auth/invalid-email', 'auth.err.badEmail'],
    ['auth/user-disabled', 'auth.err.disabled'],
    ['auth/too-many-requests', 'auth.err.tooMany'],
    ['auth/network-request-failed', 'auth.err.offline'],
    ['auth/missing-password', 'auth.enterPassword'],
  ] as const)('%s → %s', (code, key) => {
    expect(signInErrorKey({ code })).toBe(key);
  });

  // ⚠️ The sentence for four codes is ONE message on purpose: telling "wrong password" from
  // "no such account" tells somebody guessing at the door which emails exist.
  it('says the same thing for a wrong password and for an unknown account', () => {
    expect(signInErrorKey({ code: 'auth/wrong-password' })).toBe(signInErrorKey({ code: 'auth/user-not-found' }));
    expect(signInErrorKey({ code: 'auth/invalid-credential' })).toBe(signInErrorKey({ code: 'auth/user-not-found' }));
  });

  it('falls back to the generic sentence for a code it does not know', () => {
    expect(signInErrorKey({ code: 'auth/something-new' })).toBe('auth.err.generic');
  });

  it('falls back to the generic sentence for anything that is not a Firebase error', () => {
    for (const odd of [null, undefined, 'boom', 42, {}, new Error('x'), { code: 7 }, { code: null }]) {
      expect(signInErrorKey(odd), JSON.stringify(odd)).toBe('auth.err.generic');
    }
  });

  // A code is looked up, never used as an object key: «constructor» would otherwise find
  // Object's own function and put it where a message key belongs.
  it('does not read inherited properties as codes', () => {
    for (const code of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(signInErrorKey({ code })).toBe('auth.err.generic');
    }
  });

  it('only ever answers with a message that exists', () => {
    for (const code of ['auth/invalid-credential', 'auth/missing-password', 'auth/nope']) {
      expect(Object.keys(en)).toContain(signInErrorKey({ code }));
    }
  });
});

describe('resetFailureKey', () => {
  // ⚠️ The reset button must not reveal who has an account.
  it('says "sent" (null) for an address with no account', () => {
    expect(resetFailureKey({ code: 'auth/user-not-found' })).toBeNull();
  });

  it('tells a missing connection apart', () => {
    expect(resetFailureKey({ code: 'auth/network-request-failed' })).toBe('auth.err.offline');
  });

  it('keeps the current app\'s wording for what says nothing about accounts', () => {
    expect(resetFailureKey({ code: 'auth/invalid-email' })).toBe('auth.err.badEmail');
    expect(resetFailureKey({ code: 'auth/too-many-requests' })).toBe('auth.err.tooMany');
    expect(resetFailureKey({ code: 'auth/something-new' })).toBe('auth.err.generic');
  });
});
