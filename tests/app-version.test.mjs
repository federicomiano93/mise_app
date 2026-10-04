import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { versionNumber, versionState } from '../js/app-version.js';

test('versionNumber reads the trailing number of the cache name', () => {
  assert.equal(versionNumber('theitalianclub-v546'), '546');
  assert.equal(versionNumber('x-v1'), '1');
});

test('versionNumber answers null for anything malformed', () => {
  for (const bad of [undefined, null, '', 'theitalianclub', 'theitalianclub-v', 'a-v12b', 42, {}]) {
    assert.equal(versionNumber(bad), null, String(bad));
  }
});

test('versionState covers the four states', () => {
  assert.equal(versionState({ version: undefined, waiting: true }), 'checking');
  assert.equal(versionState({ version: null, waiting: true }), 'unknown');
  assert.equal(versionState({ version: 'v1', waiting: true }), 'waiting');
  assert.equal(versionState({ version: 'v1', waiting: false }), 'current');
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
  assert.match(src, /t\('settings\.home\.app'\)/);
  assert.match(src, /updateNow\(/);
  assert.match(src, /askRunningVersion\(/);
});
