// verify-live-site.mjs — after the switch: is the live site Mise 2, with everything outside links still need?
//
//   node scripts/verify-live-site.mjs [base-url]      (default https://federicomiano93.github.io/mise_app/)
//
// Asks the site, never the checkout:
//   - sw.js is Mise 2's worker (a `mise2-mise_app--…` cache), and every file it precaches answers 200 — one 404 there
//     fails the install on every phone;
//   - index.html names this release's entry script and stylesheets;
//   - order.html (clients' links), reset-password.html (the password email) and install-guide.html answer, with
//     EVERY file they load, followed through their scripts' imports and their stylesheets' url()s;
//   - each old page answers with its stub to the right Mise 2 screen (app/sw/legacy-routes.json);
//   - the manifest and its icons answer.
// Prints a JSON summary; exits 1 on any problem. Right after the merge Pages can still serve the previous site for a
// few minutes: wait and run it again before calling anything broken. Plain Node 18+, no dependency.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEPT_PAGES = ['order.html', 'reset-password.html', 'install-guide.html'];

export async function verifySite(base, fetchImpl = fetch) {
  const problems = [];
  const answered = new Map();
  // At most 6 at a time, and a 5xx or no answer is asked once more: GitHub Pages answers 503 to bursts (the current
  // app's sw.js caps its precache at 6 for the same reason).
  let inFlight = 0;
  const queue = [];
  const slot = () => (inFlight < 6 ? (inFlight++, Promise.resolve()) : new Promise(go => queue.push(go)));
  const done = () => { const next = queue.shift(); if (next) next(); else inFlight--; };
  const once = async (url) => {
    await slot();
    try {
      const res = await fetchImpl(url, { cache: 'no-store', redirect: 'manual' });
      return { status: res.status, text: res.ok ? await res.text() : '' };
    } catch (err) {
      return { status: 0, text: '' };
    } finally { done(); }
  };
  const get = async (url) => {
    if (!answered.has(url)) {
      answered.set(url, once(url).then(r => (r.status === 0 || r.status >= 500
        ? new Promise(wait => setTimeout(wait, 500)).then(() => once(url)) : r)));
    }
    return answered.get(url);
  };
  const must = async (url, why) => {
    const r = await get(url);
    if (r.status !== 200) problems.push(`${r.status || 'no answer'}: ${url.slice(base.length)} (${why})`);
    return r;
  };

  // Mise 2's worker and its precache.
  const sw = await must(`${base}sw.js`, 'the service worker');
  let precache = [];
  let pageNeeds = [];
  let cacheName = null;
  if (sw.status === 200) {
    try {
      const context = vm.createContext({ self: { location: new URL(`${base}sw.js`), addEventListener: () => {} }, URL, Map });
      vm.runInContext(sw.text, context);
      precache = vm.runInContext('PRECACHE', context);
      pageNeeds = vm.runInContext('PAGE_NEEDS', context);
      cacheName = vm.runInContext('CACHE_NAME', context);
    } catch {
      problems.push('sw.js is not Mise 2\'s worker (no PRECACHE): the site still serves the current app?');
    }
    if (cacheName && !cacheName.startsWith('mise2-mise_app--') && base.endsWith('/mise_app/')) {
      problems.push(`sw.js has cache ${cacheName}, not one of this address`);
    }
  }
  await Promise.all(precache.map(e => must(new URL(e.url, base).href, 'precached by sw.js')));
  const index = await must(`${base}index.html`, 'Mise 2');
  for (const url of pageNeeds) if (!index.text.includes(url)) problems.push(`index.html does not name ${url}: the previous release?`);

  // The current app's pages that outside links open, and everything they load.
  const seen = new Set();
  const crawl = async (url, from) => {
    const clean = url.split('#')[0].split('?')[0];
    if (seen.has(clean) || !clean.startsWith(base)) return;
    seen.add(clean);
    const r = await must(clean, `loaded by ${from.slice(base.length)}`);
    if (r.status !== 200) return;
    const refs = [];
    if (clean.endsWith('.html')) {
      for (const m of r.text.matchAll(/<(?:script|link|img)\b[^>]*?\s(?:src|href)="([^"]+)"/g)) refs.push(m[1]);
    } else if (clean.endsWith('.js')) {
      // Comments name files too (`// import './firebase.js' for init`): whole comment lines and blocks are left out.
      const code = r.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g)) refs.push(m[1]);
    } else if (clean.endsWith('.css')) {
      for (const m of r.text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) refs.push(m[1]);
    }
    for (const ref of refs) {
      if (/^(?:[a-z]+:|\/\/|#)/i.test(ref) && !ref.startsWith(base)) continue;
      await crawl(new URL(ref, clean).href, clean);
    }
  };
  for (const page of KEPT_PAGES) await crawl(`${base}${page}`, `${base}(outside link)`);

  // The old pages' stubs.
  const routes = JSON.parse(readFileSync(join(ROOT, 'app/sw/legacy-routes.json'), 'utf8'));
  delete routes['//'];
  for (const [page, route] of Object.entries(routes)) {
    const r = await must(`${base}${page}`, 'an old address');
    const target = page === 'home.html' ? 'index.html' : (route ? `./#${route}` : './');
    if (r.status === 200 && !r.text.includes(`url=${target}`)) problems.push(`${page} does not send to ${target}`);
  }
  for (const file of ['manifest.json', 'icons/icon-192.png', 'icons/icon-512.png']) await must(`${base}${file}`, 'the installed app');

  return { base, cacheName, precached: precache.length, keptPagesFiles: seen.size, checked: answered.size, problems };
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invoked) {
  const base = (process.argv[2] ?? 'https://federicomiano93.github.io/mise_app/').replace(/\/?$/, '/');
  const result = await verifySite(base);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.problems.length ? 1 : 0);
}
