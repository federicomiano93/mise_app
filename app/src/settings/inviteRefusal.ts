// inviteRefusal.ts — what «Who can get in» says when an invitation cannot be made, or a change to somebody in the list cannot be made
// (staff slice 4), in the app's own words.
//
// The functions (`createJoinCode`, `setMemberRole`, `setMemberName`) have no dictionary, so its refusals are English; the current app showed them as they came
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

// A phone that knows it is offline. ⚠️ NO SIGNAL IS NOT `unavailable`: the Functions SDK turns a fetch that never left the phone into
// `internal` (HTTP status 0), and a failed download of the SDK itself has no code at all.
function knownOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
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
      // A phone that knows it is offline says so, whatever the code.
      if (knownOffline()) return 'people.err.code';
      return 'people.err.failed';
  }
}

// ── The people list (staff slice 4) ─────────────────────────────────────────────────────────────────────────────────────────────

// What was being done to the person: their role changed, their name, or their removal (`setMemberRole` with role null).
export type MemberAction = 'role' | 'name' | 'remove';

export type MemberRefusalKey = Extract<MessageKey,
  'people.err.ownerOnly' | 'people.err.lastOwner' | 'people.err.gone'
  | 'people.err.change' | 'people.err.name' | 'people.err.remove' | 'people.err.tryAgain'>;

// No answer: the current app's three sentences, each saying to check the connection.
const NO_ANSWER: Readonly<Record<MemberAction, MemberRefusalKey>> = {
  role: 'people.err.change',
  name: 'people.err.name',
  remove: 'people.err.remove',
};

// ⚠️ EVERY CODE BELOW IS ONE THE FUNCTIONS THROW FOR ONE CASE ONLY (functions/onboarding.js), so the sentence is never a guess:
//   permission-denied    requireOwner — the caller is not (or no longer) the full owner;
//   failed-precondition  setMemberRole — the last owner would be demoted or removed (setMemberName never throws it);
//   not-found            the person is not in this venue any more (removed meanwhile, on another phone);
//   invalid-argument     a malformed call (a uid, a role, both names blank) — the screen never sends one, so it is a failure.
export function memberRefusal(error: unknown, action: MemberAction): MemberRefusalKey {
  switch (codeOf(error)) {
    case 'permission-denied':
      return 'people.err.ownerOnly';
    case 'failed-precondition':
      return action === 'name' ? 'people.err.tryAgain' : 'people.err.lastOwner';
    case 'not-found':
      return 'people.err.gone';
    case 'unavailable':
    case 'deadline-exceeded':
      return NO_ANSWER[action];
    default:
      if (knownOffline()) return NO_ANSWER[action];
      return 'people.err.tryAgain';
  }
}
