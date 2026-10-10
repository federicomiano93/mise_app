import type { MessageKey } from '../i18n/en';

// Firebase's error codes, in words that tell you what to DO about it. A port of MESSAGES in
// js/auth-gate.js (the current app), entry for entry.
//
// ⚠️ FOUR CODES SHARE ONE SENTENCE ON PURPOSE. Firebase reports a bad sign-in under several
// codes depending on whether the project has email-enumeration protection switched on, and the
// emulator uses a different one again. Saying which half was wrong would tell somebody guessing
// at the door that an email exists — and a code that fell through to the generic sentence would
// degrade the message in exactly the situation people actually hit.
const MESSAGES: ReadonlyMap<string, MessageKey> = new Map<string, MessageKey>([
  ['auth/invalid-credential', 'auth.err.badPair'],
  ['auth/invalid-login-credentials', 'auth.err.badPair'],
  ['auth/wrong-password', 'auth.err.badPair'],
  ['auth/user-not-found', 'auth.err.badPair'],
  ['auth/invalid-email', 'auth.err.badEmail'],
  ['auth/user-disabled', 'auth.err.disabled'],
  ['auth/too-many-requests', 'auth.err.tooMany'],
  ['auth/network-request-failed', 'auth.err.offline'],
  ['auth/missing-password', 'auth.enterPassword'],
]);

function codeOf(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return '';
  return typeof error.code === 'string' ? error.code : '';
}

// The sentence for a failed sign-in. Anything unknown is the generic one — never blank, never
// the raw Firebase text.
export function signInErrorKey(error: unknown): MessageKey {
  return MESSAGES.get(codeOf(error)) ?? 'auth.err.generic';
}

// What to say when «Forgot your password?» fails, or null for «say it went through».
//
// ⚠️ AN ADDRESS WITH NO ACCOUNT ANSWERS EXACTLY LIKE ONE WITH AN ACCOUNT. The sentence on
// success is «If {address} has an account, a reset link is on its way», worded so it stays true
// either way; showing «wrong email or password» (or anything else) for an unknown address would
// turn the reset button into a way to find out who has an account. Only what says nothing about
// accounts is told apart: no connection, a badly typed address, too many tries.
export function resetFailureKey(error: unknown): MessageKey | null {
  if (codeOf(error) === 'auth/user-not-found') return null;
  return signInErrorKey(error);
}
