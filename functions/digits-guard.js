// digits-guard.js — the limit on wrong six-digit guesses across EVERY account.
//
// ⚠️ WHY THE PER-ACCOUNT LIMIT WAS NOT ENOUGH (security audit, 23 Sep 2026). Six
// digits are a million codes. rate-limits/{uid} allows five tries an hour to ONE
// account, but sign-up is open to anybody: a stranger with a hundred throwaway
// accounts had five hundred tries an hour, and a wrong guess touches no document, so
// no code ever lost one of its five lives to it. This counter is the one thing a
// search cannot multiply by making more accounts.
//
// ⚠️⚠️ WHAT IT COSTS, AND FEDERICO CHOSE IT KNOWINGLY: once the limit is reached,
// six-digit codes are PAUSED FOR EVERYBODY until the hour rolls on. Somebody flooding
// the door can therefore keep it shut. What stays open is the invitation LINK — 32
// random characters, which no search reaches — so the way in is never closed, only
// the short spoken one. The alternative, longer codes, would have been paid by every
// person typing one at a counter.
//
// PURE, like join-code.js beside it: no database, no framework. The transaction that
// reads and writes the counter lives in onboarding.js; every decision is here, where
// the root test suite can run it (tests/digits-guard.test.mjs).

import { recentAttempts, ATTEMPT_WINDOW_MS } from './join-code.js';

// The one document the counter lives in. Admin SDK only: the collection has no rule
// of its own, so the default-deny block at the foot of firestore.rules refuses every
// client — the same protection rate-limits/{uid} has.
export const DIGITS_GUARD_DOC = 'rate-limits-global/digits';

// ⚠️ TWENTY AN HOUR, FOR THE WHOLE APP. Real people mistype a code now and then; twenty
// wrong ones in an hour across every venue is not a typo, it is a search. At this rate
// one live code — alive 24 hours — faces at most 480 guesses in its life: about one
// chance in two thousand, against effectively unlimited before.
export const MAX_WRONG_DIGITS_PER_HOUR = 20;

export function digitsPaused(record, now = Date.now()) {
  return recentAttempts(record, now).length >= MAX_WRONG_DIGITS_PER_HOUR;
}

// How long until the oldest counted guess falls out of the hour.
export function pauseLeftMs(record, now = Date.now()) {
  const recent = recentAttempts(record, now);
  if (recent.length < MAX_WRONG_DIGITS_PER_HOUR) return 0;
  const oldest = Math.min(...recent.map(Number));
  return Math.max(0, ATTEMPT_WINDOW_MS - (now - oldest));
}

// The counter after one more wrong guess. Trimmed on every write, so the document
// cannot grow for ever however long a search goes on.
export function withWrongGuess(record, now = Date.now()) {
  const kept = recentAttempts(record, now).map(Number);
  return {
    attempts: [...kept, now].slice(-MAX_WRONG_DIGITS_PER_HOUR * 2),
    updatedAt: now,
  };
}
