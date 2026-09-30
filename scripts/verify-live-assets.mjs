// verify-live-assets.mjs — after a merge to main, proves the LIVE site serves the release.
// Run on main after pulling: `node scripts/verify-live-assets.mjs`.
//
// 1. The live sw.js must be byte-for-byte this checkout's sw.js — otherwise Pages has not
//    finished publishing (or something else is live). The whole file, not only CACHE_NAME:
//    a release that changes the worker's logic and no cached file keeps the same name.
// 2. Every file that worker precaches must exist on the live site and match its
//    fingerprint (git blob SHA-1 of the bytes served).
// Exit code 1 on any problem.
//
// ⚠️ NO DOWNLOADED CODE IS EVER RUN. The precache list is read by EXECUTING sw.js — never by
// parsing its text: a sweep that parsed ASSETS once turned an apostrophe in a comment into
// hundreds of nonsense requests — but the copy executed is the LOCAL one, and only after the
// live text has been proved identical to it. node:vm is not a sandbox, so executing the
// downloaded file would hand a tampered live site this PC.
//
// ⚠️ The result is a DIFF (which files failed), never a count — «191 of 192» is exactly one
// broken file, and only its name says which.
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE = 'https://federicomiano93.github.io/mise_app/';
const ORIGIN = 'https://federicomiano93.github.io';
const REPO = new URL('..', import.meta.url);

function precacheList(src) {
  const ctx = {
    self: { addEventListener() {}, location: { origin: ORIGIN, href: `${BASE}sw.js`, hostname: new URL(BASE).hostname } },
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
const normalise = text => text.replace(/\r\n/g, '\n');

const res = await fetch(`${BASE}sw.js?nc=${Date.now()}`);
if (!res.ok) throw new Error(`The live sw.js answered HTTP ${res.status}.`);
const liveSrc = normalise(await res.text());
const localSrc = normalise(readFileSync(new URL('sw.js', REPO), 'utf8'));

if (liveSrc !== localSrc) {
  console.log(JSON.stringify({
    sameRelease: false,
    problems: ['the live sw.js is not this checkout\'s — Pages still publishing, or not on an up-to-date main'],
  }, null, 1));
  process.exit(1);
}

const local = precacheList(localSrc);
let matching = 0;
const problems = [];
await Promise.all(local.assets.map(async asset => {
  const file = await fetch(`${new URL(asset, BASE).href}?fp=${Date.now()}`);
  if (!file.ok) { problems.push(`${asset} HTTP ${file.status}`); return; }
  const hash = blobHash(Buffer.from(await file.arrayBuffer()));
  const expected = local.hashes[asset];
  if (!expected) problems.push(`${asset} has no fingerprint in sw.js`);
  else if (!hash.startsWith(expected)) problems.push(`${asset} fingerprint ${hash.slice(0, 8)} ≠ ${expected.slice(0, 8)}`);
  else matching++;
}));

console.log(JSON.stringify({
  liveCache: local.name, sameRelease: true,
  assets: local.assets.length, matching, problems: problems.sort(),
}, null, 1));
if (problems.length) process.exitCode = 1;
