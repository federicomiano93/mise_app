// js/error-model.js — what is caught becomes a line the rules accept; noise is dropped; one
// device cannot flood the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  recordFromError, recordFromRejection, recordFromConsole, trimStack, cleanCode, signature,
  isNoise, shouldSend, normaliseState, screenName, errorPayload, DAILY_CAP,
} from '../js/error-model.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the model imports nothing', () => {
  const src = readFileSync(join(ROOT, 'js/error-model.js'), 'utf8');
  assert.ok(!/^\s*import\s/m.test(src));
});

test('an Error becomes its message, its code and a trimmed stack', () => {
  const err = Object.assign(new Error('Missing   or\n insufficient permissions.'), { code: 'permission-denied' });
  const r = recordFromError(err, { filename: 'https://x.test/js/a.js' });
  assert.equal(r.source, 'error');
  assert.equal(r.message, 'Missing or insufficient permissions.');
  assert.equal(r.code, 'permission-denied');
  assert.match(r.stack, /Error: Missing/);
  assert.equal(r.filename, 'https://x.test/js/a.js');
});

test('a cross-origin error with only text keeps the text and no stack', () => {
  const r = recordFromError(null, { message: 'Script error.' });
  assert.deepEqual([r.message, r.stack, r.code], ['Script error.', null, null]);
});

test('a rejection reason of any type', () => {
  assert.equal(recordFromRejection('plain text').message, 'plain text');
  assert.equal(recordFromRejection(new Error('boom')).message, 'boom');
  assert.equal(recordFromRejection({ secret: 'recipe' }).message, '[object]');
  assert.equal(recordFromRejection(undefined).message, 'undefined');
  assert.equal(recordFromRejection(42).message, '42');
  assert.equal(recordFromRejection('').message, '(empty)');
  assert.equal(recordFromRejection(new Error('x')).source, 'rejection');
});

test('console.error: strings as they are, an Error by its message and code, other objects never dumped', () => {
  const err = Object.assign(new Error('offline'), { code: 'unavailable' });
  const r = recordFromConsole(['saveLogDoc failed:', err]);
  assert.equal(r.source, 'console');
  assert.equal(r.message, 'saveLogDoc failed: offline');
  assert.equal(r.code, 'unavailable');
  assert.ok(r.stack);
  const o = recordFromConsole(['order', { client: 'Mrs Rossi', total: 12 }, 7]);
  assert.equal(o.message, 'order [object] 7');
  assert.ok(!JSON.stringify(o).includes('Rossi'));
  assert.equal(recordFromConsole([]).message, '(empty)');
  assert.equal(recordFromConsole(['  ', '\n']).message, '(empty)');
});

test('the message is flattened and cut to 300 characters', () => {
  const r = recordFromConsole(['a'.repeat(400)]);
  assert.equal(r.message.length, 300);
  assert.equal(recordFromConsole(['one\n\ttwo   three']).message, 'one two three');
});

test('the stack keeps its first 10 lines and at most 2000 characters; none → null', () => {
  const long = Array.from({ length: 30 }, (_, i) => `    at f${i} (a.js:${i}:1)`).join('\n');
  assert.equal(trimStack(long).split('\n').length, 10);
  assert.equal(trimStack(`Error\n${'x'.repeat(5000)}`).length, 2000);
  assert.equal(trimStack(''), null);
  assert.equal(trimStack(undefined), null);
  assert.equal(trimStack(12), null);
});

test('a code is a short string or null', () => {
  assert.equal(cleanCode('unavailable'), 'unavailable');
  assert.equal(cleanCode('c'.repeat(61)), null);
  assert.equal(cleanCode(404), null);
  assert.equal(cleanCode(''), null);
});

test('the signature is source + the start of the message + the first frame', () => {
  const stack = 'TypeError: x\n    at render (orders.js:10:2)\n    at other (b.js:1:1)';
  const a = { source: 'error', message: 'm'.repeat(200), stack };
  const sig = signature(a);
  assert.equal(sig, `error|${'m'.repeat(120)}|at render (orders.js:10:2)`);
  assert.equal(signature({ ...a, message: `${'m'.repeat(120)}different tail` }), sig);
  assert.notEqual(signature({ ...a, source: 'console' }), sig);
  assert.equal(signature({ source: 'console', message: 'x', stack: null }), 'console|x|');
  assert.match(signature({ source: 'error', message: 'x', stack: 'fn@https://a.test/x.js:1:1' }), /fn@https/);
});

test('noise: ResizeObserver, hidden cross-origin errors, another origin\'s files', () => {
  const origin = 'https://app.test';
  assert.equal(isNoise({ message: 'ResizeObserver loop limit exceeded' }, { origin }), true);
  assert.equal(isNoise({ message: 'ResizeObserver loop completed with undelivered notifications.' }, { origin }), true);
  assert.equal(isNoise({ message: 'Script error.', stack: null }, { origin }), true);
  assert.equal(isNoise({ message: 'Script error.', stack: 'at x' }, { origin }), false);
  assert.equal(isNoise({ message: 'boom', filename: 'chrome-extension://abc/content.js' }, { origin }), true);
  assert.equal(isNoise({ message: 'boom', filename: 'https://app.test/js/a.js' }, { origin }), false);
  assert.equal(isNoise({ message: 'boom', filename: 'https://app.test.evil.com/a.js' }, { origin }), true);
  assert.equal(isNoise({ message: 'boom', filename: null }, { origin }), false);
  assert.equal(isNoise({ message: 'boom', filename: 'https://other.test/a.js' }, {}), false);
  assert.equal(isNoise({ message: 'real problem', stack: 'at x' }), false);
});

test('throttle: the same error once a day, then a daily cap, then a new day starts clean', () => {
  const day = '2026-10-09';
  let r = shouldSend(null, 'sig-a', day);
  assert.equal(r.send, true);
  assert.deepEqual(r.state, { day, count: 1, sigs: ['sig-a'] });
  r = shouldSend(r.state, 'sig-a', day);
  assert.equal(r.send, false);
  assert.equal(r.state.count, 1);
  r = shouldSend(r.state, 'sig-b', day);
  assert.equal(r.send, true);
  assert.equal(r.state.count, 2);
  let state = r.state;
  for (let i = 0; i < DAILY_CAP; i += 1) state = shouldSend(state, `s${i}`, day).state;
  assert.equal(state.count, DAILY_CAP);
  assert.equal(shouldSend(state, 'brand-new', day).send, false);
  const tomorrow = shouldSend(state, 'sig-a', '2026-10-10');
  assert.equal(tomorrow.send, true);
  assert.deepEqual(tomorrow.state, { day: '2026-10-10', count: 1, sigs: ['sig-a'] });
});

test('throttle: damaged stored state is treated as empty, never trusted', () => {
  const day = '2026-10-09';
  for (const bad of [undefined, 'text', 5, [], { day: 'x' }, { day, count: 'many', sigs: 'no' }]) {
    assert.equal(shouldSend(bad, 'a', day).send, true, JSON.stringify(bad));
  }
  assert.deepEqual(normaliseState({ day, count: -3, sigs: [1, 'a'] }, day), { day, count: 1, sigs: ['a'] });
  assert.equal(shouldSend({ day, count: 500, sigs: [] }, 'a', day).send, false);
});

test('the screen is the page name, plus a short [a-z0-9-] hash', () => {
  assert.equal(screenName('/mise_app/orders.html', ''), 'orders');
  assert.equal(screenName('/mise_app/', ''), 'index');
  assert.equal(screenName('/', ''), 'index');
  assert.equal(screenName('/mise_app/orders.html', '#suppliers'), 'orders#suppliers');
  assert.equal(screenName('/mise_app/orders.html', '#Sam-Rossi'), 'orders');
  assert.equal(screenName('/mise_app/orders.html', '#a-very-long-hash-that-may-be-a-token'), 'orders');
  assert.equal(screenName('/mise_app/orders.html', '#a=b'), 'orders');
  assert.equal(screenName('/mise_app/we ird.html', ''), 'index');
});

test('the payload holds only what the rules allow, clamped', () => {
  const record = { source: 'console', message: 'boom', code: 'unavailable', stack: 'Error\n at x', filename: 'secret.js' };
  const p = errorPayload(record, {
    screen: 'orders', appVersion: '649', deviceId: 'Dev1ce2Id3Abc4Def5Gh', kind: 'tablet', online: true,
  });
  assert.deepEqual(Object.keys(p).sort(), ['appVersion', 'code', 'deviceId', 'deviceKind', 'message', 'online', 'screen', 'source', 'stack']);
  assert.equal(p.deviceKind, 'tablet');
  const bad = errorPayload(record, { screen: 's'.repeat(61), appVersion: 'x'.repeat(13), deviceId: 'nope', kind: 'fridge', online: 'yes' });
  assert.deepEqual([bad.screen, bad.appVersion, bad.deviceId, bad.deviceKind, bad.online], [null, null, null, 'computer', false]);
  assert.equal(errorPayload({ source: 'log', message: 'x' }, {}), null);
  assert.equal(errorPayload({ source: 'error', message: '' }, {}), null);
  assert.equal(errorPayload(null, {}), null);
  assert.equal(errorPayload({ source: 'error', message: 'm'.repeat(400) }, {}).message.length, 300);
});

test('the Firebase SDK logger timestamp prefix does not change the signature', () => {
  const a = recordFromConsole(['[2026-10-09T10:00:01.123Z]  @firebase/firestore: Firestore (10.7.1): Could not reach Cloud Firestore backend.']);
  const b = recordFromConsole(['[2026-10-09T18:22:59.007Z]  @firebase/firestore: Firestore (10.7.1): Could not reach Cloud Firestore backend.']);
  assert.equal(a.message, '@firebase/firestore: Firestore (10.7.1): Could not reach Cloud Firestore backend.');
  assert.equal(signature(a), signature(b));
  // Only a leading timestamp on the first string argument is removed.
  assert.equal(recordFromConsole(['saved at [2026-10-09T10:00:01Z]  ok']).message, 'saved at [2026-10-09T10:00:01Z] ok');
  assert.equal(recordFromConsole([42, '[2026-10-09T10:00:01Z]  x']).message, '42 [2026-10-09T10:00:01Z] x');
});

test('an error thrown by our own Firebase SDK file is not extension noise', () => {
  const origin = 'https://app.test';
  const sdk = 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
  assert.equal(isNoise({ message: 'boom', filename: sdk, stack: 'at x' }, { origin }), false);
  assert.equal(isNoise({ message: 'boom', filename: 'https://www.gstatic.com.evil.test/firebasejs/x.js' }, { origin }), true);
  assert.equal(isNoise({ message: 'boom', filename: 'https://www.gstatic.com/other/x.js' }, { origin }), true);
});
