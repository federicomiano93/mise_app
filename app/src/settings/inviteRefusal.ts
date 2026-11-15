// inviteRefusal.ts — what «Who can get in» says when an invitation cannot be made, in the app's own words.
//
// The function `createJoinCode` has no dictionary, so its refusals are English; the current app showed them as they came
// (js/staff/firebase-staff.js callFailureText). Mise 2 reads the error's CODE and says its own sentence, so an Italian owner is
// never answered in English (the same rule as session/joinErrors.ts for the join form).
//
// ⚠️ IT READS THE ERROR, NEVER LOGS IT: the caller decides what goes to the console, and a code minted by a call that then failed
// was never shown to anybody.

import type { MessageKey } from '../i18n/en';

export type InviteRefusalKey = Extract<MessageKey,
  'people.err.notOwner' | 'people.add.digitsStaffOnly' | 'people.err.code' | 'people.err.failed'>;

// The Functions SDK names its codes `functions/<code>`; the bare code is accepted too.
function codeOf(error: unknown): string {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code.replace(/^functions\//, '') : '';
}

export function inviteRefusal(error: unknown): InviteRefusalKey {
  switch (codeOf(error)) {
    // requireOwner: anybody whose role is not exactly 'owner' — the screen is not drawn for them, so this is a role changed meanwhile.
    case 'permission-denied':
      return 'people.err.notOwner';
    // Six digits asked for anybody but an employee. The screen does not offer it, so this is the server keeping its own rule.
    case 'failed-precondition':
      return 'people.add.digitsStaffOnly';
    // The call never got an answer: no signal, a timeout, the Functions code not downloaded.
    case 'unavailable':
    case 'deadline-exceeded':
      return 'people.err.code';
    default:
      // ⚠️ NO SIGNAL IS NOT `unavailable`: the Functions SDK turns a fetch that never left the phone into `internal` (HTTP status 0),
      // and a failed download of the SDK itself has no code at all. A phone that knows it is offline says so, whatever the code.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'people.err.code';
      return 'people.err.failed';
  }
}
