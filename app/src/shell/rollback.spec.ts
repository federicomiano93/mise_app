// rollback.spec.ts — ⚠️ THE WAY BACK, PROVED BY RUNNING BOTH WORKERS (switch plan, step 5).
//
// If the switch has to be reverted, `git revert -m 1` of the release merge puts the current app's files back
// on the site, and the current app's sw.js — with a CACHE_NAME one higher than the last it shipped, so every
// phone sees a new release — at the same address as Mise 2's worker. This spec plays that on one phone:
//   1. the current app installed (its real sw.js, the real files of this repository),
//   2. Mise 2's worker replaces it (the switch),
//   3. the current app's sw.js, CACHE_NAME bumped, replaces Mise 2's (the revert),
// and checks the current app wins: its cache whole, Mise 2's gone, its pages served from its own cache, and no
// stored data touched on the way. Mise 2's page letting a waiting worker in is serviceWorker.spec.ts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { composeWorker, revOf, type PrecacheEntry } from '../../sw-plugin';
import { BASE, createWorld, loadWorker, ORIGIN, SCOPE, type World } from '../testing/swHarness';

const ROOT = join(__dirname, '..', '..', '..');
const CURRENT_SW = readFileSync(join(ROOT, 'sw.js'), 'utf8');
const CURRENT_CACHE = CURRENT_SW.match(/const CACHE_NAME = '(theitalianclub-v(\d+))'/)!;
// The revert: the same file, one release higher (what `node scripts/sw-hashes.mjs --bump` does on the revert branch).
const REVERTED_CACHE = `theitalianclub-v${Number(CURRENT_CACHE[2]) + 1}`;
const REVERTED_SW = CURRENT_SW.replace(`'${CURRENT_CACHE[1]}'`, `'${REVERTED_CACHE}'`);

// Every file the current app precaches, served with its real bytes, so its fingerprint check runs for real.
function serveCurrentApp(world: World) {
  const assets = new Function(`${CURRENT_SW.slice(CURRENT_SW.indexOf('const ASSETS'), CURRENT_SW.indexOf('];', CURRENT_SW.indexOf('const ASSETS')) + 2)}; return ASSETS;`)() as string[];
  for (const asset of assets) {
    const file = asset === './' ? 'index.html' : asset.slice(2);
    world.server.set(new URL(asset, SCOPE).href, { body: new Uint8Array(readFileSync(join(ROOT, file))) });
  }
  return assets;
}

const ENTRY = `${BASE}assets/index-abc123.js`;
const MISE2: Record<string, string> = {
  'index.html': `<!doctype html><script type="module" src="${ENTRY}"></script>`,
  'assets/index-abc123.js': 'console.log("mise 2")',
  'assets/alarm-0a1b2c.wav': 'RIFF',
};
function serveMise2(world: World) {
  for (const [url, body] of Object.entries(MISE2)) world.server.set(`${SCOPE}${url}`, { body });
  const precache: PrecacheEntry[] = Object.entries(MISE2).map(([url, body]) => {
    const rev = revOf(new TextEncoder().encode(body));
    return url === 'index.html' ? { url, rev, html: true as const } : { url, rev };
  });
  return composeWorker({ base: BASE, precache, pageNeeds: [ENTRY] });
}

describe('rollback: the current app takes every phone back', () => {
  test('current app → Mise 2 → current app again (CACHE_NAME bumped): the current app wins', async () => {
    const world = createWorld();
    // 1. Today: the current app installed and running.
    const assets = serveCurrentApp(world);
    const today = loadWorker(world, CURRENT_SW);
    await today.install();
    await today.activate();
    expect(world.caches.get(CURRENT_CACHE[1]!)!.size).toBe(assets.length);

    // 2. The switch: Mise 2's worker, let in by the current app's own update tap.
    world.server.clear();
    const mise2 = loadWorker(world, serveMise2(world));
    const mise2Cache = mise2.constant('CACHE_NAME') as string;
    await mise2.install();
    mise2.message({ action: 'skipWaiting' });
    await mise2.activate();
    expect([...world.caches.keys()]).toEqual([mise2Cache]);

    // 3. The revert: the current app's files are back on the site, its sw.js one release higher.
    world.server.clear();
    serveCurrentApp(world);
    const back = loadWorker(world, REVERTED_SW);
    await back.install();
    // Mise 2's page lets a waiting worker in (serviceWorker.spec.ts): the same message the worker honours.
    const before = world.skipWaiting;
    back.message({ action: 'skipWaiting' });
    expect(world.skipWaiting).toBe(before + 1);
    await back.activate();

    // The current app's cache, whole; Mise 2's, gone.
    expect(world.caches.has(mise2Cache)).toBe(false);
    expect(world.caches.get(REVERTED_CACHE)!.size).toBe(assets.length);
    // Its Home is served from its own cache with no network at all.
    world.server.clear();
    const home = await back.fetch(`${SCOPE}`, { mode: 'navigate' });
    expect(await home!.text()).toBe(readFileSync(join(ROOT, 'index.html'), 'utf8'));
    // Nothing on the way reached IndexedDB or localStorage: who is signed in, the offline copy, unsent writes.
    expect(world.storageTouched).toEqual([]);
    // ⚠️ AND THE FINGERPRINT CHECK REALLY PASSED: the current app's sw.js stores a mismatching file «as received»
    // with a warning instead of failing, so a pass here is only a pass if nobody warned.
    expect(world.warnings).toEqual([]);
    expect(back.constant('VERIFY_FINGERPRINTS')).toBe(true);
  });

  test('the fingerprint check is live in this harness: a file served with other bytes is warned about', async () => {
    const world = createWorld();
    serveCurrentApp(world);
    world.server.set(`${SCOPE}home.html`, { body: 'not the committed home.html' });
    const today = loadWorker(world, CURRENT_SW);
    await today.install();
    expect(world.warnings.some(w => w.includes('./home.html'))).toBe(true);
  });

  test('⚠️ the revert\'s CACHE_NAME must be above every one this address has served — the runbook bumps past the merge\'s', () => {
    // The release itself carries the current app's sw.js one higher than main had (it changed label-zpl.js), and that
    // file sits in main after the switch. The revert restores main's older number, so a single --bump only reaches the
    // release's number again: the runbook bumps until the revert's number is above the merge's.
    expect(Number(REVERTED_CACHE.match(/\d+$/)![0])).toBeGreaterThan(Number(CURRENT_CACHE[2]));
    expect(REVERTED_SW).toContain(`const CACHE_NAME = '${REVERTED_CACHE}'`);
  });

  test('the origin and path are the ones the phones use', () => {
    expect(ORIGIN).toBe('https://federicomiano93.github.io');
    expect(SCOPE).toBe('https://federicomiano93.github.io/mise_app/');
  });
});
