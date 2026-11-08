// join-hold.js — whether the gate may replace a join form a person has already sent.
//
// ⚠️⚠️ THE RACE THIS EXISTS FOR (review of PR #460, 6 Nov 2026). Joining with a new
// account is two steps: create the account, then redeem the code. Creating the account
// signs the phone in, so the session moves on by itself — 'loading', then 'no-access' —
// and js/auth-gate.js render() answered each move by drawing a NEW screen: the no-access
// message, or a fresh empty code form for an invitation. All of that happened while the
// code was still being checked on the OLD form. When the code was then refused (used,
// expired, offline) the refusal was written into a form nobody could see any more, and
// the person was left looking at empty boxes and no message. His note of 3 Nov 2026 («it
// didn't ask email and password, and knew the right email») is that screen.
//
// So a form that has been sent stays on screen through the states its own sign-up
// causes, and the submit itself decides what comes next (auth-gate.js joinScreen).

// The states a sent form outlives. Every other state is somewhere the person has really
// gone — signed out, or let into a venue — and is drawn as usual.
export const HELD_STATES = Object.freeze(['loading', 'no-access', 'error']);

// `form` is the join form that has been sent, or null: { invited, busy }.
//   busy     — its submit is still running: it is never replaced in a held state.
//   invited  — the invitation the window held when «Join» was tapped ('' for none).
// Once the submit has finished, the form is still kept, so a late session answer does
// not wipe the refusal it shows — unless a NEW invitation has been opened since, which
// deserves its own form.
//
// ⚠️ COMPARED WITH THE INVITATION AT SEND TIME, NOT WITH THE CODE IN THE BOX (code
// review, 6 Nov 2026). An invitation refused as used stays remembered for the life of
// the window, and «I have a code» always builds an empty box: compared with the box, a
// wrong six-digit code typed after that would throw the person back onto the old, used
// invitation, refusal and typed code gone.
export function keepJoinForm(form, status, invitedWith = '') {
  if (!form || !HELD_STATES.includes(status)) return false;
  if (form.busy) return true;
  return !invitedWith || invitedWith === (form.invited || '');
}
