// join-code.ts — the one thing that lets a new person into a location.
//
// TypeScript port of js/join-code.js for Mise 2. Behaviour is identical, input for input:
// shared/src/join-code.spec.ts runs every test against BOTH files and parity.spec.ts compares
// their exports, so a fix made to one and forgotten in the other turns something red. The
// comments below are the ones the original paid for in bugs; they are kept on purpose.
//
// ⚠️ THIS IS THE ONLY DOOR THIS APP HAS EVER OPENED FROM THE INSIDE. Until now,
// membership was written by hand in the Firebase console and by nothing else,
// which is exactly what made it a boundary between two businesses. That cannot
// survive selling the app: every customer would be half an hour of console, with
// an invisible typo waiting (a trailing space in a field name already cost this
// project half an hour once). So a Cloud Function writes it instead — after
// checking a code that came from somebody who was already allowed to hand it out.
//
// ⚠️ THE APP CANNOT BE TRUSTED WITH THIS AND IS NOT. users/{uid} is still
// `allow write: if false` for every client. The decisions below run on the
// server with the Admin SDK; this file is PURE so those decisions can be tested
// without a database, and so the phone can use the same rules to tell somebody
// their code is malformed before spending a network round trip on it.
//
// ⚠️ IT HAS NO IMPORTS, ON PURPOSE. The server (a Cloud Function) and the browser both run
// this logic, and the server has no dictionary, no DOM and none of the app's modules. Every
// function takes the clock as an argument (`now`) instead of reading it from somewhere else.

// Two shapes, because they are handed over in two completely different ways.
//
//   'digits'  six digits, read aloud by an owner to somebody standing next to
//             them. Short because it is TYPED, and kitchen staff often have no
//             email address they actually read on a phone — which is why this is
//             a code at all and not an email invite.
//
//   'link'    a long random token inside a URL, sent to a new customer over
//             WhatsApp or email. Nobody types it, so it can be as long as it
//             likes, and it is the owner's own first way in.
//
// ⚠️ SIX DIGITS IS A MILLION, AND A CALLABLE IS REACHABLE BY ANYONE who knows the
// project id — which is public. Short is only safe because of the limits below,
// and they work together: remove any one and the code becomes guessable.
export const CODE_KINDS = Object.freeze(['digits', 'link'] as const);
export type JoinCodeKind = (typeof CODE_KINDS)[number];
export const DIGITS_LENGTH = 6;
export const LINK_LENGTH = 32;

const HOUR = 60 * 60 * 1000;

// ⚠️⚠️ HOW LONG A CODE LIVES IS DECIDED BY ITS PURPOSE, NOT BY ITS SHAPE — and
// this file already contained the argument for that before it was written down.
//
// The table used to read `{ digits: 24h, link: 7d }` and the comment above it
// reasoned in words about PURPOSE — "a staff code", "the owner link" — because
// while every staff invitation was six digits, shape and purpose were the same
// fact wearing two names. They came apart the day a staff invitation could also
// be a link. Keying on the shape would then have handed a staff link the
// customer's seven days, which is the exact thing the old comment warned
// against: "a week would leave a live key in a WhatsApp thread nobody rereads".
//
//   'staff'     hiring somebody into a location that already exists. They are
//               standing in the kitchen, or they start tomorrow. A day is
//               already generous.
//   'customer'  selling the app to a stranger. It travels to somebody who may
//               not be at their desk, and it is the only thing standing between
//               them and their new app.
//
// ⚠️ CHANGING THIS TABLE CANNOT DISTURB A CODE THAT ALREADY EXISTS. It is read
// once, at minting, and what is stored is an absolute `expiresAt`.
export const PURPOSES = Object.freeze(['staff', 'customer'] as const);
export type JoinCodePurpose = (typeof PURPOSES)[number];
// Typed by purpose only: a SHAPE ('digits' / 'link') has no lifetime of its own, and a
// key of that kind is a compile error here as well as a failing test.
export const TTL_MS: Readonly<Record<JoinCodePurpose, number>> = Object.freeze({
  staff: 24 * HOUR,
  customer: 7 * 24 * HOUR,
});

// Per CODE. ⚠️ It does NOT stop a search (security audit, 7 Oct 2026): codes are stored
// under their hash, so a wrong guess never reaches the real code's document. It only
// counts tries of the RIGHT code after it has expired. What bounds a search is the
// per-account limit below and the app-wide six-digit pause (digits-guard.js) — which
// is why six digits only ever make an employee.
export const MAX_FAILED_ATTEMPTS = 5;

// Per ACCOUNT per hour, which is the limit that actually bounds a search: the
// caller must be signed in, so there is always a uid to count against. Five an
// hour over a whole day is 120 guesses before the code expires anyway — to cover
// a million you would need thousands of accounts, and Firebase Auth rate-limits
// sign-ups on its own.
// ⚠️ NOT ENOUGH ON ITS OWN, AND THE AUDIT OF 23 SEP 2026 SAID SO: throwaway accounts
// multiply it, and parallel calls used to slip past it. The server now counts wrong
// six-digit guesses across EVERY account too (functions/digits-guard.js).
export const MAX_ATTEMPTS_PER_HOUR = 5;
export const ATTEMPT_WINDOW_MS = HOUR;

// ── The documents ────────────────────────────────────────────────────────────

// join-codes/{sha256 of the code} as the server writes it (Admin SDK only). The functions
// below accept `unknown` for it, because what they read may be missing, half-written or
// corrupt — see codeStatus().
export interface JoinCodeDoc {
  kind: JoinCodeKind;
  // Absent on a code minted before the errand was recorded; those are read by their shape.
  purpose?: JoinCodePurpose;
  locationId: string;
  role: 'staff' | 'manager' | 'owner';
  title: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  failedAttempts: number;
  usedAt: number | null;
  usedBy: string | null;
  // Set when a newer link replaced this one (the old link is marked used at the same time).
  revokedBy?: string;
}

// The only fields of a code document these functions look at, each as untrusted as it is.
interface JoinCodeFields {
  usedAt?: unknown;
  failedAttempts?: unknown;
  expiresAt?: unknown;
}

// rate-limits/{uid}: the moments an account tried a code (and, app-wide, a wrong six-digit
// guess). Only `attempts` is read here.
interface AttemptsFields {
  attempts?: unknown;
}

// ── What somebody typed ──────────────────────────────────────────────────────

// People type codes with spaces in the middle, and phones like to capitalise the
// first character of anything. Neither should be a wrong answer.
//
// ⚠️ CASE IS FOLDED FOR DIGITS AND KEPT FOR A LINK. A six-digit code has no
// letters, so folding costs nothing and forgives the keyboard; a link token uses
// upper and lower case to be short, so folding it would destroy it.
export function normalizeTyped(input: unknown, kind: JoinCodeKind = 'digits'): string {
  const raw = String(input == null ? '' : input).trim();
  if (kind === 'link') return raw;
  return raw.replace(/[\s-]/g, '');
}

// ⚠️ IT REQUIRES A STRING AND DOES NOT COERCE ONE. normalizeTyped() above is
// forgiving because it handles what a person typed; this decides whether
// something may be used as a key, and there quietly turning the number 123456
// into "123456" hides a caller that has already lost track of what it is
// holding. Strict is the safe direction for the one function guarding the door.
export function isWellFormed(code: unknown, kind: JoinCodeKind = 'digits'): boolean {
  if (typeof code !== 'string') return false;
  if (kind === 'link') return /^[A-Za-z0-9_-]{32,64}$/.test(code);
  return new RegExp(`^[0-9]{${DIGITS_LENGTH}}$`).test(code);
}

// ── Whether a stored code may still be redeemed ──────────────────────────────

// Every answer that is not 'ok' is a refusal, and they are kept apart because
// the person on the other end can act on the difference: an expired code needs a
// new one, a used code means somebody already joined, and a locked one means
// something is wrong. They are NOT all reported to the caller — see
// redeemFailureText — but the server logs which, and a quiet failure with no
// reason in the log is indistinguishable from a broken function.
export type CodeStatus = 'missing' | 'used' | 'locked' | 'expired' | 'ok';

export function codeStatus(doc: unknown, now: number = Date.now()): CodeStatus {
  if (!doc || typeof doc !== 'object') return 'missing';
  // `doc` is an object here; its fields are read as untrusted values, never trusted types.
  const fields = doc as JoinCodeFields;
  if (fields.usedAt) return 'used';
  if (Number(fields.failedAttempts) >= MAX_FAILED_ATTEMPTS) return 'locked';
  const expiresAt = Number(fields.expiresAt);
  // ⚠️ AN UNREADABLE EXPIRY IS TREATED AS EXPIRED, not as "no expiry". This is
  // the opposite direction from the app's usual "widen on doubt", and it is the
  // right one here: a code is a key, and a key whose lifetime nobody can read
  // must not be immortal.
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return 'expired';
  return 'ok';
}

export function isRedeemable(doc: unknown, now: number = Date.now()): boolean {
  return codeStatus(doc, now) === 'ok';
}

// ── How hard somebody has been trying ────────────────────────────────────────

// The attempts an account has made inside the last hour. Anything older is not
// forgiven so much as forgotten: the point is to slow a search down, not to
// punish somebody who mistyped a code last Tuesday.
//
// It hands back the entries EXACTLY as stored (a numeric string that Number() accepts is
// kept as that string), which is why the element type is `unknown` and not `number`;
// callers that need numbers convert them, as functions/digits-guard.js does.
export function recentAttempts(record: unknown, now: number = Date.now()): unknown[] {
  const stored = record && (record as AttemptsFields).attempts;
  const list: unknown[] = Array.isArray(stored) ? stored : [];
  return list.filter(at => {
    const t = Number(at);
    return Number.isFinite(t) && now - t < ATTEMPT_WINDOW_MS && t <= now;
  });
}

export function isRateLimited(record: unknown, now: number = Date.now()): boolean {
  return recentAttempts(record, now).length >= MAX_ATTEMPTS_PER_HOUR;
}

// When the account may try again — for a message a person can act on, rather
// than "try later", which tells them nothing and gets the app blamed.
export function retryAfterMs(record: unknown, now: number = Date.now()): number {
  const attempts = recentAttempts(record, now);
  if (attempts.length < MAX_ATTEMPTS_PER_HOUR) return 0;
  // The entries are numbers or numeric strings (recentAttempts keeps them as stored);
  // Math.min converts each one itself, exactly as the original does.
  const oldest = Math.min(...(attempts as number[]));
  return Math.max(0, ATTEMPT_WINDOW_MS - (now - oldest));
}

// ── What the person is told ──────────────────────────────────────────────────

// Every refusal the server can give. Anything else is accepted too and gets the plain
// "does not work" sentence, so the parameter stays open to any string.
export type RedeemRefusal = Exclude<CodeStatus, 'ok'> | 'rate-limited' | 'already-member' | 'digits-paused';

// ⚠️ EVERY REFUSAL SOUNDS THE SAME EXCEPT THREE, and that is deliberate. Telling
// somebody "that code has expired" confirms the code EXISTED, which is exactly
// the signal a search wants.
//
// Two of the exceptions say something about the ACCOUNT asking, never about the
// code: the rate limit reports how often this account has tried, and
// 'already-member' is only ever reached by an account that is already inside the
// location the code names — so it tells them a fact they are living in.
//
// ⚠️ THIS ONE STAYS IN ENGLISH AND MUST. It is thrown by the server (three call
// sites in functions/onboarding.js), and the server has no dictionary — this
// logic runs there too, so importing one would work on this machine and be
// MISSING in the cloud. It also could not know which language to pick:
// whoever is redeeming has no location open yet, which is the entire point.
// Translating it means the server sending a status and the app choosing the
// words — a real piece of work, and it must not confirm that a code exists.
export function redeemFailureText(status: RedeemRefusal | (string & {}), retryMs: number = 0): string {
  if (status === 'rate-limited') {
    const mins = Math.max(1, Math.ceil(retryMs / 60000));
    return `Too many tries. Wait ${mins} minute${mins === 1 ? '' : 's'} and try again.`;
  }
  // ⚠️ A CODE MAY NOT CHANGE WHAT SOMEBODY ALREADY IN CAN DO, and this sentence
  // says so rather than pretending the code was faulty. redeemJoinCode refuses
  // before writing anything, because the write it would otherwise do OVERWRITES
  // the membership — a staff code opened by the owner of that business used to
  // make them an employee of it.
  if (status === 'already-member') {
    return 'You are already in this business. A code cannot change what you can do here.';
  }
  // ⚠️ A THIRD EXCEPTION, AND IT TOO SAYS NOTHING ABOUT ANY CODE: six-digit codes are
  // paused for EVERYBODY after too many wrong guesses across the app
  // (functions/digits-guard.js). It points at the one way in that stays open.
  if (status === 'digits-paused') {
    return 'Six-digit codes are paused for a while. Ask for an invitation link instead.';
  }
  return 'That code does not work. Ask for a new one.';
}

// How long a code has left: a NUMBER and a UNIT, never words.
//
// ⚠️⚠️ IT RETURNED ENGLISH UNTIL 13 AUG 2026, AND THREE SCREENS DROPPED THAT
// ENGLISH STRAIGHT INTO A TRANSLATED SENTENCE. In Italian, "Who can get in" read
// «Entrerà come dipendente, e il codice ha 24 hours left» — the same defect, and
// the same shape, as «sono prodotte in English» a release earlier: a sentence
// that is translated everywhere except the hole in the middle of it.
//
// ⚠️ AND IT COULD NOT BE FIXED HERE. This logic also runs on the server, which has no
// dictionary. So the arithmetic stays (it is the same on both sides and testable without a
// dictionary) and the WORDS live with the screens, which know the language.
//
// Deliberately coarse: a countdown to the second invites somebody to watch it.
export type ExpiresIn =
  | { unit: 'expired'; n: 0 }
  | { unit: 'minutes' | 'hours' | 'days'; n: number };

export function expiresIn(doc: unknown, now: number = Date.now()): ExpiresIn {
  const left = Number(doc && (doc as JoinCodeFields).expiresAt) - now;
  if (!Number.isFinite(left) || left <= 0) return { unit: 'expired', n: 0 };
  // ⚠️ NEVER "0 minutes left" — a code with forty seconds on it is still alive,
  // and a screen saying zero reads as one that is not. Round up the last minute.
  const mins = Math.max(1, Math.round(left / 60000));
  if (mins < 60) return { unit: 'minutes', n: mins };
  const hours = Math.round(left / HOUR);
  if (hours < 48) return { unit: 'hours', n: hours };
  return { unit: 'days', n: Math.round(hours / 24) };
}
