// `node scripts/sw-hashes.mjs --bump` — the one tool the Mise 2 rollback needs (docs/switch-runbook.md, «Rollback»).
//
// A revert of the switch puts back files byte-identical to the current app's last release, so the script finds every
// fingerprint unchanged and would bump nothing: the phones on Mise 2 would get back a worker with the very number they
// left. --bump gives the current app's sw.js a new CACHE_NAME anyway. Run on a COPY of the repository's files (git
// archive into a temporary folder), never on this checkout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function copyOfTheApp() {
  const dir = mkdtempSync(join(tmpdir(), 'sw-bump-'));
  // The working tree's files (sw.js and everything it precaches, and the script): what a revert branch holds.
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'sw.js', 'scripts', ':(glob)*.html', 'dist', 'js', 'icons', 'fonts', 'sounds', 'manifest.json', 'qr.png'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  execFileSync('tar', ['-cf', join(dir, 'files.tar'), ...files], { cwd: ROOT });
  execFileSync('tar', ['-xf', 'files.tar'], { cwd: dir });
  return dir;
}
const cacheName = sw => sw.match(/const CACHE_NAME = 'theitalianclub-v(\d+)';/)[1];
const hashes = sw => sw.slice(sw.indexOf('// <asset-hashes>'), sw.indexOf('// </asset-hashes>'));

test('--bump: one release higher, the fingerprints untouched; --check still writes nothing', () => {
  const dir = copyOfTheApp();
  try {
    const before = readFileSync(join(dir, 'sw.js'), 'utf8');
    const run = (...args) => execFileSync(process.execPath, [join(dir, 'scripts/sw-hashes.mjs'), ...args], { cwd: dir, encoding: 'utf8' });
    assert.match(run(), /up to date/, 'without --bump an unchanged tree bumps nothing (the reason --bump exists)');
    assert.equal(readFileSync(join(dir, 'sw.js'), 'utf8'), before);
    assert.match(run('--check', '--bump'), /up to date/);
    assert.equal(readFileSync(join(dir, 'sw.js'), 'utf8'), before, '--check never writes');
    assert.match(run('--bump'), /\(--bump\) → CACHE_NAME v/);
    const after = readFileSync(join(dir, 'sw.js'), 'utf8');
    assert.equal(Number(cacheName(after)), Number(cacheName(before)) + 1);
    assert.equal(hashes(after), hashes(before));
    assert.equal(after.replace(/theitalianclub-v\d+/, 'X'), before.replace(/theitalianclub-v\d+/, 'X'), 'only the number changed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
