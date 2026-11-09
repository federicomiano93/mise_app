// verify-build.mjs — checks the BUILT service worker against the built files. Run by CI (test.yml, job mise2) right
// after `npm run build`: `node sw/verify-build.mjs dist`. The specs prove the worker's behaviour on an invented build;
// this proves the real one is what they assumed:
//   - every file the worker precaches exists, with the fingerprint it carries (a precache 404 fails every install);
//   - every built file but the source maps and sw.js is precached (a missing one is a blank screen offline);
//   - the guided-mixing alarm, the manifest and its icons are in it;
//   - index.html is marked, names every script and stylesheet the worker expects, and links the manifest;
//   - no precached name starts with «_» (Jekyll would drop it).
// Plain Node, no dependency: the build has already run.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import vm from 'node:vm';

const dir = process.argv[2] ?? 'dist';
const problems = [];
const say = message => problems.push(message);

const context = vm.createContext({ self: { location: new URL('https://example.test/sw.js'), addEventListener: () => {} }, URL, Map });
vm.runInContext(readFileSync(join(dir, 'sw.js'), 'utf8'), context);
const PRECACHE = vm.runInContext('PRECACHE', context);
const PAGE_NEEDS = vm.runInContext('PAGE_NEEDS', context);
const LEFT_OUT = vm.runInContext('LEFT_OUT', context);

const files = [];
const walk = d => { for (const n of readdirSync(d)) { const f = join(d, n); if (statSync(f).isDirectory()) walk(f); else files.push(relative(dir, f).split(sep).join('/')); } };
walk(dir);

for (const entry of PRECACHE) {
  if (!files.includes(entry.url)) { say(`precached but not built: ${entry.url}`); continue; }
  const rev = createHash('sha256').update(readFileSync(join(dir, entry.url))).digest('hex').slice(0, 16);
  if (rev !== entry.rev) say(`fingerprint differs: ${entry.url}`);
}
const listed = new Set(PRECACHE.map(e => e.url));
for (const file of files) {
  if (file === 'sw.js' || file.endsWith('.map')) continue;
  if (!listed.has(file) && !LEFT_OUT.includes(file)) say(`built but not precached: ${file}`);
}
// A file left out must never be STATICALLY imported by a precached one (offline, that page would not start). jsPDF's
// dynamic import() of its optional parts is fine: it never runs for the recipe export.
for (const file of LEFT_OUT) {
  const name = file.split('/').pop();
  const statically = new RegExp(`(?:from\\s*|import\\s*)["'][./]*(?:assets/)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`);
  for (const entry of PRECACHE.filter(e => e.url.endsWith('.js'))) {
    if (statically.test(readFileSync(join(dir, entry.url), 'utf8'))) say(`left out but statically imported by ${entry.url}: ${file}`);
  }
  if (!/^assets\/(html2canvas|purify\.es|index\.es)-/.test(file)) say(`left out, and not one of jsPDF's optional parts: ${file}`);
}
for (const pattern of [/^assets\/alarm-[^/]+\.wav$/, /^manifest\.json$/, /^icons\/icon-192\.png$/, /^icons\/icon-512\.png$/, /^index\.html$/]) {
  if (!PRECACHE.some(e => pattern.test(e.url))) say(`not precached: ${pattern}`);
}
const index = readFileSync(join(dir, 'index.html'), 'utf8');
if (!PRECACHE.find(e => e.url === 'index.html')?.html) say('index.html is not marked as the page');
for (const url of PAGE_NEEDS) if (!index.includes(url)) say(`index.html does not name ${url}`);
if (!PAGE_NEEDS.some(url => url.endsWith('.js'))) say('the worker knows no script of index.html');
// GitHub Pages' own Jekyll build drops files whose name starts with «_»: a precached one would fail every install.
for (const entry of PRECACHE) if (entry.url.split('/').some(part => part.startsWith('_'))) say(`a name Jekyll would drop: ${entry.url}`);
if (!/<link rel="manifest" href="[^"]*manifest\.json">/.test(index)) say('index.html links no manifest');

if (problems.length) {
  console.error(`sw.js does not match the build:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`sw.js matches the build: ${PRECACHE.length} files precached (${vm.runInContext('CACHE_NAME', context)})`);
