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
// `fails(url, attempt)` decides which downloads reject. `attempt` is 1-based PER URL,
// so a test can make one file fail once and then succeed — which is what a throttled
// request actually does, and the case that decides whether strictness is affordable.
//
// ⚠️ THE FINGERPRINT CHECK IS STUBBED HERE, AND ONLY HERE. A downloaded body reads
// `asset:<url>` and the stubbed SHA-1 answers with exactly the hash sw.js expects for
// that url — so these tests are about the install's CONTROL FLOW. `stale(url)` makes a
// download come back as a different body, which the stub answers with a wrong hash.
// The real hashing is proved separately, against git itself, in
// tests/sw-asset-hashes.test.mjs.
//
// `donors` seeds the caches an earlier release left: { cacheName: { asset: hash } }.
// Where the harness pretends sw.js is served from, and a precached name as the browser
// resolves it — caches key on the full address, never on './x'.
const SW_URL = 'https://example.test/app/sw.js';
const abs = asset => new URL(asset, SW_URL).href;

function loadWorker({ fails = () => false, stale = () => false, existingCaches = [], donors = {} } = {}) {
  const listeners = new Map();
  const record = { puts: [], attempts: [], inits: [], opened: [], deleted: [], skipWaiting: 0 };
  const attemptsFor = new Map();
  const stores = new Map();
  let context;

  const cacheNamed = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      put(request, response) {
        const url = typeof request === 'string' ? request : request.url;
        record.puts.push([name, url]);
        store.set(url, response);
        return Promise.resolve();
      },
      match(request) {
        const url = typeof request === 'string' ? request : request.url;
        return Promise.resolve(store.get(url));
      },
      add() { throw new Error('the install must download through fetch, where the fingerprint is checked'); },
    };
  };
  for (const [name, files] of Object.entries(donors)) {
    const cache = cacheNamed(name);
    for (const [asset, hash] of Object.entries(files)) {
      cache.put({ url: abs(asset) }, new Response(`donated:${asset}`, { headers: hash ? { 'x-mise-hash': hash } : {} }));
    }
  }
  record.puts.length = 0;

  const toBytes = hex => Uint8Array.from(hex.padEnd(40, '0').match(/../g), h => parseInt(h, 16));
  let byAddress = null;
  const hashFor = (address) => {
    if (!byAddress) {
      const hashes = vm.runInContext('ASSET_HASHES', context);
      byAddress = new Map(Object.entries(hashes).map(([a, h]) => [abs(a), h]));
    }
    return byAddress.get(address);
  };
  context = {
    self: {
      addEventListener: (type, fn) => listeners.set(type, fn),
      location: { origin: 'https://example.test', href: SW_URL },
      clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]) },
      registration: { showNotification: () => Promise.resolve() },
      skipWaiting: () => { record.skipWaiting += 1; },
    },
    caches: {
      open: name => { record.opened.push(name); return Promise.resolve(cacheNamed(name)); },
      keys: () => Promise.resolve([...new Set([...existingCaches, ...Object.keys(donors)])]),
      delete: name => { record.deleted.push(name); return Promise.resolve(true); },
      match: () => Promise.resolve(undefined),
    },
    Request: class { constructor(url, init) { this.url = new URL(url, SW_URL).href; this.init = init; } },
    fetch: (request) => {
      const url = typeof request === 'string' ? request : request.url;
      const attempt = (attemptsFor.get(url) || 0) + 1;
      attemptsFor.set(url, attempt);
      record.attempts.push(url);
      record.inits.push(request.init);
      if (fails(url, attempt)) return Promise.reject(new TypeError('Failed to fetch ' + url));
      return Promise.resolve(new Response(stale(url, attempt) ? `stale:${url}` : `asset:${url}`, { status: 200 }));
    },
    crypto: {
      subtle: {
        async digest(algorithm, data) {
          const text = new TextDecoder().decode(data);
          const body = text.slice(text.indexOf('\0') + 1);
          const hash = body.startsWith('asset:') ? hashFor(body.slice(6)) : null;
          return toBytes(hash || 'ffffffffffffffff').buffer;
        },
      },
    },
    TextEncoder, Headers, Response,
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
  const read = expr => vm.runInContext(expr, context);
  // What landed in THIS worker's cache, in the order it landed.
  Object.defineProperty(record, 'added', {
    get: () => record.puts.filter(([name]) => name === read('CACHE_NAME')).map(([, url]) => url),
  });
  return { record, listeners, read, stores };
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
  assert.deepEqual([...w.record.added].sort(), [...assets].map(abs).sort(),
    'the precache must hold exactly the declared list');
});

test('it fills the versioned cache, not some other one', async () => {
  const w = loadWorker();
  await install(w);
  assert.deepEqual(w.record.opened, [w.read('CACHE_NAME')]);
  assert.ok(w.record.puts.every(([name]) => name === w.read('CACHE_NAME')));
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
  assert.deepEqual([...w.record.added].sort(), [...assets].map(abs).sort(),
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

// ── The counts written in the prose ──────────────────────────────────────────
//
// ⚠️ THIS PROJECT'S OWN RULE MAKES THESE NUMBERS LOAD-BEARING: "a count that is
// one short is not a diagnosis — diff the list, never compare a number." The
// number is what somebody reaches for first anyway, when a phone reports a
// partial cache at 3am, and a file that states two different counts a few
// hundred lines apart makes the count useless as evidence at exactly the moment
// it is wanted. sw.js said both 214 and 208 after the SDK upgrade: the new line
// counted, the two older ones were left where they were written.
//
// Numbers here are pinned to ASSETS itself, so the next person to add a cached
// file cannot leave the prose behind. Historical counts are deliberately NOT
// written in this shape ("207 of 208", "v1.63.0") — a fact about a past release
// stays true and must not be rewritten to match today.
test('every precache count sw.js states in prose is the real one', () => {
  const assets = [...loadWorker().read('ASSETS')];

  const claims = [
    ...[...SW.matchAll(/(\d+)-file precache/g)],
    ...[...SW.matchAll(/all (\d+) files/g)],
  ];

  // A guard on the guard: the comments explain the all-or-nothing precache by
  // its size, so finding none means they were reworded and this must be re-read.
  assert.ok(claims.length >= 2,
    `expected sw.js to state the precache size, found ${claims.length} such claims`);

  const wrong = claims.map((m) => m[1]).filter((n) => Number(n) !== assets.length);
  assert.deepEqual(wrong, [],
    `ASSETS holds ${assets.length} entries. A comment claiming another number is worse ` +
    'than none: this project diagnoses a partial precache by comparing counts first.');
});

// ── Fingerprints: only the release's own copy is stored ──────────────────────
//
// ⚠️⚠️ WHY THEY MATTER NOW (speed audit, 23 Sep 2026). A precached file is no longer
// fetched again behind every request, so whatever the install stores IS what the phone
// runs until the next release. For a minute after a deploy GitHub Pages can still
// answer with the previous copy; stored under the new name, it would never be replaced.

test('⚠⚠ a download that does not match its fingerprint is refused, and the install with it', async () => {
  const w = loadWorker({ stale: url => url.endsWith('/orders.css') });
  await assert.rejects(install(w), err => {
    assert.match(err.message, /precache incomplete/);
    assert.match(err.message, /orders\.css/, 'the refusal names the file');
    return true;
  });
  assert.ok(!w.record.added.includes(abs('./orders.css')), 'the stale copy must never be stored');
});

test('⚠ a stale copy served once is retried, and the right one stored', async () => {
  const w = loadWorker({ stale: (url, attempt) => url.endsWith('/orders.css') && attempt === 1 });
  await install(w);
  assert.ok(w.record.added.includes(abs('./orders.css')));
});

test('every stored file carries its fingerprint, so the next update can recognise it', async () => {
  const w = loadWorker();
  await install(w);
  const hashes = w.read('ASSET_HASHES');
  const store = w.stores.get(w.read('CACHE_NAME'));
  for (const asset of ['./', './index.html', './orders.css', './js/firebase.js']) {
    assert.equal(store.get(abs(asset)).headers.get('x-mise-hash'), hashes[asset], asset);
  }
});

// ── An update downloads only what changed ────────────────────────────────────

test('⚠ an unchanged file is copied from the previous release, not downloaded', async () => {
  const names = loadWorker();
  const hashes = names.read('ASSET_HASHES');
  const w = loadWorker({
    donors: { 'theitalianclub-v1': { './index.html': hashes['./index.html'], './orders.css': 'deadbeefdeadbeef' } },
  });
  const assets = w.read('ASSETS');
  await install(w);
  assert.ok(!w.record.attempts.includes(abs('./index.html')), 'an unchanged file must not travel again');
  assert.ok(w.record.attempts.includes(abs('./orders.css')), 'a CHANGED file must be downloaded');
  assert.equal(w.record.attempts.length, assets.length - 1);
  assert.deepEqual([...w.record.added].sort(), [...assets].map(abs).sort(), 'and the cache is still complete');
});

test('a copy made before fingerprints existed is downloaded again, never trusted', async () => {
  const w = loadWorker({ donors: { 'theitalianclub-v1': { './index.html': null } } });
  await install(w);
  assert.ok(w.record.attempts.includes(abs('./index.html')));
});

test('the SDK cache is never used as a source: it holds other files under other rules', async () => {
  const names = loadWorker();
  const w = loadWorker({ donors: { [names.read('SDK_CACHE')]: { './index.html': names.read('ASSET_HASHES')['./index.html'] } } });
  await install(w);
  assert.ok(w.record.attempts.includes(abs('./index.html')));
});

// ── Serving ──────────────────────────────────────────────────────────────────

// Dispatches a fetch event and hands back what the worker responded with (or null).
async function serve(w, url, method = 'GET') {
  const handler = w.listeners.get('fetch');
  assert.ok(handler, 'sw.js must register a fetch handler');
  let responded = null;
  handler({ request: { url, method }, respondWith(p) { responded = p; } });
  return responded ? await responded : null;
}

test('⚠⚠ a precached file is served from this worker\'s cache, with no network request at all', async () => {
  const w = loadWorker();
  await install(w);
  const before = w.record.attempts.length;
  const res = await serve(w, abs('./orders.css'));
  assert.ok(res, 'the worker must answer');
  assert.equal(await res.text(), `asset:${abs('./orders.css')}`);
  assert.equal(w.record.attempts.length, before, 'no request may go to the network behind it');
});

test('a precached file missing from the cache (a hole) is fetched rather than failing', async () => {
  const w = loadWorker();
  const res = await serve(w, abs('./orders.css'));
  assert.ok(res);
  assert.ok(w.record.attempts.includes(abs('./orders.css')));
});

test('a file that is NOT precached goes to the network first: nothing versions it', async () => {
  const w = loadWorker();
  await install(w);
  const before = w.record.attempts.length;
  await serve(w, abs('./order.html'));
  assert.equal(w.record.attempts.length, before + 1);
});

test('a precached path with a query string is not answered from the cache', async () => {
  const w = loadWorker();
  await install(w);
  const before = w.record.attempts.length;
  await serve(w, `${abs('./orders.css')}?v=2`);
  assert.equal(w.record.attempts.length, before + 1);
});

test('writes are never touched by the worker', async () => {
  const w = loadWorker();
  assert.equal(await serve(w, abs('./index.html'), 'POST'), null);
});
