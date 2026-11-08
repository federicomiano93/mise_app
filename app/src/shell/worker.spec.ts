// worker.spec.ts — Mise 2's service worker, EXECUTED in node:vm (app/src/testing/swHarness.ts says why).
//
// The worker is composed exactly as the build composes it (sw-plugin.ts, composeWorker), over a small
// invented build: index.html naming its entry script, two scripts, the alarm, a font.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, test } from 'vitest';
import { composeWorker, miseServiceWorker, neverLoadedChunk, revOf, type PrecacheEntry } from '../../sw-plugin';
import { BASE, createWorld, loadWorker, ORIGIN, SCOPE, type World } from '../testing/swHarness';

const ENTRY = `${BASE}assets/index-abc123.js`;
const FILES: Record<string, string> = {
  'index.html': `<!doctype html><script type="module" crossorigin src="${ENTRY}"></script>`,
  'assets/index-abc123.js': 'console.log("mise 2")',
  'assets/react-def456.js': 'export const React = 1',
  'assets/alarm-0a1b2c.wav': 'RIFF....WAVE',
  'assets/geist-latin-9f8e.woff2': 'wOF2',
};

function build(files = FILES, base = BASE) {
  const precache: PrecacheEntry[] = Object.entries(files).map(([url, body]) => {
    const rev = revOf(new TextEncoder().encode(body));
    return url === 'index.html' ? { url, rev, html: true as const } : { url, rev };
  });
  return composeWorker({ base, precache, entry: ENTRY });
}

function serve(world: World, files = FILES, base = BASE) {
  for (const [url, body] of Object.entries(files)) world.server.set(`${ORIGIN}${base}${url}`, { body });
}

async function installed(world = createWorld()) {
  serve(world);
  const sw = loadWorker(world, build());
  await sw.install();
  return { world, sw, cacheName: sw.constant('CACHE_NAME') as string };
}

describe('install', () => {
  test('precaches every file of the build, the alarm included, in its own cache', async () => {
    const { world, cacheName } = await installed();
    expect(cacheName).toMatch(/^mise2-mise_app-[0-9a-f]{12}$/);
    const cached = [...world.caches.get(cacheName)!.keys()].sort();
    expect(cached).toEqual(Object.keys(FILES).map(f => `${SCOPE}${f}`).sort());
    expect(cached).toContain(`${SCOPE}assets/alarm-0a1b2c.wav`);
  });

  test('does not take over by itself: no skipWaiting at install', async () => {
    const { world } = await installed();
    expect(world.skipWaiting).toBe(0);
  });

  test('a file refused once is retried, and the install succeeds', async () => {
    const world = createWorld();
    serve(world);
    const url = `${SCOPE}assets/react-def456.js`;
    world.server.set(url, attempt => (attempt === 1 ? 'fail' : { body: FILES['assets/react-def456.js']! }));
    const sw = loadWorker(world, build());
    await expect(sw.install()).resolves.toBeUndefined();
    expect(world.fetched.filter(u => u === url)).toHaveLength(2);
  });

  test('ALL OR NOTHING: a file that never arrives fails the whole install, after three attempts', async () => {
    const world = createWorld();
    serve(world);
    const url = `${SCOPE}assets/alarm-0a1b2c.wav`;
    world.server.set(url, () => 404);
    const sw = loadWorker(world, build());
    await expect(sw.install()).rejects.toThrow(/precache incomplete: 1 of 5 .*alarm/);
    expect(world.fetched.filter(u => u === url)).toHaveLength(3);
  });

  test('an index.html of the PREVIOUS release (a CDN still holding it) is asked for again past the CDN', async () => {
    const world = createWorld();
    serve(world);
    const stale = '<!doctype html><script type="module" src="/mise_app/assets/index-OLD.js"></script>';
    world.server.set(`${SCOPE}index.html`, { body: stale });
    world.server.set(`${SCOPE}index.html?fp=${revOf(new TextEncoder().encode(FILES['index.html']!))}`, { body: FILES['index.html']! });
    const sw = loadWorker(world, build());
    await sw.install();
    const cached = await world.caches.get(sw.constant('CACHE_NAME') as string)!.get(`${SCOPE}index.html`)!.clone().text();
    expect(cached).toBe(FILES['index.html']);
  });

  test('…and if it is STILL the previous release, the install fails rather than store a page whose scripts are gone', async () => {
    const world = createWorld();
    serve(world);
    world.server.set(`${SCOPE}index.html`, { body: '<script type="module" src="/mise_app/assets/index-OLD.js"></script>' });
    const sw = loadWorker(world, build());
    await expect(sw.install()).rejects.toThrow(/precache incomplete.*index\.html/);
  });

  test('an index.html changed on the way in (it still names this release) is stored: refusing would stop that phone updating for ever', async () => {
    const world = createWorld();
    serve(world);
    world.server.set(`${SCOPE}index.html`, { body: `${FILES['index.html']}<script>/* injected by an antivirus */</script>` });
    const sw = loadWorker(world, build());
    await expect(sw.install()).resolves.toBeUndefined();
  });

  test('an unchanged file is copied from the previous Mise 2 cache, not downloaded again', async () => {
    const { world } = await installed();
    world.fetched.length = 0;
    const next = { ...FILES, 'assets/index-abc123.js': 'console.log("mise 2, next release")' };
    serve(world, next);
    const sw = loadWorker(world, build(next));
    await sw.install();
    expect(world.fetched).toEqual([`${SCOPE}assets/index-abc123.js`]);
  });
});

describe('activate: the take-over', () => {
  test('removes the current app\'s caches and the older Mise 2 ones, keeps anything else, and touches no stored data', async () => {
    const world = createWorld();
    for (const name of ['theitalianclub-v766', 'theitalianclub-v765', 'firebase-sdk-12-19-0', 'mise2-mise_app-000000000000', 'mise2-mise2-111111111111', 'someone-elses']) {
      world.caches.set(name, new Map());
    }
    const { sw, cacheName } = await installed(world);
    await sw.activate();
    expect([...world.caches.keys()].sort()).toEqual([cacheName, 'mise2-mise2-111111111111', 'someone-elses'].sort());
    // IndexedDB (Auth, Firestore's offline copy and its unsent writes) and localStorage: never reached.
    expect(world.storageTouched).toEqual([]);
  });

  test('at /mise2/ beside the current app (the old preview) the current app\'s caches are left alone', async () => {
    const world = createWorld();
    world.caches.set('theitalianclub-v766', new Map());
    world.caches.set('firebase-sdk-12-19-0', new Map());
    serve(world, FILES, '/mise2/');
    const sw = loadWorker(world, build(FILES, '/mise2/').replace(JSON.stringify(ENTRY), JSON.stringify(ENTRY)), '/mise2/sw.js');
    await sw.install();
    await sw.activate();
    expect(world.caches.has('theitalianclub-v766')).toBe(true);
    expect(world.caches.has('firebase-sdk-12-19-0')).toBe(true);
    expect(sw.constant('TAKE_OVER')).toBe(false);
  });
});

describe('fetch', () => {
  test('opening the app — with a query too — is index.html from this release\'s cache, offline included', async () => {
    const { world, sw } = await installed();
    world.server.clear();
    for (const url of [SCOPE, `${SCOPE}index.html`, `${SCOPE}?source=pwa`]) {
      const res = await sw.fetch(url, { mode: 'navigate' });
      expect(await res!.text(), url).toBe(FILES['index.html']);
    }
  });

  test('a page of the current app opens its Mise 2 screen', async () => {
    const { sw } = await installed();
    const cases: Record<string, string> = {
      'orders.html': `${SCOPE}#/orders`,
      'calculator.html?tab=2': `${SCOPE}#/calculator`,
      'catalogue.html': `${SCOPE}#/recipes`,
      'inventory.html?month=2026-10': `${SCOPE}#/stocktake`,
      'foodcost.html': `${SCOPE}#/food-cost`,
      'home.html': SCOPE,
    };
    for (const [page, target] of Object.entries(cases)) {
      const res = await sw.fetch(`${SCOPE}${page}`, { mode: 'navigate' });
      expect(res?.status, page).toBe(302);
      expect(res?.headers.get('location'), page).toBe(target);
    }
  });

  test('order.html and reset-password.html go to the network untouched, and are never cached', async () => {
    const { world, sw, cacheName } = await installed();
    for (const url of [`${SCOPE}order.html?c=abc`, `${SCOPE}reset-password.html?mode=resetPassword&oobCode=SECRET`, `${SCOPE}install-guide.html`]) {
      expect(await sw.fetch(url, { mode: 'navigate' }), url).toBeUndefined();
    }
    expect([...world.caches.get(cacheName)!.keys()].some(k => k.includes('oobCode'))).toBe(false);
  });

  test('a file of this release comes from its cache; other hosts, other files and writes are not touched', async () => {
    const { world, sw } = await installed();
    world.server.clear();
    expect(await (await sw.fetch(`${SCOPE}assets/alarm-0a1b2c.wav`))!.text()).toBe(FILES['assets/alarm-0a1b2c.wav']);
    expect(await sw.fetch('https://firestore.googleapis.com/v1/projects/x')).toBeUndefined();
    expect(await sw.fetch(`${SCOPE}dist/order.js`)).toBeUndefined();
    expect(await sw.fetch(`${SCOPE}assets/index-abc123.js`, { method: 'POST' })).toBeUndefined();
  });
});

describe('messages and notifications', () => {
  test('the current app\'s update tap ({action: skipWaiting}) lets Mise 2 in, and «which version» is answered', async () => {
    const { world, sw, cacheName } = await installed();
    sw.message({ action: 'skipWaiting' });
    expect(world.skipWaiting).toBe(1);
    expect(sw.message({ action: 'version' })).toEqual([{ version: cacheName }]);
  });

  test('a push from the server still shows its text, and a tap opens the Mise 2 screen of the page it names', async () => {
    const { world, sw } = await installed();
    await sw.push({ data: { title: 'Ordine', body: 'Nuovo ordine', url: './calculator.html' } });
    expect(world.notifications).toHaveLength(1);
    expect(world.notifications[0]!.title).toBe('Ordine');
    await sw.click('./calculator.html');
    expect(world.opened).toEqual([`${SCOPE}#/calculator`]);
    const { navigated } = await sw.click('./orders.html', [{ url: `${SCOPE}#/home` }]);
    expect(navigated).toEqual([`${SCOPE}#/orders`]);
  });

  test('a push while the app is on screen shows nothing more', async () => {
    const { world, sw } = await installed();
    await sw.push({ data: { title: 'x' } }, true);
    expect(world.notifications).toHaveLength(0);
  });
});

describe('the build plugin', () => {
  let dir = '';
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });

  test('writes sw.js with every built file but the source maps, and copies the manifest and icons from the repository root', () => {
    dir = mkdtempSync(join(tmpdir(), 'mise2-sw-'));
    const out = join(dir, 'dist');
    mkdirSync(join(out, 'assets'), { recursive: true });
    for (const [file, body] of Object.entries(FILES)) writeFileSync(join(out, file), body);
    writeFileSync(join(out, 'assets/index-abc123.js.map'), '{}');
    writeFileSync(join(out, 'favicon.svg'), '<svg/>');
    const plugin = miseServiceWorker(join(__dirname, '..', '..', '..'));
    (plugin.configResolved as (c: unknown) => void)({ root: dir, base: BASE, build: { outDir: 'dist' } });
    (plugin.closeBundle as () => void)();

    for (const file of ['manifest.json', 'icons/icon-192.png', 'icons/icon-512.png']) expect(existsSync(join(out, file)), file).toBe(true);
    const context = vm.createContext({ self: { location: new URL(`${SCOPE}sw.js`), addEventListener: () => {} }, URL, Map });
    vm.runInContext(readFileSync(join(out, 'sw.js'), 'utf8'), context);
    const urls = (vm.runInContext('PRECACHE', context) as PrecacheEntry[]).map(e => e.url);
    expect(urls).toEqual([...Object.keys(FILES), 'favicon.svg', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'].sort());
    expect(vm.runInContext('ENTRY', context)).toBe(ENTRY);
    expect(vm.runInContext('TAKE_OVER', context)).toBe(true);
  });

  test('⚠️ jsPDF\'s never-loaded parts are left out by the modules they hold; a chunk with anything else in it stays', () => {
    expect(neverLoadedChunk(['/x/node_modules/html2canvas/dist/html2canvas.esm.js'])).toBe(true);
    expect(neverLoadedChunk(['/x/node_modules/canvg/lib/index.es.js', '/x/node_modules/core-js/modules/es.promise.js'])).toBe(true);
    expect(neverLoadedChunk(['C:\\x\\node_modules\\dompurify\\dist\\purify.es.mjs'])).toBe(true);
    expect(neverLoadedChunk(['/x/node_modules/jspdf/dist/jspdf.es.min.js'])).toBe(false);
    expect(neverLoadedChunk(['/x/node_modules/html2canvas/a.js', '/x/src/recipes/export.ts'])).toBe(false);
    expect(neverLoadedChunk([])).toBe(false);

    dir = mkdtempSync(join(tmpdir(), 'mise2-sw-'));
    const out = join(dir, 'dist');
    mkdirSync(join(out, 'assets'), { recursive: true });
    for (const [file, body] of Object.entries(FILES)) writeFileSync(join(out, file), body);
    writeFileSync(join(out, 'assets/html2canvas-x1.js'), 'export default 1');
    const plugin = miseServiceWorker(join(__dirname, '..', '..', '..'));
    (plugin.configResolved as (c: unknown) => void)({ root: dir, base: BASE, build: { outDir: 'dist' } });
    (plugin.generateBundle as (o: unknown, b: unknown) => void)({}, {
      'assets/html2canvas-x1.js': { type: 'chunk', fileName: 'assets/html2canvas-x1.js', modules: { '/r/node_modules/html2canvas/dist/x.js': {} } },
      'assets/index-abc123.js': { type: 'chunk', fileName: 'assets/index-abc123.js', modules: { '/r/app/src/main.tsx': {} } },
    });
    (plugin.closeBundle as () => void)();
    const context = vm.createContext({ self: { location: new URL(`${SCOPE}sw.js`), addEventListener: () => {} }, URL, Map });
    vm.runInContext(readFileSync(join(out, 'sw.js'), 'utf8'), context);
    const urls = (vm.runInContext('PRECACHE', context) as PrecacheEntry[]).map(e => e.url);
    expect(urls).not.toContain('assets/html2canvas-x1.js');
    expect(urls).toContain('assets/index-abc123.js');
    expect(vm.runInContext('LEFT_OUT', context)).toEqual(['assets/html2canvas-x1.js']);
  });
});
