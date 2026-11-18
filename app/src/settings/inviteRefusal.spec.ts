import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { inviteRefusal, memberRefusal } from './inviteRefusal';
import type { MemberAction } from './inviteRefusal';

// What «Who can get in» says when the server refuses, read from the error's CODE (functions/onboarding.js throws each code below for
// one case only), never the server's own English.

afterEach(() => { vi.restoreAllMocks(); });

const refused = (code: string) => Object.assign(new Error('Server English that must never be shown'), { code });

describe('a change to somebody in the list, refused', () => {
  const ACTIONS: readonly MemberAction[] = ['role', 'name', 'remove'];

  it.each(ACTIONS)('%s: not the owner, gone, or a failure, each said its own way', action => {
    expect(memberRefusal(refused('functions/permission-denied'), action)).toBe('people.err.ownerOnly');
    expect(memberRefusal(refused('functions/not-found'), action)).toBe('people.err.gone');
    expect(memberRefusal(refused('functions/internal'), action)).toBe('people.err.tryAgain');
    expect(memberRefusal(refused('functions/invalid-argument'), action)).toBe('people.err.tryAgain');
    expect(memberRefusal(new Error('no code at all'), action)).toBe('people.err.tryAgain');
    expect(memberRefusal(null, action)).toBe('people.err.tryAgain');
  });

  it('the last owner is said for a change of role and a removal (setMemberName never refuses that way)', () => {
    expect(memberRefusal(refused('functions/failed-precondition'), 'role')).toBe('people.err.lastOwner');
    expect(memberRefusal(refused('functions/failed-precondition'), 'remove')).toBe('people.err.lastOwner');
    expect(memberRefusal(refused('functions/failed-precondition'), 'name')).toBe('people.err.tryAgain');
  });

  it('no answer says to check the connection, in the current app’s sentence for what was being done', () => {
    for (const code of ['functions/unavailable', 'functions/deadline-exceeded', 'unavailable']) {
      expect(memberRefusal(refused(code), 'role')).toBe('people.err.change');
      expect(memberRefusal(refused(code), 'name')).toBe('people.err.name');
      expect(memberRefusal(refused(code), 'remove')).toBe('people.err.remove');
    }
  });

  it('a phone that knows it is offline says so, whatever code the SDK gave', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(memberRefusal(refused('functions/internal'), 'role')).toBe('people.err.change');
    expect(memberRefusal(new Error('the SDK did not load'), 'remove')).toBe('people.err.remove');
    // A refusal the server did answer is still said as what it is.
    expect(memberRefusal(refused('functions/failed-precondition'), 'remove')).toBe('people.err.lastOwner');
  });

  it('says the last owner in the plan’s words, in English and Italian', () => {
    expect(en['people.err.lastOwner']).toBe('This is the only owner. Make somebody else an owner first.');
    expect(italian['people.err.lastOwner']).toBe('È l’unico titolare. Prima rendi titolare qualcun altro.');
  });
});

describe('an invitation, refused (slice 3, unchanged)', () => {
  it('still reads the same codes', () => {
    expect(inviteRefusal(refused('functions/permission-denied'))).toBe('people.err.notOwner');
    expect(inviteRefusal(refused('functions/failed-precondition'))).toBe('people.add.digitsStaffOnly');
    expect(inviteRefusal(refused('functions/unavailable'))).toBe('people.err.code');
    expect(inviteRefusal(refused('functions/internal'))).toBe('people.err.failed');
  });
});
