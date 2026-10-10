// bundle-lib.mjs — what scripts/build-bundles.mjs and tests/bundles-fresh.test.mjs both need:
// which pages have an entry, how a file is fingerprinted, and how the manifest is read.
// One copy, so the script that WRITES the fingerprints and the test that CHECKS them cannot
// drift apart. No dependency: CI's test job installs nothing, and this must load there.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PAGES_DIR = 'js/pages';
export const DIST_DIR = 'dist';
export const MANIFEST_FILE = 'dist/build-manifest.json';
// The loader every entry imports. It is part of each bundle, never a bundle of its own.
export const SHARED_HELPER = 'run-in-order.js';
export const SHA_LENGTH = 16;

// ⚠️ PAGES THAT KEEP NATIVE <script type="module"> TAGS ON PURPOSE. A page is bundled unless it is
// named here, so one cannot silently fall out of bundling (tests/bundles-fresh.test.mjs fails on a
// page with module tags that is not listed, and on a listed page that gained a bundle tag).
//   reset-password.html: js/reset-password-boot.js draws «Checking your link…», shows the «update the
//   app» message when the real page cannot run, and forwards email actions that are not a password
//   reset — all WITHOUT the Firebase SDK. A bundle imports the SDK at the top, so all of that would
//   wait for it and die with it.
export const NATIVE_MODULE_PAGES = Object.freeze(['reset-password.html']);

// Everything that decides what the build writes, in ONE object: scripts/build-bundles.mjs builds
// its esbuild options from it, and the manifest records its fingerprint, so changing any option
// without rebuilding turns tests/bundles-fresh.test.mjs red (the sources would be unchanged, and
// the stale bundle would otherwise pass).
export const BUILD_CONFIG = Object.freeze({
  bundle: true,
  format: 'esm',
  splitting: false,          // code splitting can reorder module evaluation across chunks
  // 2020-era browsers are the floor (optional chaining, nullish coalescing in the SDK itself); a
  // newer target lets the minifier write `||=`, which they cannot parse.
  target: 'es2020',
  minifyWhitespace: true,
  minifySyntax: true,
  minifyIdentifiers: false,  // function names stay readable in error reports
  legalComments: 'eof',
  sourcemap: 'linked',
  sourcesContent: false,
  externalUrlPattern: '^https?://',   // the Firebase SDK stays an import from gstatic
  i18nSource: 'js/i18n.js',           // one instance per page, written once as dist/i18n.js
  i18nExternalPath: './i18n.js',
});

export const configSha = (config = BUILD_CONFIG) => shaOfText(JSON.stringify(config));

// The esbuild version package.json pins exactly (devDependencies), or null.
export function pinnedEsbuild(root = ROOT) {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return (pkg.devDependencies && pkg.devDependencies.esbuild) || null;
  } catch { return null; }
}

// A checkout on Windows has CRLF (core.autocrlf), CI and GitHub Pages have LF. Every
// fingerprint is taken on the LF form, so it comes out the same on both.
export const toLF = text => text.replace(/\r\n/g, '\n');

export const shaOfText = text =>
  createHash('sha256').update(toLF(text)).digest('hex').slice(0, SHA_LENGTH);

export const shaOfFile = (file, root = ROOT) => shaOfText(readFileSync(join(root, file), 'utf8'));

// «index» for js/pages/index.js — every entry file except the shared loader.
export function entryPages(root = ROOT) {
  return readdirSync(join(root, PAGES_DIR))
    .filter(n => n.endsWith('.js') && n !== SHARED_HELPER)
    .map(n => n.slice(0, -3))
    .sort();
}

export function readManifest(root = ROOT) {
  const file = join(root, MANIFEST_FILE);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

// Every `dist/<name>.js` a page loads with a <script> tag: { 'index.html': ['dist/index.js'] }.
export function bundleTagsByPage(root = ROOT) {
  const out = {};
  for (const name of readdirSync(root).filter(n => n.endsWith('.html'))) {
    const html = readFileSync(join(root, name), 'utf8');
    const tags = [...html.matchAll(/<script\b[^>]*\bsrc="(dist\/[^"]+)"[^>]*>/g)].map(m => m[1]);
    if (tags.length) out[name] = tags;
  }
  return out;
}

// What is wrong between the manifest and the files on disk. Empty means fresh.
export function manifestProblems(root = ROOT) {
  const problems = [];
  const manifest = readManifest(root);
  if (!manifest) return [`${MANIFEST_FILE} is missing`];
  const outputs = manifest.outputs || {};

  // The tool and its settings are part of what the bundles are a function of.
  const pin = pinnedEsbuild(root);
  if (pin && manifest.esbuild !== pin) {
    problems.push(`dist/ was built with esbuild ${manifest.esbuild}, package.json pins ${pin}`);
  }
  if (manifest.config !== configSha()) problems.push('the build configuration (BUILD_CONFIG) changed since dist/ was built');

  for (const page of entryPages(root)) {
    if (!outputs[`${DIST_DIR}/${page}.js`]) problems.push(`${PAGES_DIR}/${page}.js has no bundle in the manifest`);
  }
  for (const [out, info] of Object.entries(outputs)) {
    if (!existsSync(join(root, out))) { problems.push(`${out} is listed but missing`); continue; }
    if (shaOfFile(out, root) !== info.sha) problems.push(`${out} was edited by hand or is out of date`);
    if (!existsSync(join(root, `${out}.map`))) problems.push(`${out}.map is missing`);
    else if (shaOfFile(`${out}.map`, root) !== info.mapSha) problems.push(`${out}.map was edited by hand or is out of date`);
    for (const [input, sha] of Object.entries(info.inputs || {})) {
      if (!existsSync(join(root, input))) problems.push(`${out} was built from ${input}, which no longer exists`);
      else if (shaOfFile(input, root) !== sha) problems.push(`${input} changed since ${out} was built`);
    }
  }
  const tagged = bundleTagsByPage(root);
  for (const [page, tags] of Object.entries(tagged)) {
    for (const tag of tags) if (!existsSync(join(root, tag))) problems.push(`${page} loads ${tag}, which does not exist`);
    if (NATIVE_MODULE_PAGES.includes(page)) problems.push(`${page} is on the native-module allowlist but loads a bundle`);
  }
  // A page is bundled unless it is on the allowlist: native module tags anywhere else are a page
  // that fell out of bundling.
  for (const name of readdirSync(root).filter(n => n.endsWith('.html'))) {
    const html = readFileSync(join(root, name), 'utf8');
    const native = /<script\b[^>]*type="module"[^>]*\bsrc="js\//.test(html);
    if (native && !NATIVE_MODULE_PAGES.includes(name)) problems.push(`${name} has native module tags but is not on the NATIVE_MODULE_PAGES allowlist`);
    if (NATIVE_MODULE_PAGES.includes(name) && !native) problems.push(`${name} is on the native-module allowlist but has no module tag`);
  }
  for (const page of entryPages(root)) {
    if (!(tagged[`${page}.html`] || []).includes(`${DIST_DIR}/${page}.js`)) {
      problems.push(`js/pages/${page}.js exists but ${page}.html does not load ${DIST_DIR}/${page}.js`);
    }
  }
  return problems;
}
