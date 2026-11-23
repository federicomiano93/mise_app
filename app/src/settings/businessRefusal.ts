// businessRefusal.ts — what «New business» says when the business could not be made, in the app's own words.
//
// `createWorkspace` has no dictionary, so its refusals are English; the current app showed them as they came (js/staff/firebase-staff.js
// callFailureText). Mise 2 reads the error's CODE and says its own sentence, so an Italian administrator is never answered in English
// and never sees a raw error. ⚠️ IT READS THE ERROR, NEVER LOGS IT.

import type { MessageKey } from '../i18n/en';

export type BusinessRefusalKey = Extract<MessageKey,
  'newBusiness.err.notAdmin' | 'newBusiness.err.offline' | 'newBusiness.err.failed'>;

// The Functions SDK names its codes `functions/<code>`; the bare code is accepted too.
function codeOf(error: unknown): string {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code.replace(/^functions\//, '') : '';
}

export function businessRefusal(error: unknown): BusinessRefusalKey {
  switch (codeOf(error)) {
    // requireAppAdmin: the screen is drawn only for an administrator, so this is an account that stopped being one meanwhile.
    case 'permission-denied':
      return 'newBusiness.err.notAdmin';
    // No answer: no signal, a timeout, the Functions code not downloaded.
    case 'unavailable':
    case 'deadline-exceeded':
      return 'newBusiness.err.offline';
    default:
      // ⚠️ A phone that knows it is offline says so, whatever the code: the Functions SDK turns a fetch that never left the phone
      // into `internal`.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'newBusiness.err.offline';
      return 'newBusiness.err.failed';
  }
}
