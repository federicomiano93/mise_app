import { describe, expect, test, vi, afterEach } from 'vitest';
import { redeemFailureText } from '@mise/shared/join-code';
import { joinRefusal } from './joinErrors';

// Every refusal the live function `redeemJoinCode` (functions/onboarding.js) can give, as the Functions SDK hands it to the
// app: `functions/<code>`, the server's English message, and the reason it sends beside two of them. The app says each in
// its own words; every refusal about a CODE says the same sentence.

const fnError = (code: string, message: string, details?: unknown) =>
  Object.assign(new Error(message), { code: `functions/${code}`, details });

afterEach(() => { vi.unstubAllGlobals(); });

describe('joinRefusal', () => {
  test('already in this venue: said as a fact about the account, never as a bad code', () => {
    expect(joinRefusal(fnError('failed-precondition', redeemFailureText('already-member'), { reason: 'already-member' })))
      .toEqual({ key: 'join.alreadyMember' });
  });

  test('six-digit codes paused for everybody: points at a link', () => {
    expect(joinRefusal(fnError('resource-exhausted', redeemFailureText('digits-paused', 600_000), { reason: 'digits-paused' })))
      .toEqual({ key: 'join.digitsPaused' });
  });

  test('this account tried too often: the minutes the server named, in the app’s words', () => {
    expect(joinRefusal(fnError('resource-exhausted', redeemFailureText('rate-limited', 12 * 60_000))))
      .toEqual({ key: 'join.tooManyMinutes', n: 12 });
    expect(joinRefusal(fnError('resource-exhausted', redeemFailureText('rate-limited', 30_000))))
      .toEqual({ key: 'join.tooManyMinutes', n: 1 });
  });

  test('too many tries with no number to read: said without one', () => {
    expect(joinRefusal(fnError('resource-exhausted', 'Quota exceeded.'))).toEqual({ key: 'join.tooMany' });
  });

  // ⚠️ «expired», «used», «locked», «missing» and a malformed code all reach the phone as permission-denied with the same
  // English: one sentence, so the answer never confirms a code existed.
  test('every refusal of a code is the one sentence', () => {
    for (const status of ['missing', 'used', 'locked', 'expired']) {
      expect(joinRefusal(fnError('permission-denied', redeemFailureText(status))), status).toEqual({ key: 'join.badCode' });
    }
  });

  test('no answer at all: the connection', () => {
    expect(joinRefusal(fnError('unavailable', 'unavailable'))).toEqual({ key: 'join.offline' });
    expect(joinRefusal(fnError('deadline-exceeded', 'deadline-exceeded'))).toEqual({ key: 'join.offline' });
  });

  test('a phone that knows it is offline, with an error that has no code (the SDK not downloaded)', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(joinRefusal(new TypeError('Failed to fetch dynamically imported module'))).toEqual({ key: 'join.offline' });
  });

  test('anything else: could not check', () => {
    for (const error of [fnError('internal', 'INTERNAL'), fnError('unauthenticated', 'Sign in first.'), new Error('x'), null, 'x', 42]) {
      expect(joinRefusal(error), String(error)).toEqual({ key: 'join.failed' });
    }
  });

  test('the bare code (without the SDK’s prefix) is read the same way', () => {
    expect(joinRefusal({ code: 'permission-denied', message: 'x' })).toEqual({ key: 'join.badCode' });
  });

  // The words the server sends are never shown: a reason the server did not send is not invented from them.
  test('the server’s English is never the answer', () => {
    const refusal = joinRefusal(fnError('permission-denied', 'You are already in this business.'));
    expect(refusal).toEqual({ key: 'join.badCode' });
  });
});
