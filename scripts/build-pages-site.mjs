// build-pages-site.mjs — assembles what GitHub Pages serves at https://federicomiano93.github.io/mise_app/ once Mise 2
// has replaced the current app (the switch). Run by .github/workflows/pages.yml after Mise 2's build:
//
//   node scripts/build-pages-site.mjs <out-dir> <mise2-dist>
//
// Until the switch Pages publishes the committed files of main as they are. From the switch on it publishes this:
//   1. the current app's own files, from git (the same allowlist the preview stages: pages, stylesheets, js/, dist/,
//      icons, fonts, sounds, the QR code, the manifest) — so `order.html` (the wholesale clients' page, whose links
//      have been sent and must keep working), `reset-password.html` (the address of the password email) and
//      `install-guide.html` keep every file they load, unchanged;
//   2. instead of the current app's other pages, a stub that opens the same screen in Mise 2
//      (app/sw/legacy-routes.json; `home.html` keeps its own committed stub, which sends to index.html);
//   3. Mise 2's build on top: its index.html, its sw.js (at the current app's address: that is the switch), assets/.
// Nothing internal is ever copied (rules, functions, tests, sources, docs, .git): only the allowlist, from git.
//
// ⚠️ A MISE 2 FILE MAY REPLACE ONLY index.html AND sw.js (and the shared manifest and icons, byte-identical): any other
// name taken by both is refused, rather than silently serving one app's file to the other.
// Prints the site's file list; exits 1 on any problem. Plain Node, no dependency.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The current app's served files, as the preview stages them (.github/workflows/preview.yml).
export const CURRENT_APP_PATHS = [':(glob)*.html', ':(glob)*.css', 'manifest.json', 'qr.png', 'js', 'dist', 'icons', 'fonts', 'sounds'];
// Mise 2's own, replacing the current app's.
export const REPLACED_BY_MISE2 = ['index.html', 'sw.js'];
// Shared by both apps, the same bytes (app/sw-plugin.ts copies them into Mise 2's build from the root).
export const SHARED = ['manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'];
// Pages that stay the current app's own, unchanged.
export const KEPT_PAGES = ['order.html', 'reset-password.html', 'install-guide.html', 'home.html'];

export function legacyRoutes() {
  const table = JSON.parse(readFileSync(join(ROOT, 'app/sw/legacy-routes.json'), 'utf8'));
  delete table['//'];
  return table;
}

// The page served at an old address when no worker answers (a new device, a bookmark). Same shape as home.html.
export function stubPage(page, route) {
  const target = route ? `./#${route}` : './';
  return `<!--
  Redirect stub, written by scripts/build-pages-site.mjs. ${page} was a page of the app before Mise 2; its screen is
  now ${target} in Mise 2. Mise 2's service worker answers this address itself; this page is for a browser without it.
-->
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; base-uri 'self'; form-action 'self'">
<meta http-equiv="refresh" content="0; url=${target}">
<link rel="canonical" href="${target}">
<title>Mise</title>
</head>
<body>
<p>Redirecting… <a href="${target}">Open Mise</a></p>
</body>
</html>
`;
}

function filesUnder(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) filesUnder(full, out);
    else out.push(full);
  }
  return out;
}

export function buildSite(outDir, mise2Dist, repo = ROOT) {
  const problems = [];
  if (!existsSync(join(mise2Dist, 'index.html')) || !existsSync(join(mise2Dist, 'sw.js'))) {
    throw new Error(`${mise2Dist} is not a Mise 2 build (no index.html or sw.js): run \`npm run build -- --base=/mise_app/\` in app/ first`);
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const routes = legacyRoutes();

  // 1. The current app's files, from git (never the workspace).
  const tracked = execFileSync('git', ['ls-files', '-z', '--', ...CURRENT_APP_PATHS], { cwd: repo, encoding: 'utf8' })
    .split('\0').filter(Boolean);
  for (const file of tracked) {
    if (REPLACED_BY_MISE2.includes(file)) continue;
    if (Object.hasOwn(routes, file) && !KEPT_PAGES.includes(file)) continue;
    mkdirSync(dirname(join(outDir, file)), { recursive: true });
    copyFileSync(join(repo, file), join(outDir, file));
  }
  // 2. The stubs.
  for (const [page, route] of Object.entries(routes)) {
    if (KEPT_PAGES.includes(page)) continue;
    writeFileSync(join(outDir, page), stubPage(page, route));
  }
  // 3. Mise 2 on top.
  for (const full of filesUnder(mise2Dist)) {
    const file = relative(mise2Dist, full).split(sep).join('/');
    if (file.endsWith('.map')) continue;
    const target = join(outDir, file);
    if (existsSync(target) && !REPLACED_BY_MISE2.includes(file)) {
      const same = readFileSync(target).equals(readFileSync(full));
      if (!(SHARED.includes(file) && same)) problems.push(`${file}: both apps have a file of this name`);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(full, target);
  }
  // The pages every outside link needs.
  for (const page of [...KEPT_PAGES, 'index.html', 'sw.js', 'manifest.json']) {
    if (!existsSync(join(outDir, page))) problems.push(`missing: ${page}`);
  }
  const files = filesUnder(outDir).map(f => relative(outDir, f).split(sep).join('/')).sort();
  return { files, problems };
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const [outDir, mise2Dist] = process.argv.slice(2);
  if (!outDir || !mise2Dist) {
    console.error('usage: node scripts/build-pages-site.mjs <out-dir> <mise2-dist>');
    process.exit(2);
  }
  const { files, problems } = buildSite(resolve(outDir), resolve(mise2Dist));
  for (const file of files) console.log(file);
  console.log(`${files.length} files in ${outDir}`);
  if (problems.length) {
    console.error(`the site is not right:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
}
