// The limit on wrong six-digit guesses across every account (functions/digits-guard.js).
//
// ⚠️ WHY IT EXISTS (security audit, 23 Sep 2026): the per-account limit could be
// multiplied by signing up again, so a stranger with enough throwaway accounts could
// search a million codes. This counter is the one a search cannot multiply.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DIGITS_GUARD_DOC, MAX_WRONG_DIGITS_PER_HOUR,
  digitsPaused, pauseLeftMs, withWrongGuess,
} from '../functions/digits-guard.js';
import { ATTEMPT_WINDOW_MS, redeemFailureText } from '../functions/join-code.js';

const NOW = 1_800_000_000_000;
const guesses = (n, at = NOW - 1000) => ({ attempts: Array(n).fill(at) });

test('the counter lives in a collection no client can reach', () => {
  // No rule names it, so the default-deny block refuses every phone — the same
  // protection rate-limits/{uid} has.
  assert.equal(DIGITS_GUARD_DOC, 'rate-limits-global/digits');
});

test('nothing is paused before the limit, everything is at it', () => {
  assert.equal(digitsPaused(null, NOW), false);
  assert.equal(digitsPaused(guesses(MAX_WRONG_DIGITS_PER_HOUR - 1), NOW), false);
  assert.equal(digitsPaused(guesses(MAX_WRONG_DIGITS_PER_HOUR), NOW), true);
});

test('the limit is small enough to make a search hopeless', () => {
  // One live code lives 24 hours. At this rate it faces at most 24 × limit guesses
  // in its whole life, out of a million possible codes.
  const perCodeLife = 24 * MAX_WRONG_DIGITS_PER_HOUR;
  assert.ok(perCodeLife / 1_000_000 < 0.001,
    `a live code would face ${perCodeLife} guesses — more than one chance in a thousand`);
});

test('guesses older than an hour are forgotten, so the pause lifts by itself', () => {
  const old = guesses(MAX_WRONG_DIGITS_PER_HOUR, NOW - ATTEMPT_WINDOW_MS - 1);
  assert.equal(digitsPaused(old, NOW), false);
});

test('the time left is how long until the oldest counted guess leaves the hour', () => {
  const record = { attempts: [NOW - 10 * 60_000, ...Array(MAX_WRONG_DIGITS_PER_HOUR - 1).fill(NOW)] };
  assert.equal(pauseLeftMs(record, NOW), ATTEMPT_WINDOW_MS - 10 * 60_000);
  assert.equal(pauseLeftMs(guesses(3), NOW), 0, 'not paused: nothing to wait for');
});

test('a wrong guess adds one moment, and the document cannot grow for ever', () => {
  const next = withWrongGuess(guesses(2), NOW);
  assert.equal(next.attempts.length, 3);
  assert.equal(next.attempts.at(-1), NOW);
  assert.equal(next.updatedAt, NOW);

  let record = null;
  for (let i = 0; i < MAX_WRONG_DIGITS_PER_HOUR * 5; i++) record = withWrongGuess(record, NOW);
  assert.ok(record.attempts.length <= MAX_WRONG_DIGITS_PER_HOUR * 2,
    `the counter grew to ${record.attempts.length} entries`);
  assert.equal(digitsPaused(record, NOW), true);
});

test('rubbish in the stored counter is not counted as a guess', () => {
  assert.equal(digitsPaused({ attempts: Array(50).fill('not a time') }, NOW), false);
  assert.equal(digitsPaused({ attempts: 'nope' }, NOW), false);
  // A moment in the FUTURE is not a guess either: a clock skew must not pause the door.
  assert.equal(digitsPaused(guesses(MAX_WRONG_DIGITS_PER_HOUR, NOW + 60_000), NOW), false);
});

test('the words say nothing about any code, and point at the way in that stays open', () => {
  const text = redeemFailureText('digits-paused', 30 * 60_000);
  assert.match(text, /link/i);
  // Whole words: «paused» contains «used».
  assert.doesNotMatch(text, /\b(expired|used|exists|locked)\b/i);
});
