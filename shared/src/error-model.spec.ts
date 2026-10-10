// Unit tests for the error reports (P15), run against BOTH implementations: the TypeScript port
// in shared/ and the js/ file the live app uses today. Ported from tests/error-model.test.mjs;
// the two must stay equal until the switch to Mise 2.
//
// What is caught becomes a line the rules accept; noise is dropped; one device cannot flood the
// database. The test that the model imports nothing is NOT ported: it reads the source file as
// text, and this package has no file access (parity.spec.ts and the type-check cover the rest).

import { describe, expect, test } from 'vitest';
import * as ported from './error-model';
import * as legacyJs from '../../js/error-model.js';

const legacy = legacyJs as unknown as typeof ported;

// A result that may be null, asserted present and handed back typed.
function made<T>(value: T | null): T {
  expect(value).not.toBeNull();
  return value as T;
}

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('an Error becomes its message, its code and a trimmed stack', () => {
    const err = Object.assign(new Error('Missing   or\n insufficient permissions.'), { code: 'permission-denied' });
    const r = m.recordFromError(err, { filename: 'https://x.test/js/a.js' });
    expect(r.source).toBe('error');
    expect(r.message).toBe('Missing or insufficient permissions.');
    expect(r.code).toBe('permission-denied');
    expect(r.stack).toMatch(/Error: Missing/);
    expect(r.filename).toBe('https://x.test/js/a.js');
  });

  test('a cross-origin error with only text keeps the text and no stack', () => {
    const r = m.recordFromError(null, { message: 'Script error.' });
    expect([r.message, r.stack, r.code]).toStrictEqual(['Script error.', null, null]);
  });

  test('a rejection reason of any type', () => {
    expect(m.recordFromRejection('plain text').message).toBe('plain text');
    expect(m.recordFromRejection(new Error('boom')).message).toBe('boom');
    expect(m.recordFromRejection({ secret: 'recipe' }).message).toBe('[object]');
    expect(m.recordFromRejection(undefined).message).toBe('undefined');
    expect(m.recordFromRejection(42).message).toBe('42');
    expect(m.recordFromRejection('').message).toBe('(empty)');
    expect(m.recordFromRejection(new Error('x')).source).toBe('rejection');
  });

  test('console.error: strings as they are, an Error by its message and code, other objects never dumped', () => {
    const err = Object.assign(new Error('offline'), { code: 'unavailable' });
    const r = m.recordFromConsole(['saveLogDoc failed:', err]);
    expect(r.source).toBe('console');
    expect(r.message).toBe('saveLogDoc failed: offline');
    expect(r.code).toBe('unavailable');
    expect(r.stack).toBeTruthy();
    const o = m.recordFromConsole(['order', { client: 'Mrs Rossi', total: 12 }, 7]);
    expect(o.message).toBe('order [object] 7');
    expect(JSON.stringify(o)).not.toContain('Rossi');
    expect(m.recordFromConsole([]).message).toBe('(empty)');
    expect(m.recordFromConsole(['  ', '\n']).message).toBe('(empty)');
  });

  test('the message is flattened and cut to 300 characters', () => {
    const r = m.recordFromConsole(['a'.repeat(400)]);
    expect(r.message.length).toBe(300);
    expect(m.recordFromConsole(['one\n\ttwo   three']).message).toBe('one two three');
  });

  test('the stack keeps its first 10 lines and at most 2000 characters; none → null', () => {
    const long = Array.from({ length: 30 }, (_, i) => `    at f${i} (a.js:${i}:1)`).join('\n');
    expect(made(m.trimStack(long)).split('\n').length).toBe(10);
    expect(made(m.trimStack(`Error\n${'x'.repeat(5000)}`)).length).toBe(2000);
    expect(m.trimStack('')).toBe(null);
    expect(m.trimStack(undefined)).toBe(null);
    expect(m.trimStack(12)).toBe(null);
  });

  test('a code is a short string or null', () => {
    expect(m.cleanCode('unavailable')).toBe('unavailable');
    expect(m.cleanCode('c'.repeat(61))).toBe(null);
    expect(m.cleanCode(404)).toBe(null);
    expect(m.cleanCode('')).toBe(null);
  });

  test('the signature is source + the start of the message + the first frame', () => {
    const stack = 'TypeError: x\n    at render (orders.js:10:2)\n    at other (b.js:1:1)';
    const a = { source: 'error', message: 'm'.repeat(200), stack };
    const sig = m.signature(a);
    expect(sig).toBe(`error|${'m'.repeat(120)}|at render (orders.js:10:2)`);
    expect(m.signature({ ...a, message: `${'m'.repeat(120)}different tail` })).toBe(sig);
    expect(m.signature({ ...a, source: 'console' })).not.toBe(sig);
    expect(m.signature({ source: 'console', message: 'x', stack: null })).toBe('console|x|');
    expect(m.signature({ source: 'error', message: 'x', stack: 'fn@https://a.test/x.js:1:1' })).toMatch(/fn@https/);
  });

  test('noise: ResizeObserver, hidden cross-origin errors, another origin\'s files', () => {
    const origin = 'https://app.test';
    expect(m.isNoise({ message: 'ResizeObserver loop limit exceeded' }, { origin })).toBe(true);
    expect(m.isNoise({ message: 'ResizeObserver loop completed with undelivered notifications.' }, { origin })).toBe(true);
    expect(m.isNoise({ message: 'Script error.', stack: null }, { origin })).toBe(true);
    expect(m.isNoise({ message: 'Script error.', stack: 'at x' }, { origin })).toBe(false);
    expect(m.isNoise({ message: 'boom', filename: 'chrome-extension://abc/content.js' }, { origin })).toBe(true);
    expect(m.isNoise({ message: 'boom', filename: 'https://app.test/js/a.js' }, { origin })).toBe(false);
    expect(m.isNoise({ message: 'boom', filename: 'https://app.test.evil.com/a.js' }, { origin })).toBe(true);
    expect(m.isNoise({ message: 'boom', filename: null }, { origin })).toBe(false);
    expect(m.isNoise({ message: 'boom', filename: 'https://other.test/a.js' }, {})).toBe(false);
    expect(m.isNoise({ message: 'real problem', stack: 'at x' })).toBe(false);
  });

  test('throttle: the same error once a day, then a daily cap, then a new day starts clean', () => {
    const day = '2026-10-09';
    let r = m.shouldSend(null, 'sig-a', day);
    expect(r.send).toBe(true);
    expect(r.state).toStrictEqual({ day, count: 1, sigs: ['sig-a'] });
    r = m.shouldSend(r.state, 'sig-a', day);
    expect(r.send).toBe(false);
    expect(r.state.count).toBe(1);
    r = m.shouldSend(r.state, 'sig-b', day);
    expect(r.send).toBe(true);
    expect(r.state.count).toBe(2);
    let state = r.state;
    for (let i = 0; i < m.DAILY_CAP; i += 1) state = m.shouldSend(state, `s${i}`, day).state;
    expect(state.count).toBe(m.DAILY_CAP);
    expect(m.shouldSend(state, 'brand-new', day).send).toBe(false);
    const tomorrow = m.shouldSend(state, 'sig-a', '2026-10-10');
    expect(tomorrow.send).toBe(true);
    expect(tomorrow.state).toStrictEqual({ day: '2026-10-10', count: 1, sigs: ['sig-a'] });
  });

  test('throttle: damaged stored state is treated as empty, never trusted', () => {
    const day = '2026-10-09';
    for (const bad of [undefined, 'text', 5, [], { day: 'x' }, { day, count: 'many', sigs: 'no' }]) {
      expect(m.shouldSend(bad, 'a', day).send, JSON.stringify(bad)).toBe(true);
    }
    expect(m.normaliseState({ day, count: -3, sigs: [1, 'a'] }, day)).toStrictEqual({ day, count: 1, sigs: ['a'] });
    expect(m.shouldSend({ day, count: 500, sigs: [] }, 'a', day).send).toBe(false);
  });

  test('the screen is the page name, plus a short [a-z0-9-] hash', () => {
    expect(m.screenName('/mise_app/orders.html', '')).toBe('orders');
    expect(m.screenName('/mise_app/', '')).toBe('index');
    expect(m.screenName('/', '')).toBe('index');
    expect(m.screenName('/mise_app/orders.html', '#suppliers')).toBe('orders#suppliers');
    expect(m.screenName('/mise_app/orders.html', '#Sam-Rossi')).toBe('orders');
    expect(m.screenName('/mise_app/orders.html', '#a-very-long-hash-that-may-be-a-token')).toBe('orders');
    expect(m.screenName('/mise_app/orders.html', '#a=b')).toBe('orders');
    expect(m.screenName('/mise_app/we ird.html', '')).toBe('index');
  });

  test('the payload holds only what the rules allow, clamped', () => {
    const record = { source: 'console', message: 'boom', code: 'unavailable', stack: 'Error\n at x', filename: 'secret.js' };
    const p = made(m.errorPayload(record, {
      screen: 'orders', appVersion: '649', deviceId: 'Dev1ce2Id3Abc4Def5Gh', kind: 'tablet', online: true,
    }));
    expect(Object.keys(p).sort()).toStrictEqual(['appVersion', 'code', 'deviceId', 'deviceKind', 'message', 'online', 'screen', 'source', 'stack']);
    expect(p.deviceKind).toBe('tablet');
    const bad = made(m.errorPayload(record, { screen: 's'.repeat(61), appVersion: 'x'.repeat(13), deviceId: 'nope', kind: 'fridge', online: 'yes' }));
    expect([bad.screen, bad.appVersion, bad.deviceId, bad.deviceKind, bad.online]).toStrictEqual([null, null, null, 'computer', false]);
    expect(m.errorPayload({ source: 'log', message: 'x' }, {})).toBe(null);
    expect(m.errorPayload({ source: 'error', message: '' }, {})).toBe(null);
    expect(m.errorPayload(null, {})).toBe(null);
    expect(made(m.errorPayload({ source: 'error', message: 'm'.repeat(400) }, {})).message.length).toBe(300);
  });

  test('the Firebase SDK logger timestamp prefix does not change the signature', () => {
    const a = m.recordFromConsole(['[2026-10-09T10:00:01.123Z]  @firebase/firestore: Firestore (10.7.1): Could not reach Cloud Firestore backend.']);
    const b = m.recordFromConsole(['[2026-10-09T18:22:59.007Z]  @firebase/firestore: Firestore (10.7.1): Could not reach Cloud Firestore backend.']);
    expect(a.message).toBe('@firebase/firestore: Firestore (10.7.1): Could not reach Cloud Firestore backend.');
    expect(m.signature(a)).toBe(m.signature(b));
    // Only a leading timestamp on the first string argument is removed.
    expect(m.recordFromConsole(['saved at [2026-10-09T10:00:01Z]  ok']).message).toBe('saved at [2026-10-09T10:00:01Z] ok');
    expect(m.recordFromConsole([42, '[2026-10-09T10:00:01Z]  x']).message).toBe('42 [2026-10-09T10:00:01Z] x');
  });

  test('an error thrown by our own Firebase SDK file is not extension noise', () => {
    const origin = 'https://app.test';
    const sdk = 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
    expect(m.isNoise({ message: 'boom', filename: sdk, stack: 'at x' }, { origin })).toBe(false);
    expect(m.isNoise({ message: 'boom', filename: 'https://www.gstatic.com.evil.test/firebasejs/x.js' }, { origin })).toBe(true);
    expect(m.isNoise({ message: 'boom', filename: 'https://www.gstatic.com/other/x.js' }, { origin })).toBe(true);
  });
});
