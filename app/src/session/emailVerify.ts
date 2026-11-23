// emailVerify.ts — the small pure parts of «Check your email» (VerifyEmailView.tsx, JoinScreen.tsx).
//
// A new account must confirm its email before a join code lets it in (functions/onboarding.js requireConfirmedEmail). The
// confirmation email is sent by Firebase Auth; its link opens reset-password.html (the project's email action page), which
// confirms the address and tells the person to come back here and tap «I’ve confirmed».

import type { MessageKey } from '../i18n/en';
import { authCodeOf } from './authErrors';

// ⚠️ THE APP'S OWN START ADDRESS, ON ITS OWN ORIGIN: Firebase carries it in the email's link as `continueUrl`, and the action
// page offers «Open Mise» to it. `base` is Vite's BASE_URL, which may be relative ('./').
export function appStartUrl(base: string, href: string): string {
  return new URL(base, href).href;
}

// What the person is told when sending the email failed. Never Firebase's own text (P17).
export type VerifyNotice = Extract<MessageKey, 'verify.tooMany' | 'verify.cannotSend'>;

export function sendFailureKey(error: unknown): VerifyNotice {
  return authCodeOf(error) === 'auth/too-many-requests' ? 'verify.tooMany' : 'verify.cannotSend';
}
