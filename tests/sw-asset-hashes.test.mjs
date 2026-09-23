// Every precached file's fingerprint in sw.js is current (speed audit, 23 Sep 2026).
//
// ⚠️⚠️ THIS TEST IS WHAT REPLACED A SAFETY NET. sw.js used to fetch every file again
// behind every request, which quietly repaired a deploy that forgot to bump CACHE_NAME.
// It no longer does (a precached file is served from its release's cache alone), so a
// forgotten bump would now leave phones on the old file until the next release. Here it
// cannot happen: change a cached file without running scripts/sw-hashes.mjs and this
// fails, and that script bumps CACHE_NAME whenever a fingerprint changes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

import { readAssets, computeHashes, currentHashes, hashBlock, HASH_LENGTH } from '../scripts/sw-hashes.mjs';

const SW = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const ROOT = new URL('..', import.meta.url);

test('⚠⚠ every precached file\'s fingerprint in sw.js matches the file', () => {
  const assets = readAssets(SW);
  assert.ok(assets.length > 100, 'ASSETS could not be read');
  const recorded = currentHashes(SW);
  assert.ok(recorded, 'sw.js carries no ASSET_HASHES — run: node scripts/sw-hashes.mjs');
  const actual = computeHashes(assets);
  const stale = assets.filter(a => recorded[a] !== actual[a]);
  assert.deepEqual(stale, [],
    `${stale.length} cached file(s) changed without a new fingerprint — run: node scripts/sw-hashes.mjs ` +
    '(it also bumps CACHE_NAME, which is what tells the phones)');
});

test('the fingerprints name exactly the precached files, no more and no fewer', () => {
  const assets = readAssets(SW);
  const recorded = Object.keys(currentHashes(SW));
  assert.deepEqual([...recorded].sort(), [...assets].sort());
});

// ── The phone computes the same fingerprint git does ─────────────────────────

function workerBlobHash() {
  const ctx = {
    self: { addEventListener() {}, location: { origin: 'https://x.test', href: 'https://x.test/sw.js' } },
    caches: {}, URL, console, crypto: globalThis.crypto, TextEncoder, Headers, Response,
  };
  vm.createContext(ctx);
  vm.runInContext(SW, ctx);
  return body => vm.runInContext('blobHash', ctx)(new Response(body));
}

const gitHash = input => execFileSync('git', ['hash-object', '--stdin'], { cwd: ROOT, input })
  .toString().trim().slice(0, HASH_LENGTH);

test('⚠⚠ the worker\'s fingerprint of a body is git\'s blob hash of it — text', async () => {
  const hash = workerBlobHash();
  for (const text of ['hello\n', '', 'Può contenere tracce di frutta a guscio\n', 'a\r\nb\r\n']) {
    assert.equal(await hash(new TextEncoder().encode(text)), gitHash(Buffer.from(text)), JSON.stringify(text));
  }
});

test('⚠⚠ …and binary, byte for byte', async () => {
  const hash = workerBlobHash();
  const bytes = Uint8Array.from([0, 1, 2, 0, 255, 254, 13, 10, 0]);
  assert.equal(await hash(bytes), gitHash(Buffer.from(bytes)));
  const png = readFileSync(new URL('../icons/icon-192.png', import.meta.url));
  assert.equal(await hash(new Uint8Array(png)), gitHash(png));
});

test('the generated block reads back as the same map it was built from', () => {
  const sample = { './': 'aaaaaaaaaaaaaaaa', './js/x.js': 'bbbbbbbbbbbbbbbb' };
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(hashBlock(sample), ctx);
  assert.deepEqual({ ...vm.runInContext('ASSET_HASHES', ctx) }, sample);
});
