// credentials.ts — what somebody types on the way in: their name.
//
// PARTIAL and ADAPTED port of js/credentials.js for Mise 2 (staff slice 1: the join form of a
// signed-in account asks only for a name and the code). It ports `MAX_NAME_LENGTH`, `cleanName` and
// `nameProblem`; it leaves out the password and email checks (`MIN_PASSWORD_LENGTH`,
// `passwordProblem`, `confirmProblem`, `emailConfirmProblem`), which come with the join form for a
// NEW account (staff slice 2).
//
// ⚠️ ADAPTED: the original `nameProblem` returns finished words from the interface dictionary,
// which in Mise 2 belongs to the app. This one returns the dictionary KEY (the original's own key,
// so the app's dictionary carries the original's words under the same name), and the screen says
// it. credentials.spec.ts runs every case against both files: the original's text must be what its
// own t() says for the key this port returns. Not paired in parity.spec.ts for that reason.
//
// PURE, so the awkward cases can be tested without a browser: a name that is all spaces, a surname
// pasted with a newline in it. Every check here runs BEFORE the network, which matters for a reason
// that is not politeness: a malformed attempt still spends one of the account's five join attempts
// an hour.

// A name is a label on a roster, not an identity. Two people may share one, and nothing anywhere
// decides permissions from it. So this cap is about what fits on a phone screen, not about safety.
export const MAX_NAME_LENGTH = 60;

// Collapse the whitespace somebody's phone put in, and trim. A pasted name can arrive with a
// newline or a non-breaking space in it, and a roster row that wraps for no visible reason looks
// like a broken screen.
export function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

export type NameProblemKey =
  | 'help.enterYourFirstName'
  | 'help.enterYourSurname'
  | 'help.thatFirstNameNeeds'
  | 'help.thatSurnameNeedsLetters';

// What is wrong with this name — the key of the words to say, or null.
//
// ⚠️ IT ANSWERS ABOUT ONE FIELD AT A TIME so the screen can put the cursor in the field that is
// wrong. A single "check your details" tells somebody nothing when two boxes are on screen.
export function nameProblem(value: unknown, which: 'first' | 'last'): NameProblemKey | null {
  const cleaned = cleanName(value);
  if (!cleaned) return which === 'last' ? 'help.enterYourSurname' : 'help.enterYourFirstName';
  // One letter is a legitimate name in plenty of places, so length is not checked downwards. What
  // is refused is a "name" made only of punctuation, which is what an empty form filled in with a
  // dash looks like.
  if (!/\p{Letter}/u.test(cleaned)) {
    return which === 'last' ? 'help.thatSurnameNeedsLetters' : 'help.thatFirstNameNeeds';
  }
  return null;
}
