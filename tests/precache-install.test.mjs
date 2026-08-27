// The precache is all-or-nothing, and this test EXECUTES the install handler to prove
// it. Every other test in this repo reads sw.js as TEXT — which is the right tool for
// "is this file in the ASSETS list" and is completely blind to the thing that matters
// here, because Promise.allSettled and a throw are the same characters to a grep.
//
// ⚠️⚠️ WHAT THIS CLOSES. Until v348 the install used Promise.allSettled: a worker whose
// precache had a hole reported SUCCESS, activated, and — activate() deleting every
// cache that is not its own — destroyed the last complete copy on its way in. Three
// separate notes in this project asserted the opposite behaviour, and one release
// verification leaned on that false belief to dismiss a cache that read 207 of 208.
//
// ⚠️⚠️ AND THE ANTI-VACUOUS GUARD IS THE POINT, NOT DECORATION. A harness that failed
// to run the handler would report every case below as passing, because a promise that
// is never created never rejects — the exact shape of check this project has been
// caught by before. install() therefore asserts that waitUntil() was called, with a
// promise, BEFORE any case asserts anything about what that promise did.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SW = readFileSync(join(ROOT, 'sw.js'), 'utf8');

// A service-worker global just complete enough to evaluate sw.js and run one handler.
//
// `fails(url, attempt)` decides which cache.add() calls reject. `attempt` is 1-based
// PER URL, so a test can make one file fail once and then succeed — which is what a
// throttled request actually does, and the case that decides whether strictness is
// affordable at all.
function loadWorker({ fails = () => false, existingCaches = [] } = {}) {
  const listeners = new Map();
  const record = { added: [], attempts: [], inits: [], opened: [], deleted: [], skipWaiting: 0 };
  const attemptsFor = new Map();

  const cache = {
    add(request) {
      const url = request.url;
      const attempt = (attemptsFor.get(url) || 0) + 1;
      attemptsFor.set(url, attempt);
      record.attempts.push(url);
      record.inits.push(request.init);
      if (fails(url, attempt)) return Promise.reject(new TypeError('Failed to fetch ' + url));
      record.added.push(url);
      return Promise.resolve();
    },
    put: () => Promise.resolve(),
    match: () => Promise.resolve(undefined),
  };

  const context = {
    self: {
      addEventListener: (type, fn) => listeners.set(type, fn),
      location: { origin: 'https://example.test' },
      clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]) },
      registration: { showNotification: () => Promise.resolve() },
      skipWaiting: () => { record.skipWaiting += 1; },
    },
    caches: {
      open: name => { record.opened.push(name); return Promise.resolve(cache); },
      keys: () => Promise.resolve(existingCaches.slice()),
      delete: name => { record.deleted.push(name); return Promise.resolve(true); },
      match: () => Promise.resolve(undefined),
    },
    Request: class { constructor(url, init) { this.url = url; this.init = init; } },
    fetch: () => Promise.reject(new Error('the network is not part of this test')),
    setTimeout,
    clearTimeout,
    console,
    URL,
  };
  vm.createContext(context);
  vm.runInContext(SW, context, { filename: 'sw.js' });

  // sw.js declares its constants with `const`, which is a lexical binding in the
  // context rather than a property of its global object — so it is read by evaluating
  // the name, not by reaching into the object.
  return { record, listeners, read: expr => vm.runInContext(expr, context) };
}

// Runs a handler and hands back the promise the browser would wait on.
function run(worker, type) {
  const handler = worker.listeners.get(type);
  assert.ok(handler, `sw.js must register a ${type} handler`);
  let waited = null;
  handler({ waitUntil(p) { waited = p; } });
  assert.ok(waited && typeof waited.then === 'function',
    `${type} must hand a promise to waitUntil, or the browser never waits for it`);
  return waited;
}

const install = worker => run(worker, 'install');

test('the harness really runs sw.js: it exposes the worker’s own constants', () => {
  const w = loadWorker();
  assert.match(w.read('CACHE_NAME'), /^theitalianclub-v\d+$/);
  assert.ok(Array.isArray(w.read('ASSETS')) && w.read('ASSETS').length > 100);
  assert.equal(typeof w.read('PRECACHE_ATTEMPTS'), 'number');
});

test('when every asset caches, the install resolves and the cache holds all of them', async () => {
  const w = loadWorker();
  const assets = w.read('ASSETS');
  await install(w);
  assert.deepEqual([...w.record.added].sort(), [...assets].sort(),
    'the precache must hold exactly the declared list');
});

test('it fills the versioned cache, not some other one', async () => {
  const w = loadWorker();
  await install(w);
  assert.deepEqual(w.record.opened, [w.read('CACHE_NAME')]);
});

test('every request bypasses the browser HTTP cache (cache: reload)', async () => {
  const w = loadWorker();
  await install(w);
  assert.ok(w.record.inits.length > 0, 'the slice must not be empty');
  w.record.inits.forEach(init => assert.equal(init && init.cache, 'reload',
    'a stale copy precached here would survive every future deploy of that file'));
});

test('⚠⚠ one asset that will not cache REFUSES the install', async () => {
  const w = loadWorker({ fails: url => url.endsWith('/orders.css') });
  await assert.rejects(install(w), /precache incomplete/,
    'a partial cache must never be allowed to activate and delete the complete one');
});

test('⚠ the refusal NAMES the files, because it is the only diagnosis there is', async () => {
  const w = loadWorker({ fails: url => url.endsWith('/orders.css') });
  await assert.rejects(install(w), err => {
    assert.match(err.message, /orders\.css/, 'a count alone cannot be acted on');
    return true;
  });
});

test('⚠ a throttled asset does not cost the release: it is retried and succeeds', async () => {
  const w = loadWorker({ fails: (url, attempt) => url.endsWith('/orders.css') && attempt === 1 });
  const assets = w.read('ASSETS');
  await install(w);
  assert.deepEqual([...w.record.added].sort(), [...assets].sort(),
    'GitHub Pages has answered 503 to one file of a burst and 200 on retry');
});

test('⚠ only the failures are retried, never the whole list again', async () => {
  const w = loadWorker({ fails: (url, attempt) => url.endsWith('/orders.css') && attempt === 1 });
  const assets = w.read('ASSETS');
  await install(w);
  assert.equal(w.record.attempts.length, assets.length + 1,
    're-fetching all 200-odd files on every retry is how a throttle becomes a stampede');
});

test('a permanently failing asset is retried PRECACHE_ATTEMPTS times, then given up on', async () => {
  const w = loadWorker({ fails: url => url.endsWith('/orders.css') });
  const tries = w.read('PRECACHE_ATTEMPTS');
  await assert.rejects(install(w));
  const made = w.record.attempts.filter(u => u.endsWith('/orders.css')).length;
  assert.equal(made, tries);
});

// ⚠️⚠️ THE GUARD THAT MATTERS MOST NOW THAT THE INSTALL IS STRICT, and it did not exist
// before: every other test in this repo checks the OTHER direction — "this file I just
// added is in ASSETS". Nothing checked that a name IN ASSETS resolves to a real file.
// That is precisely the input strictness promotes from "a hole in the cache" to "no
// phone ever receives this release, or any later one, and is never told". A file
// renamed with its ASSETS line mistyped passes every other test, both CI jobs and the
// deploy.
test('⚠⚠ every name in ASSETS is a file that exists, or no phone can ever finish installing', () => {
  // ⚠️ SPREAD FIRST. ASSETS is an Array from the vm realm, and deepEqual compares
  // prototypes — an empty vm array against an empty host array fails, reporting
  // "actual [] expected []", which reads as a broken test rather than a realm mismatch.
  const assets = [...loadWorker().read('ASSETS')];
  assert.ok(assets.length > 100, 'the list must not be empty');
  const missing = assets
    .filter(a => a !== './')
    .filter(a => !existsSync(join(ROOT, a.replace(/^\.\//, ''))));
  assert.deepEqual(missing, [], 'ASSETS names files that are not in the repo');
});

test('the site root is served by a file that exists', () => {
  assert.ok(loadWorker().read('ASSETS').includes('./'), 'the start URL must be precached');
  assert.ok(existsSync(join(ROOT, 'index.html')));
});

// The two behaviours the change had to leave alone.

test('activate still deletes the old caches and keeps the SDK one', async () => {
  const names = loadWorker();
  const w = loadWorker({
    existingCaches: ['theitalianclub-v1', names.read('SDK_CACHE'), names.read('CACHE_NAME')],
  });
  await run(w, 'activate');
  assert.deepEqual(w.record.deleted, ['theitalianclub-v1'],
    'the SDK cache and the current one must survive the sweep');
});

test('the update banner can still activate the worker on demand', () => {
  const w = loadWorker();
  const handler = w.listeners.get('message');
  assert.ok(handler, 'sw.js must register a message handler');
  handler({ source: {}, data: { action: 'skipWaiting' } });
  assert.equal(w.record.skipWaiting, 1);
});

test('install does NOT skipWaiting by itself, or the update banner never appears', async () => {
  const w = loadWorker();
  await install(w);
  assert.equal(w.record.skipWaiting, 0);
});
