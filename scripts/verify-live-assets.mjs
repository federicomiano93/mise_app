// verify-live-assets.mjs — after a merge to main, proves the LIVE site serves the release.
// Run from the repo root, on main after pulling: `node scripts/verify-live-assets.mjs`.
//
// Every file the LIVE service worker will precache must exist on the live site and match
// its fingerprint (git blob SHA-1 of the bytes served), and the live CACHE_NAME must be the
// one in this checkout's sw.js — otherwise Pages has not finished publishing yet.
//
// ⚠️ The list is read by EXECUTING the live sw.js in a sandbox, never by parsing its text:
// a sweep that parsed ASSETS once turned an apostrophe in a comment into hundreds of
// nonsense requests. And the result is a DIFF (which files failed), never a count — «191 of
// 192» is exactly one broken file, and only its name says which.
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE = 'https://federicomiano93.github.io/mise_app/';

function loadWorker(src, origin, href) {
  const ctx = {
    self: { addEventListener() {}, location: { origin, href, hostname: new URL(href).hostname } },
    caches: {}, URL, Response, Headers, Request: class {}, fetch() {}, crypto: {},
    TextEncoder, console, setTimeout, clearTimeout,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return {
    assets: vm.runInContext('ASSETS', ctx),
    hashes: vm.runInContext('ASSET_HASHES', ctx),
    name: vm.runInContext('CACHE_NAME', ctx),
  };
}

const blobHash = buf =>
  createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');

const liveSrc = await (await fetch(`${BASE}sw.js?nc=${Date.now()}`)).text();
const live = loadWorker(liveSrc, 'https://federicomiano93.github.io', `${BASE}sw.js`);
const local = loadWorker(readFileSync('sw.js', 'utf8'), 'https://federicomiano93.github.io', `${BASE}sw.js`);

let matching = 0;
const problems = [];
await Promise.all(live.assets.map(async asset => {
  const res = await fetch(`${new URL(asset, BASE).href}?fp=${Date.now()}`);
  if (!res.ok) { problems.push(`${asset} HTTP ${res.status}`); return; }
  const hash = blobHash(Buffer.from(await res.arrayBuffer()));
  const expected = live.hashes[asset];
  if (expected && !hash.startsWith(expected)) problems.push(`${asset} fingerprint ${hash.slice(0, 8)} ≠ ${expected.slice(0, 8)}`);
  else matching++;
}));

const sameRelease = live.name === local.name;
console.log(JSON.stringify({
  liveCache: live.name, localCache: local.name, sameRelease,
  assets: live.assets.length, matching, problems: problems.sort(),
}, null, 1));
if (!sameRelease || problems.length) process.exitCode = 1;
