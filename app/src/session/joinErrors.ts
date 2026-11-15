// joinErrors.ts — what the join form says when the server refuses a code, in the app's own words.
//
// ⚠️ THE APP'S OWN WORDS, IN THE LANGUAGE ON SCREEN (current-app fix 9e0a2dac and the note in
// shared/src/join-code.ts redeemFailureText). The function `redeemJoinCode` has no dictionary, so its
// messages are English; the current app showed most of them as they came. Mise 2 reads the error's
// CODE (and, for two refusals, the reason the server sends beside it) and says its own sentence, so
// an Italian kitchen is never answered in English.
//
// ⚠️ IT NEVER SAYS MORE THAN THE SERVER DID. Every refusal that is about a CODE sounds the same
// («That code does not work»): telling somebody a code has expired confirms that it existed, which is
// what a search wants. Only the three refusals the server itself tells apart are told apart here,
// and none of them is about the code (already in this venue, too many tries by this account, six
// digits paused for everybody).
//
// ⚠️ AND IT READS THE ERROR, NEVER LOGS IT. Nothing here writes to the console or a report: the error
// came from a call that carried the code.

import type { MessageKey } from '../i18n/en';

export type JoinRefusal =
  | { readonly key: Extract<MessageKey, 'join.tooManyMinutes'>; readonly n: number }
  | { readonly key: Extract<MessageKey,
    'join.alreadyMember' | 'join.digitsPaused' | 'join.badCode' | 'join.tooMany' | 'join.offline' | 'join.failed'> };

interface CallError {
  code?: unknown;
  message?: unknown;
  details?: unknown;
}

// The Functions SDK names its codes `functions/<code>`; the bare code is accepted too.
function codeOf(error: CallError): string {
  return typeof error.code === 'string' ? error.code.replace(/^functions\//, '') : '';
}

function reasonOf(error: CallError): string {
  const details = error.details;
  if (!details || typeof details !== 'object') return '';
  const reason = (details as { reason?: unknown }).reason;
  return typeof reason === 'string' ? reason : '';
}

// The rate limit is the one refusal whose English carries a number the person can act on
// («Too many tries. Wait 12 minutes and try again.», shared/src/join-code.ts redeemFailureText). The
// number is read back out of it; anything else is said without one.
function minutesIn(message: unknown): number | null {
  if (typeof message !== 'string') return null;
  const found = /\bWait (\d{1,3}) minutes?\b/.exec(message);
  if (!found) return null;
  const n = Number(found[1]);
  return n >= 1 ? n : null;
}

export function joinRefusal(error: unknown): JoinRefusal {
  const e: CallError = error && typeof error === 'object' ? error as CallError : {};
  const code = codeOf(e);
  const reason = reasonOf(e);
  if (reason === 'already-member') return { key: 'join.alreadyMember' };
  if (reason === 'digits-paused') return { key: 'join.digitsPaused' };
  switch (code) {
    case 'resource-exhausted': {
      const n = minutesIn(e.message);
      return n === null ? { key: 'join.tooMany' } : { key: 'join.tooManyMinutes', n };
    }
    // Every refusal of a code (missing, used, expired, locked, malformed): one sentence.
    case 'permission-denied':
      return { key: 'join.badCode' };
    // The call never got an answer: no signal, a timeout, the Functions code not downloaded.
    case 'unavailable':
    case 'deadline-exceeded':
      return { key: 'join.offline' };
    default:
      // A failed download of the Functions SDK itself has no code at all; a phone that knows it is
      // offline says so.
      if (!code && typeof navigator !== 'undefined' && navigator.onLine === false) return { key: 'join.offline' };
      return { key: 'join.failed' };
  }
}
