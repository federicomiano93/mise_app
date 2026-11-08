// drive-switch.cjs — the switch and its rollback in a REAL Chromium, one profile, one origin:
//   1. today's app installed (this checkout's current-app files, its real sw.js);
//   2. the site becomes Mise 2 (built here with --base=/mise_app/): the old page's own update tap must land on Mise 2,
//      the old pages open their Mise 2 screens, reset-password.html is never cached, Mise 2 opens offline, and the
//      person's localStorage and IndexedDB come through untouched;
//   3. the site is reverted (the current app's sw.js one release higher, as `node scripts/sw-hashes.mjs --bump` makes
//      it): Mise 2's page must let it in by itself and the current app must win.
// The specs prove the same in node:vm (app/src/shell/{worker,rollback}.spec.ts); this proves it on a browser.
//
// Run from the repository root, with app/ installed:  node app/sw/drive-switch.cjs
// Needs Playwright and its Chromium (preinstalled in Claude's cloud sessions). Served on 127.0.0.1, where both apps
// point Firebase at the local emulator — nothing reaches a real project, and neither app needs to sign in: only the
// workers and the pages are driven. (On 127.0.0.1 both workers skip their fingerprint check, by design.) The
// Firebase SDK the current app loads from gstatic is answered from app/node_modules/firebase (the same 12.19.0).
// Prints one PASS/FAIL line per check; exits 1 on any FAIL.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const REPO = path.join(__dirname, '..', '..');
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-switch-'));
function stage() {
  const a = path.join(S, 'siteA', 'mise_app');
  fs.mkdirSync(a, { recursive: true });
  const files = execFileSync('git', ['ls-files', '--', ':(glob)*.html', ':(glob)*.css', 'sw.js', 'manifest.json', 'qr.png', 'js', 'dist', 'icons', 'fonts', 'sounds'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
  execFileSync('tar', ['-cf', path.join(S, 'a.tar'), ...files], { cwd: REPO });
  execFileSync('tar', ['-xf', path.join(S, 'a.tar'), '-C', a]);
  const c = path.join(S, 'siteC', 'mise_app');
  fs.cpSync(a, c, { recursive: true });
  const sw = fs.readFileSync(path.join(c, 'sw.js'), 'utf8');
  fs.writeFileSync(path.join(c, 'sw.js'), sw.replace(/const CACHE_NAME = 'theitalianclub-v(\d+)';/, (_, n) => `const CACHE_NAME = 'theitalianclub-v${Number(n) + 1}';`));
  const b = path.join(S, 'siteB', 'mise_app');
  execFileSync(process.execPath, [path.join(REPO, 'app/node_modules/vite/bin/vite.js'), 'build', '--base=/mise_app/', '--outDir', b, '--emptyOutDir', '--logLevel', 'error'], { cwd: path.join(REPO, 'app'), stdio: 'inherit' });
  for (const page of ['order.html', 'reset-password.html']) fs.copyFileSync(path.join(REPO, page), path.join(b, page));
  return fs.readFileSync(path.join(c, 'sw.js'), 'utf8').match(/theitalianclub-v\d+/)[0];
}
const REVERTED = stage();
let siteRoot = path.join(S, 'siteA');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wav': 'audio/wav' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(siteRoot, p.endsWith('/') ? p + 'index.html' : p);
  if (!file.startsWith(siteRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

const results = [];
const check = (name, ok, detail = '') => { const line = `${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`; results.push(line); console.log(line); };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/mise_app/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  // gstatic is not reachable from this sandbox: the same files, version 12.19.0, from the npm package. Context-level, so
  // the service workers' own fetches are answered too.
  const SDK = path.join(REPO, 'app/node_modules/firebase') + path.sep;
  await ctx.route('https://www.gstatic.com/firebasejs/12.19.0/*', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(SDK + name) });
  });
  const page = await ctx.newPage();
  const swState = () => page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return { controller: navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL,
      active: reg && reg.active && reg.active.scriptURL, waiting: !!(reg && reg.waiting), scope: reg && reg.scope,
      caches: await caches.keys() };
  });
  const waitFor = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch (e) { /* navigating */ } await new Promise(r => setTimeout(r, 250)); } return false; };

  console.log('step 1'); page.on('console', m => { if (m.type() === 'error') console.log('  console:', m.text().slice(0, 160)); });
  // 1. Today's app, installed.
  await page.goto(base + 'index.html');
  await waitFor(async () => (await swState()).active);
  await page.reload();
  await waitFor(async () => (await swState()).controller);
  // Some data the person has: localStorage and an IndexedDB database must survive everything below.
  await page.evaluate(() => new Promise(done => {
    localStorage.setItem('active-location', 'venue-1');
    const open = indexedDB.open('person-data-probe', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('s');
    open.onsuccess = () => { const tx = open.result.transaction('s', 'readwrite'); tx.objectStore('s').put('signed-in-user', 'k'); tx.oncomplete = () => { open.result.close(); done(); }; };
  }));
  let st = await swState();
  check('today: the current app is installed and in control', /theitalianclub/.test(st.caches.join()) && !!st.controller, JSON.stringify(st.caches));

  console.log('step 2');
  // 2. The switch: the site now serves Mise 2. The old page checks for an update (as it does on coming back).
  siteRoot = path.join(S, 'siteB');
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  const waited = await waitFor(async () => (await swState()).waiting, 30000);
  st = await swState();
  check('switch: Mise 2 installs and WAITS (no take-over by itself)', waited && st.caches.some(c => c.startsWith('mise2-')), JSON.stringify(st));
  // The current app's banner tap: the exact message js/sw-update.js posts, and its controllerchange reload.
  await page.evaluate(() => new Promise(done => {
    navigator.serviceWorker.addEventListener('controllerchange', () => { setTimeout(() => location.reload(), 300); done(); }, { once: true });
    navigator.serviceWorker.getRegistration().then(r => r.waiting.postMessage({ action: 'skipWaiting' }));
  }));
  await page.waitForLoadState('load');
  await waitFor(async () => (await page.evaluate(() => !!document.querySelector('#root'))));
  st = await swState();
  check('switch: the old page\'s own update tap lands on Mise 2', !st.waiting && !st.caches.some(c => c.startsWith('theitalianclub-') || c.startsWith('firebase-sdk-')), JSON.stringify(st.caches));
  check('switch: Mise 2\'s page is what opens', await page.evaluate(() => !!document.getElementById('root')));
  await page.goto(base + 'orders.html');
  check('switch: an old page (orders.html) opens its Mise 2 screen', page.url() === base + '#/orders', page.url());
  await page.goto(base + 'calculator.html?x=1');
  check('switch: calculator.html (a notification\'s target) opens #/calculator', page.url() === base + '#/calculator', page.url());
  const resp = await page.goto(base + 'reset-password.html?mode=resetPassword&oobCode=SECRET');
  st = await swState();
  const anyKeyHasCode = await page.evaluate(async () => { for (const n of await caches.keys()) { const c = await caches.open(n); for (const r of await c.keys()) if (r.url.includes('oobCode')) return true; } return false; });
  check('switch: reset-password.html comes from the network and is never cached', resp.status() === 200 && !anyKeyHasCode);
  // Offline: Mise 2 opens from its cache.
  await ctx.setOffline(true);
  await page.goto(base);
  check('switch: offline, Mise 2 still opens', await page.evaluate(() => !!document.getElementById('root') && document.querySelectorAll('script[type=module]').length > 0));
  await ctx.setOffline(false);
  const kept = await page.evaluate(() => new Promise(done => {
    const v = localStorage.getItem('active-location');
    const open = indexedDB.open('person-data-probe');
    open.onsuccess = () => { const g = open.result.transaction('s').objectStore('s').get('k'); g.onsuccess = () => { open.result.close(); done([v, g.result]); }; };
  }));
  check('switch: localStorage and IndexedDB untouched', kept[0] === 'venue-1' && kept[1] === 'signed-in-user', JSON.stringify(kept));

  console.log('step 3');
  // 3. The revert: the current app's files back, its sw.js one release higher. Mise 2's page lets it in by itself.
  await page.goto(base);
  await page.waitForLoadState('load');
  siteRoot = path.join(S, 'siteC');
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
  const back = await waitFor(async () => {
    try { const s = await swState(); return s.caches.includes(REVERTED) && !s.caches.some(c => c.startsWith('mise2-')) && !s.waiting; } catch { return false; }
  }, 40000);
  st = await swState().catch(() => ({}));
  check('rollback: the current app takes the phone back, Mise 2\'s cache gone', back, JSON.stringify(st));
  await page.goto(base + 'index.html');
  check('rollback: the current app\'s Home is what opens', await page.evaluate(() => !document.getElementById('root') && !!document.querySelector('script[src*="dist/index.js"]')));
  const kept2 = await page.evaluate(() => localStorage.getItem('active-location'));
  check('rollback: localStorage untouched', kept2 === 'venue-1');

  console.log(results.join('\n'));
  await browser.close();
  server.close();
  fs.rmSync(S, { recursive: true, force: true });
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.log(results.join('\n')); console.error(e); process.exit(2); });
