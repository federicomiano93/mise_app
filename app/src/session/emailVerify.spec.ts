import { describe, expect, test } from 'vitest';
import { appStartUrl, sendFailureKey } from './emailVerify';
import { isEmailUnverified } from './joinErrors';

const fnError = (code: string, message: string, details?: unknown) =>
  Object.assign(new Error(message), { code: `functions/${code}`, details });

describe('appStartUrl', () => {
  test('is the app’s start on the same origin, whatever Vite’s base looks like', () => {
    expect(appStartUrl('/', 'https://x.github.io/mise_app/index.html#/home')).toBe('https://x.github.io/');
    expect(appStartUrl('/mise_app/', 'https://x.github.io/mise_app/index.html')).toBe('https://x.github.io/mise_app/');
    expect(appStartUrl('./', 'https://x.github.io/mise_app/index.html#/home')).toBe('https://x.github.io/mise_app/');
    expect(new URL(appStartUrl('./', 'http://localhost:5173/a/b')).origin).toBe('http://localhost:5173');
  });
});

describe('sendFailureKey', () => {
  test('too many requests is said as waiting; everything else as a friendly failure, never the raw error', () => {
    expect(sendFailureKey({ code: 'auth/too-many-requests' })).toBe('verify.tooMany');
    expect(sendFailureKey({ code: 'auth/network-request-failed' })).toBe('verify.cannotSend');
    expect(sendFailureKey(new Error('boom'))).toBe('verify.cannotSend');
    expect(sendFailureKey(null)).toBe('verify.cannotSend');
  });
});

// The server's refusal is read in joinErrors.ts, beside the other redeem refusals.
describe('isEmailUnverified', () => {
  test('only the server’s «email-unverified» reason on a failed precondition', () => {
    expect(isEmailUnverified(fnError('failed-precondition', 'Confirm your email first.', { reason: 'email-unverified' }))).toBe(true);
    expect(isEmailUnverified(fnError('failed-precondition', 'x', { reason: 'already-member' }))).toBe(false);
    expect(isEmailUnverified(fnError('permission-denied', 'x', { reason: 'email-unverified' }))).toBe(false);
    expect(isEmailUnverified(fnError('failed-precondition', 'x'))).toBe(false);
    expect(isEmailUnverified(null)).toBe(false);
    expect(isEmailUnverified('x')).toBe(false);
  });
});
