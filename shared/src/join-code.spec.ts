// Unit tests for the only door this app opens from the inside (P15), run against BOTH
// implementations: the TypeScript port in shared/ and the js/ file the live app uses today.
// Ported from tests/join-code.test.mjs (plus the one test in tests/join-link.test.mjs that
// calls a join-code export); the two must stay equal until the switch to Mise 2.
//
// ⚠️ THE LIMITS ONLY WORK TOGETHER. Six digits is a million combinations, and a
// callable function is reachable by anyone who knows the project id — which is
// public. What makes that safe is the whole set: a short life, a cap per code, a
// cap per account per hour, and single use. Each test below pins one of them, so
// removing any one turns something red rather than quietly halving the cost of a
// search.

import { describe, expect, test } from 'vitest';
import * as ported from './join-code';
import * as legacyJs from '../../js/join-code.js';

const legacy = legacyJs as unknown as typeof ported;

const NOW = Date.UTC(2026, 7, 11, 12, 0, 0);
const live = (extra: Record<string, unknown> = {}) => ({ expiresAt: NOW + 60_000, failedAttempts: 0, ...extra });

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  // ── What somebody typed ──────────────────────────────────────────────────────

  test('a typed code forgives spaces and dashes', () => {
    expect(m.normalizeTyped(' 123 456 ')).toBe('123456');
    expect(m.normalizeTyped('123-456')).toBe('123456');
    expect(m.normalizeTyped('123456')).toBe('123456');
  });

  // ⚠️ A link token uses upper and lower case to stay short, so folding case would
  // destroy it. A digits code has no letters, so nothing is lost by trimming only.
  test('a link token keeps its case; only the ends are trimmed', () => {
    const token = 'aB3-_x'.repeat(6).slice(0, 36);
    expect(m.normalizeTyped(`  ${token}  `, 'link')).toBe(token);
  });

  test('well-formed means exactly six digits, nothing else', () => {
    expect(m.isWellFormed('123456')).toBe(true);
    for (const bad of ['12345', '1234567', '12345a', '', '  ', null, undefined, 123456]) {
      expect(m.isWellFormed(bad), String(bad)).toBe(false);
    }
    expect(m.DIGITS_LENGTH).toBe(6);
  });

  test('a link token has to be long', () => {
    expect(m.isWellFormed('a'.repeat(32), 'link')).toBe(true);
    expect(m.isWellFormed('a'.repeat(31), 'link')).toBe(false);
    expect(m.isWellFormed('a'.repeat(65), 'link')).toBe(false);
    expect(m.isWellFormed('has spaces in it and is long enough!!', 'link')).toBe(false);
  });

  // From tests/join-link.test.mjs, the one test there that reads a join-code export.
  test('the token is a real 32-character link token', () => {
    const token = 'aB3dEf6hIj9lMn2pQr5tUv8xYz1CdEf4'; // 32, the real shape
    expect(token.length).toBe(m.LINK_LENGTH);
  });

  // ── Whether a stored code may still be redeemed ──────────────────────────────

  test('a live, unused, untried code is redeemable', () => {
    expect(m.codeStatus(live(), NOW)).toBe('ok');
    expect(m.isRedeemable(live(), NOW)).toBe(true);
  });

  test('single use: a code that let somebody in is spent', () => {
    expect(m.codeStatus(live({ usedAt: NOW - 1000 }), NOW)).toBe('used');
    expect(m.isRedeemable(live({ usedAt: NOW - 1000 }), NOW)).toBe(false);
  });

  test('a code dies after five wrong guesses', () => {
    expect(m.codeStatus(live({ failedAttempts: m.MAX_FAILED_ATTEMPTS - 1 }), NOW)).toBe('ok');
    expect(m.codeStatus(live({ failedAttempts: m.MAX_FAILED_ATTEMPTS }), NOW)).toBe('locked');
    expect(m.MAX_FAILED_ATTEMPTS).toBe(5);
  });

  test('an expired code is refused, on the exact millisecond', () => {
    expect(m.codeStatus({ expiresAt: NOW + 1 }, NOW)).toBe('ok');
    expect(m.codeStatus({ expiresAt: NOW }, NOW)).toBe('expired');
    expect(m.codeStatus({ expiresAt: NOW - 1 }, NOW)).toBe('expired');
  });

  // ⚠️ THE DIRECTION THAT MATTERS. Everywhere else this app widens on doubt — an
  // unknown setting falls back to the most generous reading. A key is the opposite:
  // one whose lifetime cannot be read must not be immortal.
  test('an unreadable expiry means expired, never "no expiry"', () => {
    for (const bad of [undefined, null, 'soon', NaN, {}, Infinity]) {
      expect(m.codeStatus({ expiresAt: bad }, NOW), String(bad)).toBe('expired');
    }
  });

  test('a code that is not there at all is missing, not ok', () => {
    for (const nothing of [null, undefined, '', 0, 'code']) {
      expect(m.codeStatus(nothing, NOW), String(nothing)).toBe('missing');
      expect(m.isRedeemable(nothing, NOW), String(nothing)).toBe(false);
    }
  });

  test('a staff invitation lasts a day and a customer link a week', () => {
    expect(m.TTL_MS.staff).toBe(24 * 60 * 60 * 1000);
    expect(m.TTL_MS.customer).toBe(7 * 24 * 60 * 60 * 1000);
    expect([...m.PURPOSES]).toStrictEqual(['staff', 'customer']);
    expect([...m.CODE_KINDS]).toStrictEqual(['digits', 'link']);
  });

  // ⚠️⚠️ THE POINT OF SPLITTING THEM, AND THE ONLY REASON THIS TEST EXISTS.
  //
  // The lifetime used to be keyed by SHAPE — `{ digits: 24h, link: 7d }` — which
  // was right for exactly as long as a staff invitation was always six digits.
  // The day one could travel as a link, that table would have handed it the
  // customer's SEVEN DAYS: a live key sitting in a WhatsApp thread for six days
  // longer than anybody intended, which is the precise thing the comment beside
  // that table had always warned against.
  //
  // A shape must therefore have no lifetime of its own. If somebody puts one back,
  // this fails and says why.
  test('a SHAPE has no lifetime — only an errand does', () => {
    // Read through a wider type: the TypeScript table has no `digits` or `link` key at all,
    // which is the point, so the question has to be asked of an open record.
    const ttl: Readonly<Record<string, number | undefined>> = m.TTL_MS;
    expect(ttl.digits,
      'six digits sent for hiring and six digits sent for a sale would live equally long — the errand decides').toBe(undefined);
    expect(ttl.link, 'a staff link must not inherit the customer link’s week').toBe(undefined);
    for (const purpose of m.PURPOSES) {
      expect(Number.isFinite(ttl[purpose]), `${purpose} needs a lifetime`).toBeTruthy();
    }
  });

  // ── How hard somebody has been trying ────────────────────────────────────────

  test('only attempts inside the last hour count', () => {
    const record = { attempts: [NOW - 30_000, NOW - m.ATTEMPT_WINDOW_MS - 1, NOW - 1000] };
    expect(m.recentAttempts(record, NOW).length).toBe(2);
  });

  test('five tries an hour, and the sixth is blocked', () => {
    const four = { attempts: Array(4).fill(NOW - 1000) };
    const five = { attempts: Array(5).fill(NOW - 1000) };
    expect(m.isRateLimited(four, NOW)).toBe(false);
    expect(m.isRateLimited(five, NOW)).toBe(true);
    expect(m.MAX_ATTEMPTS_PER_HOUR).toBe(5);
  });

  test('a corrupt or missing attempts record does not block anybody', () => {
    for (const broken of [null, undefined, {}, { attempts: 'lots' }, { attempts: null }]) {
      expect(m.isRateLimited(broken, NOW), String(broken)).toBe(false);
    }
  });

  test('rubbish inside the attempts list is ignored rather than counted', () => {
    const record = { attempts: ['soon', null, NaN, NOW + 60_000, NOW - 1000] };
    expect(m.recentAttempts(record, NOW).length, 'only the one real, past attempt').toBe(1);
  });

  test('the wait is measured from the OLDEST attempt in the window', () => {
    const record = { attempts: [NOW - 50 * 60_000, NOW - 1000, NOW - 900, NOW - 800, NOW - 700] };
    const wait = m.retryAfterMs(record, NOW);
    expect(Math.round(wait / 60_000), 'ten minutes until the oldest falls out').toBe(10);
  });

  test('nobody under the limit is asked to wait', () => {
    expect(m.retryAfterMs({ attempts: [NOW - 1000] }, NOW)).toBe(0);
  });

  // ── What the person is told ──────────────────────────────────────────────────

  // ⚠️ "That code has expired" would confirm the code EXISTED, which is precisely
  // what a search is looking for. Every refusal reads the same except the rate
  // limit, which says nothing about any code — only about this account.
  test('a refusal never says WHY, so it cannot confirm a code exists', () => {
    const expired = m.redeemFailureText('expired');
    expect(m.redeemFailureText('used')).toBe(expired);
    expect(m.redeemFailureText('locked')).toBe(expired);
    expect(m.redeemFailureText('missing')).toBe(expired);
    expect(expired).toMatch(/does not work/);
    expect(expired).not.toMatch(/expired|used|already/i);
  });

  test('the rate limit is the one refusal that says something useful', () => {
    expect(m.redeemFailureText('rate-limited', 9 * 60_000)).toMatch(/Wait 9 minutes/);
    expect(m.redeemFailureText('rate-limited', 30_000)).toMatch(/Wait 1 minute\b/);
  });

  // ⚠️⚠️ A NUMBER AND A UNIT, NEVER A WORD, and the change is a defect being closed
  // rather than a tidy-up. This used to return English — "24 hours left" — and this
  // file is copied byte for byte into functions/, so it cannot ask the dictionary
  // to say it in anything else. Three screens dropped that English straight into a
  // translated sentence: in Italian, "Who can get in" read «Entra come dipendente ·
  // 24 hours left · …». The words now live in js/join-link.js, which has no server
  // copy; tests/join-link.test.mjs asks them in both languages.
  test('the time left is coarse, and it is numbers rather than words', () => {
    expect(m.expiresIn({ expiresAt: NOW + 5 * 60_000 }, NOW)).toStrictEqual({ unit: 'minutes', n: 5 });
    expect(m.expiresIn({ expiresAt: NOW + 60_000 }, NOW)).toStrictEqual({ unit: 'minutes', n: 1 });
    expect(m.expiresIn({ expiresAt: NOW + 3 * 60 * 60_000 }, NOW)).toStrictEqual({ unit: 'hours', n: 3 });
    expect(m.expiresIn({ expiresAt: NOW + 7 * 24 * 60 * 60_000 }, NOW)).toStrictEqual({ unit: 'days', n: 7 });
    expect(m.expiresIn({ expiresAt: NOW - 1 }, NOW)).toStrictEqual({ unit: 'expired', n: 0 });
    expect(m.expiresIn({}, NOW)).toStrictEqual({ unit: 'expired', n: 0 });
  });

  // ⚠️ NEVER "0 minutes left" WHILE IT IS STILL ALIVE. A code with forty seconds on
  // it can still be typed; rounding it to zero puts a number on screen that reads
  // as a code already gone, so the owner reads out another one for nothing.
  test('a code with seconds left still has a minute on it', () => {
    expect(m.expiresIn({ expiresAt: NOW + 40_000 }, NOW)).toStrictEqual({ unit: 'minutes', n: 1 });
    expect(m.expiresIn({ expiresAt: NOW + 1 }, NOW)).toStrictEqual({ unit: 'minutes', n: 1 });
  });
});
