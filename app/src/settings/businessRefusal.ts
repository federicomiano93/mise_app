// businessRefusal.ts — what «New business» says when the business could not be made, in the app's own words.
//
// `createWorkspace` has no dictionary, so its refusals are English; the current app showed them as they came (js/staff/firebase-staff.js
// callFailureText). Mise 2 reads the error's CODE and says its own sentence, so an Italian administrator is never answered in English
// and never sees a raw error. ⚠️ IT READS THE ERROR, NEVER LOGS IT.

import type { MessageKey } from '../i18n/en';

export type BusinessRefusalKey = Extract<MessageKey,
  'newBusiness.err.notAdmin' | 'newBusiness.err.maybe' | 'newBusiness.err.failed'>;

// The Functions SDK names its codes `functions/<code>`; the bare code is accepted too.
function codeOf(error: unknown): string {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code.replace(/^functions\//, '') : '';
}

// ⚠️ «NOTHING WAS CREATED» IS SAID ONLY WHEN THE SERVER ANSWERED THAT IT REFUSED (a bad request, no sign-in). Every other failure — a
// timeout, no signal, `internal`, `unknown`, an answer that arrived unreadable — may have come AFTER the business was made, and a retry
// would then make a second one: those say it may exist, and to look before trying again.
export function businessRefusal(error: unknown): BusinessRefusalKey {
  switch (codeOf(error)) {
    // requireAppAdmin: the screen is drawn only for an administrator, so this is an account that stopped being one meanwhile.
    case 'permission-denied':
      return 'newBusiness.err.notAdmin';
    case 'invalid-argument':
    case 'unauthenticated':
      return 'newBusiness.err.failed';
    default:
      return 'newBusiness.err.maybe';
  }
}
