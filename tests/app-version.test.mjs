import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { versionNumber, versionState, askVersionOf, askPageVersion } from '../js/app-version.js';

test('versionNumber reads the trailing number of the cache name', () => {
  assert.equal(versionNumber('theitalianclub-v546'), '546');
  assert.equal(versionNumber('x-v1'), '1');
});

test('versionNumber answers null for anything malformed', () => {
  for (const bad of [undefined, null, '', 'theitalianclub', 'theitalianclub-v', 'a-v12b', 42, {}]) {
    assert.equal(versionNumber(bad), null, String(bad));
  }
});

test('versionState: waiting wins, even with an unreadable version or a failed check', () => {
  for (const phase of ['checking', 'downloading', 'failed', 'done']) {
    assert.equal(versionState({ version: null, waiting: true, phase }), 'waiting');
    assert.equal(versionState({ version: undefined, waiting: true, phase }), 'waiting');
    assert.equal(versionState({ version: 'v1', waiting: true, phase }), 'waiting');
  }
});

test('versionState follows the phase of the check', () => {
  assert.equal(versionState({ version: 'v1', waiting: false, phase: 'downloading' }), 'downloading');
  assert.equal(versionState({ version: 'v1', waiting: false, phase: 'failed' }), 'failed');
  assert.equal(versionState({ version: 'v1', waiting: false, phase: 'checking' }), 'checking');
  assert.equal(versionState({ version: undefined, waiting: false, phase: 'done' }), 'checking');
});

test('versionState says «current» only once the check is done', () => {
  assert.equal(versionState({ version: 'v1', waiting: false, phase: 'done' }), 'current');
  assert.equal(versionState({ version: null, waiting: false, phase: 'done' }), 'unknown');
  assert.notEqual(versionState({ version: 'v1', waiting: false, phase: 'checking' }), 'current');
});

// A controller that answers (or not) through the port it was handed.
const fakeController = (onAsk) => {
  const c = { asks: 0, postMessage(msg, ports) { c.asks += 1; onAsk(c.asks, ports[0], msg); } };
  return c;
};
const fast = { timeoutMs: 150, attempts: 3 };

test('askVersionOf resolves the string the worker sends', async () => {
  const c = fakeController((n, port, msg) => {
    assert.equal(msg.action, 'version');
    port.postMessage({ version: 'theitalianclub-v9' });
  });
  assert.equal(await askVersionOf(c, fast), 'theitalianclub-v9');
  assert.equal(c.asks, 1);
});

test('askVersionOf gives up with null after every attempt timed out', async () => {
  const c = fakeController(() => {});
  assert.equal(await askVersionOf(c, fast), null);
  assert.equal(c.asks, 3);
});

test('askVersionOf retries: an answer on the second attempt is used', async () => {
  const c = fakeController((n, port) => { if (n === 2) port.postMessage({ version: 'x-v2' }); });
  assert.equal(await askVersionOf(c, fast), 'x-v2');
  assert.equal(c.asks, 2);
});

test('askPageVersion asks the controller and answers the number', async () => {
  const controller = fakeController((n, port) => port.postMessage({ version: 'theitalianclub-v741' }));
  const nav = { serviceWorker: { controller, getRegistration: async () => { throw new Error('not asked'); } } };
  assert.equal(await askPageVersion(fast, nav), '741');
});

test('askPageVersion: no controller (first visit, hard reload) → the active worker is asked', async () => {
  const active = fakeController((n, port) => port.postMessage({ version: 'theitalianclub-v740' }));
  const nav = { serviceWorker: { controller: null, getRegistration: async () => ({ active }) } };
  assert.equal(await askPageVersion(fast, nav), '740');
  assert.equal(active.asks, 1);
});

test('askPageVersion answers null, never throws, with no worker at all', async () => {
  assert.equal(await askPageVersion(fast, {}), null);
  assert.equal(await askPageVersion(fast, undefined), null);
  assert.equal(await askPageVersion(fast, { serviceWorker: { controller: null, getRegistration: async () => undefined } }), null);
  assert.equal(await askPageVersion(fast, { serviceWorker: { controller: null, getRegistration: async () => ({ active: null }) } }), null);
  assert.equal(await askPageVersion(fast, { serviceWorker: { controller: null, getRegistration: () => Promise.reject(new Error('x')) } }), null);
});

test('the statistics and the notes ask through askPageVersion', () => {
  for (const file of ['js/device-ping.js', 'js/error-report.js', 'js/usage.js', 'js/feedback.js']) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(src, /askPageVersion\(\{ timeoutMs: 800, attempts: 1 \}\)/, file);
    assert.doesNotMatch(src, /serviceWorker\.controller/, `${file} must not read the controller itself`);
  }
});

test('askVersionOf answers null for a malformed reply, without retrying', async () => {
  const c = fakeController((n, port) => port.postMessage({ nope: 1 }));
  assert.equal(await askVersionOf(c, fast), null);
  assert.equal(c.asks, 1);
});

test('askVersionOf never throws: no controller, or postMessage throws', async () => {
  assert.equal(await askVersionOf(null, fast), null);
  assert.equal(await askVersionOf(undefined, fast), null);
  assert.equal(await askVersionOf({ postMessage() { throw new Error('gone'); } }, fast), null);
});

test('the worker answers {action:"version"} on the port and still skips waiting', () => {
  const listeners = new Map();
  let skipped = 0;
  const context = {
    self: {
      addEventListener: (type, fn) => listeners.set(type, fn),
      location: { origin: 'https://example.test', href: 'https://example.test/app/sw.js', hostname: 'example.test' },
      skipWaiting: () => { skipped += 1; },
      clients: {}, registration: {},
    },
    caches: {}, Request: class {}, fetch() {}, crypto: {}, TextEncoder, Headers, Response,
    setTimeout, clearTimeout, console, URL,
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), context);
  const handler = listeners.get('message');
  assert.ok(handler, 'sw.js must register a message handler');

  const sent = [];
  handler({ source: {}, data: { action: 'version' }, ports: [{ postMessage: m => sent.push(m) }] });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].version, vm.runInContext('CACHE_NAME', context));
  assert.equal(skipped, 0, 'asking the version must not activate a waiting worker');

  handler({ source: {}, data: { action: 'skipWaiting' } });
  assert.equal(skipped, 1);

  handler({ source: {}, data: { action: 'version' } });
  assert.equal(sent.length, 1, 'no port, no reply, no throw');
});

test('home-settings builds the App row in its own section', () => {
  const src = readFileSync(new URL('../js/home-settings.js', import.meta.url), 'utf8');
  assert.match(src, /t\('settings\.home\.device'\)/);
  assert.match(src, /updateNow\(/);
  assert.match(src, /askVersionOf\(/);
  assert.match(src, /set-row--version/);
});
