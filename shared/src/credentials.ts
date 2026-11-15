// credentials.ts — what somebody types on the way in: their name, their email twice, a password twice.
//
// FULL and ADAPTED port of js/credentials.js for Mise 2. Staff slice 1 brought the name half (`MAX_NAME_LENGTH`, `cleanName`,
// `nameProblem`); staff slice 2, the join form for a NEW account, brings the rest (`MIN_PASSWORD_LENGTH`, `passwordProblem`,
// `confirmProblem`, `emailConfirmProblem`).
//
// ⚠️ ADAPTED: the original's checks return finished words from the interface dictionary, which in Mise 2 belongs to the app.
// These return the dictionary KEY (the original's own key, so the app's dictionary carries the original's words under the same
// name), and the screen says it — `help.passwordTooShort` with `{ n: MIN_PASSWORD_LENGTH }`. credentials.spec.ts runs every
// case against both files: the original's text must be what its own t() says for the key this port returns. Not paired in
// parity.spec.ts for that reason.
//
// PURE, so the awkward cases can be tested without a browser: a name that is all spaces, a surname pasted with a newline in
// it, a password that is the person's own email address. Every check here runs BEFORE the network, which matters for a reason
// that is not politeness: a malformed attempt still spends one of the account's five join attempts an hour — and a sign-up
// cannot be undone from the form, so an account must never be created for a form that is then refused for its surname.
//
// ⚠️ THE PASSWORD RULE IS A GUARD IN THE APP, NOT A RULE OF THE SERVER, and that has to be said plainly (the original says it
// too): Firebase's own floor is six characters and cannot be raised without a paid tier. This stops the ordinary case —
// somebody choosing `123456` on the one screen where a password is ever chosen — not a determined person.

// ⚠️ TEN, NOT EIGHT. Length is the only property that reliably costs an attacker anything; «a capital and a number» rules
// mostly produce Password1 and teach people to write passwords down.
export const MIN_PASSWORD_LENGTH = 10;

// ⚠️ NOT A DICTIONARY, AND DELIBERATELY SHORT: the handful that show up in every breach report, plus the ones this app invites
// by name. `!` is deliberately NOT mapped to `i`: it is decoration far more often than a substitution.
const LEET: Readonly<Record<string, string>> = { '@': 'a', '4': 'a', '0': 'o', '1': 'i', '3': 'e', '5': 's', '$': 's', '7': 't' };

const OBVIOUS: readonly string[] = [
  'password', 'password1', 'passw0rd', 'letmein', 'welcome', 'qwerty',
  'iloveyou', 'admin', 'abc123', 'football', 'monkey', 'dragon',
  'bakery', 'italianclub', 'theitalianclub',
];

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

export type PasswordProblemKey =
  | 'help.chooseAPassword'
  | 'help.passwordTooShort'
  | 'help.thatOneIsGuessed'
  | 'help.thatIsOneCharacter'
  | 'help.doNotUseYour';

// What is wrong with this password — the key of the words to say (`help.passwordTooShort` takes `{ n: MIN_PASSWORD_LENGTH }`),
// or null. `email` is passed so the commonest bad choice of all can be refused: the address typed two boxes up. Optional; its
// absence weakens the check rather than breaking it.
export function passwordProblem(value: unknown, email?: unknown): PasswordProblemKey | null {
  if (typeof value !== 'string' || !value) return 'help.chooseAPassword';
  if (value.length < MIN_PASSWORD_LENGTH) return 'help.passwordTooShort';

  const lower = value.toLowerCase();
  // ⚠️ TWO NORMALISATIONS, AND BOTH ARE NEEDED. Stripping non-letters catches `password12` and `letmein!!!!`; it does NOT catch
  // `P@ssw0rd!!`, which strips to `psswrd` — the @ and the 0 ARE the letters. So the substitutions are undone first, and then
  // the stripping runs again.
  const stripped = lower.replace(/[^a-z]/g, '');
  const unleet = lower.replace(/[@40135$7]/g, ch => LEET[ch] ?? ch).replace(/[^a-z]/g, '');
  if ([lower, stripped, unleet].some(form => form && OBVIOUS.includes(form))) return 'help.thatOneIsGuessed';

  // Repetition passes a length rule and nothing else: 'aaaaaaaaaa' is ten characters and one guess.
  if (/^(.)\1+$/.test(value)) return 'help.thatIsOneCharacter';

  const local = typeof email === 'string' ? (email.split('@')[0] ?? '').trim().toLowerCase() : '';
  if (local && local.length >= 4 && lower.includes(local)) return 'help.doNotUseYour';

  return null;
}

export type ConfirmProblemKey = 'help.repeatThePassword' | 'help.passwordsDoNotMatch';

// What is wrong with the repeated password — or null. Typed twice because the first is typed into dots: one slip and somebody
// holds an account whose password they have never actually seen. Compared exactly — no trimming — since the first box is sent
// exactly as typed.
export function confirmProblem(value: unknown, repeated: unknown): ConfirmProblemKey | null {
  if (typeof repeated !== 'string' || !repeated) return 'help.repeatThePassword';
  if (repeated !== value) return 'help.passwordsDoNotMatch';
  return null;
}

export type EmailConfirmProblemKey = 'help.repeatTheEmail' | 'help.emailsDoNotMatch';

// What is wrong with the repeated email — or null (his note of 3 Nov 2026: a mistyped address is an account nobody can reset
// the password of; decision D6). Compared trimmed and case-folded, because Firebase itself treats addresses that way.
export function emailConfirmProblem(value: unknown, repeated: unknown): EmailConfirmProblemKey | null {
  if (typeof repeated !== 'string' || !repeated.trim()) return 'help.repeatTheEmail';
  const norm = (s: unknown) => String(s == null ? '' : s).trim().toLowerCase();
  if (norm(repeated) !== norm(value)) return 'help.emailsDoNotMatch';
  return null;
}
