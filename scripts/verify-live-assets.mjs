// verify-live-assets.mjs — after a merge to main, proves the LIVE site serves the release.
// Run from the repo root, on main after pulling: `node scripts/verify-live-assets.mjs`.
//
// Every file the LIVE service worker will precache must exist on the live site and match
// its fingerprint (git blob SHA-1 of the bytes served), and the live sw.js must be exactly
// this checkout's — otherwise Pages has not finished publishing yet. Exit code 1 otherwise.
//
// ⚠️ The list is read by EXECUTING the live sw.js, never by parsing its text: a sweep that
// parsed ASSETS once turned an apostrophe in a comment into hundreds of nonsense requests.
// And the result is a DIFF (which files failed), never a count — «191 of 192» is exactly
// one broken file, and only its name says which.
//
// ⚠️ EXECUTING DOWNLOADED CODE IS WHY THIS RE-STARTS ITSELF UNDER NODE'S PERMISSION MODEL.
// node:vm is not a sandbox — any object handed to the script leads back to `process`. So
// the whole check runs in a Node that may read only this repo, and may not start programs
// or write files: a tampered live sw.js could not reach the gcloud login or anything else
// on this PC.
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.permission) {
  const run = spawnSync(process.execPath,
    ['--permission', `--allow-fs-read=${process.cwd()}`, fileURLToPath(import.meta.url)],
    { stdio: 'inherit' });
  process.exit(run.status ?? 1);
}

const BASE = 'https://federicomiano93.github.io/mise_app/';
const ORIGIN = 'https://federicomiano93.github.io';

function loadWorker(src) {
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
const liveSrc = await res.text();
const localSrc = readFileSync('sw.js', 'utf8');
const live = loadWorker(liveSrc);

let matching = 0;
const problems = [];
await Promise.all(live.assets.map(async asset => {
  const file = await fetch(`${new URL(asset, BASE).href}?fp=${Date.now()}`);
  if (!file.ok) { problems.push(`${asset} HTTP ${file.status}`); return; }
  const hash = blobHash(Buffer.from(await file.arrayBuffer()));
  const expected = live.hashes[asset];
  if (!expected) problems.push(`${asset} has no fingerprint in the live sw.js`);
  else if (!hash.startsWith(expected)) problems.push(`${asset} fingerprint ${hash.slice(0, 8)} ≠ ${expected.slice(0, 8)}`);
  else matching++;
}));

// The whole file, not only CACHE_NAME: a release that changes the worker's logic and no
// cached file keeps the same name.
const sameRelease = normalise(liveSrc) === normalise(localSrc);
console.log(JSON.stringify({
  liveCache: live.name, sameRelease,
  assets: live.assets.length, matching, problems: problems.sort(),
}, null, 1));
if (!sameRelease || problems.length) process.exitCode = 1;
