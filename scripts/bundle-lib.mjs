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

// The build's OPTIONS, in ONE object: scripts/build-bundles.mjs builds its esbuild options from it,
// and the manifest records its fingerprint, so changing any option without rebuilding turns
// tests/bundles-fresh.test.mjs red (the sources would be unchanged, and the stale bundle would
// otherwise pass). The build's CODE (the plugins, the manifest format) is not an option: the
// manifest fingerprints the two build scripts themselves (BUILD_SCRIPTS) for that.
export const BUILD_SCRIPTS = Object.freeze(['scripts/build-bundles.mjs', 'scripts/bundle-lib.mjs']);
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
  // Libraries only the recipe export needs (js/recipe-export.js reaches them with import()).
  // With splitting off, esbuild would INLINE a dynamic import, putting ~500 KB into every
  // Calculator open. They stay files of their own, loaded on the tap: the bundle keeps the
  // import() with a path relative to dist/.
  lazyVendorFiles: ['js/vendor/jspdf.esm.js', 'js/vendor/write-excel-file.esm.js'],
  // Stylesheets: the same floor as the scripts (Chrome 80 / Safari 13.1, see sw.js), written for
  // CSS. esbuild's CSS minifier merges and shortens rules; it never drops a selector as unused.
  cssTarget: ['chrome80', 'safari13.1'],
  cssMinify: true,
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

// ── Stylesheets ───────────────────────────────────────────────────────────────────────────
// Every page links its CSS from the root; the browser gets the minified copy dist/<name>.css.

const LINK_TAG = /<link\b[^>]*>/g;
// A tag's attributes, names lower-cased: double-quoted, single-quoted or bare values, any order.
const ATTR = /([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`]+))/g;
export const linkAttrs = tag => {
  const out = {};
  for (const m of tag.matchAll(ATTR)) out[m[1].toLowerCase()] ??= m[2] ?? m[3] ?? m[4];
  return out;
};
const isSheetTag = tag => String(linkAttrs(tag).rel || '').toLowerCase().split(/\s+/).includes('stylesheet');

// The href of every <link rel="stylesheet"> in a page's text, in order.
export const stylesheetHrefs = html =>
  [...String(html).matchAll(LINK_TAG)].filter(m => isSheetTag(m[0])).map(m => linkAttrs(m[0]).href).filter(Boolean);

// { 'index.html': ['tokens.css', …] } — the ROOT stylesheets each page links, whether the link
// names the source (before the swap) or its dist copy.
export function sheetsByPage(root = ROOT) {
  const out = {};
  for (const name of readdirSync(root).filter(n => n.endsWith('.html'))) {
    const hrefs = stylesheetHrefs(readFileSync(join(root, name), 'utf8'));
    if (hrefs.length) out[name] = hrefs;
  }
  return out;
}

// The distinct root stylesheet files the build must minify. A link to anything that is not a plain
// root file (a folder, a URL) is an error: this build would not know to produce it.
export function linkedSheets(root = ROOT) {
  const names = new Set();
  for (const [page, hrefs] of Object.entries(sheetsByPage(root))) {
    for (const href of hrefs) {
      const m = href.match(/^(?:dist\/)?([^/:]+\.css)$/);
      if (!m) throw new Error(`${page} links ${href}, which is not a stylesheet at the root of the repo`);
      if (!existsSync(join(root, m[1]))) throw new Error(`${page} links ${href}, but ${m[1]} does not exist`);
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

// dist/ sits one folder below the sources, so a RELATIVE url() moves one folder up. Absolute,
// protocol, data: and #fragment urls stay. Throws on a target that is not on disk.
// ⚠️ A url() this cannot parse THROWS, it is never skipped: a skipped one would keep a path that now
// points into dist/ and the font or image would silently vanish.
export function rewriteCssUrls(css, { root = ROOT, from = '' } = {}) {
  const text = String(css);
  const open = /url\(/gi;
  let out = '';
  let last = 0;
  for (let m = open.exec(text); m; m = open.exec(text)) {
    let i = m.index + m[0].length;
    while (/\s/.test(text[i] || '')) i += 1;
    const quote = text[i] === '"' || text[i] === "'" ? text[i] : '';
    let target = '';
    if (quote) {
      i += 1;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') throw new Error(`cannot parse a url() near: ${text.slice(m.index, m.index + 60)}`);
        target += text[i];
        i += 1;
      }
      i += 1;
    } else {
      while (i < text.length && !/[\s)"'(]/.test(text[i])) { target += text[i]; i += 1; }
    }
    while (/\s/.test(text[i] || '')) i += 1;
    if (text[i] !== ')') throw new Error(`cannot parse a url() near: ${text.slice(m.index, m.index + 60)}`);
    i += 1;
    open.lastIndex = i;
    if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(target)) continue;
    if (!existsSync(join(root, from, target.split(/[?#]/)[0]))) {
      throw new Error(`a stylesheet points at ${target}, which does not exist`);
    }
    out += `${text.slice(last, m.index)}url(${quote}../${target}${quote})`;
    last = i;
  }
  return out + text.slice(last);
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
  for (const file of BUILD_SCRIPTS) {
    if (!manifest.buildScripts || manifest.buildScripts[file] !== shaOfFile(file, root)) {
      problems.push(`${file} changed since dist/ was built`);
    }
  }
  if (manifest.config !== configSha()) problems.push('the build configuration (BUILD_CONFIG) changed since dist/ was built');

  for (const page of entryPages(root)) {
    if (!outputs[`${DIST_DIR}/${page}.js`]) problems.push(`${PAGES_DIR}/${page}.js has no bundle in the manifest`);
  }
  for (const [out, info] of Object.entries(outputs)) {
    if (!existsSync(join(root, out))) { problems.push(`${out} is listed but missing`); continue; }
    if (shaOfFile(out, root) !== info.sha) problems.push(`${out} was edited by hand or is out of date`);
    if (out.endsWith('.js')) {
      if (!existsSync(join(root, `${out}.map`))) problems.push(`${out}.map is missing`);
      else if (shaOfFile(`${out}.map`, root) !== info.mapSha) problems.push(`${out}.map was edited by hand or is out of date`);
    }
    for (const [input, sha] of Object.entries(info.inputs || {})) {
      if (!existsSync(join(root, input))) problems.push(`${out} was built from ${input}, which no longer exists`);
      else if (shaOfFile(input, root) !== sha) problems.push(`${input} changed since ${out} was built`);
    }
  }
  // A stylesheet is served from dist/ only: a page that links the root source skips the minified
  // copy, and one that links a dist copy nobody built is a page with no styling at all.
  for (const [page, hrefs] of Object.entries(sheetsByPage(root))) {
    for (const href of hrefs) {
      if (!href.startsWith(`${DIST_DIR}/`)) problems.push(`${page} links the source stylesheet ${href} instead of ${DIST_DIR}/${href}`);
      else if (!existsSync(join(root, href))) problems.push(`${page} links ${href}, which does not exist`);
      else if (!outputs[href]) problems.push(`${page} links ${href}, which is not in the manifest`);
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
    // A module tag with a src into js/, in either attribute order, is a native page; an inline
    // module script (no src) cannot be bundled or precached-by-name at all, so it is a fault.
    const native = [...html.matchAll(/<script\b[^>]*>/g)].some(m =>
      /\btype="module"/.test(m[0]) && /\bsrc="js\//.test(m[0]));
    if ([...html.matchAll(/<script\b[^>]*>/g)].some(m => /\btype="module"/.test(m[0]) && !/\bsrc=/.test(m[0]))) {
      problems.push(`${name} has an inline <script type="module">, which no bundle or precache covers`);
    }
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
