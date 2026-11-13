// join-hold.ts — whether the gate may replace a join form a person has already sent.
//
// TypeScript port of js/join-hold.js for Mise 2. Behaviour is identical, input for input:
// join-hold.spec.ts runs every test against BOTH files and parity.spec.ts compares their exports.
//
// ⚠️⚠️ THE RACE THIS EXISTS FOR (review of PR #460, 6 Nov 2026; current-app fix 9e0a2dac). Joining
// with a new account is two steps: create the account, then redeem the code. Creating the account
// signs the phone in, so the session moves on by itself — 'loading', then 'no-access' — and the gate
// answered each move by drawing a NEW screen while the code was still being checked on the OLD
// form. When the code was then refused (used, expired, offline) the refusal was written into a form
// nobody could see any more, and the person was left looking at empty boxes and no message.
//
// So a form that has been sent stays on screen through the states its own sending causes, and the
// submit itself decides what comes next (app/src/session/JoinScreen.tsx in Mise 2).

// The states a sent form outlives. Every other state is somewhere the person has really gone —
// signed out, or let into a venue — and is drawn as usual.
export const HELD_STATES = Object.freeze(['loading', 'no-access', 'error'] as const);

// The join form that has been sent, or null.
//   busy     — its submit is still running: it is never replaced in a held state.
//   invited  — the invitation the window held when «Join» was tapped ('' for none).
export interface SentJoinForm {
  readonly busy?: boolean;
  readonly invited?: string;
}

// Once the submit has finished, the form is still kept, so a late session answer does not wipe the
// refusal it shows — unless a NEW invitation has been opened since, which deserves its own form.
//
// ⚠️ COMPARED WITH THE INVITATION AT SEND TIME, NOT WITH THE CODE IN THE BOX (code review, 6 Nov
// 2026). An invitation refused as used stays remembered for the life of the window, and «I have a
// code» always builds an empty box: compared with the box, a wrong six-digit code typed after that
// would throw the person back onto the old, used invitation, refusal and typed code gone.
export function keepJoinForm(form: SentJoinForm | null | undefined, status: string, invitedWith: string = ''): boolean {
  if (!form || !(HELD_STATES as readonly string[]).includes(status)) return false;
  if (form.busy) return true;
  return !invitedWith || invitedWith === (form.invited || '');
}
